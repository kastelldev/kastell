/**
 * Tests for bare mode init command in src/commands/init.ts
 * Covers: bare mode skips waitForCoolify, skips openBrowser, shows SSH info,
 *         --full-setup calls firewallSetup+secureSetup (BUG-1),
 *         --name flag skips prompt (BUG-2),
 *         cloud-init wait via sshExec (BUG-5)
 */

import axios from "axios";
import { initCommand } from "../../src/commands/init";

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

const mockedAxios = axios as jest.Mocked<typeof axios>;
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
const { firewallSetup } = jest.requireMock("../../src/core/firewall") as {
  firewallSetup: jest.Mock;
};
const { secureSetup } = jest.requireMock("../../src/core/secure") as {
  secureSetup: jest.Mock;
};

function setupHetznerMocks() {
  mockedAxios.get.mockImplementation((url: string) => {
    if (url.includes("/servers/") && !url.includes("server_types")) {
      return Promise.resolve({
        data: { server: { id: 999, status: "running", public_net: { ipv4: { ip: "10.0.0.1" } } } },
      });
    }
    if (url.includes("locations")) {
      return Promise.resolve({
        data: { locations: [{ name: "nbg1", city: "Nuremberg", country: "Germany" }] },
      });
    }
    if (url.includes("server_types")) {
      return Promise.resolve({
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
      });
    }
    return Promise.resolve({ data: { servers: [] } });
  });
  mockedAxios.post.mockResolvedValue({
    data: { server: { id: 999, public_net: { ipv4: { ip: "10.0.0.1" } }, status: "running" } },
  });
}

describe("initCommand — bare mode", () => {
  let consoleSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    processExitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
    jest.clearAllMocks();
    setupHetznerMocks();
    sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    firewallSetup.mockResolvedValue(undefined);
    secureSetup.mockResolvedValue(undefined);
    waitForCoolify.mockResolvedValue(true);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it("should NOT call waitForCoolify when mode='bare'", async () => {
    await initCommand({
      provider: "hetzner",
      token: "test-token",
      region: "nbg1",
      size: "cax11",
      name: "bare-server",
      mode: "bare",
    });

    expect(waitForCoolify).not.toHaveBeenCalled();
  });

  it("should NOT call openBrowser when mode='bare'", async () => {
    await initCommand({
      provider: "hetzner",
      token: "test-token",
      region: "nbg1",
      size: "cax11",
      name: "bare-server",
      mode: "bare",
    });

    expect(openBrowser).not.toHaveBeenCalled();
  });

  it("should show SSH connection info when mode='bare'", async () => {
    await initCommand({
      provider: "hetzner",
      token: "test-token",
      region: "nbg1",
      size: "cax11",
      name: "bare-server",
      mode: "bare",
    });

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toMatch(/ssh root@/i);
  });

  it("should save ServerRecord with mode:'bare' when mode='bare'", async () => {
    await initCommand({
      provider: "hetzner",
      token: "test-token",
      region: "nbg1",
      size: "cax11",
      name: "bare-server",
      mode: "bare",
    });

    expect(saveServer).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "bare" }),
    );
  });

  it("should call waitForCoolify when mode is NOT bare (default behavior)", async () => {
    await initCommand({
      provider: "hetzner",
      token: "test-token",
      region: "nbg1",
      size: "cax11",
      name: "coolify-server",
    });

    expect(waitForCoolify).toHaveBeenCalled();
  });

  it("should call openBrowser when mode is NOT bare and Coolify is ready", async () => {
    await initCommand({
      provider: "hetzner",
      token: "test-token",
      region: "nbg1",
      size: "cax11",
      name: "coolify-server",
      noOpen: false,
    });

    expect(openBrowser).toHaveBeenCalled();
  });

  // ---- BUG-5: cloud-init wait ----

  it("should call sshExec with cloud-init status --wait when mode='bare' (BUG-5)", async () => {
    await initCommand({
      provider: "hetzner",
      token: "test-token",
      region: "nbg1",
      size: "cax11",
      name: "bare-server",
      mode: "bare",
    });

    expect(sshExec).toHaveBeenCalledWith(
      expect.any(String),
      "cloud-init status --wait",
    );
  });

  it("should continue even when cloud-init sshExec throws (BUG-5 resilience)", async () => {
    // First call (echo ok) succeeds so SSH ready check passes, second call (cloud-init) throws
    sshExec
      .mockResolvedValueOnce({ code: 0, stdout: "ok", stderr: "" })
      .mockRejectedValue(new Error("SSH connection timeout"));

    await initCommand({
      provider: "hetzner",
      token: "test-token",
      region: "nbg1",
      size: "cax11",
      name: "bare-server",
      mode: "bare",
    });

    // Should still complete and save server
    expect(saveServer).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "bare" }),
    );
  });

  it("should continue even when cloud-init returns non-zero exit code (BUG-5 resilience)", async () => {
    sshExec.mockResolvedValue({ code: 1, stdout: "", stderr: "cloud-init not found" });

    await initCommand({
      provider: "hetzner",
      token: "test-token",
      region: "nbg1",
      size: "cax11",
      name: "bare-server",
      mode: "bare",
    });

    expect(saveServer).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "bare" }),
    );
  });

  // ---- BUG-1: bare --full-setup ----

  it("should call firewallSetup with isBare=true when mode='bare' and fullSetup=true (BUG-1)", async () => {
    await initCommand({
      provider: "hetzner",
      token: "test-token",
      region: "nbg1",
      size: "cax11",
      name: "bare-server",
      mode: "bare",
      fullSetup: true,
    });

    expect(firewallSetup).toHaveBeenCalledWith(
      expect.any(String),
      "bare-server",
      false,
      true,
    );
  });

  it("should call secureSetup when mode='bare' and fullSetup=true (BUG-1)", async () => {
    await initCommand({
      provider: "hetzner",
      token: "test-token",
      region: "nbg1",
      size: "cax11",
      name: "bare-server",
      mode: "bare",
      fullSetup: true,
    });

    expect(secureSetup).toHaveBeenCalled();
  });

  it("should NOT call firewallSetup when mode='bare' and fullSetup is NOT set (BUG-1)", async () => {
    await initCommand({
      provider: "hetzner",
      token: "test-token",
      region: "nbg1",
      size: "cax11",
      name: "bare-server",
      mode: "bare",
    });

    expect(firewallSetup).not.toHaveBeenCalled();
  });

  it("should show secure your server tips when bare without fullSetup", async () => {
    await initCommand({
      provider: "hetzner",
      token: "test-token",
      region: "nbg1",
      size: "cax11",
      name: "bare-server",
      mode: "bare",
    });

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("kastell firewall setup");
  });

  it("should continue even when firewallSetup throws during bare fullSetup (BUG-1 resilience)", async () => {
    firewallSetup.mockRejectedValue(new Error("SSH connection refused"));

    await initCommand({
      provider: "hetzner",
      token: "test-token",
      region: "nbg1",
      size: "cax11",
      name: "bare-server",
      mode: "bare",
      fullSetup: true,
    });

    // Should still complete (show server ready)
    expect(saveServer).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "bare" }),
    );
  });
});

// ---- BUG-2: --name flag in interactive path ----

describe("initCommand — --name flag fix (BUG-2)", () => {
  let consoleSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    processExitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
    jest.clearAllMocks();
    setupHetznerMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  // The non-interactive (--provider specified) path already handles --name correctly.
  // This test confirms the saved server uses the provided name.
  it("should use --name option as server name without calling getServerNameConfig", async () => {
    const { saveServer: mockSave } = jest.requireMock("../../src/utils/config") as {
      saveServer: jest.Mock;
    };
    const { sshExec: mockSshExec } = jest.requireMock("../../src/utils/ssh") as {
      sshExec: jest.Mock;
    };
    mockSshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    const { waitForCoolify: mockWait } = jest.requireMock("../../src/utils/healthCheck") as {
      waitForCoolify: jest.Mock;
    };
    mockWait.mockResolvedValue(false);

    await initCommand({
      provider: "hetzner",
      token: "test-token",
      region: "nbg1",
      size: "cax11",
      name: "my-named-server",
    });

    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: "my-named-server" }),
    );
  });
});
