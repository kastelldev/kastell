/**
 * Unit tests for deployServer() in src/core/deploy.ts
 * Tests call deployServer() directly (not through initCommand) and mock all
 * external dependencies independently.
 *
 * Covers: happy path coolify, bare mode (no waitForCoolify, no openBrowser,
 *         SSH info, cloud-init wait), full-setup (firewall+secure called/skipped),
 *         error path (process.exit), pending IP, noOpen flag.
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
  sshExec: jest.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" }),
  sshConnect: jest.fn(),
  sshStream: jest.fn(),
  sanitizedEnv: jest.fn().mockReturnValue({}),
  checkSshAvailable: jest.fn().mockReturnValue(true),
}));

jest.mock("../../src/commands/firewall", () => ({
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

jest.mock("../../src/commands/secure", () => ({
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
const { sshExec } = jest.requireMock("../../src/utils/ssh") as {
  sshExec: jest.Mock;
};
const { firewallSetup } = jest.requireMock("../../src/commands/firewall") as {
  firewallSetup: jest.Mock;
};
const { secureSetup } = jest.requireMock("../../src/commands/secure") as {
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
    ...overrides,
  } as CloudProvider;
}

// ============================================================
// describe: coolify mode
// ============================================================

describe("deployServer — coolify mode", () => {
  let consoleSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    processExitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
    jest.clearAllMocks();
    // Default: Coolify reports ready
    waitForCoolify.mockResolvedValue(true);
    sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    firewallSetup.mockResolvedValue(undefined);
    secureSetup.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it("should call waitForCoolify and saveServer with mode:'coolify' (happy path)", async () => {
    const provider = createMockProvider();

    await deployServer("hetzner", provider, "nbg1", "cax11", "my-server");

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
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    processExitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
    jest.clearAllMocks();
    waitForCoolify.mockResolvedValue(true);
    sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    firewallSetup.mockResolvedValue(undefined);
    secureSetup.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    processExitSpy.mockRestore();
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

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toMatch(/ssh root@/i);
  });

  it("should call sshExec with 'cloud-init status --wait' when mode='bare'", async () => {
    const provider = createMockProvider();

    await deployServer("hetzner", provider, "nbg1", "cax11", "my-server", false, false, "bare");

    expect(sshExec).toHaveBeenCalledWith(expect.any(String), "cloud-init status --wait");
  });
});

// ============================================================
// describe: error handling
// ============================================================

describe("deployServer — error handling", () => {
  let consoleSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    processExitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
    jest.clearAllMocks();
    waitForCoolify.mockResolvedValue(true);
    sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it("should call process.exit(1) when server creation fails with a generic error", async () => {
    const provider = createMockProvider({
      createServer: jest.fn().mockRejectedValue(new Error("Internal Server Error")),
    });

    await deployServer("hetzner", provider, "nbg1", "cax11", "my-server");

    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});

// ============================================================
// describe: IP assignment
// ============================================================

describe("deployServer — IP assignment", () => {
  let consoleSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    processExitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
    jest.clearAllMocks();
    waitForCoolify.mockResolvedValue(true);
    sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    processExitSpy.mockRestore();
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
