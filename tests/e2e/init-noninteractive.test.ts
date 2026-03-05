import axios from "axios";
import inquirer from "inquirer";
import { initCommand } from "../../src/commands/init";

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

describe("initCommand Non-Interactive", () => {
  let consoleSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;
  const originalSetTimeout = global.setTimeout;
  const originalEnv = process.env;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    processExitSpy = jest.spyOn(process, "exit").mockImplementation((() => {}) as any);
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.HETZNER_TOKEN;
    delete process.env.DIGITALOCEAN_TOKEN;
    global.setTimeout = ((fn: Function) => {
      fn();
      return 0;
    }) as any;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    processExitSpy.mockRestore();
    process.env = originalEnv;
    global.setTimeout = originalSetTimeout;
  });

  it("should deploy with all options (hetzner)", async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: { servers: [] } }) // validateToken
      .mockResolvedValueOnce({ data: { server: { status: "running" } } }); // getServerStatus

    mockedAxios.post.mockResolvedValueOnce({
      data: {
        server: {
          id: 101,
          public_net: { ipv4: { ip: "99.88.77.66" } },
          status: "initializing",
        },
      },
    });

    await initCommand({
      provider: "hetzner",
      token: "valid-token",
      region: "nbg1",
      size: "cax11",
      name: "auto-hetzner",
    });

    expect(mockedInquirer.prompt).not.toHaveBeenCalled();
    expect(mockedAxios.post).toHaveBeenCalled();
    const allOutput = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(allOutput).toContain("99.88.77.66");
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it("should deploy with all options (digitalocean)", async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: { account: { status: "active" } } }) // validateToken
      .mockResolvedValueOnce({ data: { droplet: { status: "active" } } }); // getServerStatus

    mockedAxios.post.mockResolvedValueOnce({
      data: {
        droplet: {
          id: 202,
          networks: { v4: [{ type: "public", ip_address: "55.44.33.22" }] },
          status: "new",
        },
      },
    });

    await initCommand({
      provider: "digitalocean",
      token: "do-token",
      region: "nyc1",
      size: "s-2vcpu-2gb",
      name: "auto-do",
    });

    expect(mockedInquirer.prompt).not.toHaveBeenCalled();
    expect(mockedAxios.post).toHaveBeenCalled();
    const allOutput = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(allOutput).toContain("55.44.33.22");
  });

  it("should exit with error for invalid provider", async () => {
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

  it("should prompt for missing size when region is provided", async () => {
    // validateToken
    mockedAxios.get
      .mockResolvedValueOnce({ data: { servers: [] } })
      .mockResolvedValueOnce({ data: { server_types: [] } }) // getAvailableServerTypes fallback
      .mockResolvedValueOnce({ data: { server: { status: "running" } } });

    // Prompt for size
    mockedInquirer.prompt.mockResolvedValueOnce({ size: "cax11" });

    mockedAxios.post.mockResolvedValueOnce({
      data: {
        server: {
          id: 303,
          public_net: { ipv4: { ip: "11.22.33.44" } },
          status: "initializing",
        },
      },
    });

    await initCommand({
      provider: "hetzner",
      token: "valid-token",
      region: "nbg1",
      name: "partial-test",
    });

    // Should have prompted for size only
    expect(mockedInquirer.prompt).toHaveBeenCalledTimes(1);
    expect(mockedAxios.post).toHaveBeenCalled();
  });

  it("should prompt for missing name when other options provided", async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: { servers: [] } })
      .mockResolvedValueOnce({ data: { server: { status: "running" } } });

    // Prompt for name
    mockedInquirer.prompt.mockResolvedValueOnce({ serverName: "prompted-name" });

    mockedAxios.post.mockResolvedValueOnce({
      data: {
        server: {
          id: 404,
          public_net: { ipv4: { ip: "44.55.66.77" } },
          status: "initializing",
        },
      },
    });

    await initCommand({
      provider: "hetzner",
      token: "valid-token",
      region: "nbg1",
      size: "cax11",
    });

    expect(mockedInquirer.prompt).toHaveBeenCalledTimes(1);
    expect(mockedAxios.post).toHaveBeenCalled();
  });

  it("should handle server IP pending (DO assigns later)", async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: { account: { status: "active" } } })
      .mockResolvedValueOnce({ data: { droplet: { status: "active" } } })
      // getServerDetails for IP refresh
      .mockResolvedValueOnce({
        data: {
          droplet: {
            id: 505,
            networks: { v4: [{ type: "public", ip_address: "77.88.99.11" }] },
            status: "active",
          },
        },
      });

    mockedAxios.post.mockResolvedValueOnce({
      data: {
        droplet: {
          id: 505,
          networks: { v4: [] }, // No IP yet
          status: "new",
        },
      },
    });

    await initCommand({
      provider: "digitalocean",
      token: "do-token",
      region: "nyc1",
      size: "s-2vcpu-2gb",
      name: "do-pending",
    });

    const allOutput = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(allOutput).toContain("77.88.99.11");
  });

  it("should handle server creation failure in non-interactive", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { servers: [] } });

    mockedAxios.post.mockRejectedValueOnce(new Error("quota exceeded"));

    await initCommand({
      provider: "hetzner",
      token: "valid-token",
      region: "nbg1",
      size: "cax11",
      name: "fail-test",
    });

    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it("should handle server boot timeout", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { servers: [] } });

    mockedAxios.post.mockResolvedValueOnce({
      data: {
        server: {
          id: 600,
          public_net: { ipv4: { ip: "6.6.6.6" } },
          status: "initializing",
        },
      },
    });

    // Never becomes "running"
    for (let i = 0; i < 31; i++) {
      mockedAxios.get.mockResolvedValueOnce({
        data: { server: { status: "initializing" } },
      });
    }

    await initCommand({
      provider: "hetzner",
      token: "valid-token",
      region: "nbg1",
      size: "cax11",
      name: "timeout-test",
    });

    const allOutput = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(allOutput).toContain("check your cloud provider dashboard");
  });

  it("should use HETZNER_TOKEN env var when --token not provided", async () => {
    process.env.HETZNER_TOKEN = "env-hetzner-token";

    mockedAxios.get
      .mockResolvedValueOnce({ data: { servers: [] } }) // validateToken
      .mockResolvedValueOnce({ data: { server: { status: "running" } } }); // getServerStatus

    mockedAxios.post.mockResolvedValueOnce({
      data: {
        server: {
          id: 701,
          public_net: { ipv4: { ip: "10.20.30.40" } },
          status: "initializing",
        },
      },
    });

    await initCommand({
      provider: "hetzner",
      region: "nbg1",
      size: "cax11",
      name: "env-hetzner",
    });

    expect(mockedInquirer.prompt).not.toHaveBeenCalled();
    expect(mockedAxios.post).toHaveBeenCalled();
    const allOutput = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(allOutput).toContain("10.20.30.40");
  });

  it("should use DIGITALOCEAN_TOKEN env var when --token not provided", async () => {
    process.env.DIGITALOCEAN_TOKEN = "env-do-token";

    mockedAxios.get
      .mockResolvedValueOnce({ data: { account: { status: "active" } } }) // validateToken
      .mockResolvedValueOnce({ data: { droplet: { status: "active" } } }); // getServerStatus

    mockedAxios.post.mockResolvedValueOnce({
      data: {
        droplet: {
          id: 702,
          networks: { v4: [{ type: "public", ip_address: "50.60.70.80" }] },
          status: "new",
        },
      },
    });

    await initCommand({
      provider: "digitalocean",
      region: "nyc1",
      size: "s-2vcpu-2gb",
      name: "env-do-test",
    });

    expect(mockedInquirer.prompt).not.toHaveBeenCalled();
    expect(mockedAxios.post).toHaveBeenCalled();
    const allOutput = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(allOutput).toContain("50.60.70.80");
  });

  it("should prefer --token flag over env var", async () => {
    process.env.HETZNER_TOKEN = "env-token-should-not-be-used";

    mockedAxios.get
      .mockResolvedValueOnce({ data: { servers: [] } })
      .mockResolvedValueOnce({ data: { server: { status: "running" } } });

    mockedAxios.post.mockResolvedValueOnce({
      data: {
        server: {
          id: 703,
          public_net: { ipv4: { ip: "11.22.33.44" } },
          status: "initializing",
        },
      },
    });

    await initCommand({
      provider: "hetzner",
      token: "explicit-flag-token",
      region: "nbg1",
      size: "cax11",
      name: "flag-priority",
    });

    // Verify the explicit token was used (post was called, meaning token validated)
    expect(mockedAxios.post).toHaveBeenCalled();
    // The first GET (validateToken) should use the flag token, not env token
    const firstGetCall = mockedAxios.get.mock.calls[0];
    expect(firstGetCall[1]?.headers?.Authorization).toBe("Bearer explicit-flag-token");
  });

  it("should prompt for token when not provided via flag or env var", async () => {
    // No --token, no env var → should fall through to interactive prompt
    mockedInquirer.prompt.mockResolvedValueOnce({ apiToken: "prompted-token" });
    // validateToken + getServerStatus
    mockedAxios.get
      .mockResolvedValueOnce({ data: { servers: [] } })
      .mockResolvedValueOnce({ data: { server: { status: "running" } } });
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        server: {
          id: 999,
          public_net: { ipv4: { ip: "10.20.30.40" } },
          status: "initializing",
        },
      },
    });

    await initCommand({
      provider: "hetzner",
      region: "nbg1",
      size: "cax11",
      name: "no-token-test",
    });

    // Should have prompted for token, not errored
    expect(mockedInquirer.prompt).toHaveBeenCalled();
    expect(mockedAxios.post).toHaveBeenCalled();
  });

  describe("Vultr IP assignment", () => {
    it("should warn when Vultr IP assignment times out", async () => {
      // validateToken (Vultr)
      mockedAxios.get.mockResolvedValueOnce({ data: { account: {} } });

      // createServer → IP "0.0.0.0"
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          instance: {
            id: "vultr-timeout",
            main_ip: "0.0.0.0",
            power_status: "running",
            server_status: "ok",
          },
        },
      });

      // getServerStatus → already running
      mockedAxios.get.mockResolvedValueOnce({
        data: { instance: { power_status: "running", server_status: "ok" } },
      });

      // getServerDetails: 40 calls all returning 0.0.0.0
      for (let i = 0; i < 40; i++) {
        mockedAxios.get.mockResolvedValueOnce({
          data: {
            instance: { id: "vultr-timeout", main_ip: "0.0.0.0", power_status: "running" },
          },
        });
      }

      await initCommand({
        provider: "vultr",
        token: "vultr-token",
        region: "ewr",
        size: "vc2-1c-2gb",
        name: "vultr-timeout-test",
      });

      const allOutput = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(allOutput).toContain("IP assignment timed out");
      expect(allOutput).toContain("kastell status vultr-timeout");
    });

    it("should assign Vultr IP after delayed response", async () => {
      // validateToken
      mockedAxios.get.mockResolvedValueOnce({ data: { account: {} } });

      // createServer → IP "0.0.0.0"
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          instance: {
            id: "vultr-delayed",
            main_ip: "0.0.0.0",
            power_status: "running",
            server_status: "ok",
          },
        },
      });

      // getServerStatus → running
      mockedAxios.get.mockResolvedValueOnce({
        data: { instance: { power_status: "running", server_status: "ok" } },
      });

      // getServerDetails: 3 calls returning 0.0.0.0, then IP assigned
      for (let i = 0; i < 3; i++) {
        mockedAxios.get.mockResolvedValueOnce({
          data: {
            instance: { id: "vultr-delayed", main_ip: "0.0.0.0", power_status: "running" },
          },
        });
      }
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          instance: { id: "vultr-delayed", main_ip: "45.76.100.50", power_status: "running" },
        },
      });

      await initCommand({
        provider: "vultr",
        token: "vultr-token",
        region: "ewr",
        size: "vc2-1c-2gb",
        name: "vultr-delayed-test",
      });

      const allOutput = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(allOutput).toContain("45.76.100.50");
      expect(allOutput).not.toContain("IP assignment timed out");
    });

    it("should handle Vultr server_status provisioning before running", async () => {
      // validateToken
      mockedAxios.get.mockResolvedValueOnce({ data: { account: {} } });

      // createServer → IP assigned immediately
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          instance: {
            id: "vultr-prov",
            main_ip: "45.76.100.51",
            power_status: "running",
            server_status: "installingbooting",
          },
        },
      });

      // getServerStatus: first 2 calls → provisioning, then ok
      mockedAxios.get
        .mockResolvedValueOnce({
          data: { instance: { power_status: "running", server_status: "installingbooting" } },
        })
        .mockResolvedValueOnce({
          data: { instance: { power_status: "running", server_status: "installingbooting" } },
        })
        .mockResolvedValueOnce({
          data: { instance: { power_status: "running", server_status: "ok" } },
        });

      await initCommand({
        provider: "vultr",
        token: "vultr-token",
        region: "ewr",
        size: "vc2-1c-2gb",
        name: "vultr-prov-test",
      });

      const allOutput = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(allOutput).toContain("45.76.100.51");
      expect(processExitSpy).not.toHaveBeenCalled();
    });
  });

  it("should show onboarding next steps after successful deploy", async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: { servers: [] } })
      .mockResolvedValueOnce({ data: { server: { status: "running" } } });

    mockedAxios.post.mockResolvedValueOnce({
      data: {
        server: {
          id: 800,
          public_net: { ipv4: { ip: "88.99.11.22" } },
          status: "initializing",
        },
      },
    });

    await initCommand({
      provider: "hetzner",
      token: "valid-token",
      region: "nbg1",
      size: "cax11",
      name: "ssl-warn-test",
    });

    const allOutput = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(allOutput).toContain("What's Next?");
    expect(allOutput).toContain("firewall setup");
    expect(allOutput).toContain("domain add");
    expect(allOutput).toContain("secure setup");
    expect(allOutput).toContain("backup");
    expect(allOutput).toContain("Give us a star");
  });
});
