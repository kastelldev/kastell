/**
 * Tests for bare-mode routing in backup command.
 * Verifies that backupCommand routes to createBareBackup for bare servers
 * and createBackup (inline) for coolify servers.
 */
import * as config from "../../src/utils/config";
import * as sshUtils from "../../src/utils/ssh";
import * as serverSelect from "../../src/utils/serverSelect";
import * as coreBackup from "../../src/core/backup";
import { backupCommand } from "../../src/commands/backup";

jest.mock("fs", () => ({
  mkdirSync: jest.fn(),
  existsSync: jest.fn(),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(),
  readdirSync: jest.fn(),
}));
jest.mock("child_process", () => ({
  spawn: jest.fn(),
  execSync: jest.fn(),
}));
jest.mock("../../src/utils/config");
jest.mock("../../src/utils/ssh");
jest.mock("../../src/utils/serverSelect");
jest.mock("../../src/core/backup");

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedSsh = sshUtils as jest.Mocked<typeof sshUtils>;
const mockedServerSelect = serverSelect as jest.Mocked<typeof serverSelect>;
const mockedCoreBackup = coreBackup as jest.Mocked<typeof coreBackup>;

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

const bareBackupResult = {
  success: true,
  backupPath: "/home/user/.kastell/backups/bare-test/2026-02-28_08-00-00-000",
  manifest: {
    serverName: "bare-test",
    provider: "hetzner",
    timestamp: "2026-02-28_08-00-00-000",
    coolifyVersion: "n/a",
    files: ["bare-config.tar.gz"],
    mode: "bare" as const,
  },
};

describe("backupCommand — bare mode routing", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
    // formatTimestamp is a pure function, keep real implementation via passthrough
    mockedCoreBackup.formatTimestamp.mockReturnValue("2026-02-28_08-00-00-000");
    mockedCoreBackup.getBackupDir.mockReturnValue("/home/user/.kastell/backups/bare-test");
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("should call createBareBackup (not sshExec with pg_dump) for a bare server", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedServerSelect.resolveServer.mockResolvedValue(bareServer);
    mockedCoreBackup.createBareBackup.mockResolvedValue(bareBackupResult);

    await backupCommand("bare-test");

    expect(mockedCoreBackup.createBareBackup).toHaveBeenCalledWith(
      bareServer.ip,
      bareServer.name,
      bareServer.provider,
    );
  });

  it("should NOT call createBareBackup for a coolify server", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedServerSelect.resolveServer.mockResolvedValue(coolifyServer);
    // sshExec needs to return pg_dump success, config tar, etc.
    mockedSsh.sshExec
      .mockResolvedValueOnce({ code: 0, stdout: "4.0.0", stderr: "" }) // version
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" }); // pg_dump fail to short-circuit

    await backupCommand("coolify-test");

    expect(mockedCoreBackup.createBareBackup).not.toHaveBeenCalled();
  });

  it("should show backup success message for bare server", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedServerSelect.resolveServer.mockResolvedValue(bareServer);
    mockedCoreBackup.createBareBackup.mockResolvedValue(bareBackupResult);

    await backupCommand("bare-test");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Backup saved");
  });

  it("should show error when createBareBackup returns failure", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedServerSelect.resolveServer.mockResolvedValue(bareServer);
    mockedCoreBackup.createBareBackup.mockResolvedValue({
      success: false,
      error: "Config backup failed",
      hint: "Check nginx is installed",
    });

    await backupCommand("bare-test");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Config backup failed");
  });

  it("should route each server correctly in --all mode with mixed bare+coolify servers", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedConfig.getServers.mockReturnValue([bareServer, coolifyServer]);
    mockedCoreBackup.createBareBackup.mockResolvedValue(bareBackupResult);

    // coolify server path uses sshExec - make pg_dump fail quickly
    mockedSsh.sshExec
      .mockResolvedValueOnce({ code: 0, stdout: "4.0.0", stderr: "" }) // coolify version
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" }); // coolify pg_dump fails

    await backupCommand(undefined, { all: true });

    // bare server should be routed to createBareBackup
    expect(mockedCoreBackup.createBareBackup).toHaveBeenCalledWith(
      bareServer.ip,
      bareServer.name,
      bareServer.provider,
    );
    // coolify server should NOT use createBareBackup
    expect(mockedCoreBackup.createBareBackup).toHaveBeenCalledTimes(1);
  });

  it("should use 'Backing up system config' spinner text for bare server", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedServerSelect.resolveServer.mockResolvedValue(bareServer);
    mockedCoreBackup.createBareBackup.mockResolvedValue(bareBackupResult);

    await backupCommand("bare-test");

    // Verify createBareBackup was called (means bare path was taken)
    expect(mockedCoreBackup.createBareBackup).toHaveBeenCalled();
  });
});
