/**
 * Tests for bare-mode routing in backup command.
 * Verifies that backupCommand routes to backupServer() for both bare and managed servers.
 * The bare/managed dispatch is now tested in core-backup-cmd.test.ts.
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
jest.mock("../../src/adapters/factory", () => ({
  resolvePlatform: jest.fn().mockReturnValue("coolify"),
  getAdapter: jest.fn(),
}));
jest.mock("ora", () =>
  jest.fn(() => ({
    start: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
    stop: jest.fn().mockReturnThis(),
  })),
);

import ora from "ora";
import { createConsoleSpy } from "../helpers/consoleSpy.js";

const mockedOra = ora as jest.MockedFunction<typeof ora>;
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
  const spy = createConsoleSpy();
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    spy.setup();
    stderrSpy = jest.spyOn(console, "error").mockImplementation();
    jest.resetAllMocks();
    mockedCoreBackup.formatTimestamp.mockReturnValue("2026-02-28_08-00-00-000");
    mockedCoreBackup.getBackupDir.mockReturnValue("/home/user/.kastell/backups/bare-test");
    mockedOra.mockReturnValue({
      start: jest.fn().mockReturnThis(),
      succeed: jest.fn().mockReturnThis(),
      fail: jest.fn().mockReturnThis(),
      stop: jest.fn().mockReturnThis(),
    } as unknown as ReturnType<typeof ora>);
  });

  afterEach(() => {
    spy.restore();
    stderrSpy?.mockRestore();
  });

  it("should call backupServer with bare server", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedServerSelect.resolveServer.mockResolvedValue(bareServer);
    mockedCoreBackup.backupServer.mockResolvedValue(bareBackupResult);

    await backupCommand("bare-test");

    expect(mockedCoreBackup.backupServer).toHaveBeenCalledWith(bareServer);
  });

  it("should call backupServer with coolify server", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedServerSelect.resolveServer.mockResolvedValue(coolifyServer);
    mockedCoreBackup.backupServer.mockResolvedValue({
      success: true,
      backupPath: "/backups/coolify-test/ts",
      manifest: { serverName: "coolify-test", provider: "hetzner", timestamp: "ts", coolifyVersion: "4.0.0", files: [] },
    });

    await backupCommand("coolify-test");

    expect(mockedCoreBackup.backupServer).toHaveBeenCalledWith(coolifyServer);
  });

  it("should show backup success message for bare server", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedServerSelect.resolveServer.mockResolvedValue(bareServer);
    mockedCoreBackup.backupServer.mockResolvedValue(bareBackupResult);

    await backupCommand("bare-test");

    const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Backup saved");
  });

  it("should show error when backupServer returns failure", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedServerSelect.resolveServer.mockResolvedValue(bareServer);
    mockedCoreBackup.backupServer.mockResolvedValue({
      success: false,
      error: "Config backup failed",
      hint: "Check nginx is installed",
    });

    await backupCommand("bare-test");

    const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Config backup failed");
  });

  it("should call backupServer for each server in --all mode", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedConfig.getServers.mockReturnValue([bareServer, coolifyServer]);
    mockedCoreBackup.backupServer
      .mockResolvedValueOnce(bareBackupResult)
      .mockResolvedValueOnce({
        success: true,
        backupPath: "/backups/coolify-test/ts",
        manifest: { serverName: "coolify-test", provider: "hetzner", timestamp: "ts", coolifyVersion: "4.0.0", files: [] },
      });

    await backupCommand(undefined, { all: true });

    expect(mockedCoreBackup.backupServer).toHaveBeenCalledTimes(2);
    expect(mockedCoreBackup.backupServer).toHaveBeenCalledWith(bareServer);
    expect(mockedCoreBackup.backupServer).toHaveBeenCalledWith(coolifyServer);
  });

  it("should use backupServer as single entry point (no direct createBareBackup calls)", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedServerSelect.resolveServer.mockResolvedValue(bareServer);
    mockedCoreBackup.backupServer.mockResolvedValue(bareBackupResult);

    await backupCommand("bare-test");

    // Command must not call createBareBackup directly — it delegates to backupServer
    expect(mockedCoreBackup.backupServer).toHaveBeenCalled();
    expect(mockedCoreBackup.createBareBackup).not.toHaveBeenCalled();
  });
});
