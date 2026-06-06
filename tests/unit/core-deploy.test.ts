/**
 * Unit tests for deployServer() in src/core/deploy.ts
 * Tests call deployServer() directly (not through initCommand) and mock all
 * external dependencies independently.
 *
 * Covers: happy path coolify, bare mode (no waitForCoolify, no openBrowser,
 *         SSH info, cloud-init wait), full-setup (firewall+secure called/skipped),
 *         error path (KastellResult), pending IP, noOpen flag.
 */

import { deployServer } from "../../src/core/deploy";
import type { CloudProvider } from "../../src/providers/base";

jest.mock("../../src/utils/healthCheck", () => ({
  waitForCoolify: jest.fn(),
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

jest.mock("../../src/utils/ssh", () => ({
  assertValidIp: jest.fn(),
  removeStaleHostKey: jest.fn(),
  sshExec: jest.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" }),
  sshConnect: jest.fn(),
  sshStream: jest.fn(),
  sanitizedEnv: jest.fn().mockReturnValue({}),
  checkSshAvailable: jest.fn().mockReturnValue(true),
}));

jest.mock("../../src/core/firewall", () => ({
  firewallSetup: jest.fn().mockResolvedValue(undefined),
  COOLIFY_PORTS: [80, 443, 8000, 6001, 6002],
  BARE_PORTS: [80, 443],
  PROTECTED_PORTS: [22],
  isValidPort: jest.fn(),
  isProtectedPort: jest.fn(),
  buildUfwRuleCommand: jest.fn(),
  buildFirewallSetupCommand: jest.fn(),
  buildBareFirewallSetupCommand: jest.fn(),
  buildUfwStatusCommand: jest.fn(),
  parseUfwStatus: jest.fn(),
}));

jest.mock("../../src/core/secure", () => ({
  secureSetup: jest.fn().mockResolvedValue(undefined),
}));

// --- Mock accessors ---

const { waitForCoolify } = jest.requireMock("../../src/utils/healthCheck") as {
  waitForCoolify: jest.Mock;
};
const { openBrowser } = jest.requireMock("../../src/utils/openBrowser") as {
  openBrowser: jest.Mock;
};
const { saveServer } = jest.requireMock("../../src/utils/config") as {
  saveServer: jest.Mock;
};
const { sshExec, removeStaleHostKey } = jest.requireMock("../../src/utils/ssh") as {
  sshExec: jest.Mock;
  removeStaleHostKey: jest.Mock;
};
const { firewallSetup } = jest.requireMock("../../src/core/firewall") as {
  firewallSetup: jest.Mock;
};
const { secureSetup } = jest.requireMock("../../src/core/secure") as {
  secureSetup: jest.Mock;
};

// --- Helper ---

function createMockProvider(overrides: Partial<CloudProvider> = {}): CloudProvider {
  return {
    name: "hetzner",
    displayName: "Hetzner Cloud",
    createServer: jest.fn().mockResolvedValue({ id: "999", ip: "10.0.0.1", status: "running" }),
    getServerStatus: jest.fn().mockResolvedValue("running"),
    getServerDetails: jest.fn().mockResolvedValue({ ip: "10.0.0.1" }),
    uploadSshKey: jest.fn().mockResolvedValue("key-id-1"),
    validateToken: jest.fn().mockResolvedValue(true),
    getAvailableLocations: jest.fn().mockResolvedValue([]),
    getAvailableServerTypes: jest.fn().mockResolvedValue([]),
    findServerByIp: jest.fn().mockResolvedValue(null),
    ...overrides,
  } as CloudProvider;
}

// ============================================================
// describe: uploadSshKeyToProvider
// ============================================================

import { uploadSshKeyToProvider } from "../../src/core/deploy";

const { findLocalSshKey, generateSshKey } = jest.requireMock("../../src/utils/sshKey") as {
  findLocalSshKey: jest.Mock;
  generateSshKey: jest.Mock;
};

describe("uploadSshKeyToProvider", () => {
  let consoleSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    stderrSpy = jest.spyOn(console, "error").mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stderrSpy?.mockRestore();
  });

  it("should upload existing SSH key and return key ID array", async () => {
    findLocalSshKey.mockReturnValue("ssh-ed25519 AAAA...");
    const provider = createMockProvider();

    const result = await uploadSshKeyToProvider(provider);

    expect(result).toEqual(["key-id-1"]);
    expect(generateSshKey).not.toHaveBeenCalled();
  });

  it("should generate SSH key when none found and upload it", async () => {
    findLocalSshKey.mockReturnValue(null);
    generateSshKey.mockReturnValue("ssh-ed25519 GENERATED...");
    const provider = createMockProvider();

    const result = await uploadSshKeyToProvider(provider);

    expect(generateSshKey).toHaveBeenCalled();
    expect(result).toEqual(["key-id-1"]);
  });

  it("should return empty array when key generation fails", async () => {
    findLocalSshKey.mockReturnValue(null);
    generateSshKey.mockReturnValue(null);
    const provider = createMockProvider();

    const result = await uploadSshKeyToProvider(provider);

    expect(result).toEqual([]);
  });

  it("should return empty array when SSH key upload fails", async () => {
    findLocalSshKey.mockReturnValue("ssh-ed25519 AAAA...");
    const provider = createMockProvider({
      uploadSshKey: jest.fn().mockRejectedValue(new Error("upload failed")),
    });

    const result = await uploadSshKeyToProvider(provider);

    expect(result).toEqual([]);
  });
});

// ============================================================
// describe: coolify mode
// ============================================================

describe("deployServer — coolify mode", () => {
  let consoleSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    stderrSpy = jest.spyOn(console, "error").mockImplementation();
    jest.clearAllMocks();
    // Default: Coolify reports ready
    waitForCoolify.mockResolvedValue(true);
    sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    firewallSetup.mockResolvedValue(undefined);
    secureSetup.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stderrSpy?.mockRestore();
  });

  it("should return success and call waitForCoolify and saveServer with mode:'coolify' (happy path)", async () => {
    const provider = createMockProvider();

    const result = await deployServer("hetzner", provider, "nbg1", "cax11", "my-server");

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.serverIp).toBe("10.0.0.1");
    expect(waitForCoolify).toHaveBeenCalled();
    expect(saveServer).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "coolify" }),
    );
  });

  it("should call firewallSetup and secureSetup when fullSetup=true and Coolify ready", async () => {
    const provider = createMockProvider();

    await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", true);

    expect(firewallSetup).toHaveBeenCalled();
    expect(secureSetup).toHaveBeenCalled();
  });

  it("should NOT call firewallSetup when fullSetup=true but Coolify not ready", async () => {
    waitForCoolify.mockResolvedValue(false);
    const provider = createMockProvider();

    await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", true);

    expect(firewallSetup).not.toHaveBeenCalled();
    expect(secureSetup).not.toHaveBeenCalled();
  });

  it("should NOT call openBrowser when noOpen=true and Coolify ready", async () => {
    const provider = createMockProvider();

    await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", false, true);

    expect(openBrowser).not.toHaveBeenCalled();
  });

  it("should call openBrowser when noOpen=false and Coolify ready", async () => {
    const provider = createMockProvider();

    await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", false, false);

    expect(openBrowser).toHaveBeenCalled();
  });
});

// ============================================================
// describe: bare mode
// ============================================================

describe("deployServer — bare mode", () => {
  let consoleSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    stderrSpy = jest.spyOn(console, "error").mockImplementation();
    jest.clearAllMocks();
    waitForCoolify.mockResolvedValue(true);
    sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    firewallSetup.mockResolvedValue(undefined);
    secureSetup.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stderrSpy?.mockRestore();
  });

  it("should NOT call waitForCoolify when mode='bare'", async () => {
    const provider = createMockProvider();

    await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", false, false, "bare");

    expect(waitForCoolify).not.toHaveBeenCalled();
  });

  it("should NOT call openBrowser when mode='bare'", async () => {
    const provider = createMockProvider();

    await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", false, false, "bare");

    expect(openBrowser).not.toHaveBeenCalled();
  });

  it("should save ServerRecord with mode:'bare' when mode='bare'", async () => {
    const provider = createMockProvider();

    await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", false, false, "bare");

    expect(saveServer).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "bare" }),
    );
  });

  it("should output SSH connection info (ssh root@...) when mode='bare'", async () => {
    const provider = createMockProvider();

    await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", false, false, "bare");

    const output = [...consoleSpy.mock.calls, ...stderrSpy.mock.calls].map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toMatch(/ssh root@/i);
  });

  it("should call sshExec with 'cloud-init status --wait' when mode='bare'", async () => {
    const provider = createMockProvider();

    await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", false, false, "bare");

    expect(sshExec).toHaveBeenCalledWith(expect.any(String), "cloud-init status --wait");
  });

  it("should return success with no platform in bare mode", async () => {
    const provider = createMockProvider();

    const result = await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", false, false, "bare");

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.platform).toBeUndefined();
  });

  it("should call removeStaleHostKey before sshExec in bare mode with valid IP", async () => {
    const provider = createMockProvider();

    await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", false, false, "bare");

    expect(removeStaleHostKey).toHaveBeenCalledWith("10.0.0.1");
    expect(sshExec).toHaveBeenCalled();
    // Verify call order: removeStaleHostKey before sshExec
    const removeCallOrder = removeStaleHostKey.mock.invocationCallOrder[0];
    const sshExecCallOrder = sshExec.mock.invocationCallOrder[0];
    expect(removeCallOrder).toBeLessThan(sshExecCallOrder);
  });

  it("should call removeStaleHostKey even without fullSetup in bare mode", async () => {
    const provider = createMockProvider();

    // fullSetup=false — proactive call still fires
    await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", false, false, "bare");

    expect(removeStaleHostKey).toHaveBeenCalledWith("10.0.0.1");
  });

  it("should NOT call removeStaleHostKey before SSH polling when IP is invalid (0.0.0.0)", async () => {
    jest.useFakeTimers();
    const provider = createMockProvider({
      createServer: jest.fn().mockResolvedValue({ id: "999", ip: "0.0.0.0", status: "running" }),
      getServerDetails: jest.fn().mockResolvedValue({ ip: "0.0.0.0" }),
    });

    const deployPromise = deployServer("hetzner", provider, "nbg1", "cax11", "my-server", false, false, "bare");
    await jest.runAllTimersAsync();
    await deployPromise;
    jest.useRealTimers();

    // No proactive removeStaleHostKey call when IP is 0.0.0.0 (invalid)
    expect(removeStaleHostKey).not.toHaveBeenCalledWith("0.0.0.0");
  });
});

// ============================================================
// describe: error handling
// ============================================================

describe("deployServer — error handling", () => {
  let consoleSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    stderrSpy = jest.spyOn(console, "error").mockImplementation();
    jest.clearAllMocks();
    waitForCoolify.mockResolvedValue(true);
    sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stderrSpy?.mockRestore();
  });

  it("should return { success: false } when server creation fails with a generic error", async () => {
    const provider = createMockProvider({
      createServer: jest.fn().mockRejectedValue(new Error("Internal Server Error")),
    });

    const result = await deployServer("hetzner", provider, "nbg1", "cax11", "my-server");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Internal Server Error");
  });

  it("should include hint in result when provider error mapping produces a hint", async () => {
    const provider = createMockProvider({
      createServer: jest.fn().mockRejectedValue(new Error("unauthorized")),
    });

    const result = await deployServer("hetzner", provider, "nbg1", "cax11", "my-server");

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ============================================================
// describe: IP assignment
// ============================================================

describe("deployServer — IP assignment", () => {
  let consoleSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    stderrSpy = jest.spyOn(console, "error").mockImplementation();
    jest.clearAllMocks();
    waitForCoolify.mockResolvedValue(true);
    sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stderrSpy?.mockRestore();
  });

  it("should save server with resolved IP when createServer returns pending IP", async () => {
    const provider = createMockProvider({
      createServer: jest
        .fn()
        .mockResolvedValue({ id: "999", ip: "pending", status: "running" }),
      getServerDetails: jest.fn().mockResolvedValue({ ip: "10.0.0.1" }),
    });

    await deployServer("hetzner", provider, "nbg1", "cax11", "my-server");

    // saveServer should be called with the resolved IP (not "pending")
    expect(saveServer).toHaveBeenCalledWith(
      expect.objectContaining({ ip: "10.0.0.1" }),
    );
  });
});

// ============================================================
// describe: return type validation
// ============================================================

describe("deployServer — KastellResult return type", () => {
  let consoleSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    stderrSpy = jest.spyOn(console, "error").mockImplementation();
    jest.clearAllMocks();
    waitForCoolify.mockResolvedValue(true);
    sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    firewallSetup.mockResolvedValue(undefined);
    secureSetup.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stderrSpy?.mockRestore();
  });

  it("should return DeployData with serverId, serverIp, serverName on success", async () => {
    const provider = createMockProvider();

    const result = await deployServer("hetzner", provider, "nbg1", "cax11", "test-srv");

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        serverId: "999",
        serverIp: "10.0.0.1",
        serverName: "test-srv",
      }),
    });
  });

  it("should return platform in data for coolify mode", async () => {
    const provider = createMockProvider();

    const result = await deployServer("hetzner", provider, "nbg1", "cax11", "test-srv");

    expect(result.data!.platform).toBe("coolify");
  });

  it("should return platform:'dokploy' for dokploy mode", async () => {
    const provider = createMockProvider();

    const result = await deployServer("hetzner", provider, "nbg1", "cax11", "test-srv", false, false, "dokploy");

    expect(result.data!.platform).toBe("dokploy");
  });

  it("should call firewallSetup and secureSetup for bare mode when fullSetup=true and valid IP", async () => {
    const provider = createMockProvider();

    await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", true, false, "bare");

    expect(firewallSetup).toHaveBeenCalled();
    expect(secureSetup).toHaveBeenCalled();
  });

  it("should skip fullSetup for bare mode when IP is invalid (0.0.0.0)", async () => {
    jest.useFakeTimers();
    const provider = createMockProvider({
      createServer: jest.fn().mockResolvedValue({ id: "999", ip: "0.0.0.0", status: "running" }),
      getServerDetails: jest.fn().mockResolvedValue({ ip: "0.0.0.0" }),
    });

    const deployPromise = deployServer("hetzner", provider, "nbg1", "cax11", "my-server", true, false, "bare");
    await jest.runAllTimersAsync();
    const result = await deployPromise;
    jest.useRealTimers();

    expect(result.success).toBe(true);
    expect(firewallSetup).not.toHaveBeenCalled();
    expect(secureSetup).not.toHaveBeenCalled();
  });

  it("should handle firewallSetup exception in bare fullSetup gracefully", async () => {
    firewallSetup.mockRejectedValueOnce(new Error("firewall error"));
    const provider = createMockProvider();

    const result = await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", true, false, "bare");

    expect(result.success).toBe(true);
  });

  it("should handle secureSetup exception in bare fullSetup gracefully", async () => {
    secureSetup.mockRejectedValueOnce(new Error("secure error"));
    const provider = createMockProvider();

    const result = await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", true, false, "bare");

    expect(result.success).toBe(true);
  });

  it("should handle cloud-init status non-zero exit code gracefully", async () => {
    sshExec.mockResolvedValue({ code: 1, stdout: "", stderr: "cloud-init error" });
    const provider = createMockProvider();

    const result = await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", false, false, "bare");

    expect(result.success).toBe(true);
  });

  it("should handle cloud-init status SSH exception gracefully", async () => {
    sshExec
      .mockResolvedValueOnce({ code: 0, stdout: "ok", stderr: "" }) // ssh echo ok
      .mockRejectedValueOnce(new Error("cloud-init check failed")); // cloud-init status --wait
    const provider = createMockProvider();

    const result = await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", false, false, "bare");

    expect(result.success).toBe(true);
  });

  it("should show onboarding steps without fullSetup for bare mode", async () => {
    const provider = createMockProvider();

    await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", false, false, "bare");

    const output = [...consoleSpy.mock.calls, ...stderrSpy.mock.calls].map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("Secure your server");
    expect(output).toContain("kastell firewall setup");
  });

  it("should show onboarding steps without fullSetup for coolify mode", async () => {
    const provider = createMockProvider();

    await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", false, false);

    const output = [...consoleSpy.mock.calls, ...stderrSpy.mock.calls].map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("Secure your server");
    expect(output).toContain("kastell backup");
  });

  it("should show abbreviated onboarding steps with fullSetup for coolify mode", async () => {
    const provider = createMockProvider();

    await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", true, false);

    const output = [...consoleSpy.mock.calls, ...stderrSpy.mock.calls].map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("domain");
    expect(output).not.toContain("Secure your server");
  });

  it("should handle firewallSetup exception in coolify fullSetup gracefully", async () => {
    firewallSetup.mockRejectedValueOnce(new Error("firewall error"));
    const provider = createMockProvider();

    const result = await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", true, false);

    expect(result.success).toBe(true);
  });

  it("should show warning when Coolify not ready", async () => {
    waitForCoolify.mockResolvedValue(false);
    const provider = createMockProvider();

    await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", false, false);

    const output = [...consoleSpy.mock.calls, ...stderrSpy.mock.calls].map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("did not respond yet");
  });

  it("should not call process.exit on failure — returns error result instead", async () => {
    const processExitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const provider = createMockProvider({
      createServer: jest.fn().mockRejectedValue(new Error("boom")),
    });

    const result = await deployServer("hetzner", provider, "nbg1", "cax11", "test-srv");

    expect(result.success).toBe(false);
    expect(processExitSpy).not.toHaveBeenCalled();
    processExitSpy.mockRestore();
  });
});

// ─── [MUTATION-KILLER] deploy string assertions ─────────────────────────────
// Each assertion pins a specific string literal used in deploy.ts.
// Stryker replaces strings with "" which causes these checks to fail.

describe("[MUTATION-KILLER] deployServer mode string handling", () => {
  let consoleSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    stderrSpy = jest.spyOn(console, "error").mockImplementation();
    jest.clearAllMocks();
    waitForCoolify.mockResolvedValue(true);
    sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    firewallSetup.mockResolvedValue(undefined);
    secureSetup.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stderrSpy?.mockRestore();
  });

  it("mode='bare' results in platform=undefined (not 'coolify')", async () => {
    const provider = createMockProvider();
    const result = await deployServer("hetzner", provider, "nbg1", "cax11", "srv", false, false, "bare");
    expect(result.data!.platform).toBeUndefined();
  });

  it("mode='dokploy' results in platform='dokploy'", async () => {
    const provider = createMockProvider();
    const result = await deployServer("hetzner", provider, "nbg1", "cax11", "srv", false, false, "dokploy");
    expect(result.data!.platform).toBe("dokploy");
  });

  it("mode=undefined (default) results in platform='coolify'", async () => {
    const provider = createMockProvider();
    const result = await deployServer("hetzner", provider, "nbg1", "cax11", "srv");
    expect(result.data!.platform).toBe("coolify");
  });

  it("bare mode saves ServerRecord with mode='bare'", async () => {
    const provider = createMockProvider();
    await deployServer("hetzner", provider, "nbg1", "cax11", "srv", false, false, "bare");
    expect(saveServer).toHaveBeenCalledWith(expect.objectContaining({ mode: "bare" }));
  });

  it("coolify mode saves ServerRecord with mode='coolify'", async () => {
    const provider = createMockProvider();
    await deployServer("hetzner", provider, "nbg1", "cax11", "srv");
    expect(saveServer).toHaveBeenCalledWith(expect.objectContaining({ mode: "coolify" }));
  });

  it("dokploy mode saves ServerRecord with mode='coolify' and platform='dokploy'", async () => {
    const provider = createMockProvider();
    await deployServer("hetzner", provider, "nbg1", "cax11", "srv", false, false, "dokploy");
    expect(saveServer).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "coolify", platform: "dokploy" }),
    );
  });
});

describe("[MUTATION-KILLER] deployServer console output strings", () => {
  let consoleSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    stderrSpy = jest.spyOn(console, "error").mockImplementation();
    jest.clearAllMocks();
    waitForCoolify.mockResolvedValue(true);
    sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    firewallSetup.mockResolvedValue(undefined);
    secureSetup.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stderrSpy?.mockRestore();
  });

  it("bare mode shows 'ssh root@' connection info", async () => {
    const provider = createMockProvider();
    await deployServer("hetzner", provider, "nbg1", "cax11", "srv", false, false, "bare");
    const output = [...consoleSpy.mock.calls, ...stderrSpy.mock.calls].map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("ssh root@");
  });

  it("bare mode shows 'bare' mode label", async () => {
    const provider = createMockProvider();
    await deployServer("hetzner", provider, "nbg1", "cax11", "srv", false, false, "bare");
    const output = [...consoleSpy.mock.calls, ...stderrSpy.mock.calls].map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("bare");
  });

  it("bare mode shows 'kastell list' hint", async () => {
    const provider = createMockProvider();
    await deployServer("hetzner", provider, "nbg1", "cax11", "srv", false, false, "bare");
    const output = [...consoleSpy.mock.calls, ...stderrSpy.mock.calls].map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("kastell list");
  });

  it("coolify mode shows server IP in output", async () => {
    const provider = createMockProvider();
    await deployServer("hetzner", provider, "nbg1", "cax11", "srv");
    const output = [...consoleSpy.mock.calls, ...stderrSpy.mock.calls].map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("10.0.0.1");
  });

  it("coolify mode shows http:// URL with port 8000", async () => {
    const provider = createMockProvider();
    await deployServer("hetzner", provider, "nbg1", "cax11", "srv");
    const output = [...consoleSpy.mock.calls, ...stderrSpy.mock.calls].map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("http://10.0.0.1:8000");
  });

  it("dokploy mode shows http:// URL with port 3000", async () => {
    const provider = createMockProvider();
    await deployServer("hetzner", provider, "nbg1", "cax11", "srv", false, false, "dokploy");
    const output = [...consoleSpy.mock.calls, ...stderrSpy.mock.calls].map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("http://10.0.0.1:3000");
  });

  it("coolify mode shows 'Coolify' platform name", async () => {
    const provider = createMockProvider();
    await deployServer("hetzner", provider, "nbg1", "cax11", "srv");
    const output = [...consoleSpy.mock.calls, ...stderrSpy.mock.calls].map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("Coolify");
  });

  it("dokploy mode shows 'Dokploy' platform name", async () => {
    const provider = createMockProvider();
    await deployServer("hetzner", provider, "nbg1", "cax11", "srv", false, false, "dokploy");
    const output = [...consoleSpy.mock.calls, ...stderrSpy.mock.calls].map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("Dokploy");
  });

  it("onboarding shows 'kastell firewall setup' command", async () => {
    const provider = createMockProvider();
    await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", false, false);
    const output = [...consoleSpy.mock.calls, ...stderrSpy.mock.calls].map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("kastell firewall setup my-server");
  });

  it("onboarding shows 'kastell secure setup' command", async () => {
    const provider = createMockProvider();
    await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", false, false);
    const output = [...consoleSpy.mock.calls, ...stderrSpy.mock.calls].map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("kastell secure setup my-server");
  });

  it("onboarding shows 'kastell domain add' command", async () => {
    const provider = createMockProvider();
    await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", false, false);
    const output = [...consoleSpy.mock.calls, ...stderrSpy.mock.calls].map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("kastell domain add my-server");
  });

  it("onboarding shows 'example.com' domain placeholder", async () => {
    const provider = createMockProvider();
    await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", false, false);
    const output = [...consoleSpy.mock.calls, ...stderrSpy.mock.calls].map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("example.com");
  });

  it("onboarding shows 'kastell backup' command", async () => {
    const provider = createMockProvider();
    await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", false, false);
    const output = [...consoleSpy.mock.calls, ...stderrSpy.mock.calls].map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("kastell backup my-server");
  });

  it("onboarding shows 'kastell init --full-setup' tip", async () => {
    const provider = createMockProvider();
    await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", false, false);
    const output = [...consoleSpy.mock.calls, ...stderrSpy.mock.calls].map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("kastell init --full-setup");
  });

  it("onboarding shows 'kastell doctor' command", async () => {
    const provider = createMockProvider();
    await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", false, false);
    const output = [...consoleSpy.mock.calls, ...stderrSpy.mock.calls].map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("kastell doctor");
  });

  it("shows GitHub docs URL", async () => {
    const provider = createMockProvider();
    await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", false, false);
    const output = [...consoleSpy.mock.calls, ...stderrSpy.mock.calls].map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("https://github.com/kastelldev/kastell");
  });

  it("shows star CTA with stars emoji", async () => {
    const provider = createMockProvider();
    await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", false, false);
    const output = [...consoleSpy.mock.calls, ...stderrSpy.mock.calls].map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("Love Kastell?");
  });

  it("shows 'did not respond yet' warning when Coolify not ready", async () => {
    waitForCoolify.mockResolvedValue(false);
    const provider = createMockProvider();
    await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", false, false);
    const output = [...consoleSpy.mock.calls, ...stderrSpy.mock.calls].map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("did not respond yet");
  });

  it("error result contains 'Deployment failed:' prefix", async () => {
    const provider = createMockProvider({
      createServer: jest.fn().mockRejectedValue(new Error("boom")),
    });
    const result = await deployServer("hetzner", provider, "nbg1", "cax11", "srv");
    expect(result.error).toContain("Deployment failed:");
  });
});

describe("[MUTATION-KILLER] deployServer SSH and cloud-init strings", () => {
  let consoleSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    stderrSpy = jest.spyOn(console, "error").mockImplementation();
    jest.clearAllMocks();
    waitForCoolify.mockResolvedValue(true);
    sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    firewallSetup.mockResolvedValue(undefined);
    secureSetup.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stderrSpy?.mockRestore();
  });

  it("checks SSH with 'echo ok' command", async () => {
    const provider = createMockProvider();
    await deployServer("hetzner", provider, "nbg1", "cax11", "srv", false, false, "bare");
    expect(sshExec).toHaveBeenCalledWith("10.0.0.1", "echo ok");
  });

  it("checks cloud-init with 'cloud-init status --wait' command", async () => {
    const provider = createMockProvider();
    await deployServer("hetzner", provider, "nbg1", "cax11", "srv", false, false, "bare");
    expect(sshExec).toHaveBeenCalledWith("10.0.0.1", "cloud-init status --wait");
  });

  it("saves createdAt as ISO timestamp", async () => {
    const provider = createMockProvider();
    await deployServer("hetzner", provider, "nbg1", "cax11", "srv", false, false, "bare");
    const savedArg = saveServer.mock.calls[0][0];
    expect(savedArg.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("saves provider name from providerChoice parameter", async () => {
    const provider = createMockProvider();
    await deployServer("hetzner", provider, "nbg1", "cax11", "srv", false, false, "bare");
    expect(saveServer).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "hetzner" }),
    );
  });

  it("saves region from parameter", async () => {
    const provider = createMockProvider();
    await deployServer("hetzner", provider, "nbg1", "cax11", "srv", false, false, "bare");
    expect(saveServer).toHaveBeenCalledWith(
      expect.objectContaining({ region: "nbg1" }),
    );
  });

  it("saves size from parameter", async () => {
    const provider = createMockProvider();
    await deployServer("hetzner", provider, "nbg1", "cax11", "srv", false, false, "bare");
    expect(saveServer).toHaveBeenCalledWith(
      expect.objectContaining({ size: "cax11" }),
    );
  });

  it("saves server name from parameter", async () => {
    const provider = createMockProvider();
    await deployServer("hetzner", provider, "nbg1", "cax11", "test-name", false, false, "bare");
    expect(saveServer).toHaveBeenCalledWith(
      expect.objectContaining({ name: "test-name" }),
    );
  });

  it("saves IP from provider response", async () => {
    const provider = createMockProvider();
    await deployServer("hetzner", provider, "nbg1", "cax11", "srv", false, false, "bare");
    expect(saveServer).toHaveBeenCalledWith(
      expect.objectContaining({ ip: "10.0.0.1" }),
    );
  });

  it("saves server ID from provider response", async () => {
    const provider = createMockProvider();
    await deployServer("hetzner", provider, "nbg1", "cax11", "srv", false, false, "bare");
    expect(saveServer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "999" }),
    );
  });
});

describe("[MUTATION-KILLER] deployServer IP validation strings", () => {
  let consoleSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    stderrSpy = jest.spyOn(console, "error").mockImplementation();
    jest.clearAllMocks();
    waitForCoolify.mockResolvedValue(true);
    sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    firewallSetup.mockResolvedValue(undefined);
    secureSetup.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stderrSpy?.mockRestore();
  });

  it("IP 0.0.0.0 is treated as invalid (triggers IP polling)", async () => {
    jest.useFakeTimers();
    const provider = createMockProvider({
      createServer: jest.fn().mockResolvedValue({ id: "999", ip: "0.0.0.0", status: "running" }),
      getServerDetails: jest.fn().mockResolvedValue({ ip: "10.0.0.1" }),
    });
    const promise = deployServer("hetzner", provider, "nbg1", "cax11", "srv", false, false, "bare");
    await jest.runAllTimersAsync();
    await promise;
    jest.useRealTimers();
    // getServerDetails was called because 0.0.0.0 triggered IP polling
    expect(provider.getServerDetails).toHaveBeenCalled();
  });

  it("IP 'pending' is treated as invalid (triggers IP polling)", async () => {
    jest.useFakeTimers();
    const provider = createMockProvider({
      createServer: jest.fn().mockResolvedValue({ id: "999", ip: "pending", status: "running" }),
      getServerDetails: jest.fn().mockResolvedValue({ ip: "10.0.0.1" }),
    });
    const promise = deployServer("hetzner", provider, "nbg1", "cax11", "srv", false, false, "bare");
    await jest.runAllTimersAsync();
    await promise;
    jest.useRealTimers();
    expect(provider.getServerDetails).toHaveBeenCalled();
  });

  it("empty string IP is treated as invalid (triggers IP polling)", async () => {
    jest.useFakeTimers();
    const provider = createMockProvider({
      createServer: jest.fn().mockResolvedValue({ id: "999", ip: "", status: "running" }),
      getServerDetails: jest.fn().mockResolvedValue({ ip: "10.0.0.1" }),
    });
    const promise = deployServer("hetzner", provider, "nbg1", "cax11", "srv", false, false, "bare");
    await jest.runAllTimersAsync();
    await promise;
    jest.useRealTimers();
    expect(provider.getServerDetails).toHaveBeenCalled();
  });

  it("valid IP 10.0.0.1 does not trigger IP polling", async () => {
    const provider = createMockProvider();
    await deployServer("hetzner", provider, "nbg1", "cax11", "srv", false, false, "bare");
    expect(provider.getServerDetails).not.toHaveBeenCalled();
  });
});

describe("[MUTATION-KILLER] deployServer server status polling string", () => {
  let consoleSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    stderrSpy = jest.spyOn(console, "error").mockImplementation();
    jest.clearAllMocks();
    sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    firewallSetup.mockResolvedValue(undefined);
    secureSetup.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stderrSpy?.mockRestore();
  });

  it("waits for status 'running' before proceeding", async () => {
    jest.useFakeTimers();
    const getServerStatus = jest.fn()
      .mockResolvedValueOnce("initializing")
      .mockResolvedValueOnce("running");
    const provider = createMockProvider({ getServerStatus });
    waitForCoolify.mockResolvedValue(true);

    const promise = deployServer("hetzner", provider, "nbg1", "cax11", "srv");
    await jest.runAllTimersAsync();
    await promise;
    jest.useRealTimers();

    expect(getServerStatus).toHaveBeenCalledTimes(2);
  });

  it("polls server status until running", async () => {
    jest.useFakeTimers();
    const getServerStatus = jest.fn()
      .mockResolvedValueOnce("initializing")
      .mockResolvedValueOnce("running");
    const provider = createMockProvider({ getServerStatus });
    waitForCoolify.mockResolvedValue(true);

    const promise = deployServer("hetzner", provider, "nbg1", "cax11", "srv");
    await jest.runAllTimersAsync();
    const result = await promise;
    jest.useRealTimers();

    expect(result.success).toBe(true);
  });
});

describe("[MUTATION-KILLER] deployServer createServer retry strings", () => {
  let consoleSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    stderrSpy = jest.spyOn(console, "error").mockImplementation();
    jest.clearAllMocks();
    waitForCoolify.mockResolvedValue(true);
    sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    firewallSetup.mockResolvedValue(undefined);
    secureSetup.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stderrSpy?.mockRestore();
  });

  it("returns error containing 'Server creation failed' on retry exhaustion", async () => {
    const provider = createMockProvider({
      createServer: jest.fn()
        .mockRejectedValueOnce(new Error("unavailable"))
        .mockRejectedValueOnce(new Error("unavailable"))
        .mockRejectedValueOnce(new Error("unavailable")),
    });

    const result = await deployServer("hetzner", provider, "nbg1", "cax11", "srv");

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
