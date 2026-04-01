import * as config from "../../src/utils/config";
import * as ssh from "../../src/utils/ssh";
import * as providerFactory from "../../src/utils/providerFactory";
import * as status from "../../src/core/status";
import * as maintain from "../../src/core/maintain";
import { handleServerMaintain } from "../../src/mcp/tools/serverMaintain";
import {
  rebootAndWait,
  maintainServer,
} from "../../src/core/maintain";
import * as adapterFactory from "../../src/adapters/factory";
import type { CloudProvider } from "../../src/providers/base";
import { createMockAdapter } from "../helpers/mockAdapter";

jest.mock("../../src/utils/config");
jest.mock("../../src/utils/ssh");
jest.mock("../../src/utils/providerFactory");
jest.mock("../../src/core/status");
jest.mock("../../src/core/tokenBuffer", () => ({
  storeToken: jest.fn(),
  readToken: jest.fn().mockReturnValue(undefined),
  clearAllTokens: jest.fn(),
  registerCleanupHandlers: jest.fn(),
}));

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedSsh = ssh as jest.Mocked<typeof ssh>;
const mockedProviderFactory = providerFactory as jest.Mocked<typeof providerFactory>;
const mockedStatus = status as jest.Mocked<typeof status>;

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

const manualServer = {
  id: "manual-1234567890",
  name: "manual-server",
  provider: "hetzner",
  ip: "9.8.7.6",
  region: "unknown",
  size: "unknown",
  createdAt: "2026-02-20T00:00:00Z",
  mode: "coolify" as const,
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
  restoreSnapshot: jest.fn(),
  getSnapshotCostEstimate: jest.fn(),
  findServerByIp: jest.fn().mockResolvedValue(null),
};

// Small intervals for testing — avoids real setTimeout delays
const testConfig = {
  healthPollAttempts: 2,
  healthPollIntervalMs: 10,
  rebootMaxAttempts: 2,
  rebootIntervalMs: 10,
  rebootInitialWaitMs: 0,
};

const originalEnv = process.env;

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...originalEnv };
  process.env.KASTELL_SAFE_MODE = "false";
  mockedSsh.assertValidIp.mockImplementation(() => {});
});

afterAll(() => {
  process.env = originalEnv;
});

// ─── Core: rebootAndWait ─────────────────────────────────────────────────────

describe("rebootAndWait", () => {
  it("should reboot and return success when server comes back", async () => {
    (mockProvider.rebootServer as jest.Mock).mockResolvedValue(undefined);
    (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    const result = await rebootAndWait(sampleServer, "test-token", 3, 10, 0);

    expect(result.success).toBe(true);
    expect(result.finalStatus).toBe("running");
    expect(mockProvider.rebootServer).toHaveBeenCalledWith("123");
  });

  it("should reject manual servers", async () => {
    const result = await rebootAndWait(manualServer, "");

    expect(result.success).toBe(false);
    expect(result.error).toContain("manually added");
    expect(result.error).toContain("ssh root@");
  });

  it("should return timeout when server does not come back", async () => {
    (mockProvider.rebootServer as jest.Mock).mockResolvedValue(undefined);
    (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("stopped");
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    const result = await rebootAndWait(sampleServer, "test-token", 2, 10, 0);

    expect(result.success).toBe(false);
    expect(result.error).toContain("did not come back");
  });

  it("should handle API failure", async () => {
    (mockProvider.rebootServer as jest.Mock).mockRejectedValue(new Error("API rate limited"));
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    const result = await rebootAndWait(sampleServer, "test-token", 3, 10, 0);

    expect(result.success).toBe(false);
    expect(result.error).toBe("API rate limited");
  });
});

// ─── Core: maintainServer ────────────────────────────────────────────────────

describe("maintainServer", () => {
  function createMockPlatformAdapter(overrides?: Record<string, jest.Mock>) {
    return createMockAdapter({ name: "coolify", overrides });
  }

  it("should complete all 5 steps successfully", async () => {
    const mockAdapter = createMockPlatformAdapter();
    jest.spyOn(adapterFactory, "getAdapter").mockReturnValue(mockAdapter);

    mockedStatus.getCloudServerStatus.mockResolvedValue("running");
    (mockProvider.rebootServer as jest.Mock).mockResolvedValue(undefined);
    (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    const result = await maintainServer(sampleServer, "test-token", testConfig);

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(5);
    expect(result.steps[0]).toMatchObject({ step: 1, status: "success" });
    expect(result.steps[1]).toMatchObject({ step: 2, status: "success" });
    expect(result.steps[2]).toMatchObject({ step: 3, status: "success" });
    expect(result.steps[3]).toMatchObject({ step: 4, status: "success" });
    expect(result.steps[4]).toMatchObject({ step: 5, status: "success" });
  });

  it("should abort when server is not running (Step 1)", async () => {
    const mockAdapter = createMockPlatformAdapter();
    jest.spyOn(adapterFactory, "getAdapter").mockReturnValue(mockAdapter);

    mockedStatus.getCloudServerStatus.mockResolvedValue("stopped");

    const result = await maintainServer(sampleServer, "test-token", testConfig);

    expect(result.success).toBe(false);
    expect(result.steps[0]).toMatchObject({ step: 1, status: "failure" });
    expect(result.steps[1]).toMatchObject({ step: 2, status: "skipped" });
    expect(result.steps[2]).toMatchObject({ step: 3, status: "skipped" });
    expect(result.steps[3]).toMatchObject({ step: 4, status: "skipped" });
    expect(result.steps[4]).toMatchObject({ step: 5, status: "skipped" });
  });

  it("should abort when Step 1 API fails", async () => {
    const mockAdapter = createMockPlatformAdapter();
    jest.spyOn(adapterFactory, "getAdapter").mockReturnValue(mockAdapter);

    mockedStatus.getCloudServerStatus.mockRejectedValue(new Error("API error"));

    const result = await maintainServer(sampleServer, "test-token", testConfig);

    expect(result.success).toBe(false);
    expect(result.steps[0]).toMatchObject({ step: 1, status: "failure" });
    expect(result.steps[1]).toMatchObject({ step: 2, status: "skipped" });
  });

  it("should abort when update fails (Step 2)", async () => {
    const mockAdapter = createMockPlatformAdapter({
      update: jest.fn(async () => ({ success: false, error: "Connection refused" })),
    });
    jest.spyOn(adapterFactory, "getAdapter").mockReturnValue(mockAdapter);

    mockedStatus.getCloudServerStatus.mockResolvedValue("running");

    const result = await maintainServer(sampleServer, "test-token", testConfig);

    expect(result.success).toBe(false);
    expect(result.steps[0]).toMatchObject({ step: 1, status: "success" });
    expect(result.steps[1]).toMatchObject({ step: 2, status: "failure" });
    expect(result.steps[2]).toMatchObject({ step: 3, status: "skipped" });
  });

  it("should continue when health check fails (Step 3 — partial success)", async () => {
    const mockAdapter = createMockPlatformAdapter({
      healthCheck: jest.fn(async () => ({ status: "not reachable" as const })),
    });
    jest.spyOn(adapterFactory, "getAdapter").mockReturnValue(mockAdapter);

    mockedStatus.getCloudServerStatus.mockResolvedValue("running");
    (mockProvider.rebootServer as jest.Mock).mockResolvedValue(undefined);
    (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    const result = await maintainServer(sampleServer, "test-token", testConfig);

    expect(result.success).toBe(false); // has failure
    expect(result.steps[2]).toMatchObject({ step: 3, status: "failure" });
    // Steps 4 and 5 should still run
    expect(result.steps[3]).toMatchObject({ step: 4, status: "success" });
    expect(result.steps[4]).toMatchObject({ step: 5, status: "failure" }); // health still not reachable
  });

  it("should skip Steps 1, 4, 5 for manual servers", async () => {
    const mockAdapter = createMockPlatformAdapter();
    jest.spyOn(adapterFactory, "getAdapter").mockReturnValue(mockAdapter);

    const result = await maintainServer(manualServer, "", testConfig);

    expect(result.success).toBe(true);
    expect(result.steps[0]).toMatchObject({ step: 1, status: "skipped" });
    expect(result.steps[1]).toMatchObject({ step: 2, status: "success" });
    expect(result.steps[2]).toMatchObject({ step: 3, status: "success" });
    expect(result.steps[3]).toMatchObject({ step: 4, status: "skipped" });
    expect(result.steps[4]).toMatchObject({ step: 5, status: "skipped" });
  });

  it("should skip Steps 4 and 5 when skipReboot is true", async () => {
    const mockAdapter = createMockPlatformAdapter();
    jest.spyOn(adapterFactory, "getAdapter").mockReturnValue(mockAdapter);

    mockedStatus.getCloudServerStatus.mockResolvedValue("running");

    const result = await maintainServer(sampleServer, "test-token", { ...testConfig, skipReboot: true });

    expect(result.success).toBe(true);
    expect(result.steps[0]).toMatchObject({ step: 1, status: "success" });
    expect(result.steps[1]).toMatchObject({ step: 2, status: "success" });
    expect(result.steps[2]).toMatchObject({ step: 3, status: "success" });
    expect(result.steps[3]).toMatchObject({ step: 4, status: "skipped" });
    expect(result.steps[4]).toMatchObject({ step: 5, status: "skipped" });
  });
});

// ─── MCP Handler: update ─────────────────────────────────────────────────────

describe("handleServerMaintain — update", () => {
  it("should update successfully", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(sampleServer);
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "OK", stderr: "" });

    const result = await handleServerMaintain({ action: "update", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.success).toBe(true);
    expect(data.message).toContain("update completed");
    expect(data.suggested_actions).toBeDefined();
  });

  it("should return error when no servers", async () => {
    mockedConfig.getServers.mockReturnValue([]);

    const result = await handleServerMaintain({ action: "update" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toBe("No servers found");
  });

  it("should return error when server not found", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(undefined);

    const result = await handleServerMaintain({ action: "update", server: "nonexistent" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("Server not found");
  });

  it("should ask for server when multiple exist", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer, sampleServer2]);

    const result = await handleServerMaintain({ action: "update" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("Multiple servers");
    expect(data.hint).toContain("Available:");
  });

  it("should auto-select when single server", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "OK", stderr: "" });

    const result = await handleServerMaintain({ action: "update" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.success).toBe(true);
    expect(data.server).toBe("coolify-test");
  });

  it("should return error on update failure", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(sampleServer);
    const spy = jest.spyOn(adapterFactory, "getAdapter").mockReturnValue(
      createMockAdapter({ overrides: { update: jest.fn(async () => ({ success: false, error: "Connection refused" })) } }),
    );

    const result = await handleServerMaintain({ action: "update", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toBe("Connection refused");
    spy.mockRestore();
  });
});

// ─── MCP Handler: restart ────────────────────────────────────────────────────

describe("handleServerMaintain — restart", () => {
  it("should restart successfully", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(sampleServer);
    (mockProvider.rebootServer as jest.Mock).mockResolvedValue(undefined);
    (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    // Spy to use fast test intervals
    const spy = jest.spyOn(maintain, "rebootAndWait").mockResolvedValue({
      success: true,
      finalStatus: "running",
    });

    const result = await handleServerMaintain({ action: "restart", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.success).toBe(true);
    expect(data.finalStatus).toBe("running");
    spy.mockRestore();
  });

  it("should reject manual server", async () => {
    mockedConfig.getServers.mockReturnValue([manualServer]);
    mockedConfig.findServer.mockReturnValue(manualServer);

    const result = await handleServerMaintain({ action: "restart", server: "manual-server" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("manually added");
    expect(data.hint).toContain("ssh root@");
  });

  it("should return error when token missing", async () => {
    delete process.env.HETZNER_TOKEN;
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(sampleServer);

    const result = await handleServerMaintain({ action: "restart", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("No API token");
    expect(data.hint).toContain("HETZNER_TOKEN");
  });

  it("should return error on reboot failure", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(sampleServer);

    const spy = jest.spyOn(maintain, "rebootAndWait").mockResolvedValue({
      success: false,
      error: "API down",
    });

    const result = await handleServerMaintain({ action: "restart", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toBe("API down");
    spy.mockRestore();
  });
});

// ─── MCP Handler: maintain ───────────────────────────────────────────────────

describe("handleServerMaintain — maintain", () => {
  it("should return steps array on success", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(sampleServer);

    const spy = jest.spyOn(maintain, "maintainServer").mockResolvedValue({
      server: "coolify-test",
      ip: "1.2.3.4",
      provider: "hetzner",
      steps: [
        { step: 1, name: "Status Check", status: "success" },
        { step: 2, name: "Coolify Update", status: "success" },
        { step: 3, name: "Health Check", status: "success" },
        { step: 4, name: "Reboot", status: "success" },
        { step: 5, name: "Final Check", status: "success" },
      ],
      success: true,
    });

    const result = await handleServerMaintain({ action: "maintain", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.success).toBe(true);
    expect(data.steps).toHaveLength(5);
    expect(data.summary.success).toBe(5);
    expect(data.summary.failure).toBe(0);
    expect(data.suggested_actions).toBeDefined();
    spy.mockRestore();
  });

  it("should return isError when steps have failures", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(sampleServer);

    const spy = jest.spyOn(maintain, "maintainServer").mockResolvedValue({
      server: "coolify-test",
      ip: "1.2.3.4",
      provider: "hetzner",
      steps: [
        { step: 1, name: "Status Check", status: "failure", detail: "Server is stopped" },
        { step: 2, name: "Coolify Update", status: "skipped" },
        { step: 3, name: "Health Check", status: "skipped" },
        { step: 4, name: "Reboot", status: "skipped" },
        { step: 5, name: "Final Check", status: "skipped" },
      ],
      success: false,
    });

    const result = await handleServerMaintain({ action: "maintain", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.success).toBe(false);
    expect(data.summary.failure).toBe(1);
    expect(data.summary.skipped).toBe(4);
    spy.mockRestore();
  });

  it("should pass skipReboot option", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(sampleServer);

    const spy = jest.spyOn(maintain, "maintainServer").mockResolvedValue({
      server: "coolify-test",
      ip: "1.2.3.4",
      provider: "hetzner",
      steps: [
        { step: 1, name: "Status Check", status: "success" },
        { step: 2, name: "Coolify Update", status: "success" },
        { step: 3, name: "Health Check", status: "success" },
        { step: 4, name: "Reboot", status: "skipped" },
        { step: 5, name: "Final Check", status: "skipped" },
      ],
      success: true,
    });

    const result = await handleServerMaintain({
      action: "maintain",
      server: "coolify-test",
      skipReboot: true,
    });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.success).toBe(true);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ name: "coolify-test" }),
      "test-token",
      expect.objectContaining({ skipReboot: true }),
    );
    spy.mockRestore();
  });

  it("should require token for non-manual servers", async () => {
    delete process.env.HETZNER_TOKEN;
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(sampleServer);

    const result = await handleServerMaintain({ action: "maintain", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("No API token");
    expect(data.suggested_actions[0].command).toContain("update");
  });

  it("should not require token for manual servers", async () => {
    mockedConfig.getServers.mockReturnValue([manualServer]);
    mockedConfig.findServer.mockReturnValue(manualServer);

    const spy = jest.spyOn(maintain, "maintainServer").mockResolvedValue({
      server: "manual-server",
      ip: "9.8.7.6",
      provider: "hetzner",
      steps: [
        { step: 1, name: "Status Check", status: "skipped" },
        { step: 2, name: "Coolify Update", status: "success" },
        { step: 3, name: "Health Check", status: "success" },
        { step: 4, name: "Reboot", status: "skipped" },
        { step: 5, name: "Final Check", status: "skipped" },
      ],
      success: true,
    });

    const result = await handleServerMaintain({ action: "maintain", server: "manual-server" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.success).toBe(true);
    spy.mockRestore();
  });
});

// ─── MCP Handler: error handling ─────────────────────────────────────────────

describe("handleServerMaintain — error handling", () => {
  it("should catch unexpected errors", async () => {
    mockedConfig.getServers.mockImplementation(() => {
      throw new Error("Config corrupted");
    });

    const result = await handleServerMaintain({ action: "update" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toBe("Config corrupted");
  });

  it("should handle non-Error thrown values", async () => {
    mockedConfig.getServers.mockImplementation(() => {
      throw "string error";
    });

    const result = await handleServerMaintain({ action: "update" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toBe("string error");
  });
});

// ─── MCP Handler: bare mode guards ───────────────────────────────────────────

const bareServer = {
  id: "789",
  name: "bare-server",
  provider: "hetzner",
  ip: "10.0.0.1",
  region: "nbg1",
  size: "cax11",
  mode: "bare" as const,
  createdAt: "2026-02-20T00:00:00Z",
};

describe("handleServerMaintain — bare mode", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedConfig.getServers.mockReturnValue([bareServer]);
    mockedConfig.findServer.mockReturnValue(bareServer);
  });

  it("should block update on bare server with requireCoolifyMode error", async () => {
    const result = await handleServerMaintain({ action: "update", server: "bare-server" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("update");
    expect(data.error).toContain("bare");
  });

  it("should block maintain on bare server with requireCoolifyMode error", async () => {
    const result = await handleServerMaintain({ action: "maintain", server: "bare-server" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("maintain");
    expect(data.error).toContain("bare");
  });

  it("should allow restart on bare server (cloud API reboot is mode-independent)", async () => {
    process.env.HETZNER_TOKEN = "test-token";

    const spy = jest.spyOn(maintain, "rebootAndWait").mockResolvedValue({
      success: true,
      finalStatus: "running",
    });

    const result = await handleServerMaintain({ action: "restart", server: "bare-server" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.success).toBe(true);
    spy.mockRestore();
  });

  it("should return bare mode error with SSH hint for update", async () => {
    const result = await handleServerMaintain({ action: "update", server: "bare-server" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.hint).toBeDefined();
    expect(data.hint.toLowerCase()).toContain("ssh");
  });
});

// ─── MCP Handler: malformed params ───────────────────────────────────────────

describe("handleServerMaintain — malformed params", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedSsh.assertValidIp.mockImplementation(() => {});
  });

  it("returns mcpError when server param is empty string", async () => {
    // Arrange
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(undefined as never);

    // Act
    const result = await handleServerMaintain({ action: "update", server: "" });

    // Assert
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeTruthy();
  });

  it("returns mcpError when server param is null (as unknown)", async () => {
    // Arrange
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(undefined as never);

    // Act
    const result = await handleServerMaintain({ action: "update", server: null as unknown as string });

    // Assert
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeTruthy();
  });

  it("returns mcpError when action param is null (as unknown)", async () => {
    // Arrange
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(sampleServer as never);
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "OK", stderr: "" });

    // Act
    const result = await handleServerMaintain({ action: null as unknown as Parameters<typeof handleServerMaintain>[0]["action"], server: "coolify-test" });

    // Assert — handler should either catch or return mcpError, never throw uncaught
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeTruthy();
  });
});
