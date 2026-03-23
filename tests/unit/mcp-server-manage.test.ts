import * as config from "../../src/utils/config";
import * as ssh from "../../src/utils/ssh";
import * as providerFactory from "../../src/utils/providerFactory";
import * as manage from "../../src/core/manage";
import { handleServerManage } from "../../src/mcp/tools/serverManage";
import {
  isSafeMode,
  isValidProvider,
  validateIpAddress,
  validateServerName,
  addServerRecord,
  removeServerRecord,
  destroyCloudServer,
} from "../../src/core/manage";
import type { CloudProvider } from "../../src/providers/base";

jest.mock("../../src/utils/config");
jest.mock("../../src/utils/ssh", () => {
  const actual = jest.requireActual("../../src/utils/ssh") as Record<string, unknown>;
  const realAssertValidIp = actual.assertValidIp as (ip: string) => void;
  return {
    ...actual,
    assertValidIp: jest.fn().mockImplementation((ip: string) => realAssertValidIp(ip)),
    sshExec: jest.fn(),
    sshStream: jest.fn(),
    sshConnect: jest.fn(),
    checkSshAvailable: jest.fn(),
    removeStaleHostKey: jest.fn(),
    resolveSshPath: jest.fn().mockReturnValue("ssh"),
    resolveScpPath: jest.fn().mockReturnValue("scp"),
  };
});
jest.mock("../../src/utils/providerFactory");
jest.mock("../../src/adapters/factory", () => ({
  detectPlatform: jest.fn().mockResolvedValue("coolify"),
  getAdapter: jest.fn(),
  resolvePlatform: jest.fn(),
}));
jest.mock("../../src/core/tokenBuffer", () => ({
  storeToken: jest.fn(),
  readToken: jest.fn().mockReturnValue(undefined),
  clearAllTokens: jest.fn(),
  registerCleanupHandlers: jest.fn(),
}));

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedSsh = ssh as jest.Mocked<typeof ssh>;
const mockedProviderFactory = providerFactory as jest.Mocked<typeof providerFactory>;

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

const originalEnv = process.env;

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...originalEnv };
  delete process.env.KASTELL_SAFE_MODE;
  delete process.env.QUICKLIFY_SAFE_MODE;
  mockedSsh.assertValidIp.mockImplementation(() => {});
  mockedSsh.checkSshAvailable.mockReturnValue(true);
});

afterAll(() => {
  process.env = originalEnv;
});

// ─── Core: isSafeMode ─────────────────────────────────────────────────────────

describe("isSafeMode", () => {
  it("should return false when no env var is set", () => {
    delete process.env.KASTELL_SAFE_MODE;
    delete process.env.QUICKLIFY_SAFE_MODE;
    expect(isSafeMode()).toBe(false);
  });

  it("should return true when KASTELL_SAFE_MODE is 'true'", () => {
    process.env.KASTELL_SAFE_MODE = "true";
    expect(isSafeMode()).toBe(true);
  });

  it("should return false for other values of KASTELL_SAFE_MODE", () => {
    process.env.KASTELL_SAFE_MODE = "false";
    expect(isSafeMode()).toBe(false);

    process.env.KASTELL_SAFE_MODE = "1";
    expect(isSafeMode()).toBe(false);
  });

  it("should return true when only QUICKLIFY_SAFE_MODE is 'true' (backward compat)", () => {
    delete process.env.KASTELL_SAFE_MODE;
    process.env.QUICKLIFY_SAFE_MODE = "true";
    expect(isSafeMode()).toBe(true);
  });

  it("KASTELL_SAFE_MODE takes precedence when both set", () => {
    process.env.KASTELL_SAFE_MODE = "false";
    process.env.QUICKLIFY_SAFE_MODE = "true";
    expect(isSafeMode()).toBe(false);
  });
});

// ─── Core: Validation ─────────────────────────────────────────────────────────

describe("isValidProvider", () => {
  it("should accept valid providers", () => {
    expect(isValidProvider("hetzner")).toBe(true);
    expect(isValidProvider("digitalocean")).toBe(true);
    expect(isValidProvider("vultr")).toBe(true);
    expect(isValidProvider("linode")).toBe(true);
  });

  it("should reject invalid providers", () => {
    expect(isValidProvider("aws")).toBe(false);
    expect(isValidProvider("")).toBe(false);
    expect(isValidProvider("HETZNER")).toBe(false);
  });
});

describe("validateIpAddress", () => {
  const actual = jest.requireActual("../../src/utils/ssh") as { assertValidIp: (ip: string) => void };

  beforeEach(() => {
    // Restore real assertValidIp for validation tests
    mockedSsh.assertValidIp.mockImplementation((ip: string) => actual.assertValidIp(ip));
  });

  it("should accept valid IPs", () => {
    expect(validateIpAddress("1.2.3.4")).toBeNull();
    expect(validateIpAddress("192.168.1.1")).toBeNull();
    expect(validateIpAddress("203.0.113.1")).toBeNull();
    expect(validateIpAddress("10.0.0.1")).toBeNull();
  });

  it("should reject empty IP", () => {
    expect(validateIpAddress("")).not.toBeNull();
  });

  it("should reject invalid format", () => {
    expect(validateIpAddress("abc")).not.toBeNull();
    expect(validateIpAddress("1.2.3")).not.toBeNull();
    expect(validateIpAddress("1.2.3.4.5")).not.toBeNull();
  });

  it("should reject out-of-range octets", () => {
    expect(validateIpAddress("256.1.1.1")).not.toBeNull();
    expect(validateIpAddress("1.1.1.999")).not.toBeNull();
  });

  it("should reject reserved IPs", () => {
    expect(validateIpAddress("0.0.0.0")).toContain("Reserved");
    expect(validateIpAddress("127.0.0.1")).toContain("Reserved");
    expect(validateIpAddress("127.1.2.3")).toContain("Reserved");
  });
});

describe("validateServerName", () => {
  it("should accept valid names", () => {
    expect(validateServerName("coolify-test")).toBeNull();
    expect(validateServerName("server1")).toBeNull();
    expect(validateServerName("my-server-01")).toBeNull();
    expect(validateServerName("abc")).toBeNull();
  });

  it("should reject empty name", () => {
    expect(validateServerName("")).not.toBeNull();
  });

  it("should reject too short names", () => {
    expect(validateServerName("ab")).not.toBeNull();
  });

  it("should reject names starting with number", () => {
    expect(validateServerName("1server")).not.toBeNull();
  });

  it("should reject names with uppercase", () => {
    expect(validateServerName("MyServer")).not.toBeNull();
  });

  it("should reject names ending with hyphen", () => {
    expect(validateServerName("server-")).not.toBeNull();
  });
});

// ─── Core: addServerRecord ────────────────────────────────────────────────────

describe("addServerRecord", () => {
  beforeEach(() => {
    // Restore real assertValidIp so IP validation works correctly
    const actual = jest.requireActual("../../src/utils/ssh") as { assertValidIp: (ip: string) => void };
    mockedSsh.assertValidIp.mockImplementation((ip: string) => actual.assertValidIp(ip));
  });

  it("should reject invalid provider", async () => {
    const result = await addServerRecord({
      provider: "aws",
      ip: "1.2.3.4",
      name: "test-server",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid provider");
  });

  it("should reject missing token", async () => {
    delete process.env.HETZNER_TOKEN;
    const result = await addServerRecord({
      provider: "hetzner",
      ip: "1.2.3.4",
      name: "test-server",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("No API token");
  });

  it("should reject invalid IP", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    const result = await addServerRecord({
      provider: "hetzner",
      ip: "invalid",
      name: "test-server",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid IP");
  });

  it("should reject duplicate IP", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    const result = await addServerRecord({
      provider: "hetzner",
      ip: "1.2.3.4",
      name: "new-server",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("already exists");
  });

  it("should reject invalid name", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    mockedConfig.getServers.mockReturnValue([]);
    const result = await addServerRecord({
      provider: "hetzner",
      ip: "5.6.7.8",
      name: "AB",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("3-63 characters");
  });

  it("should reject invalid token", async () => {
    process.env.HETZNER_TOKEN = "bad-token";
    mockedConfig.getServers.mockReturnValue([]);
    (mockProvider.validateToken as jest.Mock).mockResolvedValue(false);
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    const result = await addServerRecord({
      provider: "hetzner",
      ip: "5.6.7.8",
      name: "test-server",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid API token");
  });

  it("should add server with Coolify running", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    mockedConfig.getServers.mockReturnValue([]);
    (mockProvider.validateToken as jest.Mock).mockResolvedValue(true);
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "200", stderr: "" });

    const result = await addServerRecord({
      provider: "hetzner",
      ip: "5.6.7.8",
      name: "test-server",
    });
    expect(result.success).toBe(true);
    expect(result.server).toBeDefined();
    expect(result.server!.name).toBe("test-server");
    expect(result.server!.ip).toBe("5.6.7.8");
    expect(result.server!.id).toMatch(/^manual-/);
    expect(result.platformStatus).toBe("running");
    expect(mockedConfig.saveServer).toHaveBeenCalled();
  });

  it("should add server with skipVerify", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    mockedConfig.getServers.mockReturnValue([]);
    (mockProvider.validateToken as jest.Mock).mockResolvedValue(true);
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    const result = await addServerRecord({
      provider: "hetzner",
      ip: "5.6.7.8",
      name: "test-server",
      skipVerify: true,
    });
    expect(result.success).toBe(true);
    expect(result.platformStatus).toBe("skipped");
    expect(mockedSsh.sshExec).not.toHaveBeenCalled();
  });

  it("should detect Coolify via docker fallback", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    mockedConfig.getServers.mockReturnValue([]);
    (mockProvider.validateToken as jest.Mock).mockResolvedValue(true);
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
    mockedSsh.sshExec
      .mockResolvedValueOnce({ code: 1, stdout: "000", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "OK", stderr: "" });

    const result = await addServerRecord({
      provider: "hetzner",
      ip: "5.6.7.8",
      name: "test-server",
    });
    expect(result.success).toBe(true);
    expect(result.platformStatus).toBe("containers_detected");
  });

  it("should warn when Coolify not detected", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    mockedConfig.getServers.mockReturnValue([]);
    (mockProvider.validateToken as jest.Mock).mockResolvedValue(true);
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
    mockedSsh.sshExec.mockResolvedValue({ code: 1, stdout: "", stderr: "" });

    const result = await addServerRecord({
      provider: "hetzner",
      ip: "5.6.7.8",
      name: "test-server",
    });
    expect(result.success).toBe(true);
    expect(result.platformStatus).toBe("not_detected");
  });

  it("should handle SSH unavailable", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    mockedConfig.getServers.mockReturnValue([]);
    (mockProvider.validateToken as jest.Mock).mockResolvedValue(true);
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
    mockedSsh.checkSshAvailable.mockReturnValue(false);

    const result = await addServerRecord({
      provider: "hetzner",
      ip: "5.6.7.8",
      name: "test-server",
    });
    expect(result.success).toBe(true);
    expect(result.platformStatus).toBe("ssh_unavailable");
  });
});

// ─── Core: removeServerRecord ─────────────────────────────────────────────────

describe("removeServerRecord", () => {
  it("should remove existing server", async () => {
    mockedConfig.findServer.mockReturnValue(sampleServer);
    mockedConfig.removeServer.mockResolvedValue(true);

    const result = await removeServerRecord("coolify-test");
    expect(result.success).toBe(true);
    expect(result.server!.name).toBe("coolify-test");
    expect(mockedConfig.removeServer).toHaveBeenCalledWith("123");
  });

  it("should return error when server not found", async () => {
    mockedConfig.findServer.mockReturnValue(undefined);

    const result = await removeServerRecord("nonexistent");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Server not found");
  });

  it("should return error when removeServer fails", async () => {
    mockedConfig.findServer.mockReturnValue(sampleServer);
    mockedConfig.removeServer.mockResolvedValue(false);

    const result = await removeServerRecord("coolify-test");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to remove");
  });
});

// ─── Core: destroyCloudServer ─────────────────────────────────────────────────

describe("destroyCloudServer", () => {
  it("should destroy cloud server and remove from config", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    mockedConfig.findServer.mockReturnValue(sampleServer);
    (mockProvider.destroyServer as jest.Mock).mockResolvedValue(undefined);
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
    mockedConfig.removeServer.mockResolvedValue(true);

    const result = await destroyCloudServer("coolify-test");
    expect(result.success).toBe(true);
    expect(result.cloudDeleted).toBe(true);
    expect(result.localRemoved).toBe(true);
    expect(mockProvider.destroyServer).toHaveBeenCalledWith("123");
    expect(mockedConfig.removeServer).toHaveBeenCalledWith("123");
  });

  it("should return error when server not found", async () => {
    mockedConfig.findServer.mockReturnValue(undefined);

    const result = await destroyCloudServer("nonexistent");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Server not found");
  });

  it("should reject manual servers", async () => {
    mockedConfig.findServer.mockReturnValue(manualServer);

    const result = await destroyCloudServer("manual-server");
    expect(result.success).toBe(false);
    expect(result.error).toContain("manually added");
    expect(result.error).toContain("remove");
  });

  it("should return error when token missing", async () => {
    delete process.env.HETZNER_TOKEN;
    mockedConfig.findServer.mockReturnValue(sampleServer);

    const result = await destroyCloudServer("coolify-test");
    expect(result.success).toBe(false);
    expect(result.error).toContain("No API token");
  });

  it("should handle not-found on provider gracefully", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    mockedConfig.findServer.mockReturnValue(sampleServer);
    (mockProvider.destroyServer as jest.Mock).mockRejectedValue(
      new Error("Server not found"),
    );
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
    mockedConfig.removeServer.mockResolvedValue(true);

    const result = await destroyCloudServer("coolify-test");
    expect(result.success).toBe(true);
    expect(result.cloudDeleted).toBe(false);
    expect(result.localRemoved).toBe(true);
    expect(result.hint).toContain("not found");
  });

  it("should return error on API failure", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    mockedConfig.findServer.mockReturnValue(sampleServer);
    (mockProvider.destroyServer as jest.Mock).mockRejectedValue(
      new Error("API rate limited"),
    );
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    const result = await destroyCloudServer("coolify-test");
    expect(result.success).toBe(false);
    expect(result.error).toBe("API rate limited");
    expect(result.cloudDeleted).toBe(false);
    expect(result.localRemoved).toBe(false);
  });
});

// ─── MCP Handler: handleServerManage — add ────────────────────────────────────

describe("handleServerManage — add", () => {
  it("should require provider parameter", async () => {
    const result = await handleServerManage({ action: "add" });
    const data = JSON.parse(result.content[0].text);
    expect(result.isError).toBe(true);
    expect(data.error).toContain("provider");
  });

  it("should require ip parameter", async () => {
    const result = await handleServerManage({ action: "add", provider: "hetzner" });
    const data = JSON.parse(result.content[0].text);
    expect(result.isError).toBe(true);
    expect(data.error).toContain("ip");
  });

  it("should require name parameter", async () => {
    const result = await handleServerManage({
      action: "add",
      provider: "hetzner",
      ip: "1.2.3.4",
    });
    const data = JSON.parse(result.content[0].text);
    expect(result.isError).toBe(true);
    expect(data.error).toContain("name");
  });

  it("should add server successfully", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    mockedConfig.getServers.mockReturnValue([]);
    (mockProvider.validateToken as jest.Mock).mockResolvedValue(true);
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "200", stderr: "" });

    const result = await handleServerManage({
      action: "add",
      provider: "hetzner",
      ip: "5.6.7.8",
      name: "test-server",
    });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.success).toBe(true);
    expect(data.server.name).toBe("test-server");
    expect(data.server.ip).toBe("5.6.7.8");
    expect(data.platformStatus).toBe("running");
    expect(data.suggested_actions).toBeDefined();
  });

  it("should return error on validation failure", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    mockedConfig.getServers.mockReturnValue([sampleServer]);

    const result = await handleServerManage({
      action: "add",
      provider: "hetzner",
      ip: "1.2.3.4",
      name: "test-server",
    });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("already exists");
  });
});

// ─── MCP Handler: handleServerManage — add bare mode ─────────────────────────

describe("handleServerManage — add bare mode", () => {
  it("should add bare server with mode:'bare' and show SSH suggested_actions", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    mockedConfig.getServers.mockReturnValue([]);
    (mockProvider.validateToken as jest.Mock).mockResolvedValue(true);
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "200", stderr: "" });

    const result = await handleServerManage({
      action: "add",
      provider: "hetzner",
      ip: "5.6.7.8",
      name: "bare-server",
      mode: "bare",
    });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.success).toBe(true);
    expect(data.server.mode).toBe("bare");
    // bare mode: no Coolify health check in suggested_actions
    const commands: string[] = data.suggested_actions.map((a: { command: string }) => a.command);
    expect(commands.every((c) => !c.includes("health"))).toBe(true);
  });

  it("should add coolify server without mode param (backward compat)", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    mockedConfig.getServers.mockReturnValue([]);
    (mockProvider.validateToken as jest.Mock).mockResolvedValue(true);
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "200", stderr: "" });

    const result = await handleServerManage({
      action: "add",
      provider: "hetzner",
      ip: "5.6.7.8",
      name: "test-server",
    });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.success).toBe(true);
    // coolify mode: health check should appear in suggested_actions
    const commands: string[] = data.suggested_actions.map((a: { command: string }) => a.command);
    expect(commands.some((c) => c.includes("health"))).toBe(true);
  });
});

// ─── MCP Handler: handleServerManage — remove ────────────────────────────────

describe("handleServerManage — remove", () => {
  it("should require server parameter", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);

    const result = await handleServerManage({ action: "remove" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("server");
    expect(data.available_servers).toHaveLength(1);
  });

  it("should show no servers message when empty", async () => {
    mockedConfig.getServers.mockReturnValue([]);

    const result = await handleServerManage({ action: "remove" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toBe("No servers found");
    expect(data.suggested_actions).toBeDefined();
  });

  it("should remove server successfully", async () => {
    mockedConfig.findServer.mockReturnValue(sampleServer);
    mockedConfig.removeServer.mockResolvedValue(true);

    const result = await handleServerManage({
      action: "remove",
      server: "coolify-test",
    });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.success).toBe(true);
    expect(data.message).toContain("removed");
    expect(data.note).toContain("still running");
    expect(data.suggested_actions).toBeDefined();
  });

  it("should return error when server not found", async () => {
    mockedConfig.findServer.mockReturnValue(undefined);
    mockedConfig.getServers.mockReturnValue([sampleServer]);

    const result = await handleServerManage({
      action: "remove",
      server: "nonexistent",
    });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("Server not found");
  });
});

// ─── MCP Handler: handleServerManage — destroy ───────────────────────────────

describe("handleServerManage — destroy", () => {
  it("should block destroy in SAFE_MODE", async () => {
    process.env.KASTELL_SAFE_MODE = "true";

    const result = await handleServerManage({
      action: "destroy",
      server: "coolify-test",
    });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("SAFE_MODE");
    expect(data.suggested_actions).toBeDefined();
  });

  it("should require server parameter", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);

    const result = await handleServerManage({ action: "destroy" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("server");
    expect(data.warning).toContain("PERMANENTLY DELETE");
  });

  it("should show no servers message when empty", async () => {
    mockedConfig.getServers.mockReturnValue([]);

    const result = await handleServerManage({ action: "destroy" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toBe("No servers found");
    expect(data.suggested_actions).toBeDefined();
  });

  it("should destroy server successfully", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    mockedConfig.findServer.mockReturnValue(sampleServer);
    (mockProvider.destroyServer as jest.Mock).mockResolvedValue(undefined);
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
    mockedConfig.removeServer.mockResolvedValue(true);

    const result = await handleServerManage({
      action: "destroy",
      server: "coolify-test",
    });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.success).toBe(true);
    expect(data.cloudDeleted).toBe(true);
    expect(data.localRemoved).toBe(true);
    expect(data.server.name).toBe("coolify-test");
  });

  it("should handle already-deleted server gracefully", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    mockedConfig.findServer.mockReturnValue(sampleServer);
    (mockProvider.destroyServer as jest.Mock).mockRejectedValue(
      new Error("Server not found"),
    );
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
    mockedConfig.removeServer.mockResolvedValue(true);

    const result = await handleServerManage({
      action: "destroy",
      server: "coolify-test",
    });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.success).toBe(true);
    expect(data.cloudDeleted).toBe(false);
    expect(data.localRemoved).toBe(true);
    expect(data.note).toContain("not found");
  });

  it("should return error on API failure", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    mockedConfig.findServer.mockReturnValue(sampleServer);
    (mockProvider.destroyServer as jest.Mock).mockRejectedValue(
      new Error("Rate limited"),
    );
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    const result = await handleServerManage({
      action: "destroy",
      server: "coolify-test",
    });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toBe("Rate limited");
    expect(data.suggested_actions).toBeDefined();
  });

  it("should reject manual server destroy", async () => {
    mockedConfig.findServer.mockReturnValue(manualServer);

    const result = await handleServerManage({
      action: "destroy",
      server: "manual-server",
    });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("manually added");
  });
});

// ─── MCP Handler: error handling ──────────────────────────────────────────────

describe("handleServerManage — error handling", () => {
  it("should catch unexpected errors", async () => {
    const spy = jest.spyOn(manage, "destroyCloudServer").mockRejectedValue(
      new Error("Config corrupted"),
    );

    const result = await handleServerManage({ action: "destroy", server: "test" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toBe("Config corrupted");
    spy.mockRestore();
  });

  it("should handle non-Error thrown values", async () => {
    const spy = jest.spyOn(manage, "destroyCloudServer").mockImplementation(() => {
      throw "string error";
    });

    const result = await handleServerManage({ action: "destroy", server: "test" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toBe("string error");
    spy.mockRestore();
  });
});

// ─── MCP Handler: malformed params ───────────────────────────────────────────

describe("handleServerManage — malformed params", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedSsh.assertValidIp.mockImplementation(() => {});
    mockedSsh.checkSshAvailable.mockReturnValue(true);
  });

  it("returns mcpError when server param is empty string", async () => {
    // Arrange
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(undefined as never);

    // Act
    const result = await handleServerManage({ action: "remove", server: "" });

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
    const result = await handleServerManage({ action: "remove", server: null as unknown as string });

    // Assert
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeTruthy();
  });

  it("returns mcpError when action param is invalid (as unknown)", async () => {
    // Arrange
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(sampleServer as never);

    // Act — invalid action falls through switch, handler should return mcpError
    const result = await handleServerManage({ action: "nonexistent" as unknown as Parameters<typeof handleServerManage>[0]["action"], server: "coolify-test" });

    // Assert
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeTruthy();
  });
});
