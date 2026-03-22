import axios from "axios";
import * as config from "../../src/utils/config";
import * as providerFactory from "../../src/utils/providerFactory";
import * as ssh from "../../src/utils/ssh";
import { handleServerInfo } from "../../src/mcp/tools/serverInfo";
import type { CloudProvider } from "../../src/providers/base";

jest.mock("../../src/utils/config");
jest.mock("../../src/utils/providerFactory");
jest.mock("../../src/utils/ssh");
jest.mock("../../src/core/tokenBuffer", () => ({
  storeToken: jest.fn(),
  readToken: jest.fn().mockReturnValue(undefined),
  clearAllTokens: jest.fn(),
  registerCleanupHandlers: jest.fn(),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedConfig = config as jest.Mocked<typeof config>;
const mockedProviderFactory = providerFactory as jest.Mocked<typeof providerFactory>;
const mockedSsh = ssh as jest.Mocked<typeof ssh>;

const sampleServer = {
  id: "123",
  name: "coolify-test",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-02-20T00:00:00Z",
  mode: "coolify" as const,
};

const sampleServer2 = {
  id: "456",
  name: "coolify-prod",
  provider: "digitalocean",
  ip: "5.6.7.8",
  region: "nyc1",
  size: "s-2vcpu-4gb",
  createdAt: "2026-02-21T00:00:00Z",
  mode: "coolify" as const,
};

const bareServer = {
  id: "789",
  name: "bare-node",
  provider: "hetzner",
  ip: "9.10.11.12",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-02-22T00:00:00Z",
  mode: "bare" as const,
};

const mockProvider: CloudProvider = {
  name: "hetzner",
  displayName: "Hetzner Cloud",
  validateToken: jest.fn(),
  getRegions: jest.fn().mockReturnValue([]),
  getServerSizes: jest.fn().mockReturnValue([]),
  getAvailableLocations: jest.fn().mockResolvedValue([]),
  getAvailableServerTypes: jest.fn().mockResolvedValue([]),
  uploadSshKey: jest.fn(),
  createServer: jest.fn(),
  getServerStatus: jest.fn(),
  getServerDetails: jest.fn(),
  destroyServer: jest.fn(),
  rebootServer: jest.fn(),
  createSnapshot: jest.fn(),
  listSnapshots: jest.fn(),
  deleteSnapshot: jest.fn(),
  getSnapshotCostEstimate: jest.fn(),
};

const originalEnv = process.env;

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...originalEnv };
  mockedSsh.assertValidIp.mockImplementation(() => {});
});

afterAll(() => {
  process.env = originalEnv;
});

describe("handleServerInfo — list", () => {
  it("should return empty list when no servers", async () => {
    mockedConfig.getServers.mockReturnValue([]);

    const result = await handleServerInfo({ action: "list" });
    const data = JSON.parse(result.content[0].text);

    expect(data.servers).toEqual([]);
    expect(data.total).toBe(0);
    expect(data.suggested_actions).toBeDefined();
    expect(result.isError).toBeUndefined();
  });

  it("should return all servers with details", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer, sampleServer2]);

    const result = await handleServerInfo({ action: "list" });
    const data = JSON.parse(result.content[0].text);

    expect(data.servers).toHaveLength(2);
    expect(data.servers[0].name).toBe("coolify-test");
    expect(data.servers[0].ip).toBe("1.2.3.4");
    expect(data.servers[0].provider).toBe("hetzner");
    expect(data.servers[1].name).toBe("coolify-prod");
    expect(data.total).toBe(2);
  });

  it("should include suggested_actions in response", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);

    const result = await handleServerInfo({ action: "list" });
    const data = JSON.parse(result.content[0].text);

    expect(data.suggested_actions).toBeDefined();
    expect(data.suggested_actions.length).toBeGreaterThan(0);
    expect(data.suggested_actions[0]).toHaveProperty("command");
    expect(data.suggested_actions[0]).toHaveProperty("reason");
  });
});

describe("handleServerInfo — status", () => {
  it("should return error when no servers exist", async () => {
    mockedConfig.getServers.mockReturnValue([]);

    const result = await handleServerInfo({ action: "status" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toBe("No servers found");
  });

  it("should return error when server not found", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(undefined);

    const result = await handleServerInfo({ action: "status", server: "nonexistent" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("Server not found");
    expect(data.available_servers).toContain("coolify-test");
  });

  it("should return error when API token is missing", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(sampleServer);
    delete process.env.HETZNER_TOKEN;

    const result = await handleServerInfo({ action: "status", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("No API token");
    expect(data.hint).toContain("HETZNER_TOKEN");
  });

  it("should return single server status with token from env", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(sampleServer);
    (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
    mockedAxios.get.mockResolvedValueOnce({ status: 200 });

    const result = await handleServerInfo({ action: "status", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.results).toHaveLength(1);
    expect(data.results[0].serverStatus).toBe("running");
    expect(data.results[0].platformStatus).toBe("running");
    expect(data.summary.running).toBe(1);
  });

  it("should return all servers status", async () => {
    process.env.HETZNER_TOKEN = "h-token";
    process.env.DIGITALOCEAN_TOKEN = "do-token";
    mockedConfig.getServers.mockReturnValue([sampleServer, sampleServer2]);
    (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
    mockedAxios.get.mockResolvedValue({ status: 200 });

    const result = await handleServerInfo({ action: "status" });
    const data = JSON.parse(result.content[0].text);

    expect(data.results).toHaveLength(2);
    expect(data.summary.total).toBe(2);
    expect(data.summary.running).toBe(2);
  });

  it("should return error when tokens missing for all-servers status", async () => {
    delete process.env.HETZNER_TOKEN;
    mockedConfig.getServers.mockReturnValue([sampleServer]);

    const result = await handleServerInfo({ action: "status" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("Missing API tokens");
    expect(data.missing[0].provider).toBe("hetzner");
    expect(data.missing[0].envVar).toBe("HETZNER_TOKEN");
  });

  it("should work with manual servers without token", async () => {
    const manualServer = { ...sampleServer, id: "manual-abc" };
    mockedConfig.getServers.mockReturnValue([manualServer]);
    mockedConfig.findServer.mockReturnValue(manualServer);
    mockedAxios.get.mockResolvedValueOnce({ status: 200 });

    const result = await handleServerInfo({ action: "status", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.results[0].serverStatus).toBe("unknown (manual)");
    expect(data.results[0].platformStatus).toBe("running");
  });

  it("should suggest autostart when coolify not reachable", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(sampleServer);
    (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
    mockedAxios.get.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await handleServerInfo({ action: "status", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);

    expect(data.results[0].platformStatus).toBe("not reachable");
    expect(data.suggested_actions.some((a: { command: string }) => a.command.includes("--autostart"))).toBe(true);
  });
});

describe("handleServerInfo — health", () => {
  it("should return error when no servers exist", async () => {
    mockedConfig.getServers.mockReturnValue([]);

    const result = await handleServerInfo({ action: "health" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toBe("No servers found");
  });

  it("should return error when server not found", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(undefined);

    const result = await handleServerInfo({ action: "health", server: "nonexistent" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("Server not found");
  });

  it("should return single server health — running", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(sampleServer);
    mockedAxios.get.mockResolvedValueOnce({ status: 200 });

    const result = await handleServerInfo({ action: "health", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);

    expect(data.platformStatus).toBe("running");
    expect(data.coolifyUrl).toBe("http://1.2.3.4:8000");
    expect(data.suggested_actions[0].command).toContain("8000");
  });

  it("should return single server health — not reachable", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(sampleServer);
    mockedAxios.get.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await handleServerInfo({ action: "health", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);

    expect(data.platformStatus).toBe("not reachable");
    expect(data.coolifyUrl).toBeNull();
    expect(data.suggested_actions[0].command).toContain("--autostart");
  });

  it("should return all servers health", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer, sampleServer2]);
    mockedAxios.get
      .mockResolvedValueOnce({ status: 200 })
      .mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await handleServerInfo({ action: "health" });
    const data = JSON.parse(result.content[0].text);

    expect(data.results).toHaveLength(2);
    expect(data.summary.running).toBe(1);
    expect(data.summary.notReachable).toBe(1);
    expect(data.suggested_actions.some((a: { command: string }) => a.command.includes("--autostart"))).toBe(true);
  });

  it("should not require API tokens for health checks", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(sampleServer);
    mockedAxios.get.mockResolvedValueOnce({ status: 200 });
    // No env tokens set
    delete process.env.HETZNER_TOKEN;

    const result = await handleServerInfo({ action: "health", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);

    // Health check should work without API tokens
    expect(result.isError).toBeUndefined();
    expect(data.platformStatus).toBe("running");
  });
});

describe("handleServerInfo — list with mode field", () => {
  it("should include mode field for each server in list", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer, bareServer]);

    const result = await handleServerInfo({ action: "list" });
    const data = JSON.parse(result.content[0].text);

    expect(data.servers).toHaveLength(2);
    // coolify server should have mode
    const coolifyEntry = data.servers.find((s: { name: string }) => s.name === "coolify-test");
    expect(coolifyEntry.mode).toBeDefined();
    // bare server should have mode:'bare'
    const bareEntry = data.servers.find((s: { name: string }) => s.name === "bare-node");
    expect(bareEntry.mode).toBe("bare");
  });
});

describe("handleServerInfo — health bare server", () => {
  it("should return SSH reachability for single bare server (reachable)", async () => {
    mockedConfig.getServers.mockReturnValue([bareServer]);
    mockedConfig.findServer.mockReturnValue(bareServer);
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "ok", stderr: "" });

    const result = await handleServerInfo({ action: "health", server: "bare-node" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.server).toBe("bare-node");
    expect(data.ip).toBe("9.10.11.12");
    expect(data.mode).toBe("bare");
    expect(data.sshReachable).toBe(true);
    expect(data.coolifyUrl).toBeUndefined();
    expect(data.platformStatus).toBeUndefined();
  });

  it("should return SSH reachability for single bare server (not reachable)", async () => {
    mockedConfig.getServers.mockReturnValue([bareServer]);
    mockedConfig.findServer.mockReturnValue(bareServer);
    mockedSsh.sshExec.mockRejectedValue(new Error("Connection refused"));

    const result = await handleServerInfo({ action: "health", server: "bare-node" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.mode).toBe("bare");
    expect(data.sshReachable).toBe(false);
    expect(data.suggested_actions).toBeDefined();
  });

  it("should return SSH reachability for bare server in all-servers health", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer, bareServer]);
    // Coolify server: axios returns 200
    mockedAxios.get.mockResolvedValueOnce({ status: 200 });
    // Bare server: SSH succeeds
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "ok", stderr: "" });

    const result = await handleServerInfo({ action: "health" });
    const data = JSON.parse(result.content[0].text);

    expect(data.results).toHaveLength(2);
    const coolifyResult = data.results.find((r: { name: string }) => r.name === "coolify-test");
    const bareResult = data.results.find((r: { name: string }) => r.name === "bare-node");
    expect(coolifyResult.platformStatus).toBe("running");
    expect(bareResult.mode).toBe("bare");
    expect(bareResult.sshReachable).toBe(true);
    // bare server in summary should be counted separately
    expect(data.summary.bare).toBeDefined();
  });

  it("should not call checkCoolifyHealth for bare servers", async () => {
    mockedConfig.getServers.mockReturnValue([bareServer]);
    mockedConfig.findServer.mockReturnValue(bareServer);
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "ok", stderr: "" });

    await handleServerInfo({ action: "health", server: "bare-node" });

    // axios (used by checkCoolifyHealth) should NOT have been called
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});

describe("handleServerInfo — status with mode field", () => {
  it("should include mode field in status result for bare server", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    mockedConfig.getServers.mockReturnValue([bareServer]);
    mockedConfig.findServer.mockReturnValue(bareServer);
    (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
    // bare servers: checkServerStatus returns platformStatus:'n/a'
    mockedAxios.get.mockRejectedValue(new Error("n/a"));

    const result = await handleServerInfo({ action: "status", server: "bare-node" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.results[0].name).toBe("bare-node");
    expect(data.results[0].mode).toBe("bare");
  });
});

describe("handleServerInfo — sizes", () => {
  it("should return error when provider is missing", async () => {
    const result = await handleServerInfo({ action: "sizes" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("Provider is required");
  });

  it("should return error when region is missing", async () => {
    const result = await handleServerInfo({ action: "sizes", provider: "hetzner" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("Region is required");
  });

  it("should return error when API token is missing", async () => {
    delete process.env.HETZNER_TOKEN;

    const result = await handleServerInfo({ action: "sizes", provider: "hetzner", region: "nbg1" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("No API token");
    expect(data.hint).toContain("HETZNER_TOKEN");
  });

  it("should return available server sizes with prices", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    (mockProvider.getAvailableServerTypes as jest.Mock).mockResolvedValue([
      { id: "cax11", name: "CAX11", vcpu: 2, ram: 4, disk: 40, price: "€3.29/mo" },
      { id: "cx22", name: "CX22", vcpu: 2, ram: 4, disk: 40, price: "€4.35/mo" },
    ]);
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    const result = await handleServerInfo({ action: "sizes", provider: "hetzner", region: "nbg1" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.provider).toBe("hetzner");
    expect(data.region).toBe("nbg1");
    expect(data.mode).toBe("coolify");
    expect(data.sizes).toHaveLength(2);
    expect(data.sizes[0].id).toBe("cax11");
    expect(data.sizes[0].price).toBe("€3.29/mo");
    expect(data.sizes[0].ram).toBe("4GB");
    expect(data.sizes[0].disk).toBe("40GB");
    expect(data.total).toBe(2);
    expect(data.suggested_actions).toBeDefined();
  });

  it("should pass mode parameter to getAvailableServerTypes", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    (mockProvider.getAvailableServerTypes as jest.Mock).mockResolvedValue([]);
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    await handleServerInfo({ action: "sizes", provider: "hetzner", region: "nbg1", mode: "bare" });

    expect(mockProvider.getAvailableServerTypes).toHaveBeenCalledWith("nbg1", "bare");
  });

  it("should default mode to coolify when not specified", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    (mockProvider.getAvailableServerTypes as jest.Mock).mockResolvedValue([]);
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    const result = await handleServerInfo({ action: "sizes", provider: "hetzner", region: "nbg1" });
    const data = JSON.parse(result.content[0].text);

    expect(data.mode).toBe("coolify");
    expect(mockProvider.getAvailableServerTypes).toHaveBeenCalledWith("nbg1", "coolify");
  });

  it("should handle provider API errors gracefully", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    (mockProvider.getAvailableServerTypes as jest.Mock).mockRejectedValue(new Error("API rate limited"));
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    const result = await handleServerInfo({ action: "sizes", provider: "hetzner", region: "nbg1" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toBe("API rate limited");
  });

  it("should return empty sizes array for invalid region", async () => {
    process.env.DIGITALOCEAN_TOKEN = "do-token";
    (mockProvider.getAvailableServerTypes as jest.Mock).mockResolvedValue([]);
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    const result = await handleServerInfo({ action: "sizes", provider: "digitalocean", region: "invalid-region" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.sizes).toEqual([]);
    expect(data.total).toBe(0);
  });
});

describe("handleServerInfo — error handling", () => {
  it("should catch unexpected errors and return isError", async () => {
    mockedConfig.getServers.mockImplementation(() => {
      throw new Error("Config file corrupted");
    });

    const result = await handleServerInfo({ action: "list" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toBe("Config file corrupted");
  });

  it("should handle non-Error thrown values", async () => {
    mockedConfig.getServers.mockImplementation(() => {
      throw "unexpected string error";
    });

    const result = await handleServerInfo({ action: "list" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toBe("unexpected string error");
  });
});

describe("malformed params", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedConfig.findServer.mockReturnValue(undefined as never);
  });

  it("returns mcpError when action is null", async () => {
    const result = await handleServerInfo({ action: null as unknown as Parameters<typeof handleServerInfo>[0]["action"] });
    expect(result.isError).toBe(true);
  });

  it("returns mcpError when action is empty string", async () => {
    const result = await handleServerInfo({ action: "" as unknown as Parameters<typeof handleServerInfo>[0]["action"] });
    expect(result.isError).toBe(true);
  });

  it("returns mcpError for unmatched server string in status action", async () => {
    mockedConfig.findServer.mockReturnValue(undefined);
    const result = await handleServerInfo({ action: "status", server: "999.999.999.999" });
    expect(result.isError).toBe(true);
  });

  it("returns mcpError for unmatched server string in health action", async () => {
    mockedConfig.findServer.mockReturnValue(undefined);
    const result = await handleServerInfo({ action: "health", server: "nonexistent" });
    expect(result.isError).toBe(true);
  });
});
