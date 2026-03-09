import axios from "axios";
import { apiClient, stripSensitiveData, withProviderErrorHandling, assertValidServerId, type CloudProvider } from "./base.js";
import { withRetry } from "../utils/retry.js";
import type { Region, ServerSize, ServerConfig, ServerResult, SnapshotInfo, ServerMode } from "../types/index.js";

interface HetznerLocation {
  name: string;
  city: string;
  country: string;
}

interface HetznerPrice {
  location: string;
  price_monthly: {
    net: string;
    gross: string;
  };
}

interface HetznerServerType {
  id: number;
  name: string;
  cores: number;
  memory: number;
  disk: number;
  deprecation: unknown;
  prices: HetznerPrice[];
}

interface HetznerDatacenter {
  name: string;
  location: { name: string };
  server_types: { available: number[] };
}

interface HetznerErrorResponse {
  error: {
    message: string;
  };
}

export class HetznerProvider implements CloudProvider {
  name = "hetzner";
  displayName = "Hetzner Cloud";
  private apiToken: string;
  private baseUrl = "https://api.hetzner.cloud/v1";

  constructor(apiToken: string) {
    this.apiToken = apiToken;
  }

  async validateToken(token: string): Promise<boolean> {
    try {
      await withRetry(async () => {
        await apiClient.get(`${this.baseUrl}/servers`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      });
      return true;
    } catch {
      return false;
    }
  }

  async uploadSshKey(name: string, publicKey: string): Promise<string> {
    try {
      const response = await apiClient.post(
        `${this.baseUrl}/ssh_keys`,
        { name, public_key: publicKey },
        {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            "Content-Type": "application/json",
          },
        },
      );
      return response.data.ssh_key.id.toString();
    } catch (error: unknown) {
      stripSensitiveData(error);
      // Key already exists → find by matching public key
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        const listResponse = await apiClient.get(`${this.baseUrl}/ssh_keys?per_page=200`, {
          headers: { Authorization: `Bearer ${this.apiToken}` },
        });
        const existing = listResponse.data.ssh_keys.find(
          (k: { public_key: string }) => k.public_key.trim() === publicKey.trim(),
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
      const body: Record<string, unknown> = {
        name: config.name,
        server_type: config.size,
        location: config.region,
        image: "ubuntu-24.04",
        user_data: config.cloudInit,
      };
      if (config.sshKeyIds?.length) {
        body.ssh_keys = config.sshKeyIds.map(Number);
      }
      const response = await apiClient.post(`${this.baseUrl}/servers`, body, {
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
        },
      });

      return {
        id: response.data.server.id.toString(),
        ip: response.data.server?.public_net?.ipv4?.ip || "pending",
        status: response.data.server.status,
      };
    } catch (error: unknown) {
      stripSensitiveData(error);
      if (axios.isAxiosError<HetznerErrorResponse>(error)) {
        throw new Error(
          `Failed to create server: ${error.response?.data?.error?.message || error.message}`,
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
    return withProviderErrorHandling("get server details", () =>
      withRetry(async () => {
        const response = await apiClient.get(`${this.baseUrl}/servers/${serverId}`, {
          headers: { Authorization: `Bearer ${this.apiToken}` },
        });
        return {
          id: response.data.server.id.toString(),
          ip: response.data.server?.public_net?.ipv4?.ip || "pending",
          status: response.data.server.status,
        };
      }),
    );
  }

  async getServerStatus(serverId: string): Promise<string> {
    assertValidServerId(serverId);
    return withProviderErrorHandling("get server status", () =>
      withRetry(async () => {
        const response = await apiClient.get(`${this.baseUrl}/servers/${serverId}`, {
          headers: { Authorization: `Bearer ${this.apiToken}` },
        });
        return response.data.server.status;
      }),
    );
  }

  async destroyServer(serverId: string): Promise<void> {
    assertValidServerId(serverId);
    try {
      await apiClient.delete(`${this.baseUrl}/servers/${serverId}`, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
      });
    } catch (error: unknown) {
      stripSensitiveData(error);
      if (axios.isAxiosError<HetznerErrorResponse>(error)) {
        throw new Error(
          `Failed to destroy server: ${error.response?.data?.error?.message || error.message}`,
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
        `${this.baseUrl}/servers/${serverId}/actions/reboot`,
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
      if (axios.isAxiosError<HetznerErrorResponse>(error)) {
        throw new Error(
          `Failed to reboot server: ${error.response?.data?.error?.message || error.message}`,
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
      { id: "nbg1", name: "Nuremberg", location: "Germany" },
      { id: "fsn1", name: "Falkenstein", location: "Germany" },
      { id: "hel1", name: "Helsinki", location: "Finland" },
      { id: "ash", name: "Ashburn", location: "USA" },
    ];
  }

  getServerSizes(): ServerSize[] {
    return [
      { id: "cax11", name: "CAX11", vcpu: 2, ram: 4, disk: 40, price: "€3.79/mo" },
      { id: "cx23", name: "CX23", vcpu: 2, ram: 4, disk: 40, price: "€3.49/mo" },
      { id: "cax21", name: "CAX21", vcpu: 4, ram: 8, disk: 80, price: "€6.49/mo" },
      { id: "cx33", name: "CX33", vcpu: 4, ram: 8, disk: 80, price: "€5.49/mo" },
    ];
  }

  async getAvailableLocations(): Promise<Region[]> {
    try {
      return await withRetry(async () => {
        const response = await apiClient.get(`${this.baseUrl}/locations`, {
          headers: { Authorization: `Bearer ${this.apiToken}` },
        });
        return response.data.locations.map((loc: HetznerLocation) => ({
          id: loc.name,
          name: loc.city,
          location: loc.country,
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
        // Get actually available server type IDs from datacenter
        const dcResponse = await apiClient.get(`${this.baseUrl}/datacenters`, {
          headers: { Authorization: `Bearer ${this.apiToken}` },
        });
        // Merge available IDs from ALL datacenters in same location (e.g. nbg1-dc3, nbg1-dc4)
        // A single location can have multiple DCs with different server types (ARM vs x86)
        const availableIds: number[] = dcResponse.data.datacenters
          .filter((dc: HetznerDatacenter) => dc.location.name === location)
          .flatMap((dc: HetznerDatacenter) => dc.server_types?.available || []);

        // Get server type details
        const response = await apiClient.get(`${this.baseUrl}/server_types`, {
          headers: { Authorization: `Bearer ${this.apiToken}` },
        });

        const MIN_RAM_GB = mode === "bare" ? 0 : 2; // Coolify requires at least 2GB RAM, bare has no minimum
        const types = response.data.server_types.filter(
          (type: HetznerServerType) =>
            !type.deprecation &&
            type.memory >= MIN_RAM_GB &&
            availableIds.includes(type.id) &&
            type.prices.some((p: HetznerPrice) => p.location === location),
        );

        if (types.length === 0) {
          return this.getServerSizes();
        }

        return types.map((type: HetznerServerType) => {
          const price = type.prices.find((p: HetznerPrice) => p.location === location);
          const rawPrice = price?.price_monthly?.net;
          const priceMonthly = rawPrice ? parseFloat(rawPrice).toFixed(2) : "N/A";

          return {
            id: type.name,
            name: type.name.toUpperCase(),
            vcpu: type.cores,
            ram: type.memory,
            disk: type.disk,
            price: `€${priceMonthly}/mo`,
          };
        });
      });
    } catch (error: unknown) {
      stripSensitiveData(error);
      return this.getServerSizes();
    }
  }

  async createSnapshot(serverId: string, name: string): Promise<SnapshotInfo> {
    assertValidServerId(serverId);
    try {
      const response = await apiClient.post(
        `${this.baseUrl}/servers/${serverId}/actions/create_image`,
        { type: "snapshot", description: name },
        {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            "Content-Type": "application/json",
          },
        },
      );
      const image = response.data.image;
      return {
        id: image.id.toString(),
        serverId,
        name: image.description || name,
        status: image.status,
        sizeGb: image.image_size || 0,
        createdAt: image.created,
        costPerMonth: `€${((image.image_size || 0) * 0.006).toFixed(2)}/mo`,
      };
    } catch (error: unknown) {
      stripSensitiveData(error);
      if (axios.isAxiosError<HetznerErrorResponse>(error)) {
        throw new Error(
          `Failed to create snapshot: ${error.response?.data?.error?.message || error.message}`,
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
      return await withRetry(async () => {
        const response = await apiClient.get(
          `${this.baseUrl}/images?type=snapshot&sort=created:desc&per_page=100`,
          { headers: { Authorization: `Bearer ${this.apiToken}` } },
        );
        const images = response.data.images.filter(
          (img: { created_from: { id: number } }) =>
            img.created_from && img.created_from.id === Number(serverId),
        );
        return images.map(
          (img: { id: number; description: string; status: string; image_size: number; created: string }) => ({
            id: img.id.toString(),
            serverId,
            name: img.description || "",
            status: img.status,
            sizeGb: img.image_size || 0,
            createdAt: img.created,
            costPerMonth: `€${((img.image_size || 0) * 0.006).toFixed(2)}/mo`,
          }),
        );
      });
    } catch (error: unknown) {
      stripSensitiveData(error);
      if (axios.isAxiosError<HetznerErrorResponse>(error)) {
        throw new Error(
          `Failed to list snapshots: ${error.response?.data?.error?.message || error.message}`,
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
      await apiClient.delete(`${this.baseUrl}/images/${snapshotId}`, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
      });
    } catch (error: unknown) {
      stripSensitiveData(error);
      if (axios.isAxiosError<HetznerErrorResponse>(error)) {
        throw new Error(
          `Failed to delete snapshot: ${error.response?.data?.error?.message || error.message}`,
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
      return await withRetry(async () => {
        const response = await apiClient.get(`${this.baseUrl}/servers/${serverId}`, {
          headers: { Authorization: `Bearer ${this.apiToken}` },
        });
        const diskGb = response.data.server.server_type.disk;
        return `€${(diskGb * 0.006).toFixed(2)}/mo`;
      });
    } catch (error: unknown) {
      stripSensitiveData(error);
      if (axios.isAxiosError<HetznerErrorResponse>(error)) {
        throw new Error(
          `Failed to get snapshot cost: ${error.response?.data?.error?.message || error.message}`,
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
