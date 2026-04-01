/**
 * Tests for BUG-02: restore --force auto-selects latest backup without prompting.
 *
 * Verifies that:
 * 1. --force without --backup auto-selects latest backup (no inquirer prompt)
 * 2. --force with --backup uses specified backup (existing behavior unchanged)
 * 3. Without --force, inquirer prompt is called for backup selection (existing behavior unchanged)
 */

jest.mock("fs", () => ({
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
}));

jest.mock("os", () => ({
  homedir: () => "/home/test",
}));

jest.mock("../../src/utils/config");
jest.mock("../../src/utils/ssh");
jest.mock("../../src/core/backup", () => ({
  ...jest.requireActual("../../src/core/backup"),
  listBackups: jest.fn(),
  getBackupDir: jest.fn().mockReturnValue("/home/test/.kastell/backups/my-server"),
  loadManifest: jest.fn(),
  restoreBareBackup: jest.fn(),
}));
jest.mock("../../src/adapters/factory", () => ({
  getAdapter: jest.fn(),
  resolvePlatform: jest.fn().mockReturnValue("coolify"),
}));

import { existsSync, readFileSync } from "fs";
import inquirer from "inquirer";
import * as config from "../../src/utils/config";
import * as sshUtils from "../../src/utils/ssh";
import * as coreBackup from "../../src/core/backup";
import { restoreCommand } from "../../src/commands/restore";

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedSsh = sshUtils as jest.Mocked<typeof sshUtils>;
const mockedBackup = coreBackup as jest.Mocked<typeof coreBackup>;
const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockedReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;
const mockedInquirerPrompt = inquirer.prompt as jest.MockedFunction<typeof inquirer.prompt>;

const sampleServer = {
  id: "srv-1",
  name: "my-server",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00.000Z",
  mode: "coolify" as const,
};

const sampleManifest = {
  serverName: "my-server",
  provider: "hetzner",
  timestamp: "2026-02-21_15-30-45-123",
  coolifyVersion: "4.0.0",
  files: ["coolify-backup.sql.gz", "coolify-config.tar.gz"],
};

describe("BUG-02 — restore --force backup auto-selection", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.resetAllMocks();
    process.env.KASTELL_SAFE_MODE = "false";
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedConfig.findServers.mockReturnValue([sampleServer]);
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest) as unknown as ReturnType<typeof mockedReadFileSync>);
    mockedBackup.getBackupDir.mockReturnValue("/home/test/.kastell/backups/my-server");
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("--force without --backup", () => {
    it("auto-selects latest backup without calling inquirer.prompt for backup selection", async () => {
      mockedBackup.listBackups.mockReturnValue([
        "2026-01-01_10-00-00-000",
        "2026-02-01_10-00-00-000",
        "2026-03-01_10-00-00-000", // latest
      ]);

      await restoreCommand("my-server", { force: true });

      // inquirer should NOT be called for backup selection
      expect(mockedInquirerPrompt).not.toHaveBeenCalled();
    });

    it("selects the last element from listBackups (the latest)", async () => {
      const latestBackup = "2026-03-01_10-00-00-000";
      mockedBackup.listBackups.mockReturnValue([
        "2026-01-01_10-00-00-000",
        "2026-02-01_10-00-00-000",
        latestBackup,
      ]);

      await restoreCommand("my-server", { force: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain(latestBackup);
    });

    it("shows info message about auto-selected backup", async () => {
      mockedBackup.listBackups.mockReturnValue(["2026-03-01_10-00-00-000"]);

      await restoreCommand("my-server", { force: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toMatch(/auto.?selected|latest backup/i);
    });

    it("returns early when no backups found (--force without --backup)", async () => {
      mockedBackup.listBackups.mockReturnValue([]);

      await restoreCommand("my-server", { force: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("No backups found");
      // Should not proceed to manifest loading
      expect(mockedExistsSync).not.toHaveBeenCalled();
    });
  });

  describe("--force with --backup (existing behavior unchanged)", () => {
    it("uses specified backup without prompting when both --force and --backup provided", async () => {
      const specifiedBackup = "2026-01-01_10-00-00-000";

      await restoreCommand("my-server", { force: true, backup: specifiedBackup });

      expect(mockedInquirerPrompt).not.toHaveBeenCalled();
      expect(mockedBackup.listBackups).not.toHaveBeenCalled();
    });
  });

  describe("without --force (existing behavior unchanged)", () => {
    it("calls inquirer.prompt for backup selection when --force is not set", async () => {
      mockedBackup.listBackups.mockReturnValue([
        "2026-01-01_10-00-00-000",
        "2026-03-01_10-00-00-000",
      ]);

      // First prompt: backup selection, second would be confirmation (cancel it)
      mockedInquirerPrompt
        .mockResolvedValueOnce({ backup: "2026-03-01_10-00-00-000" })
        .mockResolvedValueOnce({ confirm: false });

      await restoreCommand("my-server");

      expect(mockedInquirerPrompt).toHaveBeenCalled();
    });
  });
});
