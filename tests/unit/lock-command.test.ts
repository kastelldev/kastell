import * as sshUtils from "../../src/utils/ssh";
import * as serverSelectModule from "../../src/utils/serverSelect";
import * as lockModule from "../../src/core/lock/index.js";
import * as loggerModule from "../../src/utils/logger";
import { lockCommand } from "../../src/commands/lock";
import type { LockResult } from "../../src/core/lock/index.js";
import type { ServerRecord } from "../../src/types/index";

jest.mock("../../src/utils/ssh");
jest.mock("../../src/utils/serverSelect");
jest.mock("../../src/core/lock/index.js");
jest.mock("../../src/utils/logger");

const mockedSsh = sshUtils as jest.Mocked<typeof sshUtils>;
const mockedServerSelect = serverSelectModule as jest.Mocked<typeof serverSelectModule>;
const mockedLock = lockModule as jest.Mocked<typeof lockModule>;
const mockedLogger = loggerModule as jest.Mocked<typeof loggerModule>;

const sampleServer: ServerRecord = {
  id: "abc123",
  name: "prod-server",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00.000Z",
  mode: "bare",
};

const successResult: LockResult = {
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
    dockerHardening: true,
    auditd: true,
    logRetention: true,
    aide: true,
    cronAccess: true,
    sshFineTuning: true,
    loginDefs: true,
    faillock: true,
    sudoHardening: true,
  },
  scoreBefore: 45,
  scoreAfter: 72,
};

const failedResult: LockResult = {
  success: false,
  steps: {
    sshHardening: false,
    fail2ban: true,
    banners: true,
    accountLock: true,
    sshCipher: true,
    ufw: true,
    cloudMeta: true,
    dns: false,
    sysctl: true,
    unattendedUpgrades: true,
    aptValidation: true,
    resourceLimits: true,
    serviceDisable: true,
    backupPermissions: true,
    pwquality: true,
    dockerHardening: true,
    auditd: true,
    logRetention: true,
    aide: true,
    cronAccess: true,
    sshFineTuning: true,
    loginDefs: true,
    faillock: true,
    sudoHardening: true,
  },
  stepErrors: {
    sshHardening: "connection refused",
    dns: "rollback: connectivity test failed",
  },
  error: "SSH hardening failed",
  scoreBefore: 45,
  scoreAfter: 50,
};

// Spinner mock
const mockSpinner = {
  start: jest.fn().mockReturnThis(),
  succeed: jest.fn().mockReturnThis(),
  fail: jest.fn().mockReturnThis(),
  stop: jest.fn().mockReturnThis(),
};

beforeEach(() => {
  jest.resetAllMocks();

  // Default: SSH available, server found, lock succeeds
  mockedSsh.checkSshAvailable.mockReturnValue(true);
  mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
  mockedLock.applyLock.mockResolvedValue(successResult);

  // Logger mock
  (mockedLogger.logger as jest.Mocked<typeof mockedLogger.logger>) = {
    info: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
    title: jest.fn(),
    step: jest.fn(),
  };
  mockedLogger.createSpinner.mockReturnValue(mockSpinner as unknown as ReturnType<typeof mockedLogger.createSpinner>);
});

describe("lockCommand", () => {
  describe("production flag guard", () => {
    it("logs error when --production flag is not set", async () => {
      await lockCommand("prod-server", {});
      expect(mockedLogger.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("--production"),
      );
    });

    it("does not call applyLock when --production flag is not set", async () => {
      await lockCommand("prod-server", {});
      expect(mockedLock.applyLock).not.toHaveBeenCalled();
    });
  });

  describe("SSH availability check", () => {
    it("logs error when SSH client is not available", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(false);
      await lockCommand("prod-server", { production: true });
      expect(mockedLogger.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("SSH"),
      );
    });

    it("does not call applyLock when SSH is not available", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(false);
      await lockCommand("prod-server", { production: true });
      expect(mockedLock.applyLock).not.toHaveBeenCalled();
    });
  });

  describe("server resolution", () => {
    it("does not call applyLock when server is not found", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(undefined);
      await lockCommand("unknown", { production: true, force: true });
      expect(mockedLock.applyLock).not.toHaveBeenCalled();
    });
  });

  describe("dry-run mode", () => {
    it("does not call applyLock in dry-run mode", async () => {
      await lockCommand("prod-server", { production: true, dryRun: true });
      expect(mockedLock.applyLock).not.toHaveBeenCalled();
    });

    it("does not use spinner when --dry-run is set", async () => {
      await lockCommand("prod-server", { production: true, dryRun: true });
      expect(mockedLogger.createSpinner).not.toHaveBeenCalled();
    });

    it("displays preview with markers in dry-run mode", async () => {
      await lockCommand("prod-server", { production: true, dryRun: true });
      const infoCalls = (mockedLogger.logger.info as jest.Mock).mock.calls
        .map((c: string[]) => c[0])
        .join(" ");
      expect(infoCalls).toContain("○");
      expect(infoCalls).toContain("SSH & Auth");
      expect(infoCalls).toContain("Monitoring");
    });
  });

  describe("force flag", () => {
    it("calls applyLock directly without prompt when --force is set", async () => {
      await lockCommand("prod-server", { production: true, force: true });
      expect(mockedLock.applyLock).toHaveBeenCalledWith(
        sampleServer.ip,
        sampleServer.name,
        sampleServer.platform,
        expect.objectContaining({ production: true, force: true }),
      );
    });
  });

  describe("successful lock", () => {
    it("uses spinner when applying hardening", async () => {
      await lockCommand("prod-server", { production: true, force: true });
      expect(mockedLogger.createSpinner).toHaveBeenCalled();
      expect(mockSpinner.start).toHaveBeenCalled();
    });

    it("displays per-step results for all 17 steps", async () => {
      await lockCommand("prod-server", { production: true, force: true });
      const allCalls = [
        ...(mockedLogger.logger.info as jest.Mock).mock.calls.map((c: string[]) => c[0]),
        ...(mockedLogger.logger.success as jest.Mock).mock.calls.map((c: string[]) => c[0]),
        ...(mockedLogger.logger.error as jest.Mock).mock.calls.map((c: string[]) => c[0]),
      ].join(" ").toLowerCase();

      expect(allCalls).toContain("ssh");
      expect(allCalls).toContain("fail2ban");
      expect(allCalls).toContain("banner");
      expect(allCalls).toContain("account");
      expect(allCalls).toContain("cipher");
      expect(allCalls).toContain("firewall");
      expect(allCalls).toContain("metadata");
      expect(allCalls).toContain("dns");
      expect(allCalls).toContain("sysctl");
      expect(allCalls).toContain("upgrade");
      expect(allCalls).toContain("apt");
      expect(allCalls).toContain("limit");
      expect(allCalls).toContain("service");
      expect(allCalls).toContain("backup");
      expect(allCalls).toContain("auditd");
      expect(allCalls).toContain("log");
      expect(allCalls).toContain("aide");
    });

    it("displays 4 group headers in output", async () => {
      await lockCommand("prod-server", { production: true, force: true });
      const infoCalls = (mockedLogger.logger.info as jest.Mock).mock.calls
        .map((c: string[]) => c[0])
        .join(" ");
      expect(infoCalls).toContain("SSH & Auth");
      expect(infoCalls).toContain("Firewall & Network");
      expect(infoCalls).toContain("System");
      expect(infoCalls).toContain("Monitoring");
    });

    it("displays step count (no audit score delta)", async () => {
      await lockCommand("prod-server", { production: true, force: true });
      const logCalls = [
        ...(mockedLogger.logger.info as jest.Mock).mock.calls.map((c: string[]) => c[0]),
        ...(mockedLogger.logger.success as jest.Mock).mock.calls.map((c: string[]) => c[0]),
      ].join(" ");
      expect(logCalls).toContain("steps completed");
      expect(logCalls).not.toContain("Audit score:");
    });

    it("logs success message on successful lock", async () => {
      await lockCommand("prod-server", { production: true, force: true });
      expect(mockedLogger.logger.success).toHaveBeenCalledWith(
        expect.stringContaining("hard"),
      );
    });
  });

  describe("failed lock", () => {
    it("logs error message when applyLock returns success=false", async () => {
      mockedLock.applyLock.mockResolvedValue(failedResult);
      await lockCommand("prod-server", { production: true, force: true });
      expect(mockedLogger.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("SSH hardening failed"),
      );
    });

    it("displays error reason for failed steps", async () => {
      mockedLock.applyLock.mockResolvedValue(failedResult);
      await lockCommand("prod-server", { production: true, force: true });
      const errorCalls = (mockedLogger.logger.error as jest.Mock).mock.calls
        .map((c: string[]) => c[0])
        .join(" ");
      expect(errorCalls).toContain("✗");
      expect(errorCalls).toContain("connectivity test failed");
    });
  });
});
