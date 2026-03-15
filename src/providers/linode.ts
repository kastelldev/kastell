import crypto from "crypto";
import { apiClient, stripSensitiveData, withProviderErrorHandling, assertValidServerId, uploadSshKeyWithConflict, type CloudProvider } from "./base.js";
import { withRetry } from "../utils/retry.js";
import type { Region, ServerSize, ServerConfig, ServerResult, SnapshotInfo, ServerMode } from "../types/index.js";
import { formatSnapshotCost } from "../constants.js";

interface LinodeType {
  id: string;
  label: string;
  vcpus: number;
  memory: number;
  disk: number;
  price: { monthly: number };
}

interface LinodeRegion {
  id: string;
  label: string;
  country: string;
  status: string;
  capabilities: string[];
}

interface LinodeErrorResponse {
  errors: { reason: string }[];
}

function extractLinodeError(data: unknown): string | undefined {
  const d = data as LinodeErrorResponse | undefined;
  if (!Array.isArray(d?.errors)) return undefined;
  const reasons = d.errors.map((e) => e.reason).join(", ");
  return reasons || undefined;
}

export class LinodeProvider implements CloudProvider {
  name = "linode";
  displayName = "Linode (Akamai)";
  private apiToken: string;
  private baseUrl = "https://api.linode.com/v4";

  constructor(apiToken: string) {
    this.apiToken = apiToken;
  }

  async validateToken(token: string): Promise<boolean> {
    try {
      await withRetry(async () => {
        await apiClient.get(`${this.baseUrl}/profile`, {
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
      createPath: "/profile/sshkeys",
      bodyKeyField: "ssh_key",
      nameField: "label",
      listPath: "/profile/sshkeys",
      listArrayField: "data",
      listKeyField: "ssh_key",
      conflictStatuses: [400],
    });
  }

  async createServer(config: ServerConfig): Promise<ServerResult> {
    return withProviderErrorHandling("create server", async () => {
      // Ensure all character classes for Linode password strength: upper + lower + digit + special
      const rootPass = `Ql1!${crypto.randomBytes(21).toString("base64").slice(0, 28)}`;

      const body: Record<string, unknown> = {
        label: config.name,
        type: config.size,
        region: config.region,
        image: "linode/ubuntu24.04",
        root_pass: rootPass,
        metadata: { user_data: Buffer.from(config.cloudInit).toString("base64") },
      };
      if (config.sshKeyIds?.length) {
        // Linode uses authorized_users (profile usernames) to inject SSH keys.
        // Fetch profile username; if it fails, cloud-init handles SSH key injection as fallback.
        try {
          const profileRes = await apiClient.get(`${this.baseUrl}/profile`, {
            headers: { Authorization: `Bearer ${this.apiToken}` },
          });
          const username = profileRes.data?.username;
          if (typeof username === "string" && username.length > 0) {
            body.authorized_users = [username];
          }
        } catch {
          // Profile fetch failed; cloud-init will handle SSH key setup
        }
      }
      const response = await apiClient.post(`${this.baseUrl}/linode/instances`, body, {
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
        },
      });

      const instance = response.data;
      return {
        id: instance.id.toString(),
        ip: instance.ipv4?.[0] || "pending",
        status: instance.status === "provisioning" ? "initializing" : instance.status,
      };
    }, extractLinodeError);
  }

  async getServerDetails(serverId: string): Promise<ServerResult> {
    assertValidServerId(serverId);
    return withProviderErrorHandling("get server details", () =>
      withRetry(async () => {
        const response = await apiClient.get(`${this.baseUrl}/linode/instances/${serverId}`, {
          headers: { Authorization: `Bearer ${this.apiToken}` },
        });
        const instance = response.data;
        return {
          id: instance.id.toString(),
          ip: instance.ipv4?.[0] || "pending",
          status: instance.status === "running" ? "running" : instance.status,
        };
      }),
    );
  }

  async getServerStatus(serverId: string): Promise<string> {
    assertValidServerId(serverId);
    return withProviderErrorHandling("get server status", () =>
      withRetry(async () => {
        const response = await apiClient.get(`${this.baseUrl}/linode/instances/${serverId}`, {
          headers: { Authorization: `Bearer ${this.apiToken}` },
        });
        return response.data.status;
      }),
    );
  }

  async destroyServer(serverId: string): Promise<void> {
    assertValidServerId(serverId);
    return withProviderErrorHandling("destroy server", async () => {
      await apiClient.delete(`${this.baseUrl}/linode/instances/${serverId}`, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
      });
    }, extractLinodeError);
  }

  async rebootServer(serverId: string): Promise<void> {
    assertValidServerId(serverId);
    return withProviderErrorHandling("reboot server", async () => {
      await apiClient.post(
        `${this.baseUrl}/linode/instances/${serverId}/reboot`,
        {},
        {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            "Content-Type": "application/json",
          },
        },
      );
    }, extractLinodeError);
  }

  getRegions(): Region[] {
    return [
      { id: "us-east", name: "Newark, NJ", location: "USA" },
      { id: "eu-west", name: "London", location: "UK" },
      { id: "eu-central", name: "Frankfurt", location: "Germany" },
      { id: "ap-south", name: "Singapore", location: "Singapore" },
    ];
  }

  getServerSizes(): ServerSize[] {
    return [
      { id: "g6-standard-2", name: "Linode 4GB", vcpu: 2, ram: 4, disk: 80, price: "$12/mo" },
      { id: "g6-standard-4", name: "Linode 8GB", vcpu: 4, ram: 8, disk: 160, price: "$24/mo" },
      { id: "g6-standard-6", name: "Linode 16GB", vcpu: 6, ram: 16, disk: 320, price: "$48/mo" },
    ];
  }

  async getAvailableLocations(): Promise<Region[]> {
    try {
      return await withRetry(async () => {
        const response = await apiClient.get(`${this.baseUrl}/regions`, {
          headers: { Authorization: `Bearer ${this.apiToken}` },
        });
        return response.data.data
          .filter((r: LinodeRegion) => r.status === "ok" && r.capabilities.includes("Linodes"))
          .map((r: LinodeRegion) => ({
            id: r.id,
            name: r.label,
            location: r.country,
          }));
      });
    } catch (error: unknown) {
      stripSensitiveData(error);
      return this.getRegions();
    }
  }

  async getAvailableServerTypes(_location: string, mode?: ServerMode): Promise<ServerSize[]> {
    try {
      return await withRetry(async () => {
        const response = await apiClient.get(`${this.baseUrl}/linode/types`, {
          headers: { Authorization: `Bearer ${this.apiToken}` },
        });

        const MIN_RAM_MB = mode === "bare" ? 0 : 4096; // Coolify requires at least 2GB, recommend 4GB. Bare has no minimum
        const types = response.data.data.filter(
          (t: LinodeType) => t.memory >= MIN_RAM_MB && t.id.startsWith("g6-standard"),
        );

        if (types.length === 0) {
          return this.getServerSizes();
        }

        return types.map((t: LinodeType) => ({
          id: t.id,
          name: t.label,
          vcpu: t.vcpus,
          ram: Math.round(t.memory / 1024),
          disk: Math.round(t.disk / 1024),
          price: `$${t.price.monthly.toFixed(2)}/mo`,
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
      // Get the first disk to create image from
      const disksResponse = await apiClient.get(
        `${this.baseUrl}/linode/instances/${serverId}/disks`,
        { headers: { Authorization: `Bearer ${this.apiToken}` } },
      );
      const disks = disksResponse.data.data;
      if (!disks || disks.length === 0) {
        throw new Error("No disks found on this instance");
      }
      // Use the largest disk
      const disk = disks.sort((a: { size: number }, b: { size: number }) => b.size - a.size)[0];

      const response = await apiClient.post(
        `${this.baseUrl}/images`,
        { disk_id: disk.id, label: name },
        {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            "Content-Type": "application/json",
          },
        },
      );
      const image = response.data;
      return {
        id: image.id,
        serverId,
        name: image.label || name,
        status: image.status,
        sizeGb: image.size ? image.size / 1024 : 0,
        createdAt: image.created,
        costPerMonth: formatSnapshotCost("linode", image.size ? image.size / 1024 : 0),
      };
    }, extractLinodeError);
  }

  async listSnapshots(serverId: string): Promise<SnapshotInfo[]> {
    return withProviderErrorHandling("list snapshots", () =>
      withRetry(async () => {
        const response = await apiClient.get(
          `${this.baseUrl}/images?page=1&page_size=100`,
          { headers: { Authorization: `Bearer ${this.apiToken}` } },
        );
        const images = response.data.data.filter(
          (img: { type: string; label: string }) =>
            img.type === "manual" && img.label && (img.label.startsWith("kastell-") || img.label.startsWith("quicklify-")),
        );
        return images.map(
          (img: { id: string; label: string; status: string; size: number; created: string }) => ({
            id: img.id,
            serverId,
            name: img.label || "",
            status: img.status,
            sizeGb: img.size ? img.size / 1024 : 0,
            createdAt: img.created,
            costPerMonth: formatSnapshotCost("linode", img.size ? img.size / 1024 : 0),
          }),
        );
      }),
    extractLinodeError);
  }

  async deleteSnapshot(snapshotId: string): Promise<void> {
    assertValidServerId(snapshotId);
    return withProviderErrorHandling("delete snapshot", async () => {
      await apiClient.delete(`${this.baseUrl}/images/${snapshotId}`, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
      });
    }, extractLinodeError);
  }

  async getSnapshotCostEstimate(serverId: string): Promise<string> {
    assertValidServerId(serverId);
    return withProviderErrorHandling("get snapshot cost", () =>
      withRetry(async () => {
        const response = await apiClient.get(`${this.baseUrl}/linode/instances/${serverId}`, {
          headers: { Authorization: `Bearer ${this.apiToken}` },
        });
        const diskMb = response.data.specs?.disk || response.data.disk || 0;
        const diskGb = diskMb / 1024;
        return `$${(diskGb * 0.004).toFixed(2)}/mo`;
      }),
    extractLinodeError);
  }
}
