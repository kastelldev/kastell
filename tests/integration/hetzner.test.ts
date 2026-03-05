import axios from "axios";
import { HetznerProvider } from "../../src/providers/hetzner";

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("HetznerProvider", () => {
  let provider: HetznerProvider;

  beforeEach(() => {
    provider = new HetznerProvider("test-api-token");
    jest.clearAllMocks();
  });

  describe("properties", () => {
    it('should have name "hetzner"', () => {
      expect(provider.name).toBe("hetzner");
    });

    it('should have displayName "Hetzner Cloud"', () => {
      expect(provider.displayName).toBe("Hetzner Cloud");
    });
  });

  describe("getRegions", () => {
    it("should return an array of regions", () => {
      const regions = provider.getRegions();
      expect(Array.isArray(regions)).toBe(true);
      expect(regions.length).toBeGreaterThan(0);
    });

    it("should include Nuremberg (nbg1)", () => {
      const regions = provider.getRegions();
      const nbg = regions.find((r) => r.id === "nbg1");
      expect(nbg).toBeDefined();
      expect(nbg!.name).toBe("Nuremberg");
    });

    it("should include Falkenstein (fsn1)", () => {
      const regions = provider.getRegions();
      const fsn = regions.find((r) => r.id === "fsn1");
      expect(fsn).toBeDefined();
      expect(fsn!.name).toBe("Falkenstein");
    });

    it("should include Helsinki (hel1)", () => {
      const regions = provider.getRegions();
      const hel = regions.find((r) => r.id === "hel1");
      expect(hel).toBeDefined();
    });

    it("should include Ashburn (ash)", () => {
      const regions = provider.getRegions();
      const ash = regions.find((r) => r.id === "ash");
      expect(ash).toBeDefined();
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

    it("should have CAX11 as first option", () => {
      const sizes = provider.getServerSizes();
      const cax11 = sizes.find((s) => s.id === "cax11");
      expect(cax11).toBeDefined();
      expect(cax11!.vcpu).toBe(2);
      expect(cax11!.ram).toBe(4);
    });

    it("should have valid specs for every size", () => {
      const sizes = provider.getServerSizes();
      sizes.forEach((size) => {
        expect(size.id).toBeTruthy();
        expect(size.name).toBeTruthy();
        expect(size.vcpu).toBeGreaterThan(0);
        expect(size.ram).toBeGreaterThan(0);
        expect(size.disk).toBeGreaterThan(0);
        expect(size.price).toBeTruthy();
      });
    });

    it("should include both ARM64 (CAX) and x86 (CX) options", () => {
      const sizes = provider.getServerSizes();
      const arm = sizes.filter((s) => s.id.startsWith("cax"));
      const x86 = sizes.filter((s) => s.id.startsWith("cx"));
      expect(arm.length).toBeGreaterThan(0);
      expect(x86.length).toBeGreaterThan(0);
    });
  });

  describe("getAvailableLocations", () => {
    it("should return locations from API", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          locations: [
            { name: "nbg1", city: "Nuremberg", country: "Germany" },
            { name: "fsn1", city: "Falkenstein", country: "Germany" },
          ],
        },
      });

      const locations = await provider.getAvailableLocations();

      expect(locations).toHaveLength(2);
      expect(locations[0]).toEqual({ id: "nbg1", name: "Nuremberg", location: "Germany" });
      expect(mockedAxios.get).toHaveBeenCalledWith(
        "https://api.hetzner.cloud/v1/locations",
        expect.objectContaining({
          headers: { Authorization: "Bearer test-api-token" },
        }),
      );
    });

    it("should fallback to static regions on API error", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("Network Error"));

      const locations = await provider.getAvailableLocations();

      expect(locations).toEqual(provider.getRegions());
    });
  });

  describe("getAvailableServerTypes", () => {
    const mockDatacentersResponse = {
      data: {
        datacenters: [
          {
            name: "nbg1-dc3",
            location: { name: "nbg1" },
            server_types: { available: [1, 2, 3] },
          },
          {
            name: "hel1-dc2",
            location: { name: "hel1" },
            server_types: { available: [1] },
          },
        ],
      },
    };

    it("should return server types filtered by datacenter availability", async () => {
      mockedAxios.get.mockResolvedValueOnce(mockDatacentersResponse).mockResolvedValueOnce({
        data: {
          server_types: [
            {
              id: 1,
              name: "cax11",
              cores: 2,
              memory: 4,
              disk: 40,
              prices: [{ location: "nbg1", price_monthly: { net: "3.79", gross: "4.51" } }],
            },
            {
              id: 2,
              name: "cx22",
              cores: 2,
              memory: 4,
              disk: 40,
              prices: [{ location: "nbg1", price_monthly: { net: "3.49", gross: "4.15" } }],
            },
            {
              id: 99,
              name: "cpx11",
              cores: 2,
              memory: 2,
              disk: 40,
              prices: [{ location: "nbg1", price_monthly: { net: "3.49", gross: "4.15" } }],
            },
          ],
        },
      });

      const types = await provider.getAvailableServerTypes("nbg1");

      // cpx11 (id:99) not in available list [1,2,3] → filtered out
      expect(types).toHaveLength(2);
      expect(types[0].id).toBe("cax11");
      expect(types[0].price).toBe("€3.79/mo");
      expect(types[1].id).toBe("cx22");
    });

    it("should fallback to static sizes on API error", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("Network Error"));

      const types = await provider.getAvailableServerTypes("nbg1");

      expect(types).toEqual(provider.getServerSizes());
    });

    it("should fallback to static sizes when no types match", async () => {
      mockedAxios.get
        .mockResolvedValueOnce({
          data: {
            datacenters: [
              { name: "nbg1-dc3", location: { name: "nbg1" }, server_types: { available: [99] } },
            ],
          },
        })
        .mockResolvedValueOnce({
          data: {
            server_types: [
              {
                id: 1,
                name: "cax11",
                cores: 2,
                memory: 4,
                disk: 40,
                prices: [{ location: "nbg1", price_monthly: { net: "3.79", gross: "4.51" } }],
              },
            ],
          },
        });

      const types = await provider.getAvailableServerTypes("nbg1");

      expect(types).toEqual(provider.getServerSizes());
    });

    it('should return "N/A" price when price_monthly.net is undefined', async () => {
      mockedAxios.get.mockResolvedValueOnce(mockDatacentersResponse).mockResolvedValueOnce({
        data: {
          server_types: [
            {
              id: 1,
              name: "cax11",
              cores: 2,
              memory: 4,
              disk: 40,
              prices: [{ location: "nbg1", price_monthly: {} }],
            },
          ],
        },
      });

      const types = await provider.getAvailableServerTypes("nbg1");

      expect(types).toHaveLength(1);
      expect(types[0].price).toBe("€N/A/mo");
    });

    it("should filter out deprecated server types", async () => {
      mockedAxios.get.mockResolvedValueOnce(mockDatacentersResponse).mockResolvedValueOnce({
        data: {
          server_types: [
            {
              id: 1,
              name: "cax11",
              cores: 2,
              memory: 4,
              disk: 40,
              deprecation: { announced: "2025-01-01" },
              prices: [{ location: "nbg1", price_monthly: { net: "3.79", gross: "4.51" } }],
            },
            {
              id: 2,
              name: "cx22",
              cores: 2,
              memory: 4,
              disk: 40,
              prices: [{ location: "nbg1", price_monthly: { net: "3.49", gross: "4.15" } }],
            },
          ],
        },
      });

      const types = await provider.getAvailableServerTypes("nbg1");

      expect(types).toHaveLength(1);
      expect(types[0].id).toBe("cx22");
    });

    it("should merge available IDs from multiple datacenters in same location (ARM + x86)", async () => {
      // nbg1 has two DCs: dc3 (x86 types 1,2) and dc4 (ARM type 5)
      const multiDcResponse = {
        data: {
          datacenters: [
            { name: "nbg1-dc3", location: { name: "nbg1" }, server_types: { available: [1, 2] } },
            { name: "nbg1-dc4", location: { name: "nbg1" }, server_types: { available: [5] } },
            { name: "hel1-dc2", location: { name: "hel1" }, server_types: { available: [1] } },
          ],
        },
      };

      mockedAxios.get.mockResolvedValueOnce(multiDcResponse).mockResolvedValueOnce({
        data: {
          server_types: [
            {
              id: 1,
              name: "cx22",
              cores: 2,
              memory: 4,
              disk: 40,
              prices: [{ location: "nbg1", price_monthly: { net: "3.49", gross: "4.15" } }],
            },
            {
              id: 5,
              name: "cax11",
              cores: 2,
              memory: 4,
              disk: 40,
              prices: [{ location: "nbg1", price_monthly: { net: "3.79", gross: "4.51" } }],
            },
          ],
        },
      });

      const types = await provider.getAvailableServerTypes("nbg1");

      // Both x86 (cx22 from dc3) and ARM (cax11 from dc4) should be included
      expect(types).toHaveLength(2);
      expect(types.map((t) => t.id)).toContain("cx22");
      expect(types.map((t) => t.id)).toContain("cax11");
    });

    it("should call datacenters and server_types endpoints", async () => {
      mockedAxios.get.mockResolvedValueOnce(mockDatacentersResponse).mockResolvedValueOnce({
        data: {
          server_types: [
            {
              id: 1,
              name: "cax11",
              cores: 2,
              memory: 4,
              disk: 40,
              prices: [{ location: "nbg1", price_monthly: { net: "3.79", gross: "4.51" } }],
            },
          ],
        },
      });

      await provider.getAvailableServerTypes("nbg1");

      expect(mockedAxios.get).toHaveBeenCalledWith(
        "https://api.hetzner.cloud/v1/datacenters",
        expect.objectContaining({
          headers: { Authorization: "Bearer test-api-token" },
        }),
      );
      expect(mockedAxios.get).toHaveBeenCalledWith(
        "https://api.hetzner.cloud/v1/server_types",
        expect.objectContaining({
          headers: { Authorization: "Bearer test-api-token" },
        }),
      );
    });
  });

  describe("validateToken", () => {
    it("should return true for a valid token", async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: { servers: [] } });

      const result = await provider.validateToken("valid-token");

      expect(result).toBe(true);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        "https://api.hetzner.cloud/v1/servers",
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
        data: { ssh_key: { id: 12345 } },
      });

      const result = await provider.uploadSshKey("my-key", "ssh-rsa AAAA...");

      expect(result).toBe("12345");
      expect(mockedAxios.post).toHaveBeenCalledWith(
        "https://api.hetzner.cloud/v1/ssh_keys",
        { name: "my-key", public_key: "ssh-rsa AAAA..." },
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-api-token",
          }),
        }),
      );
    });

    it("should find existing key on 409 conflict", async () => {
      const axiosError = {
        response: { status: 409, data: { error: { message: "SSH key already exists" } } },
        message: "Conflict",
      };
      mockedAxios.post.mockRejectedValueOnce(axiosError);
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          ssh_keys: [
            { id: 111, public_key: "ssh-rsa OTHER..." },
            { id: 222, public_key: "ssh-rsa MATCH" },
          ],
        },
      });

      const result = await provider.uploadSshKey("my-key", "ssh-rsa MATCH");

      expect(result).toBe("222");
    });

    it("should throw when 409 conflict but key not found in list", async () => {
      const axiosError = {
        response: { status: 409, data: {} },
        message: "Conflict",
      };
      mockedAxios.post.mockRejectedValueOnce(axiosError);
      mockedAxios.get.mockResolvedValueOnce({
        data: { ssh_keys: [{ id: 111, public_key: "ssh-rsa OTHER..." }] },
      });

      await expect(provider.uploadSshKey("my-key", "ssh-rsa NOMATCH")).rejects.toThrow(
        "Failed to upload SSH key",
      );
    });

    it("should throw on non-409 error", async () => {
      const axiosError = {
        response: { status: 500, data: { error: { message: "Internal" } } },
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
      size: "cax11",
      region: "nbg1",
      cloudInit: "#!/bin/bash\necho hello",
    };

    it("should create a server and return result", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          server: {
            id: 12345,
            public_net: { ipv4: { ip: "1.2.3.4" } },
            status: "initializing",
          },
        },
      });

      const result = await provider.createServer(serverConfig);

      expect(result.id).toBe("12345");
      expect(result.ip).toBe("1.2.3.4");
      expect(result.status).toBe("initializing");
    });

    it("should send correct request payload to Hetzner API", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          server: {
            id: 1,
            public_net: { ipv4: { ip: "10.0.0.1" } },
            status: "initializing",
          },
        },
      });

      await provider.createServer(serverConfig);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        "https://api.hetzner.cloud/v1/servers",
        {
          name: "test-server",
          server_type: "cax11",
          location: "nbg1",
          image: "ubuntu-24.04",
          user_data: serverConfig.cloudInit,
        },
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-api-token",
            "Content-Type": "application/json",
          }),
        }),
      );
    });

    it("should throw with API error message on failure", async () => {
      mockedAxios.post.mockRejectedValueOnce({
        response: {
          data: {
            error: { message: "server_limit_exceeded" },
          },
        },
      });

      await expect(provider.createServer(serverConfig)).rejects.toThrow(
        "Failed to create server: server_limit_exceeded",
      );
    });

    it("should throw with generic message on network error", async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error("Network Error"));

      await expect(provider.createServer(serverConfig)).rejects.toThrow(
        "Failed to create server: Network Error",
      );
    });

    it("should throw on timeout", async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error("timeout of 30000ms exceeded"));

      await expect(provider.createServer(serverConfig)).rejects.toThrow(
        "Failed to create server: timeout of 30000ms exceeded",
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

    it("should include ssh_keys in body when sshKeyIds provided", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          server: {
            id: 1,
            public_net: { ipv4: { ip: "10.0.0.1" } },
            status: "initializing",
          },
        },
      });

      await provider.createServer({ ...serverConfig, sshKeyIds: ["111", "222"] });

      expect(mockedAxios.post).toHaveBeenCalledWith(
        "https://api.hetzner.cloud/v1/servers",
        expect.objectContaining({
          ssh_keys: [111, 222],
        }),
        expect.anything(),
      );
    });
  });

  describe("getServerDetails", () => {
    it("should return full server details", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          server: {
            id: 12345,
            public_net: { ipv4: { ip: "1.2.3.4" } },
            status: "running",
          },
        },
      });

      const details = await provider.getServerDetails("12345");

      expect(details.id).toBe("12345");
      expect(details.ip).toBe("1.2.3.4");
      expect(details.status).toBe("running");
    });
  });

  describe("getServerStatus", () => {
    it('should return "running" for a running server', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { server: { status: "running" } },
      });

      const status = await provider.getServerStatus("12345");

      expect(status).toBe("running");
    });

    it('should return "initializing" for a new server', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { server: { status: "initializing" } },
      });

      const status = await provider.getServerStatus("12345");

      expect(status).toBe("initializing");
    });

    it("should call correct API endpoint with server ID", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { server: { status: "running" } },
      });

      await provider.getServerStatus("99999");

      expect(mockedAxios.get).toHaveBeenCalledWith(
        "https://api.hetzner.cloud/v1/servers/99999",
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
  });

  describe("destroyServer", () => {
    it("should delete server successfully", async () => {
      mockedAxios.delete.mockResolvedValueOnce({});

      await provider.destroyServer("12345");

      expect(mockedAxios.delete).toHaveBeenCalledWith(
        "https://api.hetzner.cloud/v1/servers/12345",
        expect.objectContaining({
          headers: { Authorization: "Bearer test-api-token" },
        }),
      );
    });

    it("should throw with API error message on failure", async () => {
      mockedAxios.delete.mockRejectedValueOnce({
        response: {
          data: {
            error: { message: "server not found" },
          },
        },
      });

      await expect(provider.destroyServer("99999")).rejects.toThrow(
        "Failed to destroy server: server not found",
      );
    });

    it("should throw with generic message on network error", async () => {
      mockedAxios.delete.mockRejectedValueOnce(new Error("Network Error"));

      await expect(provider.destroyServer("12345")).rejects.toThrow(
        "Failed to destroy server: Network Error",
      );
    });

    it("should handle non-Error thrown values", async () => {
      mockedAxios.delete.mockRejectedValueOnce("unexpected");

      await expect(provider.destroyServer("12345")).rejects.toThrow(
        "Failed to destroy server: unexpected",
      );
    });
  });

  describe("rebootServer", () => {
    it("should reboot server successfully", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { action: { id: 1, status: "running" } },
      });

      await provider.rebootServer("12345");

      expect(mockedAxios.post).toHaveBeenCalledWith(
        "https://api.hetzner.cloud/v1/servers/12345/actions/reboot",
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
            error: { message: "server not found" },
          },
        },
        message: "Not Found",
      });

      await expect(provider.rebootServer("99999")).rejects.toThrow(
        "Failed to reboot server: server not found",
      );
    });

    it("should throw with generic message on non-axios error", async () => {
      mockedAxios.post.mockRejectedValueOnce("unexpected string");

      await expect(provider.rebootServer("12345")).rejects.toThrow(
        "Failed to reboot server: unexpected string",
      );
    });
  });

  describe("createSnapshot", () => {
    it("should create a snapshot successfully", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          image: {
            id: 100,
            description: "kastell-test",
            status: "creating",
            image_size: 5.2,
            created: "2026-02-24T00:00:00+00:00",
          },
        },
      });

      const result = await provider.createSnapshot("123", "kastell-test");

      expect(result.id).toBe("100");
      expect(result.name).toBe("kastell-test");
      expect(result.status).toBe("creating");
      expect(result.sizeGb).toBe(5.2);
      expect(result.costPerMonth).toBe("€0.03/mo");
    });

    it("should throw on API error", async () => {
      const axiosError = new Error("API Error") as any;
      axiosError.isAxiosError = true;
      axiosError.response = { status: 500, data: { error: { message: "Server error" } } };
      mockedAxios.post.mockRejectedValueOnce(axiosError);

      await expect(provider.createSnapshot("123", "test")).rejects.toThrow(
        "Failed to create snapshot",
      );
    });

    it("should handle non-Error thrown values", async () => {
      mockedAxios.post.mockRejectedValueOnce("unexpected string");

      await expect(provider.createSnapshot("123", "test")).rejects.toThrow(
        "Failed to create snapshot: unexpected string",
      );
    });
  });

  describe("listSnapshots", () => {
    it("should return snapshot list", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          images: [
            {
              id: 100,
              description: "test",
              status: "available",
              image_size: 5.2,
              created: "2026-02-24T00:00:00+00:00",
              created_from: { id: 123 },
            },
          ],
        },
      });

      const result = await provider.listSnapshots("123");

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("100");
      expect(result[0].name).toBe("test");
      expect(result[0].status).toBe("available");
    });

    it("should filter by serverId", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          images: [
            {
              id: 100,
              description: "test",
              status: "available",
              image_size: 5.2,
              created: "2026-02-24T00:00:00+00:00",
              created_from: { id: 123 },
            },
            {
              id: 101,
              description: "other",
              status: "available",
              image_size: 3.1,
              created: "2026-02-24T00:00:00+00:00",
              created_from: { id: 456 },
            },
          ],
        },
      });

      const result = await provider.listSnapshots("123");

      expect(result).toHaveLength(1);
    });

    it("should throw on API error", async () => {
      const axiosError = new Error("API Error") as any;
      axiosError.isAxiosError = true;
      axiosError.response = { status: 500, data: { error: { message: "Server error" } } };
      mockedAxios.get.mockRejectedValueOnce(axiosError);

      await expect(provider.listSnapshots("123")).rejects.toThrow("Failed to list snapshots");
    });
  });

  describe("deleteSnapshot", () => {
    it("should delete snapshot successfully", async () => {
      mockedAxios.delete.mockResolvedValueOnce({});

      await expect(provider.deleteSnapshot("100")).resolves.toBeUndefined();
    });

    it("should throw on delete error", async () => {
      const axiosError = new Error("API Error") as any;
      axiosError.isAxiosError = true;
      axiosError.response = { status: 404, data: { error: { message: "Not found" } } };
      mockedAxios.delete.mockRejectedValueOnce(axiosError);

      await expect(provider.deleteSnapshot("100")).rejects.toThrow("Failed to delete snapshot");
    });

    it("should handle non-Error thrown values", async () => {
      mockedAxios.delete.mockRejectedValueOnce("unexpected");

      await expect(provider.deleteSnapshot("100")).rejects.toThrow(
        "Failed to delete snapshot: unexpected",
      );
    });
  });

  describe("getSnapshotCostEstimate", () => {
    it("should return cost estimate", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { server: { server_type: { disk: 40 } } },
      });

      const result = await provider.getSnapshotCostEstimate("123");

      expect(result).toBe("€0.24/mo");
    });

    it("should throw on API error", async () => {
      const axiosError = new Error("API Error") as any;
      axiosError.isAxiosError = true;
      axiosError.response = { status: 500, data: { error: { message: "Server error" } } };
      mockedAxios.get.mockRejectedValueOnce(axiosError);

      await expect(provider.getSnapshotCostEstimate("123")).rejects.toThrow(
        "Failed to get snapshot cost",
      );
    });
  });

  describe("cause chain sanitization", () => {
    it("should not leak API token in error cause chain", async () => {
      const axiosError = new Error("Request failed") as any;
      axiosError.isAxiosError = true;
      axiosError.response = { status: 401, data: { error: { message: "unauthorized" } } };
      axiosError.config = { headers: { Authorization: "Bearer test-api-token" }, data: "sensitive" };
      axiosError.request = { sensitive: "data" };
      axiosError.code = "ERR_BAD_REQUEST";
      axiosError.message = "Request failed with status code 401";

      mockedAxios.post.mockRejectedValue(axiosError);

      try {
        await provider.createServer({
          name: "test",
          region: "nbg1",
          size: "cax11",
          cloudInit: "#!/bin/bash",
          sshKeyIds: [],
        });
      } catch (error: unknown) {
        const err = error as Error;
        const cause = err.cause as any;
        // Sensitive data should be stripped (set to undefined)
        expect(cause.config.headers).toBeUndefined();
        expect(cause.config.data).toBeUndefined();
        expect(cause.request).toBeUndefined();
        // Non-sensitive data should be preserved
        expect(cause.response.status).toBe(401);
        expect(cause.message).toBe("Request failed with status code 401");
      }
    });
  });
});
