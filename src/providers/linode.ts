import crypto from "crypto";
import axios from "axios";
import { stripSensitiveData, type CloudProvider } from "./base.js";
import type { Region, ServerSize, ServerConfig, ServerResult, SnapshotInfo, ServerMode } from "../types/index.js";

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
      await axios.get(`${this.baseUrl}/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return true;
    } catch {
      return false;
    }
  }

  async uploadSshKey(name: string, publicKey: string): Promise<string> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/profile/sshkeys`,
        { label: name, ssh_key: publicKey },
        {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            "Content-Type": "application/json",
          },
        },
      );
      return response.data.id.toString();
    } catch (error: unknown) {
      stripSensitiveData(error);
      // Key already exists → find by matching public key
      if (axios.isAxiosError(error) && error.response?.status === 400) {
        const listResponse = await axios.get(`${this.baseUrl}/profile/sshkeys`, {
          headers: { Authorization: `Bearer ${this.apiToken}` },
        });
        const existing = listResponse.data.data.find(
          (k: { ssh_key: string }) => k.ssh_key.trim() === publicKey.trim(),
        );
        if (existing) return existing.id.toString();
      }
      throw new Error(
        `Failed to upload SSH key: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  async createServer(config: ServerConfig): Promise<ServerResult> {
    try {
      // Ensure all character classes for Linode password strength: upper + lower + digit + special
      const rootPass = `Ql1!${crypto.randomBytes(21).toString("base64").slice(0, 28)}`;

      const body: Record<string, unknown> = {
        label: config.name,
        type: config.size,
        region: config.region,
        image: "linode/ubuntu22.04",
        root_pass: rootPass,
        metadata: { user_data: Buffer.from(config.cloudInit).toString("base64") },
      };
      if (config.sshKeyIds?.length) {
        // Linode uses authorized_users (profile usernames) to inject SSH keys.
        // Fetch profile username; if it fails, cloud-init handles SSH key injection as fallback.
        try {
          const profileRes = await axios.get(`${this.baseUrl}/profile`, {
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
      const response = await axios.post(`${this.baseUrl}/linode/instances`, body, {
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
    } catch (error: unknown) {
      stripSensitiveData(error);
      if (axios.isAxiosError<LinodeErrorResponse>(error)) {
        const reasons = error.response?.data?.errors?.map((e) => e.reason).join(", ");
        throw new Error(`Failed to create server: ${reasons || error.message}`, { cause: error });
      }
      throw new Error(
        `Failed to create server: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  async getServerDetails(serverId: string): Promise<ServerResult> {
    try {
      const response = await axios.get(`${this.baseUrl}/linode/instances/${serverId}`, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
      });
      const instance = response.data;
      return {
        id: instance.id.toString(),
        ip: instance.ipv4?.[0] || "pending",
        status: instance.status === "running" ? "running" : instance.status,
      };
    } catch (error: unknown) {
      stripSensitiveData(error);
      throw new Error(
        `Failed to get server details: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  async getServerStatus(serverId: string): Promise<string> {
    try {
      const response = await axios.get(`${this.baseUrl}/linode/instances/${serverId}`, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
      });
      return response.data.status;
    } catch (error: unknown) {
      stripSensitiveData(error);
      throw new Error(
        `Failed to get server status: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  async destroyServer(serverId: string): Promise<void> {
    try {
      await axios.delete(`${this.baseUrl}/linode/instances/${serverId}`, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
      });
    } catch (error: unknown) {
      stripSensitiveData(error);
      if (axios.isAxiosError<LinodeErrorResponse>(error)) {
        const reasons = error.response?.data?.errors?.map((e) => e.reason).join(", ");
        throw new Error(`Failed to destroy server: ${reasons || error.message}`, { cause: error });
      }
      throw new Error(
        `Failed to destroy server: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  async rebootServer(serverId: string): Promise<void> {
    try {
      await axios.post(
        `${this.baseUrl}/linode/instances/${serverId}/reboot`,
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
      if (axios.isAxiosError<LinodeErrorResponse>(error)) {
        const reasons = error.response?.data?.errors?.map((e) => e.reason).join(", ");
        throw new Error(`Failed to reboot server: ${reasons || error.message}`, { cause: error });
      }
      throw new Error(
        `Failed to reboot server: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
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
      const response = await axios.get(`${this.baseUrl}/regions`, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
      });
      return response.data.data
        .filter((r: LinodeRegion) => r.status === "ok" && r.capabilities.includes("Linodes"))
        .map((r: LinodeRegion) => ({
          id: r.id,
          name: r.label,
          location: r.country,
        }));
    } catch (error: unknown) {
      stripSensitiveData(error);
      return this.getRegions();
    }
  }

  async getAvailableServerTypes(_location: string, mode?: ServerMode): Promise<ServerSize[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/linode/types`, {
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
    } catch (error: unknown) {
      stripSensitiveData(error);
      return this.getServerSizes();
    }
  }

  async createSnapshot(serverId: string, name: string): Promise<SnapshotInfo> {
    try {
      // Get the first disk to create image from
      const disksResponse = await axios.get(
        `${this.baseUrl}/linode/instances/${serverId}/disks`,
        { headers: { Authorization: `Bearer ${this.apiToken}` } },
      );
      const disks = disksResponse.data.data;
      if (!disks || disks.length === 0) {
        throw new Error("No disks found on this instance");
      }
      // Use the largest disk
      const disk = disks.sort((a: { size: number }, b: { size: number }) => b.size - a.size)[0];

      const response = await axios.post(
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
        costPerMonth: `$${(image.size ? (image.size / 1024) * 0.004 : 0).toFixed(2)}/mo`,
      };
    } catch (error: unknown) {
      stripSensitiveData(error);
      if (axios.isAxiosError<LinodeErrorResponse>(error)) {
        const reasons = error.response?.data?.errors?.map((e) => e.reason).join(", ");
        throw new Error(`Failed to create snapshot: ${reasons || error.message}`, { cause: error });
      }
      throw new Error(
        `Failed to create snapshot: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  async listSnapshots(serverId: string): Promise<SnapshotInfo[]> {
    try {
      const response = await axios.get(
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
          costPerMonth: `$${(img.size ? (img.size / 1024) * 0.004 : 0).toFixed(2)}/mo`,
        }),
      );
    } catch (error: unknown) {
      stripSensitiveData(error);
      if (axios.isAxiosError<LinodeErrorResponse>(error)) {
        const reasons = error.response?.data?.errors?.map((e) => e.reason).join(", ");
        throw new Error(`Failed to list snapshots: ${reasons || error.message}`, { cause: error });
      }
      throw new Error(
        `Failed to list snapshots: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  async deleteSnapshot(snapshotId: string): Promise<void> {
    try {
      await axios.delete(`${this.baseUrl}/images/${snapshotId}`, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
      });
    } catch (error: unknown) {
      stripSensitiveData(error);
      if (axios.isAxiosError<LinodeErrorResponse>(error)) {
        const reasons = error.response?.data?.errors?.map((e) => e.reason).join(", ");
        throw new Error(`Failed to delete snapshot: ${reasons || error.message}`, { cause: error });
      }
      throw new Error(
        `Failed to delete snapshot: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  async getSnapshotCostEstimate(serverId: string): Promise<string> {
    try {
      const response = await axios.get(`${this.baseUrl}/linode/instances/${serverId}`, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
      });
      const diskMb = response.data.specs?.disk || response.data.disk || 0;
      const diskGb = diskMb / 1024;
      return `$${(diskGb * 0.004).toFixed(2)}/mo`;
    } catch (error: unknown) {
      stripSensitiveData(error);
      if (axios.isAxiosError<LinodeErrorResponse>(error)) {
        const reasons = error.response?.data?.errors?.map((e) => e.reason).join(", ");
        throw new Error(`Failed to get snapshot cost: ${reasons || error.message}`, { cause: error });
      }
      throw new Error(
        `Failed to get snapshot cost: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
}
