import * as sshUtils from "../../src/utils/ssh";
import * as serverSelectModule from "../../src/utils/serverSelect";
import * as lockModule from "../../src/core/lock";
import * as loggerModule from "../../src/utils/logger";
import { lockCommand } from "../../src/commands/lock";
import type { LockResult } from "../../src/core/lock";
import type { ServerRecord } from "../../src/types/index";

jest.mock("../../src/utils/ssh");
jest.mock("../../src/utils/serverSelect");
jest.mock("../../src/core/lock");
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
    ufw: true,
    sysctl: true,
    unattendedUpgrades: true,
  },
  scoreBefore: 45,
  scoreAfter: 72,
};

const failedResult: LockResult = {
  success: false,
  steps: {
    sshHardening: false,
    fail2ban: true,
    ufw: true,
    sysctl: true,
    unattendedUpgrades: true,
  },
  error: "SSH hardening failed",
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockedLogger.createSpinner.mockReturnValue(mockSpinner as any);
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
    it("calls applyLock with dryRun=true when --dry-run is set", async () => {
      await lockCommand("prod-server", { production: true, dryRun: true });
      expect(mockedLock.applyLock).toHaveBeenCalledWith(
        sampleServer.ip,
        sampleServer.name,
        sampleServer.platform,
        expect.objectContaining({ dryRun: true }),
      );
    });

    it("does not use spinner when --dry-run is set", async () => {
      await lockCommand("prod-server", { production: true, dryRun: true });
      expect(mockedLogger.createSpinner).not.toHaveBeenCalled();
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

    it("displays per-step results for all 5 steps", async () => {
      await lockCommand("prod-server", { production: true, force: true });
      // 5 steps should be logged: sshHardening, fail2ban, ufw, sysctl, unattendedUpgrades
      const logCalls = (mockedLogger.logger.info as jest.Mock).mock.calls.map((c: string[]) => c[0]);
      const stepCalls = (mockedLogger.logger.success as jest.Mock).mock.calls.map((c: string[]) => c[0]);
      const allOutputs = [...logCalls, ...stepCalls].join(" ");
      expect(allOutputs).toMatch(/ssh/i);
      expect(allOutputs).toMatch(/fail2ban/i);
      expect(allOutputs).toMatch(/ufw|firewall/i);
      expect(allOutputs).toMatch(/sysctl/i);
      expect(allOutputs).toMatch(/unattended|upgrade/i);
    });

    it("displays audit score delta when both scores are present", async () => {
      await lockCommand("prod-server", { production: true, force: true });
      const logCalls = [
        ...(mockedLogger.logger.info as jest.Mock).mock.calls.map((c: string[]) => c[0]),
        ...(mockedLogger.logger.success as jest.Mock).mock.calls.map((c: string[]) => c[0]),
      ].join(" ");
      expect(logCalls).toContain("45");
      expect(logCalls).toContain("72");
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
  });
});
