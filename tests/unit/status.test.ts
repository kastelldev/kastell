import axios from "axios";
import * as config from "../../src/utils/config";
import * as serverSelect from "../../src/utils/serverSelect";
import * as providerFactory from "../../src/utils/providerFactory";
import * as sshUtils from "../../src/utils/ssh";
import * as loggerUtils from "../../src/utils/logger";
import * as coreStatus from "../../src/core/status";
import { statusCommand } from "../../src/commands/status";
import type { CloudProvider } from "../../src/providers/base";

jest.mock("../../src/utils/config");
jest.mock("../../src/utils/serverSelect");
jest.mock("../../src/utils/providerFactory");
jest.mock("../../src/utils/ssh");
jest.mock("../../src/utils/logger");
jest.mock("../../src/core/status");

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedConfig = config as jest.Mocked<typeof config>;
const mockedServerSelect = serverSelect as jest.Mocked<typeof serverSelect>;
const mockedProviderFactory = providerFactory as jest.Mocked<typeof providerFactory>;
const mockedSsh = sshUtils as jest.Mocked<typeof sshUtils>;
const mockedLogger = loggerUtils as jest.Mocked<typeof loggerUtils>;
const mockedCoreStatus = coreStatus as jest.Mocked<typeof coreStatus>;

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
  restoreSnapshot: jest.fn(),
  getSnapshotCostEstimate: jest.fn(),
};

const mockSpinner = {
  start: jest.fn().mockReturnThis(),
  succeed: jest.fn().mockReturnThis(),
  fail: jest.fn().mockReturnThis(),
  stop: jest.fn().mockReturnThis(),
  warn: jest.fn().mockReturnThis(),
};

describe("statusCommand", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.resetAllMocks();
    // Default: SSH available
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    // Default: spinner mock
    mockedLogger.createSpinner.mockReturnValue(mockSpinner as unknown as ReturnType<typeof mockedLogger.createSpinner>);
    // Default: logger methods mock
    (mockedLogger.logger as jest.Mocked<typeof mockedLogger.logger>) = {
      info: jest.fn(),
      success: jest.fn(),
      error: jest.fn(),
      warning: jest.fn(),
      title: jest.fn(),
      step: jest.fn(),
    };
    // Default: restartCoolify succeeds
    mockedCoreStatus.restartCoolify.mockResolvedValue({ success: true, nowRunning: true });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  // ---- Existing single-server tests ----

  it("should show error when server not found by query", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(undefined);

    await statusCommand("nonexistent");

    expect(mockedServerSelect.resolveServer).toHaveBeenCalledWith("nonexistent");
  });

  it("should display status for found server", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
    mockedCoreStatus.getCloudServerStatus.mockResolvedValue("running");

    // Coolify health check success
    mockedAxios.get.mockResolvedValueOnce({ status: 200 });

    await statusCommand("1.2.3.4");

    // logger.info prints server details
    const infoCalls = (mockedLogger.logger.info as jest.Mock).mock.calls.map((c) => c[0]).join("\n");
    expect(infoCalls).toContain("coolify-test");
    expect(infoCalls).toContain("hetzner");
    expect(infoCalls).toContain("1.2.3.4");
  });

  it("should show coolify as not reachable when health check fails", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
    mockedCoreStatus.getCloudServerStatus.mockResolvedValue("running");

    // Coolify health check fails
    mockedAxios.get.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await statusCommand("1.2.3.4");

    const warnCalls = (mockedLogger.logger.warning as jest.Mock).mock.calls.map((c) => c[0]).join("\n");
    expect(warnCalls).toContain("not reachable");
  });

  it("should handle API error gracefully", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedServerSelect.promptApiToken.mockResolvedValue("bad-token");
    mockedCoreStatus.getCloudServerStatus.mockRejectedValue(new Error("Unauthorized"));

    await statusCommand("1.2.3.4");

    const errorCalls = (mockedLogger.logger.error as jest.Mock).mock.calls.map((c) => c[0]).join("\n");
    expect(errorCalls).toContain("Unauthorized");
  });

  it("should allow interactive server selection", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
    mockedCoreStatus.getCloudServerStatus.mockResolvedValue("running");
    mockedAxios.get.mockResolvedValueOnce({ status: 200 });

    await statusCommand();

    expect(mockedServerSelect.resolveServer).toHaveBeenCalledWith(undefined);
    const infoCalls = (mockedLogger.logger.info as jest.Mock).mock.calls.map((c) => c[0]).join("\n");
    expect(infoCalls).toContain("coolify-test");
  });

  // ---- --all mode tests ----

  describe("--all mode", () => {
    it("should show info when no servers exist", async () => {
      mockedConfig.getServers.mockReturnValue([]);
      mockedCoreStatus.checkAllServersStatus.mockResolvedValue([]);

      await statusCommand(undefined, { all: true });

      expect(mockedLogger.logger.info).toHaveBeenCalledWith(
        expect.stringContaining("No servers found"),
      );
    });

    it("should check all servers and display a summary table", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer, sampleServer2]);
      mockedServerSelect.collectProviderTokens.mockResolvedValue(
        new Map([
          ["hetzner", "h-token"],
          ["digitalocean", "do-token"],
        ]),
      );
      mockedCoreStatus.checkAllServersStatus.mockResolvedValue([
        {
          server: sampleServer,
          serverStatus: "running",
          platformStatus: "running",
        },
        {
          server: sampleServer2,
          serverStatus: "running",
          platformStatus: "running",
        },
      ]);

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
      mockedCoreStatus.checkAllServersStatus.mockResolvedValue([
        {
          server: sampleServer,
          serverStatus: "running",
          platformStatus: "running",
        },
        {
          server: sampleServer2,
          serverStatus: "error",
          platformStatus: "unknown",
          error: "API failure",
        },
      ]);

      await statusCommand(undefined, { all: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("coolify-test");
      expect(output).toContain("coolify-prod");
      expect(output).toContain("error");
    });

    it("should collect tokens for unique providers only", async () => {
      const server3 = { ...sampleServer, id: "789", name: "coolify-staging" };
      mockedConfig.getServers.mockReturnValue([sampleServer, server3]);
      mockedServerSelect.collectProviderTokens.mockResolvedValue(new Map([["hetzner", "h-token"]]));
      mockedCoreStatus.checkAllServersStatus.mockResolvedValue([
        { server: sampleServer, serverStatus: "running", platformStatus: "running" },
        { server: server3, serverStatus: "running", platformStatus: "running" },
      ]);

      await statusCommand(undefined, { all: true });

      expect(mockedServerSelect.collectProviderTokens).toHaveBeenCalledTimes(1);
    });

    it("should show coolify as not reachable for failed health check in --all", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedServerSelect.collectProviderTokens.mockResolvedValue(new Map([["hetzner", "h-token"]]));
      mockedCoreStatus.checkAllServersStatus.mockResolvedValue([
        {
          server: sampleServer,
          serverStatus: "running",
          platformStatus: "not reachable",
        },
      ]);

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
      mockedCoreStatus.getCloudServerStatus.mockResolvedValue("running");

      await statusCommand("9.9.9.9");

      const infoCalls = (mockedLogger.logger.info as jest.Mock).mock.calls.map((c) => c[0]).join("\n");
      expect(infoCalls).toContain("bare");
    });

    it("should NOT show Coolify status line for bare server", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(bareServer);
      mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
      mockedCoreStatus.getCloudServerStatus.mockResolvedValue("running");

      await statusCommand("9.9.9.9");

      const infoCalls = (mockedLogger.logger.info as jest.Mock).mock.calls.map((c) => c[0]).join("\n");
      expect(infoCalls).not.toContain("Coolify Status");
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it("should NOT trigger autostart for bare server", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(bareServer);
      mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
      mockedCoreStatus.getCloudServerStatus.mockResolvedValue("running");

      await statusCommand("9.9.9.9", { autostart: true });

      expect(mockedCoreStatus.restartCoolify).not.toHaveBeenCalled();
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
      mockedCoreStatus.checkAllServersStatus.mockResolvedValue([
        { server: sampleServer, serverStatus: "running", platformStatus: "running" },
        { server: bareServer, serverStatus: "running", platformStatus: "n/a" },
      ]);

      await statusCommand(undefined, { all: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Platform");
    });
  });

  // ---- --autostart tests ----

  describe("--autostart mode", () => {
    it("should trigger restartCoolify when coolify is down but server is running", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
      mockedCoreStatus.getCloudServerStatus.mockResolvedValue("running");
      mockedSsh.checkSshAvailable.mockReturnValue(true);

      // First axios call: Coolify health check fails
      mockedAxios.get.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      // Core restartCoolify: succeeds and Coolify is now running
      mockedCoreStatus.restartCoolify.mockResolvedValue({ success: true, nowRunning: true });

      await statusCommand("1.2.3.4", { autostart: true });

      expect(mockedCoreStatus.restartCoolify).toHaveBeenCalledWith(sampleServer);
    });

    it("should not trigger restart when coolify is already running", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
      mockedCoreStatus.getCloudServerStatus.mockResolvedValue("running");

      mockedAxios.get.mockResolvedValueOnce({ status: 200 });

      await statusCommand("1.2.3.4", { autostart: true });

      expect(mockedCoreStatus.restartCoolify).not.toHaveBeenCalled();
    });

    it("should not trigger restart when SSH is not available", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
      mockedCoreStatus.getCloudServerStatus.mockResolvedValue("running");
      mockedSsh.checkSshAvailable.mockReturnValue(false);

      mockedAxios.get.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      await statusCommand("1.2.3.4", { autostart: true });

      expect(mockedCoreStatus.restartCoolify).not.toHaveBeenCalled();
      const warnCalls = (mockedLogger.logger.warning as jest.Mock).mock.calls.map((c) => c[0]).join("\n");
      expect(warnCalls).toContain("SSH not available");
    });

    it("should not trigger restart when server itself is not running", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
      mockedCoreStatus.getCloudServerStatus.mockResolvedValue("off");

      mockedAxios.get.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      await statusCommand("1.2.3.4", { autostart: true });

      expect(mockedCoreStatus.restartCoolify).not.toHaveBeenCalled();
    });

    it("should handle restartCoolify failure gracefully", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
      mockedCoreStatus.getCloudServerStatus.mockResolvedValue("running");
      mockedSsh.checkSshAvailable.mockReturnValue(true);

      mockedAxios.get.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      mockedCoreStatus.restartCoolify.mockResolvedValue({
        success: false,
        nowRunning: false,
        error: "compose error",
      });

      await statusCommand("1.2.3.4", { autostart: true });

      expect(mockedCoreStatus.restartCoolify).toHaveBeenCalled();
      const errorCalls = (mockedLogger.logger.error as jest.Mock).mock.calls.map((c) => c[0]).join("\n");
      expect(errorCalls).toContain("compose error");
    });

    it("should handle restartCoolify exception via SSH hint", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
      mockedCoreStatus.getCloudServerStatus.mockResolvedValue("running");
      mockedSsh.checkSshAvailable.mockReturnValue(true);

      mockedAxios.get.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      mockedCoreStatus.restartCoolify.mockResolvedValue({
        success: false,
        nowRunning: false,
        error: "Connection refused",
        hint: "SSH connection refused. Check the IP address and SSH access.",
      });

      await statusCommand("1.2.3.4", { autostart: true });

      const errorCalls = (mockedLogger.logger.error as jest.Mock).mock.calls.map((c) => c[0]).join("\n");
      const infoCalls = (mockedLogger.logger.info as jest.Mock).mock.calls.map((c) => c[0]).join("\n");
      expect(errorCalls).toContain("Connection refused");
      expect(infoCalls).toContain("SSH connection refused");
    });

    it("should warn when coolify still not running after restart", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
      mockedCoreStatus.getCloudServerStatus.mockResolvedValue("running");
      mockedSsh.checkSshAvailable.mockReturnValue(true);

      mockedAxios.get.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      mockedCoreStatus.restartCoolify.mockResolvedValue({ success: true, nowRunning: false });

      await statusCommand("1.2.3.4", { autostart: true });

      const warnCalls = (mockedLogger.logger.warning as jest.Mock).mock.calls.map((c) => c[0]).join("\n");
      expect(warnCalls).toContain("still be starting");
    });
  });
});
