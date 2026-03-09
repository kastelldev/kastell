import axios from "axios";
import * as config from "../../src/utils/config";
import * as serverSelect from "../../src/utils/serverSelect";
import * as providerFactory from "../../src/utils/providerFactory";
import * as sshUtils from "../../src/utils/ssh";
import { statusCommand } from "../../src/commands/status";
import type { CloudProvider } from "../../src/providers/base";

jest.mock("../../src/utils/config");
jest.mock("../../src/utils/serverSelect");
jest.mock("../../src/utils/providerFactory");
jest.mock("../../src/utils/ssh");

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedConfig = config as jest.Mocked<typeof config>;
const mockedServerSelect = serverSelect as jest.Mocked<typeof serverSelect>;
const mockedProviderFactory = providerFactory as jest.Mocked<typeof providerFactory>;
const mockedSsh = sshUtils as jest.Mocked<typeof sshUtils>;

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

const mockProvider: CloudProvider = {
  name: "hetzner",
  displayName: "Hetzner Cloud",
  validateToken: jest.fn().mockResolvedValue(true),
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

describe("statusCommand", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  // ---- Existing single-server tests (adapted for module mocks) ----

  it("should show error when server not found by query", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(undefined);

    await statusCommand("nonexistent");

    // resolveServer returns undefined -> early return
    expect(mockedServerSelect.resolveServer).toHaveBeenCalledWith("nonexistent");
  });

  it("should display status for found server", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
    (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    // Coolify health check success
    mockedAxios.get.mockResolvedValueOnce({ status: 200 });

    await statusCommand("1.2.3.4");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("coolify-test");
    expect(output).toContain("hetzner");
    expect(output).toContain("1.2.3.4");
    expect(output).toContain("running");
  });

  it("should show coolify as not reachable when health check fails", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
    (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    // Coolify health check fails
    mockedAxios.get.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await statusCommand("1.2.3.4");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("not reachable");
  });

  it("should handle API error gracefully", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedServerSelect.promptApiToken.mockResolvedValue("bad-token");
    (mockProvider.getServerStatus as jest.Mock).mockRejectedValue(new Error("Unauthorized"));
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    await statusCommand("1.2.3.4");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Unauthorized");
  });

  it("should allow interactive server selection", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
    (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
    mockedAxios.get.mockResolvedValueOnce({ status: 200 });

    await statusCommand();

    expect(mockedServerSelect.resolveServer).toHaveBeenCalledWith(undefined);
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("coolify-test");
  });

  // ---- --all mode tests ----

  describe("--all mode", () => {
    it("should show info when no servers exist", async () => {
      mockedConfig.getServers.mockReturnValue([]);

      await statusCommand(undefined, { all: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("No servers found");
    });

    it("should check all servers and display a summary table", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer, sampleServer2]);
      mockedServerSelect.collectProviderTokens.mockResolvedValue(
        new Map([
          ["hetzner", "h-token"],
          ["digitalocean", "do-token"],
        ]),
      );
      (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
      mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

      // Coolify health check: both running
      mockedAxios.get.mockResolvedValue({ status: 200 });

      await statusCommand(undefined, { all: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("coolify-test");
      expect(output).toContain("coolify-prod");
      expect(output).toContain("1.2.3.4");
      expect(output).toContain("5.6.7.8");
      expect(mockedServerSelect.collectProviderTokens).toHaveBeenCalledWith([
        sampleServer,
        sampleServer2,
      ]);
    });

    it("should handle mixed results (running + error)", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer, sampleServer2]);
      mockedServerSelect.collectProviderTokens.mockResolvedValue(
        new Map([
          ["hetzner", "h-token"],
          ["digitalocean", "do-token"],
        ]),
      );

      // First server: running
      const runningProvider: CloudProvider = {
        ...mockProvider,
        getServerStatus: jest.fn().mockResolvedValue("running"),
      };
      // Second server: API error
      const errorProvider: CloudProvider = {
        ...mockProvider,
        getServerStatus: jest.fn().mockRejectedValue(new Error("API failure")),
      };

      mockedProviderFactory.createProviderWithToken
        .mockReturnValueOnce(runningProvider)
        .mockReturnValueOnce(errorProvider);

      // First server Coolify check succeeds
      mockedAxios.get.mockResolvedValue({ status: 200 });

      await statusCommand(undefined, { all: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      // Table should contain both servers
      expect(output).toContain("coolify-test");
      expect(output).toContain("coolify-prod");
      // Summary should mention errors
      expect(output).toContain("error");
    });

    it("should collect tokens for unique providers only", async () => {
      const server3 = { ...sampleServer, id: "789", name: "coolify-staging" };
      mockedConfig.getServers.mockReturnValue([sampleServer, server3]);
      mockedServerSelect.collectProviderTokens.mockResolvedValue(new Map([["hetzner", "h-token"]]));
      (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
      mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
      mockedAxios.get.mockResolvedValue({ status: 200 });

      await statusCommand(undefined, { all: true });

      // Both servers are hetzner, so collectProviderTokens is called with both
      expect(mockedServerSelect.collectProviderTokens).toHaveBeenCalledTimes(1);
    });

    it("should show coolify as not reachable for failed health check in --all", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedServerSelect.collectProviderTokens.mockResolvedValue(new Map([["hetzner", "h-token"]]));
      (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
      mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
      mockedAxios.get.mockRejectedValue(new Error("ECONNREFUSED"));

      await statusCommand(undefined, { all: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("not reachable");
    });
  });

  // ---- Bare mode tests ----

  describe("bare server", () => {
    const bareServer = {
      id: "bare-123",
      name: "bare-test",
      provider: "hetzner",
      ip: "9.9.9.9",
      region: "nbg1",
      size: "cax11",
      createdAt: "2026-02-20T00:00:00Z",
      mode: "bare" as const,
    };

    it("should display Mode: bare in status output for bare server", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(bareServer);
      mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
      (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
      mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

      await statusCommand("9.9.9.9");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("bare");
    });

    it("should NOT show Coolify status line for bare server", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(bareServer);
      mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
      (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
      mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

      await statusCommand("9.9.9.9");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).not.toContain("Coolify Status");
      // Should not attempt Coolify health check
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it("should NOT trigger autostart for bare server", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(bareServer);
      mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
      (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
      mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

      await statusCommand("9.9.9.9", { autostart: true });

      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });
  });

  describe("--all mode with mixed bare+coolify", () => {
    const bareServer = {
      id: "bare-123",
      name: "bare-test",
      provider: "hetzner",
      ip: "9.9.9.9",
      region: "nbg1",
      size: "cax11",
      createdAt: "2026-02-20T00:00:00Z",
      mode: "bare" as const,
    };

    it("should include Mode column in status table output", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer, bareServer]);
      mockedServerSelect.collectProviderTokens.mockResolvedValue(
        new Map([["hetzner", "h-token"]]),
      );
      (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
      mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
      mockedAxios.get.mockResolvedValue({ status: 200 });

      await statusCommand(undefined, { all: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Mode");
    });
  });

  // ---- --autostart tests ----

  describe("--autostart mode", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    function setupAutostartMocks(
      serverStatus: string,
      axiosBehavior: "reject" | "resolve" | "reject-then-resolve" | "reject-both",
      sshAvailable = true,
    ) {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
      (mockProvider.getServerStatus as jest.Mock).mockResolvedValue(serverStatus);
      mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
      mockedSsh.checkSshAvailable.mockReturnValue(sshAvailable);

      switch (axiosBehavior) {
        case "resolve":
          mockedAxios.get.mockResolvedValue({ status: 200 });
          break;
        case "reject":
          mockedAxios.get.mockRejectedValue(new Error("ECONNREFUSED"));
          break;
        case "reject-then-resolve":
          mockedAxios.get
            .mockRejectedValueOnce(new Error("ECONNREFUSED"))
            .mockResolvedValueOnce({ status: 200 });
          break;
        case "reject-both":
          mockedAxios.get
            .mockRejectedValueOnce(new Error("ECONNREFUSED"))
            .mockRejectedValueOnce(new Error("ECONNREFUSED"));
          break;
      }
    }

    it("should trigger SSH restart when coolify is down but server is running", async () => {
      setupAutostartMocks("running", "reject-then-resolve");
      mockedSsh.sshExec.mockResolvedValue({
        code: 0,
        stdout: "",
        stderr: "",
      });

      const promise = statusCommand("1.2.3.4", { autostart: true });
      // Advance past the 5-second wait in autostartCoolify
      await jest.advanceTimersByTimeAsync(6000);
      await promise;

      expect(mockedSsh.sshExec).toHaveBeenCalledWith(
        "1.2.3.4",
        expect.stringContaining("docker compose"),
      );
    });

    it("should not trigger restart when coolify is already running", async () => {
      setupAutostartMocks("running", "resolve");

      await statusCommand("1.2.3.4", { autostart: true });

      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
    });

    it("should not trigger restart when SSH is not available", async () => {
      setupAutostartMocks("running", "reject", false);

      await statusCommand("1.2.3.4", { autostart: true });

      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("SSH not available");
    });

    it("should not trigger restart when server itself is not running", async () => {
      setupAutostartMocks("off", "reject");

      await statusCommand("1.2.3.4", { autostart: true });

      // autostart should NOT trigger because server status is "off", not "running"
      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
    });

    it("should handle SSH restart failure gracefully", async () => {
      setupAutostartMocks("running", "reject");
      mockedSsh.sshExec.mockResolvedValue({
        code: 1,
        stdout: "",
        stderr: "compose error",
      });

      await statusCommand("1.2.3.4", { autostart: true });

      expect(mockedSsh.sshExec).toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("compose error");
    });

    it("should handle SSH restart exception gracefully", async () => {
      setupAutostartMocks("running", "reject");
      mockedSsh.sshExec.mockRejectedValue(new Error("Connection refused"));

      await statusCommand("1.2.3.4", { autostart: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Connection refused");
      expect(output).toContain("SSH connection refused");
    });

    it("should warn when coolify still not running after restart", async () => {
      setupAutostartMocks("running", "reject-both");
      mockedSsh.sshExec.mockResolvedValue({
        code: 0,
        stdout: "",
        stderr: "",
      });

      const promise = statusCommand("1.2.3.4", { autostart: true });
      await jest.advanceTimersByTimeAsync(6000);
      await promise;

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("still be starting");
    });
  });
});
