/**
 * Command→Core→Adapter chain tests.
 *
 * Purpose: Verify that CLI commands correctly invoke the right core functions
 * with the right arguments. Each test mocks at the core boundary so no SSH
 * or provider API calls occur.
 */

// Mock modules BEFORE imports (jest hoists these)
jest.mock("../../src/utils/serverSelect.js");
jest.mock("../../src/utils/config.js");
jest.mock("../../src/utils/ssh.js");
jest.mock("../../src/core/audit/index.js");
jest.mock("../../src/core/lock.js");
jest.mock("../../src/core/manage.js");
jest.mock("../../src/core/maintain.js");
jest.mock("../../src/core/status.js");
jest.mock("../../src/adapters/factory.js");
jest.mock("../../src/utils/logger.js");
jest.mock("inquirer");

import * as serverSelect from "../../src/utils/serverSelect.js";
import * as configUtils from "../../src/utils/config.js";
import * as sshUtils from "../../src/utils/ssh.js";
import * as coreAudit from "../../src/core/audit/index.js";
import * as coreLock from "../../src/core/lock.js";
import * as coreManage from "../../src/core/manage.js";
import * as coreMaintain from "../../src/core/maintain.js";
import * as coreStatus from "../../src/core/status.js";
import * as adapterFactory from "../../src/adapters/factory.js";
import { createMockAdapter } from "../helpers/mockAdapter.js";
import { auditCommand } from "../../src/commands/audit.js";
import { lockCommand } from "../../src/commands/lock.js";
import { addCommand } from "../../src/commands/add.js";
import { statusCommand } from "../../src/commands/status.js";
import { maintainCommand } from "../../src/commands/maintain.js";

const mockedServerSelect = serverSelect as jest.Mocked<typeof serverSelect>;
const mockedConfig = configUtils as jest.Mocked<typeof configUtils>;
const mockedSsh = sshUtils as jest.Mocked<typeof sshUtils>;
const mockedCoreAudit = coreAudit as jest.Mocked<typeof coreAudit>;
const mockedCoreLock = coreLock as jest.Mocked<typeof coreLock>;
const mockedCoreManage = coreManage as jest.Mocked<typeof coreManage>;
const mockedCoreMaintain = coreMaintain as jest.Mocked<typeof coreMaintain>;
const mockedCoreStatus = coreStatus as jest.Mocked<typeof coreStatus>;
const mockedAdapterFactory = adapterFactory as jest.Mocked<typeof adapterFactory>;

import inquirer from "inquirer";
const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;

const sampleServer = {
  id: "htz-001",
  name: "my-server",
  provider: "hetzner" as const,
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-03-01T00:00:00Z",
  mode: "coolify" as const,
  platform: "coolify" as const,
};

const bareServer = {
  id: "htz-002",
  name: "bare-server",
  provider: "hetzner" as const,
  ip: "5.6.7.8",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-03-01T00:00:00Z",
  mode: "bare" as const,
  platform: "bare" as const,
};

describe("Command→Core Chain Tests", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.spyOn(console, "error").mockImplementation();
    jest.spyOn(process, "exit").mockImplementation(() => undefined as never);

    // Logger mock — return no-op object
    const loggerMock = {
      info: jest.fn(),
      success: jest.fn(),
      error: jest.fn(),
      warning: jest.fn(),
      title: jest.fn(),
      step: jest.fn(),
    };
    const createSpinnerMock = jest.fn(() => ({
      start: jest.fn().mockReturnThis(),
      succeed: jest.fn().mockReturnThis(),
      fail: jest.fn().mockReturnThis(),
      stop: jest.fn().mockReturnThis(),
      warn: jest.fn().mockReturnThis(),
    }));

    const loggerModule = require("../../src/utils/logger.js");
    Object.assign(loggerModule, { logger: loggerMock, createSpinner: createSpinnerMock });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  // ─── 1. audit command chain ────────────────────────────────────────────────

  describe("audit command chain", () => {
    it("should call runAudit with ip, name, and platform from resolved server", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedCoreAudit.runAudit.mockResolvedValue({
        success: true,
        data: {
          serverIp: "1.2.3.4",
          serverName: "my-server",
          platform: "coolify",
          overallScore: 72,
          auditVersion: "1.0",
          timestamp: new Date().toISOString(),
          categories: [],
          quickWins: [],
          skippedCategories: [],
        },
      });

      // Mock history so trend doesn't blow up
      const { saveAuditHistory, loadAuditHistory, detectTrend } = require("../../src/core/audit/history.js");
      jest.mock("../../src/core/audit/history.js", () => ({
        saveAuditHistory: jest.fn().mockResolvedValue(undefined),
        loadAuditHistory: jest.fn().mockReturnValue([]),
        detectTrend: jest.fn().mockReturnValue("first audit"),
        computeTrend: jest.fn().mockReturnValue({ trend: "first audit", scores: [] }),
      }), { virtual: false });

      await auditCommand("my-server", {});

      expect(mockedCoreAudit.runAudit).toHaveBeenCalledWith("1.2.3.4", "my-server", "coolify");
    });

    it("should not call runAudit when resolveServer returns undefined", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(undefined);

      await auditCommand("nonexistent", {});

      expect(mockedCoreAudit.runAudit).not.toHaveBeenCalled();
    });
  });

  // ─── 2. lock command chain ─────────────────────────────────────────────────

  describe("lock command chain", () => {
    it("should call applyLock with ip, name, platform, and options from resolved server", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedCoreLock.applyLock.mockResolvedValue({
        success: true,
        steps: {
          sshHardening: true,
          fail2ban: true,
          banners: true,
          accountLock: true,
          sshCipher: true,
          ufw: true,
          cloudMeta: true,
          dns: true,
          sysctl: true,
          unattendedUpgrades: true,
          aptValidation: true,
          resourceLimits: true,
          serviceDisable: true,
          backupPermissions: true,
          pwquality: true,
          auditd: true,
          logRetention: true,
          aide: true,
          cronAccess: true,
          dockerHardening: true,
          sshFineTuning: true,
          loginDefs: true,
          faillock: true,
          sudoHardening: true,
        },
      });

      await lockCommand("my-server", { production: true, force: true });

      expect(mockedCoreLock.applyLock).toHaveBeenCalledWith(
        "1.2.3.4",
        "my-server",
        "coolify",
        expect.objectContaining({ production: true, force: true }),
      );
    });

    it("should not call applyLock when --production flag is missing", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);

      await lockCommand("my-server", {});

      expect(mockedCoreLock.applyLock).not.toHaveBeenCalled();
    });

    it("should not call applyLock when SSH is unavailable", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(false);

      await lockCommand("my-server", { production: true });

      expect(mockedCoreLock.applyLock).not.toHaveBeenCalled();
    });
  });

  // ─── 3. add command chain ──────────────────────────────────────────────────

  describe("add command chain", () => {
    it("should call addServerRecord with correct config when options are provided", async () => {
      mockedCoreManage.addServerRecord.mockResolvedValue({
        success: true,
        server: {
          id: "manual-001",
          name: "new-server",
          provider: "hetzner",
          ip: "10.0.0.1",
          region: "nbg1",
          size: "cax11",
          createdAt: new Date().toISOString(),
          mode: "coolify",
        },
        platformStatus: "skipped",
      });

      // Mock promptApiToken to return a token
      mockedServerSelect.promptApiToken.mockResolvedValue("test-token");

      await addCommand({
        provider: "hetzner",
        ip: "10.0.0.1",
        name: "new-server",
        skipVerify: true,
        mode: "coolify",
      });

      expect(mockedCoreManage.addServerRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "hetzner",
          ip: "10.0.0.1",
          name: "new-server",
          skipVerify: true,
        }),
      );
    });
  });

  // ─── 4. status command chain ───────────────────────────────────────────────

  describe("status command chain", () => {
    it("should call getCloudServerStatus with resolved server and apiToken for platform servers", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      // server.id doesn't start with "manual-" so it prompts for token
      mockedServerSelect.promptApiToken.mockResolvedValue("api-token-123");
      mockedCoreStatus.getCloudServerStatus.mockResolvedValue("running");

      // Mock adapter for platform health check
      const mockAdapter = createMockAdapter({ name: "coolify" });
      mockedAdapterFactory.resolvePlatform.mockReturnValue("coolify");
      mockedAdapterFactory.getAdapter.mockReturnValue(mockAdapter);

      await statusCommand("my-server");

      expect(mockedCoreStatus.getCloudServerStatus).toHaveBeenCalledWith(
        sampleServer,
        "api-token-123",
      );
    });

    it("should call adapter.healthCheck for platform servers", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedServerSelect.promptApiToken.mockResolvedValue("api-token-123");
      mockedCoreStatus.getCloudServerStatus.mockResolvedValue("running");

      const mockAdapter = createMockAdapter({ name: "coolify" });
      mockedAdapterFactory.resolvePlatform.mockReturnValue("coolify");
      mockedAdapterFactory.getAdapter.mockReturnValue(mockAdapter);

      await statusCommand("my-server");

      expect(mockAdapter.healthCheck).toHaveBeenCalledWith("1.2.3.4", undefined);
    });
  });

  // ─── 5. maintain command chain ─────────────────────────────────────────────

  describe("maintain command chain", () => {
    it("should call maintainServer with server record and apiToken", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedServerSelect.promptApiToken.mockResolvedValue("api-token-123");

      // requireManagedMode returns null for managed servers (no error)
      const modeGuard = require("../../src/utils/modeGuard.js");
      jest.mock("../../src/utils/modeGuard.js", () => ({
        requireManagedMode: jest.fn().mockReturnValue(null),
        isBareServer: jest.fn().mockReturnValue(false),
        getServerModeLabel: jest.fn().mockReturnValue("Coolify"),
      }), { virtual: false });

      mockedCoreMaintain.maintainServer.mockResolvedValue({
        server: "my-server",
        ip: "1.2.3.4",
        provider: "hetzner",
        success: true,
        steps: [],
      });

      await maintainCommand("my-server", { force: true });

      // maintainCommand passes only { skipReboot } to maintainServer — force is consumed by the command
      expect(mockedCoreMaintain.maintainServer).toHaveBeenCalledWith(
        sampleServer,
        "api-token-123",
        expect.objectContaining({ skipReboot: undefined }),
      );
    });

    it("should not call maintainServer when SSH is unavailable", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(false);

      await maintainCommand("my-server", {});

      expect(mockedCoreMaintain.maintainServer).not.toHaveBeenCalled();
    });
  });
});
