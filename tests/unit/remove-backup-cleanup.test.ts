/**
 * Tests for the backup-cleanup section of src/commands/remove.ts (P142
 * coverage gap: lines 51-73, 68.91% lines baseline).
 *
 * Sibling file `tests/unit/remove.test.ts` covers the main remove flow,
 * dry-run, and the P142 Task 9 destructive guard matrix. This file focuses
 * on the post-remove backup cleanup prompt:
 *   - backups present + --force → skip with log
 *   - backups present + user accepts → cleanupServerBackups called, success log
 *   - backups present + user accepts + cleanup returns removed=false → warning log
 *   - backups present + user declines → "Backups kept" log
 *   - backups present empty list → no prompt, no cleanup
 *
 * Note: logger.warning writes to stderr (console.error) per LESSONS logger
 * routing, so we spy on the logger methods directly rather than console.log.
 */
import inquirer from "inquirer";
import * as inquirerPrompts from "@inquirer/prompts";
import * as config from "../../src/utils/config";
import * as serverSelect from "../../src/utils/serverSelect";
import * as backup from "../../src/core/backup";
import { removeCommand } from "../../src/commands/remove";
import { logger } from "../../src/utils/logger";

jest.mock("../../src/utils/config");
jest.mock("../../src/utils/serverSelect");
jest.mock("../../src/core/backup");
jest.mock("inquirer");
jest.mock("@inquirer/prompts", () => ({
  confirm: jest.fn(),
}));

const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;
const mockedInquirerConfirm = inquirerPrompts.confirm as jest.MockedFunction<
  typeof inquirerPrompts.confirm
>;
const mockedConfig = config as jest.Mocked<typeof config>;
const mockedServerSelect = serverSelect as jest.Mocked<typeof serverSelect>;
const mockedBackup = backup as jest.Mocked<typeof backup>;

const infoSpy = jest.spyOn(logger, "info").mockImplementation(() => {});
const successSpy = jest.spyOn(logger, "success").mockImplementation(() => {});
const warningSpy = jest.spyOn(logger, "warning").mockImplementation(() => {});

const mockServer = {
  id: "123",
  name: "coolify-test",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-02-23T10:00:00Z",
  mode: "coolify" as const,
};

describe("removeCommand — backup cleanup", () => {
  const originalIsTTY = process.stdin.isTTY;
  const originalExitCode = process.exitCode;

  function setIsTTY(value: boolean | undefined): void {
    Object.defineProperty(process.stdin, "isTTY", { value, configurable: true, writable: true });
  }

  beforeEach(() => {
    // P139 LESSONS: mockReset clears call history AND mockReturnValue/Once queues
    mockedInquirerConfirm.mockReset();
    mockedInquirer.prompt.mockReset();
    mockedConfig.removeServer.mockReset();
    mockedServerSelect.resolveServer.mockReset();
    mockedBackup.listBackups.mockReset();
    mockedBackup.cleanupServerBackups.mockReset();
    infoSpy.mockReset();
    successSpy.mockReset();
    warningSpy.mockReset();
    infoSpy.mockImplementation(() => {});
    successSpy.mockImplementation(() => {});
    warningSpy.mockImplementation(() => {});
    // Default: confirmOrCancel returns true (accept) — destructive guard passes
    mockedInquirerConfirm.mockResolvedValue(true);
    process.exitCode = 0;
    setIsTTY(true);
  });

  afterEach(() => {
    setIsTTY(originalIsTTY);
    process.exitCode = originalExitCode;
  });

  afterAll(() => {
    infoSpy.mockRestore();
    successSpy.mockRestore();
    warningSpy.mockRestore();
  });

  it("skips backup cleanup prompt when --force is set and logs the skip", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(mockServer);
    mockedConfig.removeServer.mockResolvedValue(true);
    mockedBackup.listBackups.mockReturnValue(["backup-1", "backup-2"]);

    await removeCommand("coolify-test", { force: true });

    expect(mockedInquirer.prompt).not.toHaveBeenCalled();
    expect(mockedBackup.cleanupServerBackups).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("Skipping backup cleanup"),
    );
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("2 backup(s) kept"),
    );
  });

  it("calls cleanupServerBackups and logs success when user accepts the prompt", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(mockServer);
    mockedConfig.removeServer.mockResolvedValue(true);
    mockedBackup.listBackups.mockReturnValue(["backup-1"]);
    mockedInquirer.prompt.mockResolvedValueOnce({ cleanBackups: true });
    mockedBackup.cleanupServerBackups.mockReturnValue({ removed: true, path: "/tmp/x" });

    await removeCommand("coolify-test");

    expect(mockedInquirer.prompt).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: "cleanBackups", type: "confirm" }),
      ]),
    );
    expect(mockedBackup.cleanupServerBackups).toHaveBeenCalledWith("coolify-test");
    expect(successSpy).toHaveBeenCalledWith("Backups removed.");
    expect(warningSpy).not.toHaveBeenCalled();
  });

  it("logs warning when user accepts but cleanup returns removed=false", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(mockServer);
    mockedConfig.removeServer.mockResolvedValue(true);
    mockedBackup.listBackups.mockReturnValue(["backup-1"]);
    mockedInquirer.prompt.mockResolvedValueOnce({ cleanBackups: true });
    mockedBackup.cleanupServerBackups.mockReturnValue({ removed: false, path: "/tmp/x" });

    await removeCommand("coolify-test");

    expect(mockedBackup.cleanupServerBackups).toHaveBeenCalledWith("coolify-test");
    expect(warningSpy).toHaveBeenCalledWith("Failed to remove backups.");
    // The only success call should be the "removed from local config" one,
    // not the "Backups removed." one
    expect(
      successSpy.mock.calls.some((c) => String(c[0]).includes("Backups removed")),
    ).toBe(false);
  });

  it("logs 'Backups kept' hint when user declines the cleanup prompt", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(mockServer);
    mockedConfig.removeServer.mockResolvedValue(true);
    mockedBackup.listBackups.mockReturnValue(["backup-1"]);
    mockedInquirer.prompt.mockResolvedValueOnce({ cleanBackups: false });

    await removeCommand("coolify-test");

    expect(mockedBackup.cleanupServerBackups).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("Backups kept"),
    );
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("backup cleanup"),
    );
  });

  it("does not call inquirer.prompt or cleanup when listBackups is empty", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(mockServer);
    mockedConfig.removeServer.mockResolvedValue(true);
    mockedBackup.listBackups.mockReturnValue([]);

    await removeCommand("coolify-test");

    expect(mockedInquirer.prompt).not.toHaveBeenCalled();
    expect(mockedBackup.cleanupServerBackups).not.toHaveBeenCalled();
  });
});
