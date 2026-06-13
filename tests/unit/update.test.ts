import inquirer from "inquirer";
import * as config from "../../src/utils/config";
import * as sshUtils from "../../src/utils/ssh";
import * as serverSelect from "../../src/utils/serverSelect";
import * as adapterFactory from "../../src/adapters/factory";
import * as loggerUtils from "../../src/utils/logger";
import * as modeGuard from "../../src/utils/modeGuard";
import * as coreUpdate from "../../src/core/update";
import * as inquirerPrompts from "@inquirer/prompts";
import { updateCommand } from "../../src/commands/update";
import { createConsoleSpy } from "../helpers/consoleSpy.js";

jest.mock("../../src/utils/config");
jest.mock("../../src/utils/ssh");
jest.mock("../../src/utils/serverSelect");
jest.mock("../../src/utils/logger");
jest.mock("../../src/core/update");
jest.mock("../../src/adapters/factory");
jest.mock("../../src/utils/modeGuard");
jest.mock("@inquirer/prompts", () => ({
  confirm: jest.fn(),
}));

const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;
const mockedConfig = config as jest.Mocked<typeof config>;
const mockedSsh = sshUtils as jest.Mocked<typeof sshUtils>;
const mockedServerSelect = serverSelect as jest.Mocked<typeof serverSelect>;
const mockedLogger = loggerUtils as jest.Mocked<typeof loggerUtils>;
const mockedModeGuard = modeGuard as jest.Mocked<typeof modeGuard>;
const mockedCoreUpdate = coreUpdate as jest.Mocked<typeof coreUpdate>;
const mockedAdapterFactory = adapterFactory as jest.Mocked<typeof adapterFactory>;
const mockedInquirerConfirm = inquirerPrompts.confirm as jest.MockedFunction<
  typeof inquirerPrompts.confirm
>;

const sampleServer = {
  id: "123",
  name: "coolify-test",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00.000Z",
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

const mockSpinner = {
  start: jest.fn().mockReturnThis(),
  succeed: jest.fn().mockReturnThis(),
  fail: jest.fn().mockReturnThis(),
  stop: jest.fn().mockReturnThis(),
  warn: jest.fn().mockReturnThis(),
};

const mockAdapter = {
  name: "coolify",
  getCloudInit: jest.fn(() => ""),
  healthCheck: jest.fn(async () => ({ status: "running" as const })),
  createBackup: jest.fn(async () => ({ success: true })),
  getStatus: jest.fn(async () => ({ platformVersion: "1.0", status: "running" as const })),
  update: jest.fn(async () => ({ success: true })),
};

describe("updateCommand", () => {
  const spy = createConsoleSpy();
  const originalIsTTY = process.stdin.isTTY;
  const originalExitCode = process.exitCode;

  function setIsTTY(value: boolean | undefined): void {
    Object.defineProperty(process.stdin, "isTTY", { value, configurable: true, writable: true });
  }

  beforeEach(() => {
    // P142: deterministic reset to prevent cross-suite process.exitCode pollution
    process.exitCode = 0;
    spy.setup();
    jest.resetAllMocks();
    // Re-apply inquirer prompts mock after resetAllMocks
    mockedInquirerConfirm.mockReset();
    mockedInquirerConfirm.mockResolvedValue(true);
    setIsTTY(true);
    process.exitCode = undefined;
    // Default: SSH available
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    // Default: spinner mock
    mockedLogger.createSpinner.mockReturnValue(mockSpinner as unknown as ReturnType<typeof mockedLogger.createSpinner>);
    // Logger methods mock
    (mockedLogger.logger as jest.Mocked<typeof mockedLogger.logger>) = {
      info: jest.fn(),
      success: jest.fn(),
      error: jest.fn(),
      warning: jest.fn(),
      title: jest.fn(),
      step: jest.fn(),
    };
    // Default: updateServer succeeds
    mockedCoreUpdate.updateServer.mockResolvedValue({ success: true, output: "Updated" });
    // Default: adapter returns coolify mock
    mockedAdapterFactory.getAdapter.mockReturnValue(mockAdapter as unknown as ReturnType<typeof mockedAdapterFactory.getAdapter>);
    mockedAdapterFactory.resolvePlatform.mockReturnValue("coolify");
    // Default: modeGuard — server is managed (not bare)
    mockedModeGuard.isBareServer.mockReturnValue(false);
    mockedModeGuard.requireManagedMode.mockReturnValue(null);
  });

  afterEach(() => {
    spy.restore();
    setIsTTY(originalIsTTY);
    process.exitCode = originalExitCode;
  });

  it("should show error when SSH not available", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(false);
    await updateCommand();
    expect(mockedLogger.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("SSH client not found"),
    );
  });

  it("should return when no server found", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(undefined);
    await updateCommand("nonexistent");
    expect(mockedServerSelect.resolveServer).toHaveBeenCalledWith(
      "nonexistent",
      "Select a server to update:",
    );
  });

  it("should cancel when user declines", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirerConfirm.mockResolvedValueOnce(false);

    await updateCommand("1.2.3.4");
    expect(mockedLogger.logger.info).toHaveBeenCalledWith("Operation cancelled.");
    expect(mockedCoreUpdate.updateServer).not.toHaveBeenCalled();
  });

  it("should call updateServer with correct args and show success", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
    mockedCoreUpdate.updateServer.mockResolvedValue({ success: true, output: "Coolify updated" });

    await updateCommand("1.2.3.4");

    expect(mockedCoreUpdate.updateServer).toHaveBeenCalledWith(
      sampleServer,
      "test-token",
      "coolify",
    );
    expect(mockedLogger.logger.success).toHaveBeenCalledWith(
      expect.stringContaining("update completed successfully"),
    );
  });

  it("should show error when updateServer returns failure", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
    mockedCoreUpdate.updateServer.mockResolvedValue({ success: false, error: "SSH connection refused" });

    await updateCommand("1.2.3.4");
    expect(mockedLogger.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Update failed"),
    );
  });

  it("should skip confirmation and proceed when --force is set", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
    mockedCoreUpdate.updateServer.mockResolvedValue({ success: true, output: "Done" });

    await updateCommand("1.2.3.4", { force: true });

    expect(mockedInquirerConfirm).not.toHaveBeenCalled();
    expect(mockedCoreUpdate.updateServer).toHaveBeenCalled();
    expect(mockedLogger.logger.success).toHaveBeenCalledWith(
      expect.stringContaining("update completed"),
    );
  });

  it("should show error when no platform detected for server", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedAdapterFactory.resolvePlatform.mockReturnValue(undefined);

    await updateCommand("1.2.3.4");

    expect(mockedLogger.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("No platform detected"),
    );
    expect(mockedCoreUpdate.updateServer).not.toHaveBeenCalled();
  });

  it("should skip API token prompt for manually added servers", async () => {
    const manualServer = { ...sampleServer, id: "manual-123" };
    mockedServerSelect.resolveServer.mockResolvedValue(manualServer);
    mockedCoreUpdate.updateServer.mockResolvedValue({ success: true });

    await updateCommand("1.2.3.4");

    expect(mockedServerSelect.promptApiToken).not.toHaveBeenCalled();
    expect(mockedCoreUpdate.updateServer).toHaveBeenCalledWith(
      manualServer,
      "",
      "coolify",
    );
  });

  it("should show hint when updateServer returns failure with hint", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
    mockedCoreUpdate.updateServer.mockResolvedValue({
      success: false,
      error: "SSH timeout",
      hint: "Check server network",
    });

    await updateCommand("1.2.3.4");

    expect(mockedLogger.logger.info).toHaveBeenCalledWith("Check server network");
  });

  it("should show output when updateServer returns output", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
    mockedCoreUpdate.updateServer.mockResolvedValue({ success: true, output: "Update log output" });

    await updateCommand("1.2.3.4");

    expect(spy.consoleSpy).toHaveBeenCalledWith("Update log output");
  });

  it("should provide SSH install hints when SSH not available", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(false);
    await updateCommand();
    expect(mockedLogger.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Windows"),
    );
  });

  // ---- DX-01: --dry-run support ----

  it("should show dry-run preview without calling core updateServer", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);

    await updateCommand("1.2.3.4", { dryRun: true });

    expect(mockedLogger.logger.title).toHaveBeenCalledWith("Dry Run: Update Server");
    expect(mockedLogger.logger.info).toHaveBeenCalledWith("No changes applied (dry run).");
    expect(mockedCoreUpdate.updateServer).not.toHaveBeenCalled();
    expect(mockedInquirerConfirm).not.toHaveBeenCalled();
  });

  it("should show platform and action in dry-run output", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);

    await updateCommand("1.2.3.4", { dryRun: true });

    expect(mockedLogger.logger.step).toHaveBeenCalledWith(
      expect.stringContaining("Run update script via SSH"),
    );
  });

  it("should show dry-run per server in --all mode", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);

    await updateCommand(undefined, { all: true, dryRun: true });

    expect(mockedLogger.logger.title).toHaveBeenCalledWith("Dry Run: Update Server");
    expect(mockedLogger.logger.info).toHaveBeenCalledWith("No changes applied (dry run).");
    expect(mockedCoreUpdate.updateServer).not.toHaveBeenCalled();
    expect(mockedInquirerConfirm).not.toHaveBeenCalled();
  });

  // ---- Bare mode tests ----

  describe("bare server guard", () => {
    const bareServer = {
      ...sampleServer,
      id: "bare-123",
      name: "bare-test",
      ip: "9.9.9.9",
      mode: "bare" as const,
    };

    it("should print error and return when server is bare", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(bareServer);
      mockedModeGuard.requireManagedMode.mockReturnValue(
        'The "update" command is not available for bare servers.',
      );

      await updateCommand("9.9.9.9");

      expect(mockedLogger.logger.error).toHaveBeenCalled();
      expect(mockedCoreUpdate.updateServer).not.toHaveBeenCalled();
      expect(mockedInquirerConfirm).not.toHaveBeenCalled();
    });

    it("should still update coolify server when passed", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
        mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
      mockedCoreUpdate.updateServer.mockResolvedValue({ success: true });

      await updateCommand("1.2.3.4");
      expect(mockedLogger.logger.success).toHaveBeenCalledWith(
        expect.stringContaining("update completed successfully"),
      );
    });
  });

  // ---- Dokploy server tests ----

  describe("dokploy server", () => {
    const dokplayAdapter = {
      name: "dokploy",
      getCloudInit: jest.fn(() => ""),
      healthCheck: jest.fn(async () => ({ status: "running" as const })),
      createBackup: jest.fn(async () => ({ success: true })),
      getStatus: jest.fn(async () => ({ platformVersion: "1.0", status: "running" as const })),
      update: jest.fn(async () => ({ success: true })),
    };

    const dokployServer = {
      ...sampleServer,
      id: "dok-123",
      name: "dokploy-test",
      ip: "10.0.0.1",
    };

    it("should update Dokploy server and call updateServer", async () => {
      mockedAdapterFactory.getAdapter.mockReturnValue(dokplayAdapter as unknown as ReturnType<typeof mockedAdapterFactory.getAdapter>);
      mockedAdapterFactory.resolvePlatform.mockReturnValue("dokploy");
      mockedServerSelect.resolveServer.mockResolvedValue(dokployServer);
        mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
      mockedCoreUpdate.updateServer.mockResolvedValue({ success: true });

      await updateCommand("10.0.0.1");
      expect(mockedCoreUpdate.updateServer).toHaveBeenCalledWith(
        dokployServer,
        "test-token",
        "dokploy",
      );
      expect(mockedLogger.logger.success).toHaveBeenCalledWith(
        expect.stringContaining("update completed"),
      );
    });
  });

  // ---- --all mode tests ----

  describe("--all mode", () => {
    it("should show error when SSH not available", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(false);

      await updateCommand(undefined, { all: true });

      expect(mockedLogger.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("SSH client not found"),
      );
    });

    it("should show info when no servers exist", async () => {
      mockedConfig.getServers.mockReturnValue([]);

      await updateCommand(undefined, { all: true });

      expect(mockedLogger.logger.info).toHaveBeenCalledWith(
        expect.stringContaining("No servers found"),
      );
    });

    it("should cancel when user declines confirmation", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedInquirerConfirm.mockResolvedValueOnce(false);

      await updateCommand(undefined, { all: true });

      expect(mockedLogger.logger.info).toHaveBeenCalledWith("Operation cancelled.");
      expect(mockedServerSelect.collectProviderTokens).not.toHaveBeenCalled();
    });

    it("should update all servers sequentially on confirm", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer, sampleServer2]);
        mockedServerSelect.collectProviderTokens.mockResolvedValue(
        new Map([
          ["hetzner", "h-token"],
          ["digitalocean", "do-token"],
        ]),
      );
      mockedCoreUpdate.updateServer.mockResolvedValue({ success: true, output: "Updated" });

      await updateCommand(undefined, { all: true });

      expect(mockedCoreUpdate.updateServer).toHaveBeenCalledTimes(2);
      expect(mockedLogger.logger.success).toHaveBeenCalledWith(
        expect.stringContaining("All 2 server(s) updated successfully"),
      );
    });

    it("should report mixed results when some servers fail", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer, sampleServer2]);
        mockedServerSelect.collectProviderTokens.mockResolvedValue(
        new Map([
          ["hetzner", "h-token"],
          ["digitalocean", "do-token"],
        ]),
      );

      mockedCoreUpdate.updateServer
        .mockResolvedValueOnce({ success: true, output: "OK" })
        .mockResolvedValueOnce({ success: false, error: "SSH failed" });

      await updateCommand(undefined, { all: true });

      expect(mockedLogger.logger.warning).toHaveBeenCalledWith(
        expect.stringContaining("1 succeeded"),
      );
    });

    it("should call updateServer even for non-running server result", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
        mockedServerSelect.collectProviderTokens.mockResolvedValue(new Map([["hetzner", "h-token"]]));
      mockedCoreUpdate.updateServer.mockResolvedValue({
        success: false,
        error: "Server is not running (status: off)",
      });

      await updateCommand(undefined, { all: true });

      expect(mockedCoreUpdate.updateServer).toHaveBeenCalledWith(
        expect.objectContaining({ id: "123" }),
        "h-token",
        "coolify",
      );
    });

    it("should handle server error gracefully in --all", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
        mockedServerSelect.collectProviderTokens.mockResolvedValue(new Map([["hetzner", "h-token"]]));
      mockedCoreUpdate.updateServer.mockResolvedValue({
        success: false,
        error: "API down",
      });

      await updateCommand(undefined, { all: true });

      expect(mockedCoreUpdate.updateServer).toHaveBeenCalled();
    });

    it("should skip --force confirmation in --all mode", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedServerSelect.collectProviderTokens.mockResolvedValue(new Map([["hetzner", "h-token"]]));
      mockedCoreUpdate.updateServer.mockResolvedValue({ success: true, output: "OK" });

      await updateCommand(undefined, { all: true, force: true });

      expect(mockedInquirerConfirm).not.toHaveBeenCalled();
      expect(mockedCoreUpdate.updateServer).toHaveBeenCalled();
    });

    it("should skip servers with no platform detected in --all mode", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
        mockedServerSelect.collectProviderTokens.mockResolvedValue(new Map([["hetzner", "h-token"]]));
      mockedAdapterFactory.resolvePlatform.mockReturnValue(undefined);

      await updateCommand(undefined, { all: true });

      expect(mockedLogger.logger.warning).toHaveBeenCalledWith(
        expect.stringContaining("no platform detected"),
      );
      expect(mockedCoreUpdate.updateServer).not.toHaveBeenCalled();
    });

    it("should show hint when updateServer fails with hint in --all mode", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
        mockedServerSelect.collectProviderTokens.mockResolvedValue(new Map([["hetzner", "h-token"]]));
      mockedCoreUpdate.updateServer.mockResolvedValue({
        success: false,
        error: "SSH down",
        hint: "Check firewall",
        displayName: "Coolify",
      });

      await updateCommand(undefined, { all: true });

      expect(mockedLogger.logger.info).toHaveBeenCalledWith("Check firewall");
    });

    it("should skip bare servers and warn in dry-run --all mode", async () => {
      const bareServer = {
        ...sampleServer,
        id: "bare-123",
        name: "bare-test",
        ip: "9.9.9.9",
        mode: "bare" as const,
      };
      mockedConfig.getServers.mockReturnValue([bareServer]);
      mockedModeGuard.isBareServer.mockReturnValue(true);

      await updateCommand(undefined, { all: true, dryRun: true });

      expect(mockedLogger.logger.warning).toHaveBeenCalledWith(
        expect.stringContaining("bare"),
      );
    });

    it("should skip servers with no platform in dry-run --all mode", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedModeGuard.isBareServer.mockReturnValue(false);
      mockedAdapterFactory.resolvePlatform.mockReturnValue(undefined);

      await updateCommand(undefined, { all: true, dryRun: true });

      expect(mockedLogger.logger.warning).toHaveBeenCalledWith(
        expect.stringContaining("no platform detected"),
      );
    });

    it("should skip bare servers and warn in --all mode", async () => {
      const bareServer = {
        ...sampleServer,
        id: "bare-123",
        name: "bare-test",
        ip: "9.9.9.9",
        mode: "bare" as const,
      };
      mockedConfig.getServers.mockReturnValue([sampleServer, bareServer]);
        mockedServerSelect.collectProviderTokens.mockResolvedValue(
        new Map([["hetzner", "h-token"]]),
      );
      // Return false for sampleServer, true for bareServer
      mockedModeGuard.isBareServer
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);
      mockedCoreUpdate.updateServer.mockResolvedValue({ success: true, output: "Updated" });

      await updateCommand(undefined, { all: true });

      // Only 1 call (bare server skipped)
      expect(mockedCoreUpdate.updateServer).toHaveBeenCalledTimes(1);
      expect(mockedLogger.logger.warning).toHaveBeenCalledWith(
        expect.stringContaining("bare"),
      );
    });

    it("should set process.exitCode to 1 when one or more --all targets are bare (live)", async () => {
      const bareServer = {
        ...sampleServer,
        id: "bare-123",
        name: "bare-test",
        ip: "9.9.9.9",
        mode: "bare" as const,
      };
      mockedConfig.getServers.mockReturnValue([bareServer]);
      mockedModeGuard.isBareServer.mockReturnValue(true);
  
      await updateCommand(undefined, { all: true });

      expect(process.exitCode).toBe(1);
    });

    it("should set process.exitCode to 1 when one or more --all targets lack a platform (live)", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedModeGuard.isBareServer.mockReturnValue(false);
      mockedAdapterFactory.resolvePlatform.mockReturnValue(undefined);

      await updateCommand(undefined, { all: true });

      expect(process.exitCode).toBe(1);
    });

    it("should set process.exitCode to 1 when a managed --all target updateServer fails", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedModeGuard.isBareServer.mockReturnValue(false);
        mockedServerSelect.collectProviderTokens.mockResolvedValue(
        new Map([["hetzner", "h-token"]]),
      );
      mockedCoreUpdate.updateServer.mockResolvedValue({ success: false, error: "boom" });

      await updateCommand(undefined, { all: true });

      expect(process.exitCode).toBe(1);
    });

    it("should leave process.exitCode unset when --all targets are fully successful", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedModeGuard.isBareServer.mockReturnValue(false);
        mockedServerSelect.collectProviderTokens.mockResolvedValue(
        new Map([["hetzner", "h-token"]]),
      );
      mockedCoreUpdate.updateServer.mockResolvedValue({ success: true, output: "OK" });

      await updateCommand(undefined, { all: true });

      expect(process.exitCode).toBeUndefined();
    });

    it("should set process.exitCode to 1 when --all --dryRun has a bare target (dry-run does not weaken policy)", async () => {
      const bareServer = {
        ...sampleServer,
        id: "bare-123",
        name: "bare-test",
        ip: "9.9.9.9",
        mode: "bare" as const,
      };
      mockedConfig.getServers.mockReturnValue([bareServer]);
      mockedModeGuard.isBareServer.mockReturnValue(true);

      await updateCommand(undefined, { all: true, dryRun: true });

      expect(process.exitCode).toBe(1);
    });

    it("should set process.exitCode to 1 when --all --dryRun lacks a platform for a target", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedModeGuard.isBareServer.mockReturnValue(false);
      mockedAdapterFactory.resolvePlatform.mockReturnValue(undefined);

      await updateCommand(undefined, { all: true, dryRun: true });

      expect(process.exitCode).toBe(1);
    });

    it("should leave process.exitCode unset when no servers are configured (informational)", async () => {
      mockedConfig.getServers.mockReturnValue([]);

      await updateCommand(undefined, { all: true });

      expect(process.exitCode).toBeUndefined();
    });

    it("should leave process.exitCode unset when user cancels --all confirmation", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedInquirerConfirm.mockResolvedValueOnce(false);

      await updateCommand(undefined, { all: true });

      expect(process.exitCode).toBeUndefined();
    });
  });

  // ---- Exit-code policy: single-server failures ----

  it("should set process.exitCode to 1 when single bare server is rejected (mode guard)", async () => {
    const bareServer = {
      ...sampleServer,
      id: "bare-123",
      name: "bare-test",
      ip: "9.9.9.9",
      mode: "bare" as const,
    };
    mockedServerSelect.resolveServer.mockResolvedValue(bareServer);
    mockedModeGuard.requireManagedMode.mockReturnValue(
      'The "update" command is not available for bare servers.',
    );

    await updateCommand("9.9.9.9");

    expect(process.exitCode).toBe(1);
  });

  it("should set process.exitCode to 1 when single server has no platform detected", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedAdapterFactory.resolvePlatform.mockReturnValue(undefined);

    await updateCommand("1.2.3.4");

    expect(process.exitCode).toBe(1);
  });

  it("should set process.exitCode to 1 when single server updateServer fails", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
    mockedCoreUpdate.updateServer.mockResolvedValue({
      success: false,
      error: "SSH connection refused",
    });

    await updateCommand("1.2.3.4");

    expect(process.exitCode).toBe(1);
  });

  it("should set process.exitCode to 1 when single server update throws", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
    mockedCoreUpdate.updateServer.mockRejectedValue(new Error("catastrophic"));

    await updateCommand("1.2.3.4");

    expect(process.exitCode).toBe(1);
  });

  it("should leave process.exitCode unset when single server update succeeds", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
    mockedCoreUpdate.updateServer.mockResolvedValue({ success: true, output: "OK" });

    await updateCommand("1.2.3.4");

    expect(process.exitCode).toBeUndefined();
  });

  it("should leave process.exitCode unset when user cancels single server confirmation", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirerConfirm.mockResolvedValueOnce(false);

    await updateCommand("1.2.3.4");

    expect(process.exitCode).toBeUndefined();
  });
});
