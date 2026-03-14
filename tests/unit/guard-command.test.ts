import * as sshUtils from "../../src/utils/ssh";
import * as serverSelectModule from "../../src/utils/serverSelect";
import * as guardModule from "../../src/core/guard";
import * as loggerModule from "../../src/utils/logger";
import { guardCommand } from "../../src/commands/guard";
import type { GuardStartResult, GuardStopResult, GuardStatusResult } from "../../src/core/guard";
import { dispatchGuardBreaches } from "../../src/core/guard";
import type { ServerRecord } from "../../src/types/index";

jest.mock("../../src/utils/ssh");
jest.mock("../../src/utils/serverSelect");
jest.mock("../../src/core/guard");
jest.mock("../../src/core/notify");
jest.mock("../../src/utils/logger");
jest.mock("inquirer");

import inquirer from "inquirer";

const mockedSsh = sshUtils as jest.Mocked<typeof sshUtils>;
const mockedServerSelect = serverSelectModule as jest.Mocked<typeof serverSelectModule>;
const mockedGuard = guardModule as jest.Mocked<typeof guardModule>;
const mockedLogger = loggerModule as jest.Mocked<typeof loggerModule>;
const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;

const sampleServer: ServerRecord = {
  id: "srv001",
  name: "prod-server",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00.000Z",
  mode: "bare",
};

const startSuccess: GuardStartResult = { success: true };
const startFailure: GuardStartResult = { success: false, error: "SSH connection failed" };

const stopSuccess: GuardStopResult = { success: true };
const stopFailure: GuardStopResult = { success: false, error: "Failed to remove cron" };

const statusActive: GuardStatusResult = {
  success: true,
  isActive: true,
  lastRunAt: "2026-03-14T09:00:00Z",
  installedAt: "2026-03-01T12:00:00Z",
  breaches: ["Disk usage 85% exceeds 80% threshold", "RAM usage 92% exceeds 90% threshold"],
  logTail: "[kastell-guard] 2026-03-14T09:00:00Z BREACH: Disk usage 85%",
};

const statusActiveNoBreach: GuardStatusResult = {
  success: true,
  isActive: true,
  lastRunAt: "2026-03-14T09:00:00Z",
  installedAt: "2026-03-01T12:00:00Z",
  breaches: [],
  logTail: "[kastell-guard] 2026-03-14T09:00:00Z OK: Disk 42%",
};

const statusInactive: GuardStatusResult = {
  success: true,
  isActive: false,
  breaches: [],
  logTail: "",
};

const statusFailure: GuardStatusResult = {
  success: false,
  isActive: false,
  breaches: [],
  logTail: "",
  error: "SSH connection refused",
};

const mockSpinner = {
  start: jest.fn().mockReturnThis(),
  succeed: jest.fn().mockReturnThis(),
  fail: jest.fn().mockReturnThis(),
  stop: jest.fn().mockReturnThis(),
};

beforeEach(() => {
  jest.resetAllMocks();

  mockedSsh.checkSshAvailable.mockReturnValue(true);
  mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
  mockedGuard.startGuard.mockResolvedValue(startSuccess);
  mockedGuard.stopGuard.mockResolvedValue(stopSuccess);
  mockedGuard.guardStatus.mockResolvedValue(statusActive);
  (dispatchGuardBreaches as jest.Mock).mockResolvedValue(undefined);

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

  // Default: user confirms
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mockedInquirer.prompt as any) = jest.fn().mockResolvedValue({ confirm: true });
});

// ─── guard start ──────────────────────────────────────────────────────────────

describe("guardCommand start", () => {
  it("logs error and does not call startGuard when SSH not available", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(false);
    await guardCommand("start", "prod-server", {});
    expect(mockedLogger.logger.error).toHaveBeenCalledWith(expect.stringContaining("SSH"));
    expect(mockedGuard.startGuard).not.toHaveBeenCalled();
  });

  it("does not call startGuard when server not found", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(undefined);
    await guardCommand("start", "unknown", { force: true });
    expect(mockedGuard.startGuard).not.toHaveBeenCalled();
  });

  it("calls startGuard with server ip and name on success path", async () => {
    await guardCommand("start", "prod-server", { force: true });
    expect(mockedGuard.startGuard).toHaveBeenCalledWith(sampleServer.ip, sampleServer.name);
  });

  it("uses spinner when installing guard daemon", async () => {
    await guardCommand("start", "prod-server", { force: true });
    expect(mockedLogger.createSpinner).toHaveBeenCalled();
    expect(mockSpinner.start).toHaveBeenCalled();
  });

  it("logs success message on successful start", async () => {
    await guardCommand("start", "prod-server", { force: true });
    expect(mockedLogger.logger.success).toHaveBeenCalledWith(
      expect.stringContaining("Guard daemon installed"),
    );
  });

  it("logs error when startGuard returns success=false", async () => {
    mockedGuard.startGuard.mockResolvedValue(startFailure);
    await guardCommand("start", "prod-server", { force: true });
    expect(mockedLogger.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("SSH connection failed"),
    );
  });

  it("skips confirmation prompt when --force is set", async () => {
    await guardCommand("start", "prod-server", { force: true });
    expect(mockedInquirer.prompt).not.toHaveBeenCalled();
  });

  it("shows confirmation prompt when --force is not set", async () => {
    await guardCommand("start", "prod-server", {});
    expect(mockedInquirer.prompt).toHaveBeenCalled();
  });

  it("does not call startGuard when user declines confirmation", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockedInquirer.prompt as any).mockResolvedValue({ confirm: false });
    await guardCommand("start", "prod-server", {});
    expect(mockedGuard.startGuard).not.toHaveBeenCalled();
  });
});

// ─── guard stop ───────────────────────────────────────────────────────────────

describe("guardCommand stop", () => {
  it("does not call stopGuard when server not found", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(undefined);
    await guardCommand("stop", "unknown", { force: true });
    expect(mockedGuard.stopGuard).not.toHaveBeenCalled();
  });

  it("calls stopGuard with server ip and name on success path", async () => {
    await guardCommand("stop", "prod-server", { force: true });
    expect(mockedGuard.stopGuard).toHaveBeenCalledWith(sampleServer.ip, sampleServer.name);
  });

  it("uses spinner when removing guard daemon", async () => {
    await guardCommand("stop", "prod-server", { force: true });
    expect(mockedLogger.createSpinner).toHaveBeenCalled();
    expect(mockSpinner.start).toHaveBeenCalled();
  });

  it("logs success message on successful stop", async () => {
    await guardCommand("stop", "prod-server", { force: true });
    expect(mockedLogger.logger.success).toHaveBeenCalledWith(
      expect.stringContaining("Guard daemon removed"),
    );
  });

  it("logs error when stopGuard returns success=false", async () => {
    mockedGuard.stopGuard.mockResolvedValue(stopFailure);
    await guardCommand("stop", "prod-server", { force: true });
    expect(mockedLogger.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to remove cron"),
    );
  });

  it("skips confirmation prompt when --force is set", async () => {
    await guardCommand("stop", "prod-server", { force: true });
    expect(mockedInquirer.prompt).not.toHaveBeenCalled();
  });

  it("shows confirmation prompt when --force is not set", async () => {
    await guardCommand("stop", "prod-server", {});
    expect(mockedInquirer.prompt).toHaveBeenCalled();
  });
});

// ─── guard status ─────────────────────────────────────────────────────────────

describe("guardCommand status", () => {
  it("does not call guardStatus when server not found", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(undefined);
    await guardCommand("status", "unknown", {});
    expect(mockedGuard.guardStatus).not.toHaveBeenCalled();
  });

  it("does NOT check checkSshAvailable — skips pre-flight entirely", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(false);
    await guardCommand("status", "prod-server", {});
    // guardStatus should still be called — no SSH pre-flight check
    expect(mockedGuard.guardStatus).toHaveBeenCalled();
    // no SSH error logged
    expect(mockedLogger.logger.error).not.toHaveBeenCalledWith(expect.stringContaining("SSH"));
  });

  it("calls guardStatus with server ip and name", async () => {
    await guardCommand("status", "prod-server", {});
    expect(mockedGuard.guardStatus).toHaveBeenCalledWith(sampleServer.ip, sampleServer.name);
  });

  it("displays active status with breaches", async () => {
    mockedGuard.guardStatus.mockResolvedValue(statusActive);
    await guardCommand("status", "prod-server", {});
    const allOutput = [
      ...(mockedLogger.logger.info as jest.Mock).mock.calls.map((c: string[]) => c[0]),
      ...(mockedLogger.logger.success as jest.Mock).mock.calls.map((c: string[]) => c[0]),
      ...(mockedLogger.logger.error as jest.Mock).mock.calls.map((c: string[]) => c[0]),
    ].join("\n");
    expect(allOutput).toMatch(/ACTIVE/i);
    expect(allOutput).toMatch(/Disk usage 85%/);
    expect(allOutput).toMatch(/RAM usage 92%/);
  });

  it("displays active status with no breaches", async () => {
    mockedGuard.guardStatus.mockResolvedValue(statusActiveNoBreach);
    await guardCommand("status", "prod-server", {});
    const allOutput = [
      ...(mockedLogger.logger.info as jest.Mock).mock.calls.map((c: string[]) => c[0]),
      ...(mockedLogger.logger.success as jest.Mock).mock.calls.map((c: string[]) => c[0]),
    ].join("\n");
    expect(allOutput).toMatch(/ACTIVE/i);
  });

  it("displays inactive status when guard is not running", async () => {
    mockedGuard.guardStatus.mockResolvedValue(statusInactive);
    await guardCommand("status", "prod-server", {});
    const allOutput = [
      ...(mockedLogger.logger.info as jest.Mock).mock.calls.map((c: string[]) => c[0]),
      ...(mockedLogger.logger.error as jest.Mock).mock.calls.map((c: string[]) => c[0]),
    ].join("\n");
    expect(allOutput).toMatch(/INACTIVE|not active/i);
  });

  it("logs error when guardStatus returns success=false", async () => {
    mockedGuard.guardStatus.mockResolvedValue(statusFailure);
    await guardCommand("status", "prod-server", {});
    expect(mockedLogger.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("SSH connection refused"),
    );
  });

  it("calls dispatchGuardBreaches with server name and breaches when status has breaches", async () => {
    mockedGuard.guardStatus.mockResolvedValue(statusActive);
    await guardCommand("status", "prod-server", {});
    expect(dispatchGuardBreaches as jest.Mock).toHaveBeenCalledWith(
      sampleServer.name,
      statusActive.breaches,
    );
  });

  it("does not call dispatchGuardBreaches when no breaches", async () => {
    mockedGuard.guardStatus.mockResolvedValue(statusActiveNoBreach);
    await guardCommand("status", "prod-server", {});
    expect(dispatchGuardBreaches as jest.Mock).not.toHaveBeenCalled();
  });

  it("does not call dispatchGuardBreaches when status failed", async () => {
    mockedGuard.guardStatus.mockResolvedValue(statusFailure);
    await guardCommand("status", "prod-server", {});
    expect(dispatchGuardBreaches as jest.Mock).not.toHaveBeenCalled();
  });
});

// ─── guard dispatch not called for start/stop ─────────────────────────────────

describe("guardCommand dispatch isolation", () => {
  it("does not call dispatchGuardBreaches on start action", async () => {
    await guardCommand("start", "prod-server", { force: true });
    expect(dispatchGuardBreaches as jest.Mock).not.toHaveBeenCalled();
  });

  it("does not call dispatchGuardBreaches on stop action", async () => {
    await guardCommand("stop", "prod-server", { force: true });
    expect(dispatchGuardBreaches as jest.Mock).not.toHaveBeenCalled();
  });
});
