import axios from "axios";
import { LinodeProvider } from "../../src/providers/linode";

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("LinodeProvider", () => {
  let provider: LinodeProvider;

  beforeEach(() => {
    provider = new LinodeProvider("test-api-token");
    jest.clearAllMocks();
  });

  describe("properties", () => {
    it('should have name "linode"', () => {
      expect(provider.name).toBe("linode");
    });

    it('should have displayName "Linode (Akamai)"', () => {
      expect(provider.displayName).toBe("Linode (Akamai)");
    });
  });

  describe("getRegions", () => {
    it("should return an array of regions", () => {
      const regions = provider.getRegions();
      expect(Array.isArray(regions)).toBe(true);
      expect(regions.length).toBeGreaterThan(0);
    });

    it("should include Newark (us-east)", () => {
      const regions = provider.getRegions();
      const usEast = regions.find((r) => r.id === "us-east");
      expect(usEast).toBeDefined();
      expect(usEast!.name).toBe("Newark, NJ");
    });

    it("should include London (eu-west)", () => {
      const regions = provider.getRegions();
      const euWest = regions.find((r) => r.id === "eu-west");
      expect(euWest).toBeDefined();
      expect(euWest!.name).toBe("London");
    });

    it("should include Frankfurt (eu-central)", () => {
      const regions = provider.getRegions();
      const euCentral = regions.find((r) => r.id === "eu-central");
      expect(euCentral).toBeDefined();
      expect(euCentral!.name).toBe("Frankfurt");
    });

    it("should include Singapore (ap-south)", () => {
      const regions = provider.getRegions();
      const apSouth = regions.find((r) => r.id === "ap-south");
      expect(apSouth).toBeDefined();
      expect(apSouth!.name).toBe("Singapore");
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

    it("should have g6-standard-2 as first option", () => {
      const sizes = provider.getServerSizes();
      const std2 = sizes.find((s) => s.id === "g6-standard-2");
      expect(std2).toBeDefined();
      expect(std2!.vcpu).toBe(2);
      expect(std2!.ram).toBe(4);
    });

    it("should have g6-standard-4 option", () => {
      const sizes = provider.getServerSizes();
      const std4 = sizes.find((s) => s.id === "g6-standard-4");
      expect(std4).toBeDefined();
      expect(std4!.vcpu).toBe(4);
      expect(std4!.ram).toBe(8);
    });

    it("should have g6-standard-6 option", () => {
      const sizes = provider.getServerSizes();
      const std6 = sizes.find((s) => s.id === "g6-standard-6");
      expect(std6).toBeDefined();
      expect(std6!.vcpu).toBe(6);
      expect(std6!.ram).toBe(16);
    });

    it("should have valid specs for every size", () => {
      const sizes = provider.getServerSizes();
      sizes.forEach((size) => {
        expect(size.id).toBeTruthy();
        expect(size.name).toBeTruthy();
        expect(size.vcpu).toBeGreaterThan(0);
        expect(size.ram).toBeGreaterThanOrEqual(4);
        expect(size.disk).toBeGreaterThan(0);
        expect(size.price).toBeTruthy();
      });
    });
  });

  describe("validateToken", () => {
    it("should return true for a valid token", async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: { username: "testuser" } });

      const result = await provider.validateToken("valid-token");

      expect(result).toBe(true);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        "https://api.linode.com/v4/profile",
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
        data: { id: 12345 },
      });

      const result = await provider.uploadSshKey("my-key", "ssh-rsa AAAA...");

      expect(result).toBe("12345");
      expect(mockedAxios.post).toHaveBeenCalledWith(
        "https://api.linode.com/v4/profile/sshkeys",
        { label: "my-key", ssh_key: "ssh-rsa AAAA..." },
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-api-token",
          }),
        }),
      );
    });

    it("should find existing key on 400 error", async () => {
      const axiosError = {
        response: { status: 400, data: { errors: [{ reason: "SSH key already in use" }] } },
        message: "Bad Request",
      };
      mockedAxios.post.mockRejectedValueOnce(axiosError);
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          data: [
            { id: 111, ssh_key: "ssh-rsa OTHER..." },
            { id: 222, ssh_key: "ssh-rsa MATCH" },
          ],
        },
      });

      const result = await provider.uploadSshKey("my-key", "ssh-rsa MATCH");

      expect(result).toBe("222");
    });

    it("should throw when 400 error but key not found in list", async () => {
      const axiosError = {
        response: { status: 400, data: {} },
        message: "Bad Request",
      };
      mockedAxios.post.mockRejectedValueOnce(axiosError);
      mockedAxios.get.mockResolvedValueOnce({
        data: { data: [{ id: 111, ssh_key: "ssh-rsa OTHER..." }] },
      });

      await expect(provider.uploadSshKey("my-key", "ssh-rsa NOMATCH")).rejects.toThrow(
        "Failed to upload SSH key",
      );
    });

    it("should throw on non-400 error", async () => {
      const axiosError = {
        response: { status: 500, data: { errors: [{ reason: "Internal" }] } },
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
      size: "g6-standard-2",
      region: "us-east",
      cloudInit: "#!/bin/bash\necho hello",
    };

    it("should create a server and return result", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          id: 12345678,
          ipv4: ["1.2.3.4"],
          status: "running",
        },
      });

      const result = await provider.createServer(serverConfig);

      expect(result.id).toBe("12345678");
      expect(result.ip).toBe("1.2.3.4");
      expect(result.status).toBe("running");
    });

    it("should send correct request payload with base64 user_data in metadata", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          id: 1,
          ipv4: ["10.0.0.1"],
          status: "provisioning",
        },
      });

      await provider.createServer(serverConfig);

      const expectedBase64 = Buffer.from(serverConfig.cloudInit).toString("base64");
      expect(mockedAxios.post).toHaveBeenCalledWith(
        "https://api.linode.com/v4/linode/instances",
        expect.objectContaining({
          label: "test-server",
          type: "g6-standard-2",
          region: "us-east",
          image: "linode/ubuntu22.04",
          root_pass: expect.any(String),
          metadata: { user_data: expectedBase64 },
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-api-token",
            "Content-Type": "application/json",
          }),
        }),
      );
    });

    it("should generate a root_pass with sufficient length", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { id: 1, ipv4: ["10.0.0.1"], status: "running" },
      });

      await provider.createServer(serverConfig);

      const callBody = mockedAxios.post.mock.calls[0][1] as Record<string, unknown>;
      expect(typeof callBody.root_pass).toBe("string");
      expect((callBody.root_pass as string).length).toBeGreaterThanOrEqual(16);
    });

    it("should normalize provisioning status to initializing", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          id: 1,
          ipv4: ["10.0.0.1"],
          status: "provisioning",
        },
      });

      const result = await provider.createServer(serverConfig);

      expect(result.status).toBe("initializing");
    });

    it("should return 'pending' IP when ipv4 is empty", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          id: 1,
          ipv4: [],
          status: "provisioning",
        },
      });

      const result = await provider.createServer(serverConfig);

      expect(result.ip).toBe("pending");
    });

    it("should include authorized_users when sshKeyIds provided", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { username: "testuser" },
      });
      mockedAxios.post.mockResolvedValueOnce({
        data: { id: 1, ipv4: ["10.0.0.1"], status: "running" },
      });

      await provider.createServer({ ...serverConfig, sshKeyIds: ["key-111"] });

      expect(mockedAxios.get).toHaveBeenCalledWith(
        "https://api.linode.com/v4/profile",
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: "Bearer test-api-token" }),
        }),
      );
      expect(mockedAxios.post).toHaveBeenCalledWith(
        "https://api.linode.com/v4/linode/instances",
        expect.objectContaining({
          authorized_users: ["testuser"],
        }),
        expect.anything(),
      );
    });

    it("should skip authorized_users when profile fetch fails", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("Profile fetch failed"));
      mockedAxios.post.mockResolvedValueOnce({
        data: { id: 1, ipv4: ["10.0.0.1"], status: "running" },
      });

      await provider.createServer({ ...serverConfig, sshKeyIds: ["key-111"] });

      expect(mockedAxios.post).toHaveBeenCalledWith(
        "https://api.linode.com/v4/linode/instances",
        expect.not.objectContaining({
          authorized_users: expect.anything(),
        }),
        expect.anything(),
      );
    });

    it("should throw with API error reasons on failure", async () => {
      mockedAxios.post.mockRejectedValueOnce({
        response: {
          data: {
            errors: [{ reason: "Insufficient funds" }],
          },
        },
      });

      await expect(provider.createServer(serverConfig)).rejects.toThrow(
        "Failed to create server: Insufficient funds",
      );
    });

    it("should join multiple error reasons", async () => {
      mockedAxios.post.mockRejectedValueOnce({
        response: {
          data: {
            errors: [{ reason: "Bad region" }, { reason: "Bad type" }],
          },
        },
      });

      await expect(provider.createServer(serverConfig)).rejects.toThrow(
        "Failed to create server: Bad region, Bad type",
      );
    });

    it("should fallback to error.message when errors array is undefined", async () => {
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
          id: 12345678,
          ipv4: ["1.2.3.4"],
          status: "running",
        },
      });

      const details = await provider.getServerDetails("12345678");

      expect(details.id).toBe("12345678");
      expect(details.ip).toBe("1.2.3.4");
      expect(details.status).toBe("running");
    });

    it("should return 'pending' IP when ipv4 is empty", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { id: 1, ipv4: [], status: "running" },
      });

      const details = await provider.getServerDetails("1");
      expect(details.ip).toBe("pending");
    });
  });

  describe("getServerStatus", () => {
    it('should return "running" for a running server', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { status: "running" },
      });

      const status = await provider.getServerStatus("12345678");

      expect(status).toBe("running");
    });

    it('should return "offline" for an offline server', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { status: "offline" },
      });

      const status = await provider.getServerStatus("12345678");

      expect(status).toBe("offline");
    });

    it("should call correct API endpoint with server ID", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { status: "running" },
      });

      await provider.getServerStatus("99999");

      expect(mockedAxios.get).toHaveBeenCalledWith(
        "https://api.linode.com/v4/linode/instances/99999",
        expect.objectContaining({
          headers: { Authorization: "Bearer test-api-token" },
        }),
      );
    });

    it("should throw on error", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("Not Found"));

      await expect(provider.getServerStatus("00000")).rejects.toThrow(
        "Failed to get server status: Not Found",
      );
    });

    it("should handle non-Error thrown values", async () => {
      mockedAxios.get.mockRejectedValueOnce("unexpected string");

      await expect(provider.getServerStatus("00000")).rejects.toThrow(
        "Failed to get server status: unexpected string",
      );
    });
  });

  describe("destroyServer", () => {
    it("should delete server successfully", async () => {
      mockedAxios.delete.mockResolvedValueOnce({});

      await provider.destroyServer("12345678");

      expect(mockedAxios.delete).toHaveBeenCalledWith(
        "https://api.linode.com/v4/linode/instances/12345678",
        expect.objectContaining({
          headers: { Authorization: "Bearer test-api-token" },
        }),
      );
    });

    it("should throw with API error reasons on failure", async () => {
      mockedAxios.delete.mockRejectedValueOnce({
        response: {
          data: {
            errors: [{ reason: "Linode not found" }],
          },
        },
      });

      await expect(provider.destroyServer("99999")).rejects.toThrow(
        "Failed to destroy server: Linode not found",
      );
    });

    it("should throw with generic message on network error", async () => {
      mockedAxios.delete.mockRejectedValueOnce(new Error("Network Error"));

      await expect(provider.destroyServer("12345678")).rejects.toThrow(
        "Failed to destroy server: Network Error",
      );
    });

    it("should handle non-Error thrown values", async () => {
      mockedAxios.delete.mockRejectedValueOnce("unexpected");

      await expect(provider.destroyServer("12345678")).rejects.toThrow(
        "Failed to destroy server: unexpected",
      );
    });

    it("should fallback to error.message when errors array is undefined", async () => {
      mockedAxios.delete.mockRejectedValueOnce({
        response: { data: {} },
        message: "Delete failed",
      });

      await expect(provider.destroyServer("12345678")).rejects.toThrow(
        "Failed to destroy server: Delete failed",
      );
    });
  });

  describe("rebootServer", () => {
    it("should reboot server successfully", async () => {
      mockedAxios.post.mockResolvedValueOnce({});

      await provider.rebootServer("12345678");

      expect(mockedAxios.post).toHaveBeenCalledWith(
        "https://api.linode.com/v4/linode/instances/12345678/reboot",
        {},
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-api-token",
          }),
        }),
      );
    });

    it("should throw with API error reasons on axios error", async () => {
      mockedAxios.post.mockRejectedValueOnce({
        response: {
          data: {
            errors: [{ reason: "Linode not found" }],
          },
        },
        message: "Not Found",
      });

      await expect(provider.rebootServer("99999")).rejects.toThrow(
        "Failed to reboot server: Linode not found",
      );
    });

    it("should throw with generic message on non-axios error", async () => {
      mockedAxios.post.mockRejectedValueOnce("unexpected string");

      await expect(provider.rebootServer("12345678")).rejects.toThrow(
        "Failed to reboot server: unexpected string",
      );
    });

    it("should fallback to error.message when errors array is undefined", async () => {
      mockedAxios.post.mockRejectedValueOnce({
        response: { data: {} },
        message: "Reboot failed",
      });

      await expect(provider.rebootServer("12345678")).rejects.toThrow(
        "Failed to reboot server: Reboot failed",
      );
    });
  });

  describe("getAvailableLocations", () => {
    it("should return locations from API", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          data: [
            {
              id: "us-east",
              label: "Newark, NJ",
              country: "us",
              status: "ok",
              capabilities: ["Linodes"],
            },
            {
              id: "eu-central",
              label: "Frankfurt, DE",
              country: "de",
              status: "ok",
              capabilities: ["Linodes"],
            },
          ],
        },
      });

      const locations = await provider.getAvailableLocations();

      expect(locations).toHaveLength(2);
      expect(locations[0]).toEqual({ id: "us-east", name: "Newark, NJ", location: "us" });
      expect(mockedAxios.get).toHaveBeenCalledWith(
        "https://api.linode.com/v4/regions",
        expect.objectContaining({
          headers: { Authorization: "Bearer test-api-token" },
        }),
      );
    });

    it("should filter out regions without Linodes capability", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          data: [
            {
              id: "us-east",
              label: "Newark",
              country: "us",
              status: "ok",
              capabilities: ["Linodes"],
            },
            {
              id: "us-obj",
              label: "Object Storage",
              country: "us",
              status: "ok",
              capabilities: ["Object Storage"],
            },
          ],
        },
      });

      const locations = await provider.getAvailableLocations();

      expect(locations).toHaveLength(1);
      expect(locations[0].id).toBe("us-east");
    });

    it("should filter out regions with non-ok status", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          data: [
            {
              id: "us-east",
              label: "Newark",
              country: "us",
              status: "ok",
              capabilities: ["Linodes"],
            },
            {
              id: "us-west",
              label: "Fremont",
              country: "us",
              status: "outage",
              capabilities: ["Linodes"],
            },
          ],
        },
      });

      const locations = await provider.getAvailableLocations();

      expect(locations).toHaveLength(1);
      expect(locations[0].id).toBe("us-east");
    });

    it("should fallback to static regions on API error", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("Network Error"));

      const locations = await provider.getAvailableLocations();

      expect(locations).toEqual(provider.getRegions());
    });
  });

  describe("getAvailableServerTypes", () => {
    it("should return server types filtered by RAM", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          data: [
            {
              id: "g6-standard-2",
              label: "Linode 4GB",
              vcpus: 2,
              memory: 4096,
              disk: 81920,
              price: { monthly: 12 },
            },
            {
              id: "g6-standard-4",
              label: "Linode 8GB",
              vcpus: 4,
              memory: 8192,
              disk: 163840,
              price: { monthly: 24 },
            },
            {
              id: "g6-standard-1",
              label: "Linode 2GB",
              vcpus: 1,
              memory: 2048,
              disk: 51200,
              price: { monthly: 10 },
            },
          ],
        },
      });

      const types = await provider.getAvailableServerTypes("us-east");

      // g6-standard-1 filtered out (< 4096 MB RAM)
      expect(types).toHaveLength(2);
      expect(types[0].id).toBe("g6-standard-2");
      expect(types[0].price).toBe("$12.00/mo");
      expect(types[0].ram).toBe(4);
      expect(types[0].disk).toBe(80);
      expect(types[1].id).toBe("g6-standard-4");
    });

    it("should filter by g6-standard type only", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          data: [
            {
              id: "g6-standard-2",
              label: "Linode 4GB",
              vcpus: 2,
              memory: 4096,
              disk: 81920,
              price: { monthly: 12 },
            },
            {
              id: "g6-dedicated-2",
              label: "Dedicated 4GB",
              vcpus: 2,
              memory: 4096,
              disk: 81920,
              price: { monthly: 30 },
            },
          ],
        },
      });

      const types = await provider.getAvailableServerTypes("us-east");

      expect(types).toHaveLength(1);
      expect(types[0].id).toBe("g6-standard-2");
    });

    it("should fallback to static sizes when no types match", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          data: [
            {
              id: "g6-standard-1",
              label: "Linode 2GB",
              vcpus: 1,
              memory: 2048,
              disk: 51200,
              price: { monthly: 10 },
            },
          ],
        },
      });

      const types = await provider.getAvailableServerTypes("us-east");

      expect(types).toEqual(provider.getServerSizes());
    });

    it("should fallback to static sizes on API error", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("Network Error"));

      const types = await provider.getAvailableServerTypes("us-east");

      expect(types).toEqual(provider.getServerSizes());
    });

    it("should call types endpoint with correct auth header", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          data: [
            {
              id: "g6-standard-2",
              label: "Linode 4GB",
              vcpus: 2,
              memory: 4096,
              disk: 81920,
              price: { monthly: 12 },
            },
          ],
        },
      });

      await provider.getAvailableServerTypes("us-east");

      expect(mockedAxios.get).toHaveBeenCalledWith(
        "https://api.linode.com/v4/linode/types",
        expect.objectContaining({
          headers: { Authorization: "Bearer test-api-token" },
        }),
      );
    });

    it("should convert disk from MB to GB", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          data: [
            {
              id: "g6-standard-2",
              label: "Linode 4GB",
              vcpus: 2,
              memory: 4096,
              disk: 81920,
              price: { monthly: 12 },
            },
          ],
        },
      });

      const types = await provider.getAvailableServerTypes("us-east");

      expect(types[0].disk).toBe(80); // 81920 MB → 80 GB
    });
  });

  describe("createSnapshot", () => {
    it("should create a snapshot successfully", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          data: [
            { id: 101, size: 81920 },
            { id: 102, size: 512 },
          ],
        },
      });
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          id: "private/12345",
          label: "kastell-test",
          status: "creating",
          size: 81920,
          created: "2026-02-24T00:00:00",
        },
      });

      const result = await provider.createSnapshot("12345678", "kastell-test");

      expect(result.id).toBe("private/12345");
      expect(result.name).toBe("kastell-test");
      expect(result.status).toBe("creating");
      expect(result.sizeGb).toBe(80);
      expect(result.costPerMonth).toBe("$0.32/mo");
      expect(mockedAxios.get).toHaveBeenCalledWith(
        "https://api.linode.com/v4/linode/instances/12345678/disks",
        expect.objectContaining({
          headers: { Authorization: "Bearer test-api-token" },
        }),
      );
      expect(mockedAxios.post).toHaveBeenCalledWith(
        "https://api.linode.com/v4/images",
        { disk_id: 101, label: "kastell-test" },
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-api-token",
          }),
        }),
      );
    });

    it("should throw when no disks found", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { data: [] },
      });

      await expect(provider.createSnapshot("12345678", "test")).rejects.toThrow(
        "Failed to create snapshot: No disks found on this instance",
      );
    });

    it("should throw on API error", async () => {
      mockedAxios.get.mockRejectedValueOnce({
        response: {
          data: { errors: [{ reason: "Linode not found" }] },
        },
      });

      await expect(provider.createSnapshot("12345678", "test")).rejects.toThrow(
        "Failed to create snapshot: Linode not found",
      );
    });

    it("should handle non-Error thrown values", async () => {
      mockedAxios.get.mockRejectedValueOnce("unexpected string");

      await expect(provider.createSnapshot("12345678", "test")).rejects.toThrow(
        "Failed to create snapshot: unexpected string",
      );
    });
  });

  describe("listSnapshots", () => {
    it("should return filtered snapshot list", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          data: [
            {
              id: "private/100",
              label: "kastell-test",
              type: "manual",
              status: "available",
              size: 81920,
              created: "2026-02-24T00:00:00",
            },
            {
              id: "private/101",
              label: "other-image",
              type: "manual",
              status: "available",
              size: 40960,
              created: "2026-02-24T00:00:00",
            },
            {
              id: "linode/ubuntu22.04",
              label: "Ubuntu 22.04",
              type: "automatic",
              status: "available",
              size: 2500,
              created: "2026-01-01T00:00:00",
            },
          ],
        },
      });

      const result = await provider.listSnapshots("12345678");

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("private/100");
      expect(result[0].name).toBe("kastell-test");
      expect(result[0].sizeGb).toBe(80);
    });

    it("should throw on API error", async () => {
      mockedAxios.get.mockRejectedValueOnce({
        response: {
          data: { errors: [{ reason: "Unauthorized" }] },
        },
      });

      await expect(provider.listSnapshots("12345678")).rejects.toThrow("Failed to list snapshots");
    });
  });

  describe("deleteSnapshot", () => {
    it("should delete snapshot successfully", async () => {
      mockedAxios.delete.mockResolvedValueOnce({});

      await expect(provider.deleteSnapshot("private/100")).resolves.toBeUndefined();

      expect(mockedAxios.delete).toHaveBeenCalledWith(
        "https://api.linode.com/v4/images/private/100",
        expect.objectContaining({
          headers: { Authorization: "Bearer test-api-token" },
        }),
      );
    });

    it("should throw on delete error", async () => {
      mockedAxios.delete.mockRejectedValueOnce({
        response: {
          data: { errors: [{ reason: "Image not found" }] },
        },
      });

      await expect(provider.deleteSnapshot("private/100")).rejects.toThrow(
        "Failed to delete snapshot",
      );
    });

    it("should handle non-Error thrown values", async () => {
      mockedAxios.delete.mockRejectedValueOnce("unexpected");

      await expect(provider.deleteSnapshot("private/100")).rejects.toThrow(
        "Failed to delete snapshot: unexpected",
      );
    });
  });

  describe("getSnapshotCostEstimate", () => {
    it("should return cost estimate using specs.disk", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { specs: { disk: 81920 } },
      });

      const result = await provider.getSnapshotCostEstimate("12345678");

      expect(result).toBe("$0.32/mo");
    });

    it("should fallback to data.disk when specs is undefined", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { disk: 81920 },
      });

      const result = await provider.getSnapshotCostEstimate("12345678");

      expect(result).toBe("$0.32/mo");
    });

    it("should throw on API error", async () => {
      mockedAxios.get.mockRejectedValueOnce({
        response: {
          data: { errors: [{ reason: "Linode not found" }] },
        },
      });

      await expect(provider.getSnapshotCostEstimate("12345678")).rejects.toThrow(
        "Failed to get snapshot cost",
      );
    });
  });

  describe("cause chain sanitization", () => {
    it("should not leak API token in error cause chain", async () => {
      const axiosError = new Error("Request failed") as any;
      axiosError.isAxiosError = true;
      axiosError.response = { status: 401, data: { errors: [{ reason: "unauthorized" }] } };
      axiosError.config = { headers: { Authorization: "Bearer test-api-token" }, data: '{"root_pass":"secret"}' };
      axiosError.request = { some: "request data" };
      axiosError.code = "ERR_BAD_REQUEST";
      axiosError.message = "Request failed with status code 401";

      mockedAxios.post.mockRejectedValue(axiosError);

      try {
        await provider.createServer({
          name: "test",
          region: "us-east",
          size: "g6-standard-2",
          cloudInit: "#!/bin/bash",
          sshKeyIds: [],
        });
      } catch (error: unknown) {
        const err = error as Error;
        const cause = err.cause as Record<string, unknown>;
        // The original error is preserved as cause (ESLint preserve-caught-error rule)
        // but sensitive data is stripped (headers, data, request set to undefined)
        expect(cause).toHaveProperty("isAxiosError", true);
        expect(cause).toHaveProperty("message", "Request failed with status code 401");
        // Config exists but headers and data are undefined
        const config = (cause as any).config;
        expect(config.headers).toBeUndefined();
        expect(config.data).toBeUndefined();
        // Request is stripped
        expect(cause.request).toBeUndefined();
      }
    });

    it("should clear error.config.data on createServer failure (rootPass protection)", async () => {
      const axiosError = new Error("Request failed") as any;
      axiosError.isAxiosError = true;
      axiosError.response = { status: 400, data: { errors: [{ reason: "bad request" }] } };
      axiosError.config = { data: '{"root_pass":"Ql1!supersecretpass"}' };
      axiosError.code = "ERR_BAD_REQUEST";
      axiosError.message = "Request failed";

      mockedAxios.post.mockRejectedValue(axiosError);

      try {
        await provider.createServer({
          name: "test",
          region: "us-east",
          size: "g6-standard-2",
          cloudInit: "#!/bin/bash",
          sshKeyIds: [],
        });
      } catch {
        // After the error is thrown, config.data should have been deleted
        expect(axiosError.config.data).toBeUndefined();
      }
    });
  });
});
