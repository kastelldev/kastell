import { apiClient, stripSensitiveData, withProviderErrorHandling, assertValidServerId, uploadSshKeyWithConflict, type CloudProvider } from "./base.js";
import { withRetry } from "../utils/retry.js";
import type { Region, ServerSize, ServerConfig, ServerResult, SnapshotInfo, ServerMode } from "../types/index.js";
import { formatSnapshotCost } from "../constants.js";

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

function extractHetznerError(data: unknown): string | undefined {
  const d = data as HetznerErrorResponse | undefined;
  return d?.error?.message;
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
    return uploadSshKeyWithConflict(name, publicKey, {
      apiToken: this.apiToken,
      baseUrl: this.baseUrl,
      createPath: "/ssh_keys",
      bodyKeyField: "public_key",
      listPath: "/ssh_keys?per_page=200",
      listArrayField: "ssh_keys",
      listKeyField: "public_key",
      conflictStatuses: [409],
    });
  }

  async createServer(config: ServerConfig): Promise<ServerResult> {
    return withProviderErrorHandling("create server", async () => {
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
    }, extractHetznerError);
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
    return withProviderErrorHandling("destroy server", async () => {
      await apiClient.delete(`${this.baseUrl}/servers/${serverId}`, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
      });
    }, extractHetznerError);
  }

  async rebootServer(serverId: string): Promise<void> {
    assertValidServerId(serverId);
    return withProviderErrorHandling("reboot server", async () => {
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
    }, extractHetznerError);
  }

  getRegions(): Region[] {
    return [
      { id: "nbg1", name: "Nuremberg", location: "Germany" },
      { id: "fsn1", name: "Falkenstein", location: "Germany" },
      { id: "hel1", name: "Helsinki", location: "Finland" },
      { id: "ash", name: "Ashburn", location: "USA" },
      { id: "sin1", name: "Singapore", location: "Singapore" },
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
    return withProviderErrorHandling("create snapshot", async () => {
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
        costPerMonth: formatSnapshotCost("hetzner", image.image_size || 0),
      };
    }, extractHetznerError);
  }

  async listSnapshots(serverId: string): Promise<SnapshotInfo[]> {
    assertValidServerId(serverId);
    return withProviderErrorHandling("list snapshots", () =>
      withRetry(async () => {
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
            costPerMonth: formatSnapshotCost("hetzner", img.image_size || 0),
          }),
        );
      }),
    extractHetznerError);
  }

  async deleteSnapshot(snapshotId: string): Promise<void> {
    assertValidServerId(snapshotId);
    return withProviderErrorHandling("delete snapshot", async () => {
      await apiClient.delete(`${this.baseUrl}/images/${snapshotId}`, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
      });
    }, extractHetznerError);
  }

  async restoreSnapshot(serverId: string, snapshotId: string): Promise<void> {
    assertValidServerId(serverId);
    assertValidServerId(snapshotId);
    return withProviderErrorHandling("restore snapshot", async () => {
      await apiClient.post(
        `${this.baseUrl}/servers/${serverId}/actions/rebuild`,
        { image: Number(snapshotId) },
        { headers: { Authorization: `Bearer ${this.apiToken}`, "Content-Type": "application/json" } },
      );
    }, extractHetznerError);
  }

  async getSnapshotCostEstimate(serverId: string): Promise<string> {
    assertValidServerId(serverId);
    return withProviderErrorHandling("get snapshot cost", () =>
      withRetry(async () => {
        const response = await apiClient.get(`${this.baseUrl}/servers/${serverId}`, {
          headers: { Authorization: `Bearer ${this.apiToken}` },
        });
        const diskGb = response.data.server.server_type.disk;
        return formatSnapshotCost("hetzner", diskGb);
      }),
    extractHetznerError);
  }

  async findServerByIp(ip: string): Promise<string | null> {
    return withProviderErrorHandling("find server by IP", async () => {
      const response = await apiClient.get(`${this.baseUrl}/servers?per_page=100`, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
      });
      const servers = response.data.servers as { id: number; public_net?: { ipv4?: { ip?: string } } }[];
      const found = servers.find((server) => server.public_net?.ipv4?.ip === ip);
      return found ? found.id.toString() : null;
    }, extractHetznerError);
  }
}
