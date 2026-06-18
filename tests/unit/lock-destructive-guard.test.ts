/**
 * Tests for P142 destructive-guard refactor in src/commands/lock.ts
 * (coverage gap: lines 60, 93-106). Sibling file tests/unit/lock-command.test.ts
 * tests the main flow (dry-run, force, success, fail) but does NOT cover
 * the P142 Task 9 destructive-guard matrix that wraps the applyLock call.
 *
 * Also covers line 60: --dryRun without --production → error hint.
 */
import * as inquirerPrompts from "@inquirer/prompts";
import * as ssh from "../../src/utils/ssh";
import * as lockCore from "../../src/core/lock";
import type { LockResult } from "../../src/core/lock";
import * as serverSelect from "../../src/utils/serverSelect";
import * as exitCode from "../../src/utils/exitCode";
import * as promptsModule from "../../src/utils/prompts";
import { lockCommand } from "../../src/commands/lock";
import { logger } from "../../src/utils/logger";

jest.mock("../../src/utils/ssh");
jest.mock("../../src/core/lock");
jest.mock("../../src/utils/serverSelect");
jest.mock("../../src/utils/exitCode");
jest.mock("../../src/utils/prompts", () => {
  const actual = jest.requireActual("../../src/utils/prompts");
  return {
    ...actual,
    confirmOrCancel: jest.fn(),
  };
});
jest.mock("@inquirer/prompts", () => ({
  confirm: jest.fn(),
}));

const mockedSsh = ssh as jest.Mocked<typeof ssh>;
const mockedLock = lockCore as jest.Mocked<typeof lockCore>;
const mockedServerSelect = serverSelect as jest.Mocked<typeof serverSelect>;
const mockedExitCode = exitCode as jest.Mocked<typeof exitCode>;
const mockedConfirmOrCancel = promptsModule.confirmOrCancel as jest.MockedFunction<
  typeof promptsModule.confirmOrCancel
>;
const mockedInquirerConfirm = inquirerPrompts.confirm as jest.MockedFunction<
  typeof inquirerPrompts.confirm
>;

const infoSpy = jest.spyOn(logger, "info").mockImplementation(() => {});
const errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {});
const successSpy = jest.spyOn(logger, "success").mockImplementation(() => {});

const sampleServer = {
  id: "srv-1",
  name: "prod-server",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-02-23T10:00:00Z",
  mode: "coolify" as const,
  platform: "coolify" as const,
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
};

describe("lockCommand — P142 destructive-guard matrix", () => {
  const originalIsTTY = process.stdin.isTTY;
  const originalExitCode = process.exitCode;

  function setIsTTY(value: boolean | undefined): void {
    Object.defineProperty(process.stdin, "isTTY", { value, configurable: true, writable: true });
  }

  beforeEach(() => {
    // P139 LESSONS: mockReset (not clearAllMocks) to fully clear mockReturnValue queues
    mockedSsh.checkSshAvailable.mockReset();
    mockedServerSelect.resolveServer.mockReset();
    mockedLock.applyLock.mockReset();
    mockedConfirmOrCancel.mockReset();
    mockedInquirerConfirm.mockReset();
    infoSpy.mockReset();
    errorSpy.mockReset();
    successSpy.mockReset();
    infoSpy.mockImplementation(() => {});
    errorSpy.mockImplementation(() => {});
    successSpy.mockImplementation(() => {});

    // Defaults
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedLock.applyLock.mockResolvedValue(successResult);
    process.exitCode = 0;
  });

  afterEach(() => {
    setIsTTY(originalIsTTY);
    process.exitCode = originalExitCode;
  });

  afterAll(() => {
    infoSpy.mockRestore();
    errorSpy.mockRestore();
    successSpy.mockRestore();
  });

  it("--dryRun without --production logs the dry-run hint error", async () => {
    await lockCommand("prod-server", { dryRun: true });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("--dry-run --production"),
    );
    expect(mockedLock.applyLock).not.toHaveBeenCalled();
  });

  it("TTY mode without --force prompts the user via confirmOrCancel", async () => {
    setIsTTY(true);
    mockedConfirmOrCancel.mockResolvedValue({ confirmed: true, source: "prompt" });

    await lockCommand("prod-server", { production: true });

    expect(mockedConfirmOrCancel).toHaveBeenCalledWith(
      expect.stringContaining("apply production hardening"),
      false,
      "Use --force to apply hardening in non-interactive mode.",
    );
    expect(mockedLock.applyLock).toHaveBeenCalled();
  });

  it("TTY mode with --force bypasses confirmOrCancel entirely", async () => {
    setIsTTY(true);
    // --force makes the whole !options.force branch skip — no confirmOrCancel

    await lockCommand("prod-server", { production: true, force: true });

    expect(mockedConfirmOrCancel).not.toHaveBeenCalled();
    expect(mockedLock.applyLock).toHaveBeenCalled();
  });

  it("non-TTY mode without --force refuses, calls markCommandFailed, and does NOT apply", async () => {
    setIsTTY(false);
    mockedConfirmOrCancel.mockResolvedValue({
      confirmed: false,
      reason: "non-tty",
      message: "Use --force to apply hardening in non-interactive mode.",
    });

    await lockCommand("prod-server", { production: true });

    expect(mockedLock.applyLock).not.toHaveBeenCalled();
    expect(mockedExitCode.markCommandFailed).toHaveBeenCalledTimes(1);
  });

  it("non-TTY mode with --force reaches the applyLock mutation", async () => {
    setIsTTY(false);
    // --force bypasses confirmOrCancel

    await lockCommand("prod-server", { production: true, force: true });

    expect(mockedConfirmOrCancel).not.toHaveBeenCalled();
    expect(mockedLock.applyLock).toHaveBeenCalledWith(
      sampleServer.ip,
      sampleServer.name,
      sampleServer.platform,
      expect.objectContaining({ production: true, force: true }),
    );
  });
});
