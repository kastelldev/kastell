import { apiClient, stripSensitiveData, withProviderErrorHandling, assertValidServerId, uploadSshKeyWithConflict, type CloudProvider } from "./base.js";
import { withRetry } from "../utils/retry.js";
import type { Region, ServerSize, ServerConfig, ServerResult, SnapshotInfo, ServerMode } from "../types/index.js";
import { VULTR_UBUNTU_OS_ID, formatSnapshotCost } from "../constants.js";

interface VultrPlan {
  id: string;
  vcpu_count: number;
  ram: number;
  disk: number;
  monthly_cost: number;
  locations: string[];
  type: string;
}

interface VultrRegion {
  id: string;
  city: string;
  country: string;
  options: string[];
}

interface VultrErrorResponse {
  error: string;
}

function extractVultrError(data: unknown): string | undefined {
  const d = data as VultrErrorResponse | undefined;
  return typeof d?.error === "string" ? d.error : undefined;
}

export class VultrProvider implements CloudProvider {
  name = "vultr";
  displayName = "Vultr";
  private apiToken: string;
  private baseUrl = "https://api.vultr.com/v2";

  constructor(apiToken: string) {
    this.apiToken = apiToken;
  }

  async validateToken(token: string): Promise<boolean> {
    try {
      await withRetry(async () => {
        await apiClient.get(`${this.baseUrl}/account`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      });
      return true;
    } catch {
      return false;
    }
  }

  async uploadSshKey(name: string, publicKey: string): Promise<string> {
    return uploadSshKeyWithConflict(name, publicKey, {
      apiToken: this.apiToken,
      baseUrl: this.baseUrl,
      createPath: "/ssh-keys",
      bodyKeyField: "ssh_key",
      listPath: "/ssh-keys",
      listArrayField: "ssh_keys",
      listKeyField: "ssh_key",
      conflictStatuses: [409],
      idToString: false,
    });
  }

  async createServer(config: ServerConfig): Promise<ServerResult> {
    return withProviderErrorHandling("create server", async () => {
      const body: Record<string, unknown> = {
        label: config.name,
        plan: config.size,
        region: config.region,
        os_id: VULTR_UBUNTU_OS_ID,
        user_data: Buffer.from(config.cloudInit).toString("base64"),
      };
      if (config.sshKeyIds?.length) {
        body.sshkey_id = config.sshKeyIds;
      }
      const response = await apiClient.post(`${this.baseUrl}/instances`, body, {
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
        },
      });

      const instance = response.data.instance;
      return {
        id: instance.id,
        ip: instance.main_ip || "pending",
        status: instance.power_status,
      };
    }, extractVultrError);
  }

  async getServerDetails(serverId: string): Promise<ServerResult> {
    assertValidServerId(serverId);
    return withProviderErrorHandling("get server details", () =>
      withRetry(async () => {
        const response = await apiClient.get(`${this.baseUrl}/instances/${serverId}`, {
          headers: { Authorization: `Bearer ${this.apiToken}` },
        });
        const instance = response.data.instance;
        return {
          id: instance.id,
          ip: instance.main_ip,
          status: instance.power_status === "running" ? "running" : instance.power_status,
        };
      }),
    );
  }

  async getServerStatus(serverId: string): Promise<string> {
    assertValidServerId(serverId);
    return withProviderErrorHandling("get server status", () =>
      withRetry(async () => {
        const response = await apiClient.get(`${this.baseUrl}/instances/${serverId}`, {
          headers: { Authorization: `Bearer ${this.apiToken}` },
        });
        const inst = response.data.instance;
        // Vultr reports power_status=running before server is fully provisioned.
        // server_status progresses: none → locked → installingbooting → ok
        if (inst.power_status === "running" && inst.server_status != null && inst.server_status !== "ok") {
          return "provisioning";
        }
        return inst.power_status;
      }),
    );
  }

  async destroyServer(serverId: string): Promise<void> {
    assertValidServerId(serverId);
    return withProviderErrorHandling("destroy server", async () => {
      await apiClient.delete(`${this.baseUrl}/instances/${serverId}`, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
      });
    }, extractVultrError);
  }

  async rebootServer(serverId: string): Promise<void> {
    assertValidServerId(serverId);
    return withProviderErrorHandling("reboot server", async () => {
      await apiClient.post(
        `${this.baseUrl}/instances/${serverId}/reboot`,
        {},
        {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            "Content-Type": "application/json",
          },
        },
      );
    }, extractVultrError);
  }

  getRegions(): Region[] {
    return [
      { id: "ewr", name: "New Jersey", location: "USA" },
      { id: "ord", name: "Chicago", location: "USA" },
      { id: "ams", name: "Amsterdam", location: "Netherlands" },
      { id: "fra", name: "Frankfurt", location: "Germany" },
    ];
  }

  getServerSizes(): ServerSize[] {
    return [
      { id: "vc2-1c-2gb", name: "VC2-1C-2GB", vcpu: 1, ram: 2, disk: 55, price: "$10/mo" },
      { id: "vc2-2c-4gb", name: "VC2-2C-4GB", vcpu: 2, ram: 4, disk: 80, price: "$20/mo" },
      { id: "vc2-4c-8gb", name: "VC2-4C-8GB", vcpu: 4, ram: 8, disk: 160, price: "$40/mo" },
    ];
  }

  async getAvailableLocations(): Promise<Region[]> {
    try {
      return await withRetry(async () => {
        const response = await apiClient.get(`${this.baseUrl}/regions`, {
          headers: { Authorization: `Bearer ${this.apiToken}` },
        });
        return response.data.regions
          .filter((r: VultrRegion) => r.options && r.options.length > 0)
          .map((r: VultrRegion) => ({
            id: r.id,
            name: r.city,
            location: r.country,
          }));
      });
    } catch (error: unknown) {
      stripSensitiveData(error);
      return this.getRegions();
    }
  }

  async getAvailableServerTypes(location: string, mode?: ServerMode): Promise<ServerSize[]> {
    try {
      return await withRetry(async () => {
        const response = await apiClient.get(`${this.baseUrl}/plans`, {
          headers: { Authorization: `Bearer ${this.apiToken}` },
        });

        const MIN_RAM_MB = mode === "bare" ? 0 : 2048; // Coolify requires at least 2GB RAM, bare has no minimum
        const plans = response.data.plans.filter(
          (p: VultrPlan) => p.type === "vc2" && p.ram >= MIN_RAM_MB && p.locations.includes(location),
        );

        if (plans.length === 0) {
          return this.getServerSizes();
        }

        return plans.map((p: VultrPlan) => ({
          id: p.id,
          name: p.id.toUpperCase(),
          vcpu: p.vcpu_count,
          ram: p.ram / 1024,
          disk: p.disk,
          price: `$${p.monthly_cost.toFixed(2)}/mo`,
        }));
      });
    } catch (error: unknown) {
      stripSensitiveData(error);
      return this.getServerSizes();
    }
  }

  async createSnapshot(serverId: string, name: string): Promise<SnapshotInfo> {
    assertValidServerId(serverId);
    return withProviderErrorHandling("create snapshot", async () => {
      const response = await apiClient.post(
        `${this.baseUrl}/snapshots`,
        { instance_id: serverId, description: name },
        {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            "Content-Type": "application/json",
          },
        },
      );
      const snap = response.data.snapshot;
      return {
        id: snap.id,
        serverId,
        name: snap.description || name,
        status: snap.status,
        sizeGb: snap.size ? snap.size / (1024 * 1024 * 1024) : 0,
        createdAt: snap.date_created,
        costPerMonth: formatSnapshotCost("vultr", snap.size ? snap.size / (1024 * 1024 * 1024) : 0),
      };
    }, extractVultrError);
  }

  async listSnapshots(serverId: string): Promise<SnapshotInfo[]> {
    assertValidServerId(serverId);
    return withProviderErrorHandling("list snapshots", () =>
      withRetry(async () => {
        // Vultr API does not return instance_id in snapshot list,
        // so we return all account snapshots (they are account-wide, not per-instance).
        const response = await apiClient.get(`${this.baseUrl}/snapshots`, {
          headers: { Authorization: `Bearer ${this.apiToken}` },
        });
        const snapshots = response.data.snapshots || [];
        return snapshots.map(
          (s: { id: string; description: string; status: string; size: number; date_created: string }) => ({
            id: s.id,
            serverId,
            name: s.description || "",
            status: s.status,
            sizeGb: s.size ? s.size / (1024 * 1024 * 1024) : 0,
            createdAt: s.date_created,
            costPerMonth: formatSnapshotCost("vultr", s.size ? s.size / (1024 * 1024 * 1024) : 0),
          }),
        );
      }),
    extractVultrError);
  }

  async deleteSnapshot(snapshotId: string): Promise<void> {
    assertValidServerId(snapshotId);
    return withProviderErrorHandling("delete snapshot", async () => {
      await apiClient.delete(`${this.baseUrl}/snapshots/${snapshotId}`, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
      });
    }, extractVultrError);
  }

  async getSnapshotCostEstimate(serverId: string): Promise<string> {
    assertValidServerId(serverId);
    return withProviderErrorHandling("get snapshot cost", () =>
      withRetry(async () => {
        const response = await apiClient.get(`${this.baseUrl}/instances/${serverId}`, {
          headers: { Authorization: `Bearer ${this.apiToken}` },
        });
        const diskGb = response.data.instance?.disk || 0;
        return formatSnapshotCost("vultr", diskGb);
      }),
    extractVultrError);
  }
}
