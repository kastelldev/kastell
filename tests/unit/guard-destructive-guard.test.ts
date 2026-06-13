/**
 * Tests for the P142 destructive-guard matrix in src/commands/guard.ts
 * (coverage gap: lines 33-34, 51-52, 71-76). Sibling file
 * tests/unit/guard-command.test.ts covers basic destructive guard (--force,
 * decline, prompt) but not the full P142 Task 9 matrix including:
 *   - non-TTY mode + no --force → refuses + markCommandFailed
 *   - TTY + --force + mutation reach
 */
import * as inquirerPrompts from "@inquirer/prompts";
import * as ssh from "../../src/utils/ssh";
import * as guard from "../../src/core/guard";
import * as serverSelect from "../../src/utils/serverSelect";
import * as exitCode from "../../src/utils/exitCode";
import * as promptsModule from "../../src/utils/prompts";
import { guardCommand } from "../../src/commands/guard";

jest.mock("../../src/utils/ssh");
jest.mock("../../src/core/guard");
jest.mock("../../src/utils/serverSelect");
jest.mock("../../src/utils/exitCode");
jest.mock("../../src/utils/prompts", () => ({
  confirmOrCancel: jest.fn(),
}));
jest.mock("@inquirer/prompts", () => ({
  confirm: jest.fn(),
}));

const mockedSsh = ssh as jest.Mocked<typeof ssh>;
const mockedGuard = guard as jest.Mocked<typeof guard>;
const mockedServerSelect = serverSelect as jest.Mocked<typeof serverSelect>;
const mockedExitCode = exitCode as jest.Mocked<typeof exitCode>;
const mockedConfirmOrCancel = promptsModule.confirmOrCancel as jest.MockedFunction<
  typeof promptsModule.confirmOrCancel
>;
const mockedInquirerConfirm = inquirerPrompts.confirm as jest.MockedFunction<
  typeof inquirerPrompts.confirm
>;

const sampleServer = {
  id: "srv-1",
  name: "prod-server",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-02-23T10:00:00Z",
  mode: "coolify" as const,
};

describe("guardCommand — P142 destructive-guard matrix (start + stop)", () => {
  const originalIsTTY = process.stdin.isTTY;

  function setIsTTY(value: boolean | undefined): void {
    Object.defineProperty(process.stdin, "isTTY", { value, configurable: true, writable: true });
  }

  beforeEach(() => {
    // mockReset (not clearAllMocks) per LESSONS — fully clears mockReturnValue queues
    mockedSsh.checkSshAvailable.mockReset();
    mockedServerSelect.resolveServer.mockReset();
    mockedGuard.startGuard.mockReset();
    mockedGuard.stopGuard.mockReset();
    mockedGuard.guardStatus.mockReset();
    mockedConfirmOrCancel.mockReset();
    mockedInquirerConfirm.mockReset();
    mockedExitCode.markCommandFailed.mockReset();
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    process.exitCode = 0;
  });

  afterEach(() => {
    setIsTTY(originalIsTTY);
    process.exitCode = 0;
  });

  it("start: TTY mode without --force prompts the user via confirmOrCancel", async () => {
    setIsTTY(true);
    mockedConfirmOrCancel.mockResolvedValue({ confirmed: true, source: "prompt" });
    mockedGuard.startGuard.mockResolvedValue({ success: true });

    await guardCommand("start", "prod-server", {});

    expect(mockedConfirmOrCancel).toHaveBeenCalledWith(
      expect.stringContaining("Install guard daemon"),
      false,
      expect.stringContaining("--force"),
    );
    expect(mockedGuard.startGuard).toHaveBeenCalled();
  });

  it("start: non-TTY mode without --force refuses and calls markCommandFailed", async () => {
    setIsTTY(false);
    mockedConfirmOrCancel.mockResolvedValue({
      confirmed: false,
      reason: "non-tty",
      message: "Use --force to install guard in non-interactive mode.",
    });

    await guardCommand("start", "prod-server", {});

    expect(mockedGuard.startGuard).not.toHaveBeenCalled();
    expect(mockedExitCode.markCommandFailed).toHaveBeenCalledTimes(1);
  });

  it("start: non-TTY mode with --force reaches startGuard", async () => {
    setIsTTY(false);
    mockedGuard.startGuard.mockResolvedValue({ success: true });

    await guardCommand("start", "prod-server", { force: true });

    expect(mockedConfirmOrCancel).not.toHaveBeenCalled();
    expect(mockedGuard.startGuard).toHaveBeenCalledWith("1.2.3.4", "prod-server");
  });

  it("stop: TTY mode without --force prompts the user via confirmOrCancel", async () => {
    setIsTTY(true);
    mockedConfirmOrCancel.mockResolvedValue({ confirmed: true, source: "prompt" });
    mockedGuard.stopGuard.mockResolvedValue({ success: true });

    await guardCommand("stop", "prod-server", {});

    expect(mockedConfirmOrCancel).toHaveBeenCalledWith(
      expect.stringContaining("Remove guard daemon"),
      false,
      expect.stringContaining("--force"),
    );
    expect(mockedGuard.stopGuard).toHaveBeenCalled();
  });

  it("stop: non-TTY mode without --force refuses and calls markCommandFailed", async () => {
    setIsTTY(false);
    mockedConfirmOrCancel.mockResolvedValue({
      confirmed: false,
      reason: "non-tty",
      message: "Use --force to remove guard in non-interactive mode.",
    });

    await guardCommand("stop", "prod-server", {});

    expect(mockedGuard.stopGuard).not.toHaveBeenCalled();
    expect(mockedExitCode.markCommandFailed).toHaveBeenCalledTimes(1);
  });

  it("stop: non-TTY mode with --force reaches stopGuard", async () => {
    setIsTTY(false);
    mockedGuard.stopGuard.mockResolvedValue({ success: true });

    await guardCommand("stop", "prod-server", { force: true });

    expect(mockedConfirmOrCancel).not.toHaveBeenCalled();
    expect(mockedGuard.stopGuard).toHaveBeenCalledWith("1.2.3.4", "prod-server");
  });
});
