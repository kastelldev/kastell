import * as config from "../../src/utils/config";
import * as ssh from "../../src/utils/ssh";
import * as providerFactory from "../../src/utils/providerFactory";
import * as tokens from "../../src/core/tokens";
import * as sshKey from "../../src/utils/sshKey";
import * as cloudInit from "../../src/utils/cloudInit";
import * as templates from "../../src/utils/templates";
import { provisionServer, uploadSshKeyBestEffort } from "../../src/core/provision";
import { handleServerProvision } from "../../src/mcp/tools/serverProvision";
import type { CloudProvider } from "../../src/providers/base";

jest.mock("../../src/utils/config");
jest.mock("../../src/utils/ssh");
jest.mock("../../src/utils/providerFactory");
jest.mock("../../src/core/tokens");
jest.mock("../../src/utils/sshKey");
jest.mock("../../src/utils/cloudInit");
jest.mock("../../src/utils/templates");

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedSsh = ssh as jest.Mocked<typeof ssh>;
const mockedProviderFactory = providerFactory as jest.Mocked<typeof providerFactory>;
const mockedTokens = tokens as jest.Mocked<typeof tokens>;
const mockedSshKey = sshKey as jest.Mocked<typeof sshKey>;
const mockedCloudInit = cloudInit as jest.Mocked<typeof cloudInit>;
const mockedTemplates = templates as jest.Mocked<typeof templates>;

// ─── Mock Provider ───────────────────────────────────────────────────────────

const createMockProvider = (): jest.Mocked<CloudProvider> => ({
  name: "hetzner",
  displayName: "Hetzner Cloud",
  validateToken: jest.fn().mockResolvedValue(true),
  getRegions: jest.fn().mockResolvedValue([]),
  getServerSizes: jest.fn().mockResolvedValue([]),
  getAvailableLocations: jest.fn().mockResolvedValue([]),
  getAvailableServerTypes: jest.fn().mockResolvedValue([]),
  createServer: jest.fn().mockResolvedValue({ id: "srv-123", ip: "5.6.7.8", status: "running" }),
  getServerStatus: jest.fn().mockResolvedValue("running"),
  getServerDetails: jest.fn().mockResolvedValue({ id: "srv-123", ip: "5.6.7.8", status: "running" }),
  destroyServer: jest.fn().mockResolvedValue(undefined),
  rebootServer: jest.fn().mockResolvedValue(undefined),
  uploadSshKey: jest.fn().mockResolvedValue("key-456"),
  createSnapshot: jest.fn().mockResolvedValue({ id: "snap-1", name: "test", status: "available", sizeGb: 20, createdAt: "", serverId: "", costPerMonth: "$0" }),
  listSnapshots: jest.fn().mockResolvedValue([]),
  deleteSnapshot: jest.fn().mockResolvedValue(undefined),
  restoreSnapshot: jest.fn().mockResolvedValue(undefined),
  getSnapshotCostEstimate: jest.fn().mockReturnValue("$0.01/GB/month"),
});

let mockProvider: jest.Mocked<CloudProvider>;

// ─── Setup ───────────────────────────────────────────────────────────────────

const originalEnv = process.env;

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...originalEnv };
  delete process.env.KASTELL_SAFE_MODE;
  delete process.env.QUICKLIFY_SAFE_MODE;

  mockProvider = createMockProvider();
  mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
  mockedTokens.getProviderToken.mockReturnValue("test-token-123");
  mockedSsh.assertValidIp.mockImplementation(() => {});
  mockedSshKey.findLocalSshKey.mockReturnValue("ssh-ed25519 AAAA test@kastell");
  mockedSshKey.getSshKeyName.mockReturnValue("kastell-1234567890");

  mockedTemplates.getTemplateDefaults.mockReturnValue({ region: "nbg1", size: "cax11" });
  mockedConfig.saveServer.mockImplementation(() => Promise.resolve());
});

afterAll(() => {
  process.env = originalEnv;
});

// ─── provisionServer ────────────────────────────────────────────────────────

describe("provisionServer — happy path", () => {
  it("should provision server successfully with explicit region/size", async () => {
    const result = await provisionServer({
      provider: "hetzner",
      region: "fsn1",
      size: "cx22",
      name: "prod-server",
    });

    expect(result.success).toBe(true);
    expect(result.server).toBeDefined();
    expect(result.server!.name).toBe("prod-server");
    expect(result.server!.provider).toBe("hetzner");
    expect(result.server!.ip).toBe("5.6.7.8");
    expect(result.server!.region).toBe("fsn1");
    expect(result.server!.size).toBe("cx22");
    expect(result.server!.id).toBe("srv-123");
    expect(result.server!.createdAt).toBeDefined();
    expect(mockedConfig.saveServer).toHaveBeenCalledTimes(1);
  });

  it("should use template defaults when region/size omitted", async () => {
    const result = await provisionServer({
      provider: "hetzner",
      name: "test-srv",
      template: "starter",
    });

    expect(result.success).toBe(true);
    expect(mockedTemplates.getTemplateDefaults).toHaveBeenCalledWith("starter", "hetzner");
    expect(mockProvider.createServer).toHaveBeenCalledWith(
      expect.objectContaining({ region: "nbg1", size: "cax11" }),
    );
  });

  it("should use default starter template when no template specified", async () => {
    const result = await provisionServer({
      provider: "hetzner",
      name: "test-srv",
    });

    expect(result.success).toBe(true);
    expect(mockedTemplates.getTemplateDefaults).toHaveBeenCalledWith("starter", "hetzner");
  });

  it("should let explicit region/size override template defaults", async () => {
    const result = await provisionServer({
      provider: "hetzner",
      region: "fsn1",
      size: "cx33",
      name: "test-srv",
      template: "starter",
    });

    expect(result.success).toBe(true);
    expect(mockProvider.createServer).toHaveBeenCalledWith(
      expect.objectContaining({ region: "fsn1", size: "cx33" }),
    );
  });

  it("should call saveServer with correct record", async () => {
    await provisionServer({ provider: "hetzner", name: "my-server", region: "nbg1", size: "cax11" });

    expect(mockedConfig.saveServer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "srv-123",
        name: "my-server",
        provider: "hetzner",
        ip: "5.6.7.8",
        region: "nbg1",
        size: "cax11",
      }),
    );
  });

  it("should call assertValidIp on server IP", async () => {
    await provisionServer({ provider: "hetzner", name: "test-srv", region: "nbg1", size: "cax11" });

    expect(mockedSsh.assertValidIp).toHaveBeenCalledWith("5.6.7.8");
  });
});

describe("provisionServer — validation errors", () => {
  it("should return error for invalid provider", async () => {
    const result = await provisionServer({
      provider: "invalid",
      name: "test-srv",
      region: "nbg1",
      size: "cax11",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid provider");
  });

  it("should return error for name too short", async () => {
    const result = await provisionServer({
      provider: "hetzner",
      name: "ab",
      region: "nbg1",
      size: "cax11",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("3-63 characters");
  });

  it("should return error for invalid name format", async () => {
    const result = await provisionServer({
      provider: "hetzner",
      name: "123-invalid",
      region: "nbg1",
      size: "cax11",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("start with a letter");
  });

  it("should return error when region/size cannot be resolved", async () => {
    mockedTemplates.getTemplateDefaults.mockReturnValue(undefined);

    const result = await provisionServer({
      provider: "hetzner",
      name: "test-srv",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Could not resolve region/size");
    expect(result.hint).toContain("explicit region and size");
  });
});

describe("provisionServer — token errors", () => {
  it("should return error when no API token found", async () => {
    mockedTokens.getProviderToken.mockReturnValue(undefined);

    const result = await provisionServer({
      provider: "hetzner",
      name: "test-srv",
      region: "nbg1",
      size: "cax11",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("No API token");
    expect(result.hint).toContain("HETZNER_TOKEN");
  });

  it("should return error when token validation fails", async () => {
    mockProvider.validateToken.mockResolvedValue(false);

    const result = await provisionServer({
      provider: "hetzner",
      name: "test-srv",
      region: "nbg1",
      size: "cax11",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid API token");
  });

  it("should return error when token validation throws", async () => {
    mockProvider.validateToken.mockRejectedValue(new Error("Network error"));

    const result = await provisionServer({
      provider: "hetzner",
      name: "test-srv",
      region: "nbg1",
      size: "cax11",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Token validation failed");
    expect(result.error).toContain("Network error");
  });
});

describe("provisionServer — server creation errors", () => {
  it("should return error with hint on createServer failure", async () => {
    mockProvider.createServer.mockRejectedValue(new Error("Server name already used"));

    const result = await provisionServer({
      provider: "hetzner",
      name: "test-srv",
      region: "nbg1",
      size: "cax11",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Server creation failed");
    expect(result.error).toContain("already used");
  });

  it("should return error when server does not reach running state", async () => {
    jest.useFakeTimers();
    mockProvider.getServerStatus.mockResolvedValue("initializing");

    const promise = provisionServer({
      provider: "hetzner",
      name: "test-srv",
      region: "nbg1",
      size: "cax11",
    });
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toContain("did not reach running state");
    jest.useRealTimers();
  });
});

describe("provisionServer — IP wait", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("should poll for IP when initial IP is pending", async () => {
    mockProvider.createServer.mockResolvedValue({ id: "srv-123", ip: "pending", status: "running" });
    mockProvider.getServerDetails
      .mockResolvedValueOnce({ id: "srv-123", ip: "pending", status: "running" })
      .mockResolvedValueOnce({ id: "srv-123", ip: "5.6.7.8", status: "running" });

    const promise = provisionServer({
      provider: "hetzner",
      name: "test-srv",
      region: "nbg1",
      size: "cax11",
    });
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.server!.ip).toBe("5.6.7.8");
    expect(mockProvider.getServerDetails).toHaveBeenCalled();
  });

  it("should return success with pending IP on timeout", async () => {
    mockProvider.createServer.mockResolvedValue({ id: "srv-123", ip: "pending", status: "running" });
    mockProvider.getServerDetails.mockResolvedValue({ id: "srv-123", ip: "pending", status: "running" });

    const promise = provisionServer({
      provider: "hetzner",
      name: "test-srv",
      region: "nbg1",
      size: "cax11",
    });
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.server!.ip).toBe("pending");
    expect(result.hint).toContain("IP address not yet assigned");
  });

  it("should handle 0.0.0.0 as pending IP", async () => {
    mockProvider.createServer.mockResolvedValue({ id: "srv-123", ip: "0.0.0.0", status: "running" });
    mockProvider.getServerDetails.mockResolvedValue({ id: "srv-123", ip: "5.6.7.8", status: "running" });

    const promise = provisionServer({
      provider: "hetzner",
      name: "test-srv",
      region: "nbg1",
      size: "cax11",
    });
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.server!.ip).toBe("5.6.7.8");
  });
});

describe("provisionServer — SSH key handling", () => {
  it("should continue without SSH key when no local key found", async () => {
    mockedSshKey.findLocalSshKey.mockReturnValue(null);

    const result = await provisionServer({
      provider: "hetzner",
      name: "test-srv",
      region: "nbg1",
      size: "cax11",
    });

    expect(result.success).toBe(true);
    expect(mockProvider.createServer).toHaveBeenCalledWith(
      expect.objectContaining({ sshKeyIds: [] }),
    );
  });

  it("should continue when SSH key upload fails", async () => {
    mockProvider.uploadSshKey.mockRejectedValue(new Error("Upload failed"));

    const result = await provisionServer({
      provider: "hetzner",
      name: "test-srv",
      region: "nbg1",
      size: "cax11",
    });

    expect(result.success).toBe(true);
    expect(mockProvider.createServer).toHaveBeenCalledWith(
      expect.objectContaining({ sshKeyIds: [] }),
    );
  });

  it("should pass SSH key ID on successful upload", async () => {
    const result = await provisionServer({
      provider: "hetzner",
      name: "test-srv",
      region: "nbg1",
      size: "cax11",
    });

    expect(result.success).toBe(true);
    expect(mockProvider.createServer).toHaveBeenCalledWith(
      expect.objectContaining({ sshKeyIds: ["key-456"] }),
    );
  });
});

// ─── uploadSshKeyBestEffort ──────────────────────────────────────────────────

describe("uploadSshKeyBestEffort", () => {
  it("should return key ID on successful upload", async () => {
    const ids = await uploadSshKeyBestEffort(mockProvider);

    expect(ids).toEqual(["key-456"]);
    expect(mockProvider.uploadSshKey).toHaveBeenCalledWith(
      "kastell-1234567890",
      "ssh-ed25519 AAAA test@kastell",
    );
  });

  it("should return empty array when no local key and generation fails", async () => {
    mockedSshKey.findLocalSshKey.mockReturnValue(null);
    mockedSshKey.generateSshKey.mockReturnValue(null);

    const ids = await uploadSshKeyBestEffort(mockProvider);

    expect(ids).toEqual([]);
    expect(mockedSshKey.generateSshKey).toHaveBeenCalled();
    expect(mockProvider.uploadSshKey).not.toHaveBeenCalled();
  });

  it("should generate and upload key when no local key exists", async () => {
    mockedSshKey.findLocalSshKey.mockReturnValue(null);
    mockedSshKey.generateSshKey.mockReturnValue("ssh-ed25519 AAAA generated@kastell");
    mockProvider.uploadSshKey.mockResolvedValue("key-gen-789");

    const ids = await uploadSshKeyBestEffort(mockProvider);

    expect(ids).toEqual(["key-gen-789"]);
    expect(mockedSshKey.generateSshKey).toHaveBeenCalled();
    expect(mockProvider.uploadSshKey).toHaveBeenCalledWith(
      "kastell-1234567890",
      "ssh-ed25519 AAAA generated@kastell",
    );
  });

  it("should return empty array on upload failure", async () => {
    mockProvider.uploadSshKey.mockRejectedValue(new Error("Conflict"));

    const ids = await uploadSshKeyBestEffort(mockProvider);

    expect(ids).toEqual([]);
  });
});

// ─── handleServerProvision — SAFE_MODE ───────────────────────────────────────

describe("handleServerProvision — SAFE_MODE", () => {
  it("should block provision in SAFE_MODE", async () => {
    process.env.KASTELL_SAFE_MODE = "true";

    const result = await handleServerProvision({
      provider: "hetzner",
      name: "test-srv",
    });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("SAFE_MODE");
    expect(data.hint).toContain("SAFE_MODE=false");
  });
});

// ─── handleServerProvision — success ─────────────────────────────────────────

describe("handleServerProvision — success", () => {
  it("should return success with server details and suggested_actions", async () => {
    const result = await handleServerProvision({
      provider: "hetzner",
      region: "nbg1",
      size: "cax11",
      name: "my-server",
    });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.success).toBe(true);
    expect(data.message).toContain("my-server");
    expect(data.message).toContain("hetzner");
    expect(data.server.id).toBe("srv-123");
    expect(data.server.name).toBe("my-server");
    expect(data.server.ip).toBe("5.6.7.8");
    expect(data.suggested_actions).toHaveLength(4);
    expect(data.suggested_actions[0].command).toContain("health");
    expect(data.suggested_actions[1].command).toContain("secure-setup");
    expect(data.suggested_actions[2].command).toContain("firewall-setup");
    expect(data.suggested_actions[3].command).toContain("status");
  });

  it("should include hint when IP is pending", async () => {
    jest.useFakeTimers();
    mockProvider.createServer.mockResolvedValue({ id: "srv-123", ip: "pending", status: "running" });
    mockProvider.getServerDetails.mockResolvedValue({ id: "srv-123", ip: "pending", status: "running" });

    const promise = handleServerProvision({
      provider: "hetzner",
      region: "nbg1",
      size: "cax11",
      name: "my-server",
    });
    await jest.runAllTimersAsync();
    const result = await promise;
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.success).toBe(true);
    expect(data.hint).toContain("IP address not yet assigned");
    jest.useRealTimers();
  });
});

// ─── handleServerProvision — errors ──────────────────────────────────────────

describe("handleServerProvision — errors", () => {
  it("should return error with hint when token missing", async () => {
    mockedTokens.getProviderToken.mockReturnValue(undefined);

    const result = await handleServerProvision({
      provider: "digitalocean",
      region: "fra1",
      size: "s-2vcpu-2gb",
      name: "test-srv",
    });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("No API token");
    expect(data.suggested_actions).toBeDefined();
  });

  it("should return error on createServer API failure", async () => {
    mockProvider.createServer.mockRejectedValue(new Error("409 Conflict: name already used"));

    const result = await handleServerProvision({
      provider: "hetzner",
      region: "nbg1",
      size: "cax11",
      name: "test-srv",
    });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("Server creation failed");
  });

  it("should catch unexpected errors in outer try-catch", async () => {
    // Force provisionServer to throw unexpectedly by mocking createProviderWithToken to throw
    mockedProviderFactory.createProviderWithToken.mockImplementation(() => {
      throw new Error("Unexpected factory crash");
    });

    const result = await handleServerProvision({
      provider: "hetzner",
      region: "nbg1",
      size: "cax11",
      name: "test-srv",
    });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("Unexpected factory crash");
  });

  it("should handle non-Error thrown values", async () => {
    mockedProviderFactory.createProviderWithToken.mockImplementation(() => {
      throw "string error value";
    });

    const result = await handleServerProvision({
      provider: "hetzner",
      region: "nbg1",
      size: "cax11",
      name: "test-srv",
    });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toBe("string error value");
  });

  it("should return error on validation failure", async () => {
    const result = await handleServerProvision({
      provider: "hetzner",
      region: "nbg1",
      size: "cax11",
      name: "ab",
    });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("3-63 characters");
  });
});

// ─── handleServerProvision — bare mode ───────────────────────────────────────

describe("handleServerProvision — bare mode", () => {
  it("should pass mode:'bare' to provisionServer and show SSH hint in suggested_actions", async () => {
    const result = await handleServerProvision({
      provider: "hetzner",
      region: "nbg1",
      size: "cax11",
      name: "bare-srv",
      mode: "bare",
    });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.success).toBe(true);
    expect(data.server.mode).toBe("bare");
    // SSH hint should appear instead of Coolify health check
    const commands: string[] = data.suggested_actions.map((a: { command: string }) => a.command);
    expect(commands.some((c) => c.includes("ssh"))).toBe(true);
    expect(commands.every((c) => !c.includes("health"))).toBe(true);
  });

  it("should include mode field in success response server object for bare", async () => {
    const result = await handleServerProvision({
      provider: "hetzner",
      region: "nbg1",
      size: "cax11",
      name: "bare-srv",
      mode: "bare",
    });
    const data = JSON.parse(result.content[0].text);

    expect(data.server.mode).toBe("bare");
  });

  it("should default to coolify mode when mode omitted (backward compat)", async () => {
    const result = await handleServerProvision({
      provider: "hetzner",
      region: "nbg1",
      size: "cax11",
      name: "my-server",
    });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.success).toBe(true);
    // existing coolify suggested_actions intact
    const commands: string[] = data.suggested_actions.map((a: { command: string }) => a.command);
    expect(commands.some((c) => c.includes("health"))).toBe(true);
  });

  it("should pass mode:'coolify' explicitly and behave like default", async () => {
    const result = await handleServerProvision({
      provider: "hetzner",
      region: "nbg1",
      size: "cax11",
      name: "coolify-srv",
      mode: "coolify",
    });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.success).toBe(true);
    const commands: string[] = data.suggested_actions.map((a: { command: string }) => a.command);
    expect(commands.some((c) => c.includes("health"))).toBe(true);
  });
});

// ─── handleServerProvision — template ────────────────────────────────────────

describe("handleServerProvision — template", () => {
  it("should use template defaults when region/size omitted", async () => {
    const result = await handleServerProvision({
      provider: "hetzner",
      name: "template-srv",
      template: "production",
    });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.success).toBe(true);
    expect(mockedTemplates.getTemplateDefaults).toHaveBeenCalledWith("production", "hetzner");
  });

  it("should work with explicit region/size overriding template", async () => {
    const result = await handleServerProvision({
      provider: "hetzner",
      region: "fsn1",
      size: "cx33",
      name: "override-srv",
      template: "starter",
    });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.success).toBe(true);
    expect(mockProvider.createServer).toHaveBeenCalledWith(
      expect.objectContaining({ region: "fsn1", size: "cx33" }),
    );
  });

  it("should default to starter template when none specified", async () => {
    const result = await handleServerProvision({
      provider: "hetzner",
      name: "default-srv",
    });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.success).toBe(true);
    expect(mockedTemplates.getTemplateDefaults).toHaveBeenCalledWith("starter", "hetzner");
  });
});

// ─── handleServerProvision — malformed params ────────────────────────────────

describe("handleServerProvision — malformed params", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedSsh.assertValidIp.mockImplementation(() => {});
    mockedSshKey.findLocalSshKey.mockReturnValue("ssh-ed25519 AAAA test@kastell");
    mockedSshKey.getSshKeyName.mockReturnValue("kastell-1234567890");
    mockedTemplates.getTemplateDefaults.mockReturnValue({ region: "nbg1", size: "cax11" });
    mockedConfig.saveServer.mockImplementation(() => Promise.resolve());
  });

  it("returns mcpError when provider param is empty string", async () => {
    // Arrange — empty string provider is not in SUPPORTED_PROVIDERS enum
    mockedTokens.getProviderToken.mockReturnValue("test-token");

    // Act
    const result = await handleServerProvision({
      provider: "" as unknown as Parameters<typeof handleServerProvision>[0]["provider"],
      region: "nbg1",
      size: "cax11",
      name: "test-srv",
    });

    // Assert
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeTruthy();
  });

  it("returns mcpError when provider param is null (as unknown)", async () => {
    // Arrange
    mockedTokens.getProviderToken.mockReturnValue("test-token");

    // Act
    const result = await handleServerProvision({
      provider: null as unknown as Parameters<typeof handleServerProvision>[0]["provider"],
      region: "nbg1",
      size: "cax11",
      name: "test-srv",
    });

    // Assert
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeTruthy();
  });

  it("returns mcpError when name param is null (as unknown)", async () => {
    // Arrange
    mockedTokens.getProviderToken.mockReturnValue("test-token");
    mockProvider = createMockProvider();
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    // Act
    const result = await handleServerProvision({
      provider: "hetzner",
      region: "nbg1",
      size: "cax11",
      name: null as unknown as string,
    });

    // Assert
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeTruthy();
  });

  it("returns mcpError when server creation fails (simulated SSH/API error)", async () => {
    // Arrange
    mockedTokens.getProviderToken.mockReturnValue("test-token");
    mockProvider = createMockProvider();
    mockProvider.createServer.mockRejectedValue(new Error("SSH connection refused"));
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    // Act
    const result = await handleServerProvision({
      provider: "hetzner",
      region: "nbg1",
      size: "cax11",
      name: "test-srv",
    });

    // Assert
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeTruthy();
  });
});
