import axios from "axios";
import { apiClient, stripSensitiveData, withProviderErrorHandling, assertValidServerId, type CloudProvider } from "./base.js";
import type { Region, ServerSize, ServerConfig, ServerResult, SnapshotInfo, ServerMode } from "../types/index.js";

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
      await apiClient.get(`${this.baseUrl}/account`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return true;
    } catch {
      return false;
    }
  }

  async uploadSshKey(name: string, publicKey: string): Promise<string> {
    try {
      const response = await apiClient.post(
        `${this.baseUrl}/ssh-keys`,
        { name, ssh_key: publicKey },
        {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            "Content-Type": "application/json",
          },
        },
      );
      return response.data.ssh_key.id;
    } catch (error: unknown) {
      stripSensitiveData(error);
      // Key already exists -> find by matching public key
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        const listResponse = await apiClient.get(`${this.baseUrl}/ssh-keys`, {
          headers: { Authorization: `Bearer ${this.apiToken}` },
        });
        const existing = listResponse.data.ssh_keys.find(
          (k: { ssh_key: string }) => k.ssh_key.trim() === publicKey.trim(),
        );
        if (existing) return existing.id;
      }
      throw new Error(
        `Failed to upload SSH key: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  async createServer(config: ServerConfig): Promise<ServerResult> {
    try {
      const body: Record<string, unknown> = {
        label: config.name,
        plan: config.size,
        region: config.region,
        os_id: 2284, // Ubuntu 24.04
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
    } catch (error: unknown) {
      stripSensitiveData(error);
      if (axios.isAxiosError<VultrErrorResponse>(error)) {
        throw new Error(
          `Failed to create server: ${error.response?.data?.error || error.message}`,
          { cause: error },
        );
      }
      throw new Error(
        `Failed to create server: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  async getServerDetails(serverId: string): Promise<ServerResult> {
    assertValidServerId(serverId);
    return withProviderErrorHandling("get server details", async () => {
      const response = await apiClient.get(`${this.baseUrl}/instances/${serverId}`, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
      });
      const instance = response.data.instance;
      return {
        id: instance.id,
        ip: instance.main_ip,
        status: instance.power_status === "running" ? "running" : instance.power_status,
      };
    });
  }

  async getServerStatus(serverId: string): Promise<string> {
    assertValidServerId(serverId);
    return withProviderErrorHandling("get server status", async () => {
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
    });
  }

  async destroyServer(serverId: string): Promise<void> {
    assertValidServerId(serverId);
    try {
      await apiClient.delete(`${this.baseUrl}/instances/${serverId}`, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
      });
    } catch (error: unknown) {
      stripSensitiveData(error);
      if (axios.isAxiosError<VultrErrorResponse>(error)) {
        throw new Error(
          `Failed to destroy server: ${error.response?.data?.error || error.message}`,
          { cause: error },
        );
      }
      throw new Error(
        `Failed to destroy server: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  async rebootServer(serverId: string): Promise<void> {
    assertValidServerId(serverId);
    try {
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
    } catch (error: unknown) {
      stripSensitiveData(error);
      if (axios.isAxiosError<VultrErrorResponse>(error)) {
        throw new Error(
          `Failed to reboot server: ${error.response?.data?.error || error.message}`,
          { cause: error },
        );
      }
      throw new Error(
        `Failed to reboot server: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
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
    } catch (error: unknown) {
      stripSensitiveData(error);
      return this.getRegions();
    }
  }

  async getAvailableServerTypes(location: string, mode?: ServerMode): Promise<ServerSize[]> {
    try {
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
    } catch (error: unknown) {
      stripSensitiveData(error);
      return this.getServerSizes();
    }
  }

  async createSnapshot(serverId: string, name: string): Promise<SnapshotInfo> {
    assertValidServerId(serverId);
    try {
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
        costPerMonth: `$${(snap.size ? (snap.size / (1024 * 1024 * 1024)) * 0.05 : 0).toFixed(2)}/mo`,
      };
    } catch (error: unknown) {
      stripSensitiveData(error);
      if (axios.isAxiosError<VultrErrorResponse>(error)) {
        throw new Error(
          `Failed to create snapshot: ${error.response?.data?.error || error.message}`,
          { cause: error },
        );
      }
      throw new Error(
        `Failed to create snapshot: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  async listSnapshots(serverId: string): Promise<SnapshotInfo[]> {
    assertValidServerId(serverId);
    try {
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
          costPerMonth: `$${(s.size ? (s.size / (1024 * 1024 * 1024)) * 0.05 : 0).toFixed(2)}/mo`,
        }),
      );
    } catch (error: unknown) {
      stripSensitiveData(error);
      if (axios.isAxiosError<VultrErrorResponse>(error)) {
        throw new Error(
          `Failed to list snapshots: ${error.response?.data?.error || error.message}`,
          { cause: error },
        );
      }
      throw new Error(
        `Failed to list snapshots: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  async deleteSnapshot(snapshotId: string): Promise<void> {
    assertValidServerId(snapshotId);
    try {
      await apiClient.delete(`${this.baseUrl}/snapshots/${snapshotId}`, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
      });
    } catch (error: unknown) {
      stripSensitiveData(error);
      if (axios.isAxiosError<VultrErrorResponse>(error)) {
        throw new Error(
          `Failed to delete snapshot: ${error.response?.data?.error || error.message}`,
          { cause: error },
        );
      }
      throw new Error(
        `Failed to delete snapshot: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  async getSnapshotCostEstimate(serverId: string): Promise<string> {
    assertValidServerId(serverId);
    try {
      const response = await apiClient.get(`${this.baseUrl}/instances/${serverId}`, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
      });
      const diskGb = response.data.instance?.disk || 0;
      return `$${(diskGb * 0.05).toFixed(2)}/mo`;
    } catch (error: unknown) {
      stripSensitiveData(error);
      if (axios.isAxiosError<VultrErrorResponse>(error)) {
        throw new Error(
          `Failed to get snapshot cost: ${error.response?.data?.error || error.message}`,
          { cause: error },
        );
      }
      throw new Error(
        `Failed to get snapshot cost: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
}
