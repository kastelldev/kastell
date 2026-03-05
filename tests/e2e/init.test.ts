import axios from "axios";
import inquirer from "inquirer";
import { initCommand } from "../../src/commands/init";

// Mock healthCheck and config to avoid real filesystem/network in E2E tests
jest.mock("../../src/utils/healthCheck", () => ({
  waitForCoolify: jest.fn().mockResolvedValue(true),
}));

jest.mock("../../src/utils/config", () => ({
  saveServer: jest.fn(),
  getServers: jest.fn().mockReturnValue([]),
  removeServer: jest.fn(),
  findServer: jest.fn(),
}));

jest.mock("../../src/utils/sshKey", () => ({
  findLocalSshKey: jest.fn().mockReturnValue(null),
  generateSshKey: jest.fn().mockReturnValue(null),
  getSshKeyName: jest.fn().mockReturnValue("kastell-test"),
}));

jest.mock("../../src/utils/openBrowser", () => ({
  openBrowser: jest.fn(),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;

// Hetzner API mock responses
const hetznerLocationsResponse = {
  data: {
    locations: [
      { name: "nbg1", city: "Nuremberg", country: "Germany" },
      { name: "fsn1", city: "Falkenstein", country: "Germany" },
    ],
  },
};

const hetznerServerTypesResponse = {
  data: {
    server_types: [
      {
        name: "cax11",
        cores: 2,
        memory: 4,
        disk: 40,
        prices: [{ location: "nbg1", price_monthly: { gross: "3.85" } }],
      },
    ],
  },
};

// DigitalOcean API mock responses
const doRegionsResponse = {
  data: {
    regions: [
      { slug: "nyc1", name: "New York 1", available: true },
      { slug: "fra1", name: "Frankfurt 1", available: true },
    ],
  },
};

const doSizesResponse = {
  data: {
    sizes: [
      {
        slug: "s-2vcpu-2gb",
        memory: 2048,
        vcpus: 2,
        disk: 60,
        price_monthly: 12.0,
        available: true,
        regions: ["nyc1", "fra1"],
      },
    ],
  },
};

describe("initCommand E2E", () => {
  let consoleSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;
  const originalSetTimeout = global.setTimeout;

  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    processExitSpy = jest.spyOn(process, "exit").mockImplementation((() => {}) as any);
    jest.clearAllMocks();
    // Save and clear provider tokens so promptApiToken/initCommand doesn't pick them up
    for (const key of ["HETZNER_TOKEN", "DIGITALOCEAN_TOKEN", "VULTR_TOKEN", "LINODE_TOKEN"]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }

    // Make all setTimeout calls resolve instantly for test speed
    global.setTimeout = ((fn: Function) => {
      fn();
      return 0;
    }) as any;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    processExitSpy.mockRestore();
    global.setTimeout = originalSetTimeout;
    // Restore provider tokens
    for (const key of ["HETZNER_TOKEN", "DIGITALOCEAN_TOKEN", "VULTR_TOKEN", "LINODE_TOKEN"]) {
      if (savedEnv[key] !== undefined) process.env[key] = savedEnv[key];
      else delete process.env[key];
    }
  });

  describe("Hetzner flow", () => {
    it("should complete full deployment flow successfully", async () => {
      // Mock prompts: provider → apiToken → region → size → serverName → confirm
      mockedInquirer.prompt
        .mockResolvedValueOnce({ provider: "hetzner" })
        .mockResolvedValueOnce({ apiToken: "valid-token" })
        .mockResolvedValueOnce({ region: "nbg1" })
        .mockResolvedValueOnce({ size: "cax11" })
        .mockResolvedValueOnce({ serverName: "coolify-test" })
        .mockResolvedValueOnce({ confirm: "yes" });

      // Mock API: validateToken → locations → serverTypes → confirmLocations → confirmServerTypes → getServerStatus
      mockedAxios.get
        .mockResolvedValueOnce({ data: { servers: [] } }) // validateToken
        .mockResolvedValueOnce(hetznerLocationsResponse) // getAvailableLocations (selection)
        .mockResolvedValueOnce(hetznerServerTypesResponse) // getAvailableServerTypes (selection)
        .mockResolvedValueOnce(hetznerLocationsResponse) // getAvailableLocations (confirmDeployment)
        .mockResolvedValueOnce(hetznerServerTypesResponse) // getAvailableServerTypes (confirmDeployment)
        .mockResolvedValueOnce({ data: { server: { status: "running" } } }); // getServerStatus

      // Mock: createServer succeeds
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          server: {
            id: 123,
            public_net: { ipv4: { ip: "1.2.3.4" } },
            status: "initializing",
          },
        },
      });

      await initCommand();

      expect(mockedAxios.get).toHaveBeenCalled();
      expect(mockedAxios.post).toHaveBeenCalled();

      const allOutput = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(allOutput).toContain("1.2.3.4");
      expect(processExitSpy).not.toHaveBeenCalled();
    });

    it("should abort when user cancels deployment", async () => {
      // Mock prompts: provider → apiToken → region → size → serverName → cancel
      mockedInquirer.prompt
        .mockResolvedValueOnce({ provider: "hetzner" })
        .mockResolvedValueOnce({ apiToken: "valid-token" })
        .mockResolvedValueOnce({ region: "nbg1" })
        .mockResolvedValueOnce({ size: "cax11" })
        .mockResolvedValueOnce({ serverName: "coolify-test" })
        .mockResolvedValueOnce({ confirm: "no" });

      // Mock API: validateToken → locations → serverTypes → confirmLocations → confirmServerTypes
      mockedAxios.get
        .mockResolvedValueOnce({ data: { servers: [] } })
        .mockResolvedValueOnce(hetznerLocationsResponse)
        .mockResolvedValueOnce(hetznerServerTypesResponse)
        .mockResolvedValueOnce(hetznerLocationsResponse)
        .mockResolvedValueOnce(hetznerServerTypesResponse);

      await initCommand();

      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it("should stop on invalid API token", async () => {
      mockedInquirer.prompt
        .mockResolvedValueOnce({ provider: "hetzner" })
        .mockResolvedValueOnce({ apiToken: "bad-token" });

      mockedAxios.get.mockRejectedValueOnce(new Error("Unauthorized"));

      await initCommand();

      expect(mockedAxios.post).not.toHaveBeenCalled();
      expect(processExitSpy).not.toHaveBeenCalled();
    });

    it("should handle server creation failure", async () => {
      mockedInquirer.prompt
        .mockResolvedValueOnce({ provider: "hetzner" })
        .mockResolvedValueOnce({ apiToken: "valid-token" })
        .mockResolvedValueOnce({ region: "nbg1" })
        .mockResolvedValueOnce({ size: "cax11" })
        .mockResolvedValueOnce({ serverName: "coolify-test" })
        .mockResolvedValueOnce({ confirm: "yes" });

      mockedAxios.get
        .mockResolvedValueOnce({ data: { servers: [] } })
        .mockResolvedValueOnce(hetznerLocationsResponse)
        .mockResolvedValueOnce(hetznerServerTypesResponse)
        .mockResolvedValueOnce(hetznerLocationsResponse)
        .mockResolvedValueOnce(hetznerServerTypesResponse);

      mockedAxios.post.mockRejectedValueOnce({
        response: { data: { error: { message: "insufficient_funds" } } },
      });

      await initCommand();

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should handle server boot timeout", async () => {
      mockedInquirer.prompt
        .mockResolvedValueOnce({ provider: "hetzner" })
        .mockResolvedValueOnce({ apiToken: "valid-token" })
        .mockResolvedValueOnce({ region: "nbg1" })
        .mockResolvedValueOnce({ size: "cax11" })
        .mockResolvedValueOnce({ serverName: "coolify-test" })
        .mockResolvedValueOnce({ confirm: "yes" });

      mockedAxios.get
        .mockResolvedValueOnce({ data: { servers: [] } })
        .mockResolvedValueOnce(hetznerLocationsResponse)
        .mockResolvedValueOnce(hetznerServerTypesResponse)
        .mockResolvedValueOnce(hetznerLocationsResponse)
        .mockResolvedValueOnce(hetznerServerTypesResponse);

      mockedAxios.post.mockResolvedValueOnce({
        data: {
          server: {
            id: 456,
            public_net: { ipv4: { ip: "5.6.7.8" } },
            status: "initializing",
          },
        },
      });

      // getServerStatus returns "initializing" for all 30 attempts (never becomes "running")
      for (let i = 0; i < 31; i++) {
        mockedAxios.get.mockResolvedValueOnce({
          data: { server: { status: "initializing" } },
        });
      }

      await initCommand();

      expect(mockedAxios.post).toHaveBeenCalled();
    });

    it("should handle network error during deployment", async () => {
      mockedInquirer.prompt
        .mockResolvedValueOnce({ provider: "hetzner" })
        .mockResolvedValueOnce({ apiToken: "valid-token" })
        .mockResolvedValueOnce({ region: "nbg1" })
        .mockResolvedValueOnce({ size: "cax11" })
        .mockResolvedValueOnce({ serverName: "coolify-test" })
        .mockResolvedValueOnce({ confirm: "yes" });

      mockedAxios.get
        .mockResolvedValueOnce({ data: { servers: [] } })
        .mockResolvedValueOnce(hetznerLocationsResponse)
        .mockResolvedValueOnce(hetznerServerTypesResponse)
        .mockResolvedValueOnce(hetznerLocationsResponse)
        .mockResolvedValueOnce(hetznerServerTypesResponse);

      mockedAxios.post.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      await initCommand();

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should retry with different server type when unavailable", async () => {
      // Mock prompts: provider → apiToken → region → size → serverName → confirm → retry size
      mockedInquirer.prompt
        .mockResolvedValueOnce({ provider: "hetzner" })
        .mockResolvedValueOnce({ apiToken: "valid-token" })
        .mockResolvedValueOnce({ region: "nbg1" })
        .mockResolvedValueOnce({ size: "cax11" })
        .mockResolvedValueOnce({ serverName: "coolify-test" })
        .mockResolvedValueOnce({ confirm: "yes" })
        .mockResolvedValueOnce({ size: "cpx11" }); // retry: pick different type

      // Mock API
      mockedAxios.get
        .mockResolvedValueOnce({ data: { servers: [] } }) // validateToken
        .mockResolvedValueOnce(hetznerLocationsResponse) // getAvailableLocations (selection)
        .mockResolvedValueOnce(hetznerServerTypesResponse) // getAvailableServerTypes (selection)
        .mockResolvedValueOnce(hetznerLocationsResponse) // getAvailableLocations (confirmDeployment)
        .mockResolvedValueOnce(hetznerServerTypesResponse) // getAvailableServerTypes (confirmDeployment)
        .mockResolvedValueOnce(hetznerServerTypesResponse) // getAvailableServerTypes (retry selection)
        .mockResolvedValueOnce({ data: { server: { status: "running" } } }); // getServerStatus

      // Mock: first createServer fails (unsupported), second succeeds
      mockedAxios.post
        .mockRejectedValueOnce(
          new Error("Failed to create server: unsupported location for server type"),
        )
        .mockResolvedValueOnce({
          data: {
            server: {
              id: 789,
              public_net: { ipv4: { ip: "9.8.7.6" } },
              status: "initializing",
            },
          },
        });

      await initCommand();

      expect(mockedAxios.post).toHaveBeenCalledTimes(2);

      const allOutput = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(allOutput).toContain("9.8.7.6");
      expect(processExitSpy).not.toHaveBeenCalled();
    });

    it("should retry with new name when server name is already used", async () => {
      mockedInquirer.prompt
        .mockResolvedValueOnce({ provider: "hetzner" })
        .mockResolvedValueOnce({ apiToken: "valid-token" })
        .mockResolvedValueOnce({ region: "nbg1" })
        .mockResolvedValueOnce({ size: "cax11" })
        .mockResolvedValueOnce({ serverName: "coolify-server" })
        .mockResolvedValueOnce({ confirm: "yes" })
        .mockResolvedValueOnce({ serverName: "coolify-new" }); // retry: pick new name

      mockedAxios.get
        .mockResolvedValueOnce({ data: { servers: [] } }) // validateToken
        .mockResolvedValueOnce(hetznerLocationsResponse) // getAvailableLocations (selection)
        .mockResolvedValueOnce(hetznerServerTypesResponse) // getAvailableServerTypes (selection)
        .mockResolvedValueOnce(hetznerLocationsResponse) // getAvailableLocations (confirmDeployment)
        .mockResolvedValueOnce(hetznerServerTypesResponse) // getAvailableServerTypes (confirmDeployment)
        .mockResolvedValueOnce({ data: { server: { status: "running" } } }); // getServerStatus

      mockedAxios.post
        .mockRejectedValueOnce(new Error("Failed to create server: server name is already used"))
        .mockResolvedValueOnce({
          data: {
            server: {
              id: 111,
              public_net: { ipv4: { ip: "2.3.4.5" } },
              status: "initializing",
            },
          },
        });

      await initCommand();

      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
      const allOutput = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(allOutput).toContain("2.3.4.5");
      expect(processExitSpy).not.toHaveBeenCalled();
    });

    it("should retry with new region and server type when location is disabled", async () => {
      mockedInquirer.prompt
        .mockResolvedValueOnce({ provider: "hetzner" })
        .mockResolvedValueOnce({ apiToken: "valid-token" })
        .mockResolvedValueOnce({ region: "fsn1" })
        .mockResolvedValueOnce({ size: "cax11" })
        .mockResolvedValueOnce({ serverName: "coolify-test" })
        .mockResolvedValueOnce({ confirm: "yes" })
        .mockResolvedValueOnce({ region: "nbg1" }) // retry: pick new region
        .mockResolvedValueOnce({ size: "cx23" }); // retry: pick new server type

      mockedAxios.get
        .mockResolvedValueOnce({ data: { servers: [] } }) // validateToken
        .mockResolvedValueOnce(hetznerLocationsResponse) // getAvailableLocations (selection)
        .mockResolvedValueOnce(hetznerServerTypesResponse) // getAvailableServerTypes (selection)
        .mockResolvedValueOnce(hetznerLocationsResponse) // getAvailableLocations (confirmDeployment)
        .mockResolvedValueOnce(hetznerServerTypesResponse) // getAvailableServerTypes (confirmDeployment)
        .mockResolvedValueOnce(hetznerLocationsResponse) // getAvailableLocations (retry)
        .mockResolvedValueOnce(hetznerServerTypesResponse) // getAvailableServerTypes (retry)
        .mockResolvedValueOnce({ data: { server: { status: "running" } } }); // getServerStatus

      mockedAxios.post
        .mockRejectedValueOnce(new Error("Failed to create server: location disabled"))
        .mockResolvedValueOnce({
          data: {
            server: {
              id: 222,
              public_net: { ipv4: { ip: "3.4.5.6" } },
              status: "initializing",
            },
          },
        });

      await initCommand();

      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
      const allOutput = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(allOutput).toContain("3.4.5.6");
      expect(processExitSpy).not.toHaveBeenCalled();
    });

    it("should exit after max retries on unavailable server type", async () => {
      mockedInquirer.prompt
        .mockResolvedValueOnce({ provider: "hetzner" })
        .mockResolvedValueOnce({ apiToken: "valid-token" })
        .mockResolvedValueOnce({ region: "nbg1" })
        .mockResolvedValueOnce({ size: "cax11" })
        .mockResolvedValueOnce({ serverName: "coolify-test" })
        .mockResolvedValueOnce({ confirm: "yes" })
        .mockResolvedValueOnce({ size: "cpx11" }) // retry 1
        .mockResolvedValueOnce({ size: "cax21" }); // retry 2

      mockedAxios.get
        .mockResolvedValueOnce({ data: { servers: [] } })
        .mockResolvedValueOnce(hetznerLocationsResponse)
        .mockResolvedValueOnce(hetznerServerTypesResponse)
        .mockResolvedValueOnce(hetznerLocationsResponse)
        .mockResolvedValueOnce(hetznerServerTypesResponse)
        .mockResolvedValueOnce(hetznerServerTypesResponse) // retry 1
        .mockResolvedValueOnce(hetznerServerTypesResponse); // retry 2

      mockedAxios.post
        .mockRejectedValueOnce(
          new Error("Failed to create server: unsupported location for server type"),
        )
        .mockRejectedValueOnce(
          new Error("Failed to create server: unsupported location for server type"),
        )
        .mockRejectedValueOnce(
          new Error("Failed to create server: unsupported location for server type"),
        );

      await initCommand();

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("Unknown provider", () => {
    it("should throw error for unknown provider selection", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ provider: "unknown-provider" });

      await expect(initCommand()).rejects.toThrow("Unknown provider: unknown-provider");
    });
  });

  describe("DigitalOcean flow", () => {
    it("should complete full DO deployment flow successfully", async () => {
      // Mock prompts: provider → apiToken → region → size → serverName → confirm
      mockedInquirer.prompt
        .mockResolvedValueOnce({ provider: "digitalocean" })
        .mockResolvedValueOnce({ apiToken: "do-valid-token" })
        .mockResolvedValueOnce({ region: "nyc1" })
        .mockResolvedValueOnce({ size: "s-2vcpu-2gb" })
        .mockResolvedValueOnce({ serverName: "coolify-do" })
        .mockResolvedValueOnce({ confirm: "yes" });

      // Mock API: validateToken → regions → sizes → confirmRegions → confirmSizes → getServerStatus
      mockedAxios.get
        .mockResolvedValueOnce({ data: { account: { status: "active" } } }) // validateToken
        .mockResolvedValueOnce(doRegionsResponse) // getAvailableLocations (selection)
        .mockResolvedValueOnce(doSizesResponse) // getAvailableServerTypes (selection)
        .mockResolvedValueOnce(doRegionsResponse) // getAvailableLocations (confirmDeployment)
        .mockResolvedValueOnce(doSizesResponse) // getAvailableServerTypes (confirmDeployment)
        .mockResolvedValueOnce({ data: { droplet: { status: "active" } } }); // getServerStatus → DO returns "active", normalized to "running"

      // Mock: createServer succeeds
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          droplet: {
            id: 555,
            networks: {
              v4: [{ type: "public", ip_address: "10.20.30.40" }],
            },
            status: "new",
          },
        },
      });

      await initCommand();

      expect(mockedAxios.post).toHaveBeenCalled();

      const allOutput = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(allOutput).toContain("10.20.30.40");
      expect(allOutput).toContain("DigitalOcean");
      expect(processExitSpy).not.toHaveBeenCalled();
    });

    it("should stop on invalid DO API token", async () => {
      mockedInquirer.prompt
        .mockResolvedValueOnce({ provider: "digitalocean" })
        .mockResolvedValueOnce({ apiToken: "bad-do-token" });

      mockedAxios.get.mockRejectedValueOnce(new Error("Unauthorized"));

      await initCommand();

      expect(mockedAxios.post).not.toHaveBeenCalled();
      expect(processExitSpy).not.toHaveBeenCalled();
    });

    it("should handle DO server creation failure", async () => {
      mockedInquirer.prompt
        .mockResolvedValueOnce({ provider: "digitalocean" })
        .mockResolvedValueOnce({ apiToken: "do-valid-token" })
        .mockResolvedValueOnce({ region: "nyc1" })
        .mockResolvedValueOnce({ size: "s-2vcpu-2gb" })
        .mockResolvedValueOnce({ serverName: "coolify-do" })
        .mockResolvedValueOnce({ confirm: "yes" });

      mockedAxios.get
        .mockResolvedValueOnce({ data: { account: { status: "active" } } })
        .mockResolvedValueOnce(doRegionsResponse)
        .mockResolvedValueOnce(doSizesResponse)
        .mockResolvedValueOnce(doRegionsResponse)
        .mockResolvedValueOnce(doSizesResponse);

      mockedAxios.post.mockRejectedValueOnce({
        response: { data: { message: "You specified an invalid size for Droplet creation." } },
      });

      await initCommand();

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("Non-interactive mode", () => {
    it("should exit with error for invalid provider option", async () => {
      await initCommand({ provider: "aws", token: "test" });

      expect(processExitSpy).toHaveBeenCalledWith(1);
      const allOutput = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(allOutput).toContain("Invalid provider");
    });

    it("should exit with error for invalid token", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("Unauthorized"));

      await initCommand({
        provider: "hetzner",
        token: "bad-token",
        region: "nbg1",
        size: "cax11",
        name: "test",
      });

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should deploy with all options provided", async () => {
      // validateToken
      mockedAxios.get
        .mockResolvedValueOnce({ data: { servers: [] } })
        .mockResolvedValueOnce({ data: { server: { status: "running" } } });

      mockedAxios.post.mockResolvedValueOnce({
        data: {
          server: {
            id: 999,
            public_net: { ipv4: { ip: "5.5.5.5" } },
            status: "initializing",
          },
        },
      });

      await initCommand({
        provider: "hetzner",
        token: "valid-token",
        region: "nbg1",
        size: "cax11",
        name: "auto-server",
      });

      expect(mockedAxios.post).toHaveBeenCalled();
      const allOutput = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(allOutput).toContain("5.5.5.5");
      expect(processExitSpy).not.toHaveBeenCalled();
    });
  });
});
