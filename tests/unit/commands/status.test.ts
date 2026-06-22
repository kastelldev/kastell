import { statusCommand } from "../../../src/commands/status";
import * as config from "../../../src/utils/config";
import * as serverSelect from "../../../src/utils/serverSelect";
import * as sshUtils from "../../../src/utils/ssh";
import * as statusCore from "../../../src/core/status";
import * as adapterFactory from "../../../src/adapters/factory";
import * as modeGuard from "../../../src/utils/modeGuard";
import * as errorMapper from "../../../src/utils/errorMapper";
import * as exitCode from "../../../src/utils/exitCode";
import inquirer from "inquirer";
import ora from "ora";

jest.mock("../../../src/utils/config");
jest.mock("../../../src/utils/serverSelect");
jest.mock("../../../src/utils/ssh");
jest.mock("../../../src/core/status");
jest.mock("../../../src/adapters/factory");
jest.mock("../../../src/utils/modeGuard");
jest.mock("../../../src/utils/errorMapper");
jest.mock("../../../src/utils/exitCode");
jest.mock("inquirer");
jest.mock("ora");

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedServerSelect = serverSelect as jest.Mocked<typeof serverSelect>;
const mockedSsh = sshUtils as jest.Mocked<typeof sshUtils>;
const mockedStatusCore = statusCore as jest.Mocked<typeof statusCore>;
const mockedAdapterFactory = adapterFactory as jest.Mocked<typeof adapterFactory>;
const mockedModeGuard = modeGuard as jest.Mocked<typeof modeGuard>;
const mockedErrorMapper = errorMapper as jest.Mocked<typeof errorMapper>;
const mockedExitCode = exitCode as jest.Mocked<typeof exitCode>;
const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;

const sampleServer = {
  id: "123",
  name: "test-server",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00Z",
  mode: "coolify" as const,
  platform: "coolify" as const,
  domain: "example.com",
};

const sampleServerBare = {
  id: "manual-456",
  name: "bare-server",
  provider: "hetzner",
  ip: "5.6.7.8",
  region: "fsn1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00Z",
  mode: "bare" as const,
};

function createMockSpinner() {
  return {
    start: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
    stop: jest.fn().mockReturnThis(),
    warn: jest.fn().mockReturnThis(),
  };
}

function getMockAdapter() {
  return {
    name: "Coolify",
    port: 8000,
    displayName: "Coolify",
    healthCheck: jest.fn(),
    restart: jest.fn(),
  };
}

describe("statusCommand", () => {
  let consoleSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;
  let restartCoolifySpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    stderrSpy = jest.spyOn(console, "error").mockImplementation();
    jest.clearAllMocks();
    process.exitCode = undefined;
    (ora as jest.Mock).mockImplementation(() => createMockSpinner());
    // Spy on restartCoolify directly so we can control nowRunning in each test
    restartCoolifySpy = jest.spyOn(mockedStatusCore, "restartCoolify").mockResolvedValue({
      success: true,
      nowRunning: true,
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stderrSpy.mockRestore();
    restartCoolifySpy?.mockRestore();
    process.exitCode = undefined;
  });

  // ─── options.all branch ────────────────────────────────────────────────────────

  describe("options.all", () => {
    it("should log info and return early when no servers exist", async () => {
      mockedConfig.getServers.mockReturnValue([]);

      await statusCommand(undefined, { all: true });

      expect(mockedConfig.getServers).toHaveBeenCalled();
      // logger.info uses console.log (stdout), not stderr
      const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(output).toContain("No servers found");
    });

    it("should print status table and summary for multiple servers", async () => {
      const servers = [sampleServer, sampleServerBare];
      mockedConfig.getServers.mockReturnValue(servers);
      mockedServerSelect.collectProviderTokens.mockResolvedValue(new Map([["hetzner", "token"]]));
      mockedStatusCore.checkAllServersStatus.mockResolvedValue([
        { server: sampleServer, serverStatus: "running", platformStatus: "running" },
        { server: sampleServerBare, serverStatus: "running", platformStatus: "n/a" },
      ]);
      mockedModeGuard.isBareServer.mockImplementation((s) => s.mode === "bare");
      mockedModeGuard.getServerModeLabel.mockImplementation((s) => s.mode);

      await statusCommand(undefined, { all: true });

      expect(mockedStatusCore.checkAllServersStatus).toHaveBeenCalledWith(servers, expect.any(Map));
      // Table header printed to stdout
      expect(consoleSpy.mock.calls.some((c) => c[0]?.includes("Name"))).toBe(true);
      // Summary (logger.success) uses console.log (stdout)
      const stdoutOutput = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(stdoutOutput).toContain("1/1 server(s) with Coolify running");
    });

    it("should log warning with error count when some servers have errors", async () => {
      const servers = [sampleServer, sampleServerBare];
      mockedConfig.getServers.mockReturnValue(servers);
      mockedServerSelect.collectProviderTokens.mockResolvedValue(new Map([["hetzner", "token"]]));
      mockedStatusCore.checkAllServersStatus.mockResolvedValue([
        { server: sampleServer, serverStatus: "running", platformStatus: "running" },
        { server: sampleServerBare, serverStatus: "error", platformStatus: "n/a", error: "SSH timeout" },
      ]);
      mockedModeGuard.isBareServer.mockImplementation((s) => s.mode === "bare");
      mockedModeGuard.getServerModeLabel.mockImplementation((s) => s.mode);

      await statusCommand(undefined, { all: true });

      // logger.warning → stderr
      const stderrOutput = stderrSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(stderrOutput).toContain("1 running, 1 error(s)");
    });

    it("should log bare-only success when only bare servers exist", async () => {
      const servers = [sampleServerBare];
      mockedConfig.getServers.mockReturnValue(servers);
      mockedServerSelect.collectProviderTokens.mockResolvedValue(new Map());
      mockedStatusCore.checkAllServersStatus.mockResolvedValue([
        { server: sampleServerBare, serverStatus: "running", platformStatus: "n/a" },
      ]);
      mockedModeGuard.isBareServer.mockImplementation((s) => s.mode === "bare");
      mockedModeGuard.getServerModeLabel.mockImplementation((s) => s.mode);

      await statusCommand(undefined, { all: true });

      // logger.success → stdout
      const stdoutOutput = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(stdoutOutput).toContain("1 bare server(s) running");
    });

    it("should not append bare count when errors exist but no bare servers", async () => {
      // bareCount=0, errors>0 → ternary false branch on line 44
      const servers = [sampleServer];
      mockedConfig.getServers.mockReturnValue(servers);
      mockedServerSelect.collectProviderTokens.mockResolvedValue(new Map([["hetzner", "token"]]));
      mockedStatusCore.checkAllServersStatus.mockResolvedValue([
        { server: sampleServer, serverStatus: "running", platformStatus: "running", error: "SSH timeout" },
      ]);
      mockedModeGuard.isBareServer.mockImplementation((s) => s.mode === "bare");
      mockedModeGuard.getServerModeLabel.mockImplementation((s) => s.mode);

      await statusCommand(undefined, { all: true });

      // errors>0 branch fires; bareCount=0 so ternary `${bareCount > 0 ? ... : ""}` = ""
      const stderrOutput = stderrSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(stderrOutput).toContain("1 running, 1 error(s)");
      // bare count should NOT appear in output (ternary false branch)
      expect(stderrOutput).not.toContain("bare");
    });

    it("should not append bare count in else branch when no bare servers exist", async () => {
      // errors=0, bareCount=0, coolifyResults>0 → ternary false branch on line 51
      const servers = [sampleServer];
      mockedConfig.getServers.mockReturnValue(servers);
      mockedServerSelect.collectProviderTokens.mockResolvedValue(new Map([["hetzner", "token"]]));
      mockedStatusCore.checkAllServersStatus.mockResolvedValue([
        { server: sampleServer, serverStatus: "running", platformStatus: "running" },
      ]);
      mockedModeGuard.isBareServer.mockImplementation((s) => s.mode === "bare");
      mockedModeGuard.getServerModeLabel.mockImplementation((s) => s.mode);

      await statusCommand(undefined, { all: true });

      const stdoutOutput = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      // bare count should NOT appear (ternary false branch)
      expect(stdoutOutput).not.toContain("bare");
    });
  });

  // ─── single server query: bare server (no platform) ────────────────────────

  describe("single server: bare server", () => {
    it("should show bare server details with SSH info", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServerBare);
      mockedModeGuard.isBareServer.mockReturnValue(true);
      mockedModeGuard.getServerModeLabel.mockReturnValue("bare");

      await statusCommand("bare-server");

      const stdoutOutput = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(stdoutOutput).toContain("Name:");
      expect(stdoutOutput).toContain("bare-server");
      expect(stdoutOutput).toContain("No platform installed (bare server)");
      expect(stdoutOutput).toContain("SSH:");
    });
  });

  // ─── single server query: platform running ───────────────────────────────────

  describe("single server: platform running", () => {
    it("should show running platform with access URL", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
      mockedModeGuard.isBareServer.mockImplementation((s) => s.mode === "bare");
      mockedModeGuard.getServerModeLabel.mockImplementation((s) => s.mode);
      mockedStatusCore.getCloudServerStatus.mockResolvedValue("running");

      const mockAdapter = getMockAdapter();
      mockAdapter.healthCheck.mockResolvedValue({ status: "running" });
      mockedAdapterFactory.getAdapter.mockReturnValue(mockAdapter as never);
      mockedAdapterFactory.resolvePlatform.mockReturnValue("coolify");

      await statusCommand("test-server");

      expect(mockAdapter.healthCheck).toHaveBeenCalledWith(sampleServer.ip, sampleServer.domain);
      // logger.info ("Coolify Status: running") → stdout
      const stdoutOutput = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(stdoutOutput).toContain("Coolify Status: running");
      // logger.success ("Access http://...") → stdout
      expect(stdoutOutput).toContain("http://1.2.3.4:8000");
      // logger.warning ("Running on HTTP...") → stderr
      const stderrOutput = stderrSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(stderrOutput).toContain("Running on HTTP");
    });
  });

  // ─── single server query: platform not running ───────────────────────────────

  describe("single server: platform not running", () => {
    it("should warn when platform is not reachable", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
      mockedModeGuard.isBareServer.mockImplementation((s) => s.mode === "bare");
      mockedModeGuard.getServerModeLabel.mockImplementation((s) => s.mode);
      mockedStatusCore.getCloudServerStatus.mockResolvedValue("running");

      const mockAdapter = getMockAdapter();
      mockAdapter.healthCheck.mockResolvedValue({ status: "stopped" });
      mockedAdapterFactory.getAdapter.mockReturnValue(mockAdapter as never);
      mockedAdapterFactory.resolvePlatform.mockReturnValue("coolify");

      await statusCommand("test-server");

      const stderrOutput = stderrSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(stderrOutput).toContain("not reachable");
      expect(stderrOutput).toContain("still be installing");
    });

    it("should skip autostart when serverStatus is not running", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
      mockedModeGuard.isBareServer.mockReturnValue(false);
      mockedModeGuard.getServerModeLabel.mockReturnValue("coolify");
      mockedStatusCore.getCloudServerStatus.mockResolvedValue("stopped");

      const mockAdapter = getMockAdapter();
      mockAdapter.healthCheck.mockResolvedValue({ status: "stopped" });
      mockedAdapterFactory.getAdapter.mockReturnValue(mockAdapter as never);
      mockedAdapterFactory.resolvePlatform.mockReturnValue("coolify");
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedStatusCore.restartCoolify.mockResolvedValue({ success: false, nowRunning: false });

      await statusCommand("test-server", { autostart: true });

      // restartCoolify should NOT be called because serverStatus !== "running"
      expect(mockedStatusCore.restartCoolify).not.toHaveBeenCalled();
    });

    it("should call autostartCoolify when serverStatus is running and autostart is set", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
      mockedModeGuard.isBareServer.mockReturnValue(false);
      mockedModeGuard.getServerModeLabel.mockReturnValue("coolify");
      mockedStatusCore.getCloudServerStatus.mockResolvedValue("running");

      const mockAdapter = getMockAdapter();
      mockAdapter.healthCheck.mockResolvedValue({ status: "stopped" });
      mockedAdapterFactory.getAdapter.mockReturnValue(mockAdapter as never);
      mockedAdapterFactory.resolvePlatform.mockReturnValue("coolify");
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedStatusCore.restartCoolify.mockResolvedValue({ success: true, nowRunning: true });

      await statusCommand("test-server", { autostart: true });

      expect(mockedSsh.checkSshAvailable).toHaveBeenCalled();
      expect(mockedStatusCore.restartCoolify).toHaveBeenCalledWith(sampleServer);
    });

    it("should warn when autostart succeeds but Coolify is still starting", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
      mockedModeGuard.isBareServer.mockImplementation((s) => s.mode === "bare");
      mockedModeGuard.getServerModeLabel.mockImplementation((s) => s.mode);
      mockedStatusCore.getCloudServerStatus.mockResolvedValue("running");

      const mockAdapter = getMockAdapter();
      mockAdapter.healthCheck.mockResolvedValue({ status: "stopped" });
      mockedAdapterFactory.getAdapter.mockReturnValue(mockAdapter as never);
      mockedAdapterFactory.resolvePlatform.mockReturnValue("coolify");
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      // Override spy default: success=true but nowRunning=false (Coolify still starting)
      mockedStatusCore.restartCoolify.mockResolvedValue({
        success: true,
        nowRunning: false,
      });

      await statusCommand("test-server", { autostart: true });

      // nowRunning=false → should warn "may still be starting" (lines 96-97)
      const stderrOutput = stderrSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(stderrOutput).toContain("may still be starting");
    });

    it("should warn and not call autostart when SSH is not available", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
      mockedModeGuard.isBareServer.mockReturnValue(false);
      mockedModeGuard.getServerModeLabel.mockReturnValue("coolify");
      mockedStatusCore.getCloudServerStatus.mockResolvedValue("running");

      const mockAdapter = getMockAdapter();
      mockAdapter.healthCheck.mockResolvedValue({ status: "stopped" });
      mockedAdapterFactory.getAdapter.mockReturnValue(mockAdapter as never);
      mockedAdapterFactory.resolvePlatform.mockReturnValue("coolify");
      mockedSsh.checkSshAvailable.mockReturnValue(false);

      await statusCommand("test-server", { autostart: true });

      expect(mockedStatusCore.restartCoolify).not.toHaveBeenCalled();
      const stderrOutput = stderrSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(stderrOutput).toContain("SSH not available");
    });

    it("should log error and hint when restartCoolify fails", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
      mockedModeGuard.isBareServer.mockImplementation((s) => s.mode === "bare");
      mockedModeGuard.getServerModeLabel.mockImplementation((s) => s.mode);
      mockedStatusCore.getCloudServerStatus.mockResolvedValue("running");

      const mockAdapter = getMockAdapter();
      mockAdapter.healthCheck.mockResolvedValue({ status: "stopped" });
      mockedAdapterFactory.getAdapter.mockReturnValue(mockAdapter as never);
      mockedAdapterFactory.resolvePlatform.mockReturnValue("coolify");
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedStatusCore.restartCoolify.mockResolvedValue({
        success: false,
        nowRunning: false,
        error: "Restart command failed",
        hint: "Check SSH connectivity",
      });

      await statusCommand("test-server", { autostart: true });

      // logger.error → stderr, logger.info (hint) → stdout
      const stderrOutput = stderrSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(stderrOutput).toContain("Restart command failed");
      const stdoutOutput = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(stdoutOutput).toContain("Check SSH connectivity");
    });
  });

  // ─── error handling ──────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("should handle getCloudServerStatus throwing Error", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
      mockedModeGuard.isBareServer.mockReturnValue(false);
      mockedModeGuard.getServerModeLabel.mockReturnValue("coolify");
      mockedStatusCore.getCloudServerStatus.mockRejectedValue(new Error("Network Error"));
      mockedErrorMapper.classifyError.mockReturnValue({
        message: "Network Error",
        isTyped: false,
      });
      mockedErrorMapper.mapProviderError.mockReturnValue("Check your API token");

      await statusCommand("test-server");

      expect(mockedExitCode.markCommandFailed).toHaveBeenCalled();
      const stderrOutput = stderrSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(stderrOutput).toContain("Network Error");
    });

    it("should handle getCloudServerStatus throwing non-Error value", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
      mockedModeGuard.isBareServer.mockReturnValue(false);
      mockedModeGuard.getServerModeLabel.mockReturnValue("coolify");
      mockedStatusCore.getCloudServerStatus.mockRejectedValue("unexpected failure");
      mockedErrorMapper.classifyError.mockReturnValue({
        message: "unexpected failure",
        isTyped: false,
      });
      mockedErrorMapper.mapProviderError.mockReturnValue("");

      await statusCommand("test-server");

      expect(mockedExitCode.markCommandFailed).toHaveBeenCalled();
      const stderrOutput = stderrSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(stderrOutput).toContain("unexpected failure");
    });

    it("should call mapProviderError hint when error is not typed", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
      mockedModeGuard.isBareServer.mockImplementation((s) => s.mode === "bare");
      mockedModeGuard.getServerModeLabel.mockImplementation((s) => s.mode);
      // mapProviderError returns hint only for axios 401/403 errors
      const axiosError = Object.assign(new Error("Request failed"), {
        isAxiosError: true,
        response: { status: 401 },
      });
      mockedStatusCore.getCloudServerStatus.mockRejectedValue(axiosError);
      mockedErrorMapper.classifyError.mockReturnValue({
        message: "Request failed",
        isTyped: false,
      });
      mockedErrorMapper.mapProviderError.mockReturnValue(
        "API token is invalid or expired. Generate a new token from https://console.hetzner.cloud",
      );

      await statusCommand("test-server");

      // hint from mapProviderError is logged via logger.info (stdout)
      const stdoutOutput = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(stdoutOutput).toContain("API token is invalid or expired");
    });
  });

  // ─── resolveServer: multiple matches (inquirer picks one) ───────────────────

  describe("resolveServer with multiple matches", () => {
    it("should prompt inquirer when query matches multiple servers", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
      mockedModeGuard.isBareServer.mockImplementation((s) => s.mode === "bare");
      mockedModeGuard.getServerModeLabel.mockImplementation((s) => s.mode);
      mockedStatusCore.getCloudServerStatus.mockResolvedValue("running");

      const mockAdapter = getMockAdapter();
      mockAdapter.healthCheck.mockResolvedValue({ status: "running" });
      mockedAdapterFactory.getAdapter.mockReturnValue(mockAdapter as never);
      mockedAdapterFactory.resolvePlatform.mockReturnValue("coolify");

      await statusCommand("test");

      expect(mockedServerSelect.resolveServer).toHaveBeenCalledWith("test");
    });
  });

  // ─── manual server (no API token needed) ───────────────────────────────────

  describe("manual server", () => {
    it("should skip API token prompt for manual- prefixed server", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServerBare);
      mockedModeGuard.isBareServer.mockReturnValue(true);
      mockedModeGuard.getServerModeLabel.mockReturnValue("bare");

      await statusCommand("bare-server");

      expect(mockedServerSelect.promptApiToken).not.toHaveBeenCalled();
    });
  });
});
