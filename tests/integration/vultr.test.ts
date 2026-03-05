import axios from "axios";
import { VultrProvider } from "../../src/providers/vultr";

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("VultrProvider", () => {
  let provider: VultrProvider;

  beforeEach(() => {
    provider = new VultrProvider("test-api-token");
    jest.clearAllMocks();
  });

  describe("properties", () => {
    it('should have name "vultr"', () => {
      expect(provider.name).toBe("vultr");
    });

    it('should have displayName "Vultr"', () => {
      expect(provider.displayName).toBe("Vultr");
    });
  });

  describe("getRegions", () => {
    it("should return an array of regions", () => {
      const regions = provider.getRegions();
      expect(Array.isArray(regions)).toBe(true);
      expect(regions.length).toBeGreaterThan(0);
    });

    it("should include New Jersey (ewr)", () => {
      const regions = provider.getRegions();
      const ewr = regions.find((r) => r.id === "ewr");
      expect(ewr).toBeDefined();
      expect(ewr!.name).toBe("New Jersey");
    });

    it("should include Chicago (ord)", () => {
      const regions = provider.getRegions();
      const ord = regions.find((r) => r.id === "ord");
      expect(ord).toBeDefined();
      expect(ord!.name).toBe("Chicago");
    });

    it("should include Amsterdam (ams)", () => {
      const regions = provider.getRegions();
      const ams = regions.find((r) => r.id === "ams");
      expect(ams).toBeDefined();
      expect(ams!.name).toBe("Amsterdam");
    });

    it("should include Frankfurt (fra)", () => {
      const regions = provider.getRegions();
      const fra = regions.find((r) => r.id === "fra");
      expect(fra).toBeDefined();
      expect(fra!.name).toBe("Frankfurt");
    });

    it("should have id, name, and location for every region", () => {
      const regions = provider.getRegions();
      regions.forEach((region) => {
        expect(region.id).toBeTruthy();
        expect(region.name).toBeTruthy();
        expect(region.location).toBeTruthy();
      });
    });
  });

  describe("getServerSizes", () => {
    it("should return an array of server sizes", () => {
      const sizes = provider.getServerSizes();
      expect(Array.isArray(sizes)).toBe(true);
      expect(sizes.length).toBeGreaterThan(0);
    });

    it("should have VC2-1C-2GB as first option", () => {
      const sizes = provider.getServerSizes();
      const vc2 = sizes.find((s) => s.id === "vc2-1c-2gb");
      expect(vc2).toBeDefined();
      expect(vc2!.vcpu).toBe(1);
      expect(vc2!.ram).toBe(2);
    });

    it("should have VC2-2C-4GB option", () => {
      const sizes = provider.getServerSizes();
      const vc2 = sizes.find((s) => s.id === "vc2-2c-4gb");
      expect(vc2).toBeDefined();
      expect(vc2!.vcpu).toBe(2);
      expect(vc2!.ram).toBe(4);
    });

    it("should have VC2-4C-8GB option", () => {
      const sizes = provider.getServerSizes();
      const vc2 = sizes.find((s) => s.id === "vc2-4c-8gb");
      expect(vc2).toBeDefined();
      expect(vc2!.vcpu).toBe(4);
      expect(vc2!.ram).toBe(8);
    });

    it("should have valid specs for every size", () => {
      const sizes = provider.getServerSizes();
      sizes.forEach((size) => {
        expect(size.id).toBeTruthy();
        expect(size.name).toBeTruthy();
        expect(size.vcpu).toBeGreaterThan(0);
        expect(size.ram).toBeGreaterThanOrEqual(2);
        expect(size.disk).toBeGreaterThan(0);
        expect(size.price).toBeTruthy();
      });
    });
  });

  describe("validateToken", () => {
    it("should return true for a valid token", async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: { account: {} } });

      const result = await provider.validateToken("valid-token");

      expect(result).toBe(true);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        "https://api.vultr.com/v2/account",
        expect.objectContaining({
          headers: { Authorization: "Bearer valid-token" },
        }),
      );
    });

    it("should return false for an invalid token", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("Unauthorized"));

      const result = await provider.validateToken("bad-token");

      expect(result).toBe(false);
    });

    it("should return false on network error", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const result = await provider.validateToken("any-token");

      expect(result).toBe(false);
    });
  });

  describe("uploadSshKey", () => {
    it("should upload SSH key and return ID", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { ssh_key: { id: "abc-123-def" } },
      });

      const result = await provider.uploadSshKey("my-key", "ssh-rsa AAAA...");

      expect(result).toBe("abc-123-def");
      expect(mockedAxios.post).toHaveBeenCalledWith(
        "https://api.vultr.com/v2/ssh-keys",
        { name: "my-key", ssh_key: "ssh-rsa AAAA..." },
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-api-token",
          }),
        }),
      );
    });

    it("should find existing key on 409 conflict", async () => {
      const axiosError = {
        response: { status: 409, data: { error: "SSH key already exists" } },
        message: "Conflict",
      };
      mockedAxios.post.mockRejectedValueOnce(axiosError);
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          ssh_keys: [
            { id: "key-111", ssh_key: "ssh-rsa OTHER..." },
            { id: "key-222", ssh_key: "ssh-rsa MATCH" },
          ],
        },
      });

      const result = await provider.uploadSshKey("my-key", "ssh-rsa MATCH");

      expect(result).toBe("key-222");
    });

    it("should throw when 409 conflict but key not found in list", async () => {
      const axiosError = {
        response: { status: 409, data: {} },
        message: "Conflict",
      };
      mockedAxios.post.mockRejectedValueOnce(axiosError);
      mockedAxios.get.mockResolvedValueOnce({
        data: { ssh_keys: [{ id: "key-111", ssh_key: "ssh-rsa OTHER..." }] },
      });

      await expect(provider.uploadSshKey("my-key", "ssh-rsa NOMATCH")).rejects.toThrow(
        "Failed to upload SSH key",
      );
    });

    it("should throw on non-409 error", async () => {
      const axiosError = {
        response: { status: 500, data: { error: "Internal" } },
        message: "Server Error",
      };
      mockedAxios.post.mockRejectedValueOnce(axiosError);

      await expect(provider.uploadSshKey("my-key", "ssh-rsa AAA")).rejects.toThrow(
        "Failed to upload SSH key",
      );
    });

    it("should handle non-Error thrown values", async () => {
      mockedAxios.post.mockRejectedValueOnce("unexpected string");

      await expect(provider.uploadSshKey("my-key", "ssh-rsa AAA")).rejects.toThrow(
        "Failed to upload SSH key: unexpected string",
      );
    });
  });

  describe("createServer", () => {
    const serverConfig = {
      name: "test-server",
      size: "vc2-1c-2gb",
      region: "ewr",
      cloudInit: "#!/bin/bash\necho hello",
    };

    it("should create a server and return result", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          instance: {
            id: "inst-abc-123",
            main_ip: "1.2.3.4",
            power_status: "running",
          },
        },
      });

      const result = await provider.createServer(serverConfig);

      expect(result.id).toBe("inst-abc-123");
      expect(result.ip).toBe("1.2.3.4");
      expect(result.status).toBe("running");
    });

    it("should send correct request payload with base64 user_data", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          instance: {
            id: "inst-1",
            main_ip: "10.0.0.1",
            power_status: "running",
          },
        },
      });

      await provider.createServer(serverConfig);

      const expectedBase64 = Buffer.from(serverConfig.cloudInit).toString("base64");
      expect(mockedAxios.post).toHaveBeenCalledWith(
        "https://api.vultr.com/v2/instances",
        {
          label: "test-server",
          plan: "vc2-1c-2gb",
          region: "ewr",
          os_id: 2284,
          user_data: expectedBase64,
        },
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-api-token",
            "Content-Type": "application/json",
          }),
        }),
      );
    });

    it("should include sshkey_id in body when sshKeyIds provided", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          instance: {
            id: "inst-1",
            main_ip: "10.0.0.1",
            power_status: "running",
          },
        },
      });

      await provider.createServer({ ...serverConfig, sshKeyIds: ["key-111", "key-222"] });

      expect(mockedAxios.post).toHaveBeenCalledWith(
        "https://api.vultr.com/v2/instances",
        expect.objectContaining({
          sshkey_id: ["key-111", "key-222"],
        }),
        expect.anything(),
      );
    });

    it("should throw with API error message on failure", async () => {
      mockedAxios.post.mockRejectedValueOnce({
        response: {
          data: {
            error: "Insufficient funds",
          },
        },
      });

      await expect(provider.createServer(serverConfig)).rejects.toThrow(
        "Failed to create server: Insufficient funds",
      );
    });

    it("should fallback to error.message when response.data.error is undefined", async () => {
      mockedAxios.post.mockRejectedValueOnce({
        response: {
          data: {},
        },
        message: "Request failed",
      });

      await expect(provider.createServer(serverConfig)).rejects.toThrow(
        "Failed to create server: Request failed",
      );
    });

    it("should handle non-Error thrown values", async () => {
      mockedAxios.post.mockRejectedValueOnce("unexpected string error");

      await expect(provider.createServer(serverConfig)).rejects.toThrow(
        "Failed to create server: unexpected string error",
      );
    });
  });

  describe("getServerDetails", () => {
    it("should return full server details", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          instance: {
            id: "inst-abc-123",
            main_ip: "1.2.3.4",
            power_status: "running",
          },
        },
      });

      const details = await provider.getServerDetails("inst-abc-123");

      expect(details.id).toBe("inst-abc-123");
      expect(details.ip).toBe("1.2.3.4");
      expect(details.status).toBe("running");
    });
  });

  describe("getServerStatus", () => {
    it('should return "running" for a running server', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { instance: { power_status: "running" } },
      });

      const status = await provider.getServerStatus("inst-abc-123");

      expect(status).toBe("running");
    });

    it('should return "stopped" for a stopped server', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { instance: { power_status: "stopped" } },
      });

      const status = await provider.getServerStatus("inst-abc-123");

      expect(status).toBe("stopped");
    });

    it("should call correct API endpoint with server ID", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { instance: { power_status: "running" } },
      });

      await provider.getServerStatus("inst-99999");

      expect(mockedAxios.get).toHaveBeenCalledWith(
        "https://api.vultr.com/v2/instances/inst-99999",
        expect.objectContaining({
          headers: { Authorization: "Bearer test-api-token" },
        }),
      );
    });

    it('should return "provisioning" when power is running but server_status is not ok', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { instance: { power_status: "running", server_status: "installingbooting" } },
      });

      const status = await provider.getServerStatus("inst-abc-123");

      expect(status).toBe("provisioning");
    });

    it('should return "running" when power_status is running and server_status is ok', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { instance: { power_status: "running", server_status: "ok" } },
      });

      const status = await provider.getServerStatus("inst-abc-123");

      expect(status).toBe("running");
    });

    it('should return "provisioning" when server_status is "none"', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { instance: { power_status: "running", server_status: "none" } },
      });

      const status = await provider.getServerStatus("inst-abc-123");

      expect(status).toBe("provisioning");
    });

    it('should return "provisioning" when server_status is "locked"', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { instance: { power_status: "running", server_status: "locked" } },
      });

      const status = await provider.getServerStatus("inst-abc-123");

      expect(status).toBe("provisioning");
    });

    it('should return "running" when server_status is null (backward compat)', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { instance: { power_status: "running", server_status: null } },
      });

      const status = await provider.getServerStatus("inst-abc-123");

      expect(status).toBe("running");
    });

    it("should throw on error", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("Not Found"));

      await expect(provider.getServerStatus("inst-00000")).rejects.toThrow(
        "Failed to get server status: Not Found",
      );
    });

    it("should handle non-Error thrown values", async () => {
      mockedAxios.get.mockRejectedValueOnce("unexpected string");

      await expect(provider.getServerStatus("inst-00000")).rejects.toThrow(
        "Failed to get server status: unexpected string",
      );
    });
  });

  describe("destroyServer", () => {
    it("should delete server successfully", async () => {
      mockedAxios.delete.mockResolvedValueOnce({});

      await provider.destroyServer("inst-abc-123");

      expect(mockedAxios.delete).toHaveBeenCalledWith(
        "https://api.vultr.com/v2/instances/inst-abc-123",
        expect.objectContaining({
          headers: { Authorization: "Bearer test-api-token" },
        }),
      );
    });

    it("should throw with API error message on failure", async () => {
      mockedAxios.delete.mockRejectedValueOnce({
        response: {
          data: {
            error: "Instance not found",
          },
        },
      });

      await expect(provider.destroyServer("inst-99999")).rejects.toThrow(
        "Failed to destroy server: Instance not found",
      );
    });

    it("should throw with generic message on network error", async () => {
      mockedAxios.delete.mockRejectedValueOnce(new Error("Network Error"));

      await expect(provider.destroyServer("inst-abc-123")).rejects.toThrow(
        "Failed to destroy server: Network Error",
      );
    });

    it("should handle non-Error thrown values", async () => {
      mockedAxios.delete.mockRejectedValueOnce("unexpected");

      await expect(provider.destroyServer("inst-abc-123")).rejects.toThrow(
        "Failed to destroy server: unexpected",
      );
    });
  });

  describe("rebootServer", () => {
    it("should reboot server successfully", async () => {
      mockedAxios.post.mockResolvedValueOnce({});

      await provider.rebootServer("inst-abc-123");

      expect(mockedAxios.post).toHaveBeenCalledWith(
        "https://api.vultr.com/v2/instances/inst-abc-123/reboot",
        {},
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-api-token",
          }),
        }),
      );
    });

    it("should throw with API error message on axios error", async () => {
      mockedAxios.post.mockRejectedValueOnce({
        response: {
          data: {
            error: "Instance not found",
          },
        },
        message: "Not Found",
      });

      await expect(provider.rebootServer("inst-99999")).rejects.toThrow(
        "Failed to reboot server: Instance not found",
      );
    });

    it("should throw with generic message on non-axios error", async () => {
      mockedAxios.post.mockRejectedValueOnce("unexpected string");

      await expect(provider.rebootServer("inst-abc-123")).rejects.toThrow(
        "Failed to reboot server: unexpected string",
      );
    });
  });

  describe("getAvailableLocations", () => {
    it("should return locations from API", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          regions: [
            { id: "ewr", city: "New Jersey", country: "US", options: ["ddos_protection"] },
            { id: "ord", city: "Chicago", country: "US", options: ["ddos_protection"] },
          ],
        },
      });

      const locations = await provider.getAvailableLocations();

      expect(locations).toHaveLength(2);
      expect(locations[0]).toEqual({ id: "ewr", name: "New Jersey", location: "US" });
      expect(mockedAxios.get).toHaveBeenCalledWith(
        "https://api.vultr.com/v2/regions",
        expect.objectContaining({
          headers: { Authorization: "Bearer test-api-token" },
        }),
      );
    });

    it("should filter out regions with empty options array", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          regions: [
            { id: "ewr", city: "New Jersey", country: "US", options: ["ddos_protection"] },
            { id: "deprecated", city: "Old DC", country: "US", options: [] },
          ],
        },
      });

      const locations = await provider.getAvailableLocations();

      expect(locations).toHaveLength(1);
      expect(locations[0].id).toBe("ewr");
    });

    it("should fallback to static regions on API error", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("Network Error"));

      const locations = await provider.getAvailableLocations();

      expect(locations).toEqual(provider.getRegions());
    });
  });

  describe("getAvailableServerTypes", () => {
    it("should return server types filtered by location and RAM", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          plans: [
            {
              id: "vc2-1c-2gb",
              vcpu_count: 1,
              ram: 2048,
              disk: 55,
              monthly_cost: 10,
              locations: ["ewr", "ord"],
              type: "vc2",
            },
            {
              id: "vc2-2c-4gb",
              vcpu_count: 2,
              ram: 4096,
              disk: 80,
              monthly_cost: 20,
              locations: ["ewr"],
              type: "vc2",
            },
            {
              id: "vc2-1c-1gb",
              vcpu_count: 1,
              ram: 1024,
              disk: 25,
              monthly_cost: 5,
              locations: ["ewr"],
              type: "vc2",
            },
          ],
        },
      });

      const types = await provider.getAvailableServerTypes("ewr");

      // vc2-1c-1gb filtered out (< 2048 MB RAM)
      expect(types).toHaveLength(2);
      expect(types[0].id).toBe("vc2-1c-2gb");
      expect(types[0].price).toBe("$10.00/mo");
      expect(types[0].ram).toBe(2);
      expect(types[1].id).toBe("vc2-2c-4gb");
    });

    it("should filter by vc2 type only", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          plans: [
            {
              id: "vc2-1c-2gb",
              vcpu_count: 1,
              ram: 2048,
              disk: 55,
              monthly_cost: 10,
              locations: ["ewr"],
              type: "vc2",
            },
            {
              id: "vhp-1c-2gb",
              vcpu_count: 1,
              ram: 2048,
              disk: 55,
              monthly_cost: 12,
              locations: ["ewr"],
              type: "vhp",
            },
          ],
        },
      });

      const types = await provider.getAvailableServerTypes("ewr");

      expect(types).toHaveLength(1);
      expect(types[0].id).toBe("vc2-1c-2gb");
    });

    it("should filter by location", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          plans: [
            {
              id: "vc2-1c-2gb",
              vcpu_count: 1,
              ram: 2048,
              disk: 55,
              monthly_cost: 10,
              locations: ["ewr"],
              type: "vc2",
            },
            {
              id: "vc2-2c-4gb",
              vcpu_count: 2,
              ram: 4096,
              disk: 80,
              monthly_cost: 20,
              locations: ["ord"],
              type: "vc2",
            },
          ],
        },
      });

      const types = await provider.getAvailableServerTypes("ewr");

      expect(types).toHaveLength(1);
      expect(types[0].id).toBe("vc2-1c-2gb");
    });

    it("should fallback to static sizes when no plans match", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          plans: [
            {
              id: "vc2-1c-1gb",
              vcpu_count: 1,
              ram: 1024,
              disk: 25,
              monthly_cost: 5,
              locations: ["ewr"],
              type: "vc2",
            },
          ],
        },
      });

      const types = await provider.getAvailableServerTypes("ewr");

      expect(types).toEqual(provider.getServerSizes());
    });

    it("should fallback to static sizes on API error", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("Network Error"));

      const types = await provider.getAvailableServerTypes("ewr");

      expect(types).toEqual(provider.getServerSizes());
    });

    it("should call plans endpoint with correct auth header", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          plans: [
            {
              id: "vc2-1c-2gb",
              vcpu_count: 1,
              ram: 2048,
              disk: 55,
              monthly_cost: 10,
              locations: ["ewr"],
              type: "vc2",
            },
          ],
        },
      });

      await provider.getAvailableServerTypes("ewr");

      expect(mockedAxios.get).toHaveBeenCalledWith(
        "https://api.vultr.com/v2/plans",
        expect.objectContaining({
          headers: { Authorization: "Bearer test-api-token" },
        }),
      );
    });
  });

  describe("createSnapshot", () => {
    it("should create a snapshot successfully", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          snapshot: {
            id: "snap-abc-123",
            description: "kastell-test",
            status: "pending",
            size: 5368709120,
            date_created: "2026-02-24T00:00:00+00:00",
          },
        },
      });

      const result = await provider.createSnapshot("inst-abc-123", "kastell-test");

      expect(result.id).toBe("snap-abc-123");
      expect(result.name).toBe("kastell-test");
      expect(result.status).toBe("pending");
      expect(result.sizeGb).toBe(5);
      expect(result.costPerMonth).toBe("$0.25/mo");
      expect(mockedAxios.post).toHaveBeenCalledWith(
        "https://api.vultr.com/v2/snapshots",
        { instance_id: "inst-abc-123", description: "kastell-test" },
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-api-token",
          }),
        }),
      );
    });

    it("should throw on API error", async () => {
      mockedAxios.post.mockRejectedValueOnce({
        response: {
          data: { error: "Instance not found" },
        },
      });

      await expect(provider.createSnapshot("inst-abc-123", "test")).rejects.toThrow(
        "Failed to create snapshot: Instance not found",
      );
    });

    it("should handle non-Error thrown values", async () => {
      mockedAxios.post.mockRejectedValueOnce("unexpected string");

      await expect(provider.createSnapshot("inst-abc-123", "test")).rejects.toThrow(
        "Failed to create snapshot: unexpected string",
      );
    });

    it("should handle snapshot with zero size", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          snapshot: {
            id: "snap-abc-123",
            description: "test",
            status: "pending",
            size: 0,
            date_created: "2026-02-24T00:00:00+00:00",
          },
        },
      });

      const result = await provider.createSnapshot("inst-abc-123", "test");

      expect(result.sizeGb).toBe(0);
    });
  });

  describe("listSnapshots", () => {
    it("should return snapshot list filtered by serverId", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          snapshots: [
            {
              id: "snap-1",
              description: "test-1",
              status: "complete",
              size: 5368709120,
              date_created: "2026-02-24T00:00:00+00:00",
              instance_id: "inst-abc-123",
            },
            {
              id: "snap-2",
              description: "test-2",
              status: "complete",
              size: 3221225472,
              date_created: "2026-02-24T00:00:00+00:00",
              instance_id: "inst-other",
            },
          ],
        },
      });

      const result = await provider.listSnapshots("inst-abc-123");

      // Vultr API does not return instance_id, so all account snapshots are returned
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("snap-1");
      expect(result[0].costPerMonth).toBe("$0.25/mo");
      expect(result[1].id).toBe("snap-2");
    });

    it("should throw on API error", async () => {
      mockedAxios.get.mockRejectedValueOnce({
        response: {
          data: { error: "Unauthorized" },
        },
      });

      await expect(provider.listSnapshots("inst-abc-123")).rejects.toThrow(
        "Failed to list snapshots",
      );
    });
  });

  describe("deleteSnapshot", () => {
    it("should delete snapshot successfully", async () => {
      mockedAxios.delete.mockResolvedValueOnce({});

      await expect(provider.deleteSnapshot("snap-abc-123")).resolves.toBeUndefined();

      expect(mockedAxios.delete).toHaveBeenCalledWith(
        "https://api.vultr.com/v2/snapshots/snap-abc-123",
        expect.objectContaining({
          headers: { Authorization: "Bearer test-api-token" },
        }),
      );
    });

    it("should throw on delete error", async () => {
      mockedAxios.delete.mockRejectedValueOnce({
        response: {
          data: { error: "Snapshot not found" },
        },
      });

      await expect(provider.deleteSnapshot("snap-abc-123")).rejects.toThrow(
        "Failed to delete snapshot",
      );
    });

    it("should handle non-Error thrown values", async () => {
      mockedAxios.delete.mockRejectedValueOnce("unexpected");

      await expect(provider.deleteSnapshot("snap-abc-123")).rejects.toThrow(
        "Failed to delete snapshot: unexpected",
      );
    });
  });

  describe("getSnapshotCostEstimate", () => {
    it("should return cost based on disk size from API", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { instance: { disk: 55 } },
      });

      const result = await provider.getSnapshotCostEstimate("inst-abc-123");

      expect(result).toBe("$2.75/mo");
      expect(mockedAxios.get).toHaveBeenCalledWith(
        "https://api.vultr.com/v2/instances/inst-abc-123",
        expect.objectContaining({
          headers: { Authorization: "Bearer test-api-token" },
        }),
      );
    });

    it("should throw on API error", async () => {
      mockedAxios.get.mockRejectedValueOnce({
        response: { data: { error: "Not found" } },
      });

      await expect(provider.getSnapshotCostEstimate("inst-abc-123")).rejects.toThrow(
        "Failed to get snapshot cost",
      );
    });
  });

  describe("cause chain sanitization", () => {
    it("should not leak API token in error cause chain", async () => {
      const axiosError = new Error("Request failed") as any;
      axiosError.isAxiosError = true;
      axiosError.response = { status: 401, data: { error: "unauthorized" } };
      axiosError.config = { headers: { Authorization: "Bearer test-api-token" }, data: "secret" };
      axiosError.request = { sensitive: "data" };
      axiosError.code = "ERR_BAD_REQUEST";
      axiosError.message = "Request failed with status code 401";

      mockedAxios.post.mockRejectedValue(axiosError);

      try {
        await provider.createServer({
          name: "test",
          region: "ewr",
          size: "vc2-1c-2gb",
          cloudInit: "#!/bin/bash",
          sshKeyIds: [],
        });
      } catch (error: unknown) {
        const err = error as Error;
        const cause = err.cause as Record<string, unknown>;
        // Sensitive data should be stripped from the cause chain
        expect((cause as any).config?.headers).toBeUndefined();
        expect((cause as any).config?.data).toBeUndefined();
        expect((cause as any).request).toBeUndefined();
        // Error properties should still be present
        expect(cause).toHaveProperty("response");
        expect(cause).toHaveProperty("message");
      }
    });
  });
});
