/**
 * Tests for bare-mode routing in restore command.
 * Verifies that restoreCommand routes to restoreBareBackup for bare servers,
 * restoreBackup for coolify servers, and SAFE_MODE blocks bare restore.
 */
import { existsSync, readFileSync } from "fs";
import inquirer from "inquirer";
import * as config from "../../src/utils/config";
import * as sshUtils from "../../src/utils/ssh";
import * as coreBackup from "../../src/core/backup";
import { restoreCommand } from "../../src/commands/restore";

jest.mock("inquirer");
jest.mock("fs", () => ({
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
}));
jest.mock("child_process", () => ({
  spawn: jest.fn(),
  execSync: jest.fn(),
}));
jest.mock("../../src/utils/config");
jest.mock("../../src/utils/ssh");
jest.mock("../../src/core/backup");

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedSsh = sshUtils as jest.Mocked<typeof sshUtils>;
const mockedCoreBackup = coreBackup as jest.Mocked<typeof coreBackup>;
const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;
const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockedReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;

const bareServer = {
  id: "bare-001",
  name: "bare-test",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00.000Z",
  mode: "bare" as const,
};

const coolifyServer = {
  id: "123",
  name: "coolify-test",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00.000Z",
  mode: "coolify" as const,
};

const bareManifest = {
  serverName: "bare-test",
  provider: "hetzner",
  timestamp: "2026-02-28_08-00-00-000",
  coolifyVersion: "n/a",
  files: ["bare-config.tar.gz"],
  mode: "bare" as const,
};

const coolifyManifest = {
  serverName: "coolify-test",
  provider: "hetzner",
  timestamp: "2026-02-28_08-00-00-000",
  coolifyVersion: "4.0.0",
  files: ["coolify-backup.sql.gz", "coolify-config.tar.gz"],
};

describe("restoreCommand — bare mode routing", () => {
  let consoleSpy: jest.SpyInstance;
  const originalSafeMode = process.env.SAFE_MODE;
  const originalKastellSafeMode = process.env.KASTELL_SAFE_MODE;
  const originalQuicklifySafeMode = process.env.QUICKLIFY_SAFE_MODE;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
    delete process.env.SAFE_MODE;
    process.env.KASTELL_SAFE_MODE = "false";
    mockedCoreBackup.getBackupDir.mockReturnValue("/home/user/.kastell/backups/bare-test");
    // Default: manifest exists
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(JSON.stringify(bareManifest));
    // loadManifest is from core/backup (mocked)
    mockedCoreBackup.loadManifest.mockReturnValue(bareManifest);
    // Cast to any to satisfy the SshCommand branded type in mocks
    mockedCoreBackup.buildStopCoolifyCommand.mockReturnValue("docker compose stop" as unknown as ReturnType<typeof mockedCoreBackup.buildStopCoolifyCommand>);
    mockedCoreBackup.buildStartCoolifyCommand.mockReturnValue("docker compose up -d" as unknown as ReturnType<typeof mockedCoreBackup.buildStartCoolifyCommand>);
    mockedCoreBackup.buildStartDbCommand.mockReturnValue("docker compose up -d postgres" as unknown as ReturnType<typeof mockedCoreBackup.buildStartDbCommand>);
    mockedCoreBackup.buildRestoreDbCommand.mockReturnValue("gunzip psql" as unknown as ReturnType<typeof mockedCoreBackup.buildRestoreDbCommand>);
    mockedCoreBackup.buildRestoreConfigCommand.mockReturnValue("tar xzf coolify-config.tar.gz" as unknown as ReturnType<typeof mockedCoreBackup.buildRestoreConfigCommand>);
    mockedCoreBackup.buildCleanupCommand.mockReturnValue("rm -f /tmp/*.gz" as unknown as ReturnType<typeof mockedCoreBackup.buildCleanupCommand>);
    mockedCoreBackup.tryRestartCoolify.mockResolvedValue(undefined);
    mockedCoreBackup.scpUpload.mockResolvedValue({ code: 0, stderr: "" });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    if (originalSafeMode === undefined) {
      delete process.env.SAFE_MODE;
    } else {
      process.env.SAFE_MODE = originalSafeMode;
    }
    if (originalKastellSafeMode === undefined) {
      delete process.env.KASTELL_SAFE_MODE;
    } else {
      process.env.KASTELL_SAFE_MODE = originalKastellSafeMode;
    }
    if (originalQuicklifySafeMode === undefined) {
      delete process.env.QUICKLIFY_SAFE_MODE;
    } else {
      process.env.QUICKLIFY_SAFE_MODE = originalQuicklifySafeMode;
    }
  });

  it("should call restoreBareBackup for a bare server", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedConfig.findServers.mockReturnValue([bareServer]);
    mockedCoreBackup.restoreBareBackup.mockResolvedValue({
      success: true,
      steps: [
        { name: "Upload config", status: "success" },
        { name: "Restore config", status: "success" },
      ],
    });
    mockedCoreBackup.listBackups.mockReturnValue(["2026-02-28_08-00-00-000"]);

    // inquirer: select backup, confirm, confirm name
    mockedInquirer.prompt = jest
      .fn()
      .mockResolvedValueOnce({ backup: "2026-02-28_08-00-00-000" })
      .mockResolvedValueOnce({ confirm: true })
      .mockResolvedValueOnce({ confirmName: "bare-test" }) as unknown as typeof mockedInquirer.prompt;

    await restoreCommand("1.2.3.4");

    expect(mockedCoreBackup.restoreBareBackup).toHaveBeenCalledWith(
      bareServer.ip,
      bareServer.name,
      "2026-02-28_08-00-00-000",
    );
  });

  it("should NOT call restoreBareBackup for a coolify server", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedConfig.findServers.mockReturnValue([coolifyServer]);
    mockedCoreBackup.loadManifest.mockReturnValue(coolifyManifest);
    mockedReadFileSync.mockReturnValue(JSON.stringify(coolifyManifest));

    mockedInquirer.prompt = jest
      .fn()
      .mockResolvedValueOnce({ confirm: true })
      .mockResolvedValueOnce({ confirmName: "coolify-test" }) as unknown as typeof mockedInquirer.prompt;

    // coolify path uses scpUpload from core - make it fail at first upload to short-circuit
    mockedCoreBackup.scpUpload.mockResolvedValue({ code: 1, stderr: "upload error" });

    await restoreCommand("1.2.3.4", { backup: "my-backup" });

    expect(mockedCoreBackup.restoreBareBackup).not.toHaveBeenCalled();
  });

  it("should block bare restore with KASTELL_SAFE_MODE=true and error message", async () => {
    process.env.KASTELL_SAFE_MODE = "true";
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedConfig.findServers.mockReturnValue([bareServer]);

    await restoreCommand("1.2.3.4", { backup: "my-backup" });

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("SAFE_MODE");
    expect(mockedCoreBackup.restoreBareBackup).not.toHaveBeenCalled();

    delete process.env.KASTELL_SAFE_MODE;
  });

  it("should block coolify restore with KASTELL_SAFE_MODE=true as well", async () => {
    process.env.KASTELL_SAFE_MODE = "true";
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedConfig.findServers.mockReturnValue([coolifyServer]);

    await restoreCommand("1.2.3.4", { backup: "my-backup" });

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("SAFE_MODE");
    // No core restore functions should be called
    expect(mockedCoreBackup.restoreBareBackup).not.toHaveBeenCalled();

    delete process.env.KASTELL_SAFE_MODE;
  });

  it("should show config restored message and service restart hint for bare restore success", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedConfig.findServers.mockReturnValue([bareServer]);
    mockedCoreBackup.restoreBareBackup.mockResolvedValue({
      success: true,
      steps: [
        { name: "Upload config", status: "success" },
        { name: "Restore config", status: "success" },
      ],
    });
    mockedCoreBackup.listBackups.mockReturnValue(["2026-02-28_08-00-00-000"]);

    mockedInquirer.prompt = jest
      .fn()
      .mockResolvedValueOnce({ backup: "2026-02-28_08-00-00-000" })
      .mockResolvedValueOnce({ confirm: true })
      .mockResolvedValueOnce({ confirmName: "bare-test" }) as unknown as typeof mockedInquirer.prompt;

    await restoreCommand("1.2.3.4");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Restart affected services manually");
  });

  it("should show error message when restoreBareBackup fails", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedConfig.findServers.mockReturnValue([bareServer]);
    mockedCoreBackup.restoreBareBackup.mockResolvedValue({
      success: false,
      steps: [{ name: "Upload config", status: "failure", error: "scp error" }],
      error: "Upload failed",
    });
    mockedCoreBackup.listBackups.mockReturnValue(["2026-02-28_08-00-00-000"]);

    mockedInquirer.prompt = jest
      .fn()
      .mockResolvedValueOnce({ backup: "2026-02-28_08-00-00-000" })
      .mockResolvedValueOnce({ confirm: true })
      .mockResolvedValueOnce({ confirmName: "bare-test" }) as unknown as typeof mockedInquirer.prompt;

    await restoreCommand("1.2.3.4");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Upload failed");
  });
});
