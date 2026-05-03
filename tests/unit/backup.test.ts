import { mkdirSync, existsSync, writeFileSync, readdirSync } from "fs";
import { spawn } from "child_process";
import inquirer from "inquirer";
import * as config from "../../src/utils/config";
import * as sshUtils from "../../src/utils/ssh";
import * as serverSelect from "../../src/utils/serverSelect";
import {
  formatTimestamp,
  getBackupDir,
  buildPgDumpCommand,
  buildConfigTarCommand,
  buildCleanupCommand,
  buildCoolifyVersionCommand,
  scpDownload,
  listBackups,
  listOrphanBackups,
  cleanupServerBackups,
} from "../../src/core/backup";
import { backupCommand } from "../../src/commands/backup";

jest.mock("fs", () => ({
  mkdirSync: jest.fn(),
  existsSync: jest.fn(),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(),
  readdirSync: jest.fn(),
  rmSync: jest.fn(),
}));
jest.mock("child_process", () => ({
  spawn: jest.fn(),
  execSync: jest.fn(),
}));
jest.mock("../../src/utils/config");
jest.mock("../../src/utils/ssh");
jest.mock("../../src/utils/serverSelect");
jest.mock("inquirer");
jest.mock("ora", () =>
  jest.fn(() => ({
    start: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
    stop: jest.fn().mockReturnThis(),
  })),
);

// Mock core/backup so command tests are isolated from backup implementation
jest.mock("../../src/core/backup", () => {
  const actual = jest.requireActual("../../src/core/backup");
  return {
    ...actual,
    backupServer: jest.fn(),
  };
});

// Mock adapters/factory for resolvePlatform used in dry-run display
jest.mock("../../src/adapters/factory", () => ({
  resolvePlatform: jest.fn(),
  getAdapter: jest.fn(),
}));

import ora from "ora";
import { backupServer } from "../../src/core/backup";
import { resolvePlatform } from "../../src/adapters/factory";
import { MockChildProcess } from "../helpers/ssh-factories.js";
import { createMockProcess as createMockChildProcess } from "../helpers/mockProcess.js";

const mockedOra = ora as jest.MockedFunction<typeof ora>;
const mockedBackupServer = backupServer as jest.MockedFunction<typeof backupServer>;
const mockedResolvePlatform = resolvePlatform as jest.MockedFunction<typeof resolvePlatform>;
const mockedConfig = config as jest.Mocked<typeof config>;
const mockedSsh = sshUtils as jest.Mocked<typeof sshUtils>;
const mockedServerSelect = serverSelect as jest.Mocked<typeof serverSelect>;
const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;
const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockedReaddirSync = readdirSync as jest.MockedFunction<typeof readdirSync>;
const mockedWriteFileSync = writeFileSync as jest.MockedFunction<typeof writeFileSync>;
const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;

const sampleServer = {
  id: "123",
  name: "coolify-test",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00.000Z",
  mode: "coolify" as const,
};

const sampleServer2 = {
  id: "456",
  name: "coolify-prod",
  provider: "digitalocean",
  ip: "5.6.7.8",
  region: "nyc1",
  size: "s-2vcpu-4gb",
  createdAt: "2026-02-21T00:00:00Z",
  mode: "coolify" as const,
};

function createMockProcess(code: number = 0, stderrData: string = ""): ReturnType<typeof spawn> {
  return createMockChildProcess(code, { stderrData, delayMs: 10 }) as unknown as ReturnType<typeof spawn>;
}

describe("backup", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.resetAllMocks();
    mockedSsh.resolveScpPath.mockReturnValue("scp");
    mockedResolvePlatform.mockReturnValue("coolify");
    mockedOra.mockReturnValue({
      start: jest.fn().mockReturnThis(),
      succeed: jest.fn().mockReturnThis(),
      fail: jest.fn().mockReturnThis(),
      stop: jest.fn().mockReturnThis(),
    } as unknown as ReturnType<typeof ora>);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  // Pure function tests
  describe("formatTimestamp", () => {
    it("should format date to file-safe timestamp", () => {
      const date = new Date("2026-02-21T15:30:45.123Z");
      const result = formatTimestamp(date);
      expect(result).toBe("2026-02-21_15-30-45-123");
    });

    it("should handle midnight", () => {
      const date = new Date("2026-01-01T00:00:00.000Z");
      const result = formatTimestamp(date);
      expect(result).toBe("2026-01-01_00-00-00-000");
    });
  });

  describe("getBackupDir", () => {
    it("should return path under backups dir", () => {
      const dir = getBackupDir("my-server");
      expect(dir).toContain("backups");
      expect(dir).toContain("my-server");
    });
  });

  describe("buildPgDumpCommand", () => {
    it("should use docker exec with pg_dump and gzip", () => {
      const cmd = buildPgDumpCommand();
      expect(cmd).toContain("docker exec coolify-db");
      expect(cmd).toContain("pg_dump");
      expect(cmd).toContain("-U coolify");
      expect(cmd).toContain("-d coolify");
      expect(cmd).toContain("gzip");
      expect(cmd).toContain("/tmp/coolify-backup.sql.gz");
    });
  });

  describe("buildConfigTarCommand", () => {
    it("should tar .env and compose files", () => {
      const cmd = buildConfigTarCommand();
      expect(cmd).toContain("tar czf");
      expect(cmd).toContain(".env");
      expect(cmd).toContain("docker-compose.yml");
      expect(cmd).toContain("/tmp/coolify-config.tar.gz");
    });

    it("should include prod compose fallback", () => {
      const cmd = buildConfigTarCommand();
      expect(cmd).toContain("docker-compose.prod.yml");
    });
  });

  describe("buildCleanupCommand", () => {
    it("should rm backup files from /tmp", () => {
      const cmd = buildCleanupCommand();
      expect(cmd).toContain("rm -f");
      expect(cmd).toContain("/tmp/coolify-backup.sql.gz");
      expect(cmd).toContain("/tmp/coolify-config.tar.gz");
    });
  });

  describe("buildCoolifyVersionCommand", () => {
    it("should use docker inspect with fallback", () => {
      const cmd = buildCoolifyVersionCommand();
      expect(cmd).toContain("docker inspect coolify");
      expect(cmd).toContain("unknown");
    });
  });

  describe("scpDownload", () => {
    it("should resolve with code 0 on success", async () => {
      mockedSpawn.mockReturnValue(createMockProcess(0));
      const result = await scpDownload("1.2.3.4", "/tmp/file", "/local/file");
      expect(result.code).toBe(0);
      expect(mockedSpawn).toHaveBeenCalledWith(
        "scp",
        expect.arrayContaining(["root@1.2.3.4:/tmp/file", "/local/file"]),
        expect.any(Object),
      );
    });

    it("should resolve with code 1 and stderr on failure", async () => {
      mockedSpawn.mockReturnValue(createMockProcess(1, "Permission denied"));
      const result = await scpDownload("1.2.3.4", "/tmp/file", "/local/file");
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Permission denied");
    });

    it("should handle spawn error event", async () => {
      const proc = new MockChildProcess(0, 99999);
      setTimeout(() => proc.emit("error", new Error("ENOENT")), 10);
      mockedSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

      const result = await scpDownload("1.2.3.4", "/tmp/file", "/local/file");
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("ENOENT");
    });
  });

  describe("listBackups", () => {
    it("should return empty array when dir does not exist", () => {
      mockedExistsSync.mockReturnValue(false);
      expect(listBackups("test-server")).toEqual([]);
    });

    it("should list valid backup dirs (with manifest.json)", () => {
      mockedExistsSync.mockImplementation((p) => {
        const path = String(p);
        if (path.includes("backups") && !path.includes("manifest")) return true;
        return path.includes("manifest.json");
      });
      mockedReaddirSync.mockReturnValue([
        "2026-02-21_10-00-00-000",
        "2026-02-20_10-00-00-000",
      ] as unknown as ReturnType<typeof mockedReaddirSync>);

      const result = listBackups("test-server");
      expect(result).toHaveLength(2);
      expect(result[0]).toBe("2026-02-21_10-00-00-000");
    });

    it("should filter out dirs without manifest.json", () => {
      mockedExistsSync.mockImplementation((p) => {
        const path = String(p);
        if (path.includes("good") && path.includes("manifest.json")) return true;
        if (path.includes("bad") && path.includes("manifest.json")) return false;
        return true;
      });
      mockedReaddirSync.mockReturnValue(["good-backup", "bad-backup"] as unknown as ReturnType<typeof mockedReaddirSync>);

      const result = listBackups("test-server");
      expect(result).toHaveLength(1);
      expect(result[0]).toBe("good-backup");
    });

    it("should handle readdirSync error", () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReaddirSync.mockImplementation(() => {
        throw new Error("EACCES");
      });
      expect(listBackups("test-server")).toEqual([]);
    });
  });

  // Command tests
  describe("backupCommand", () => {
    it("should show error when SSH not available", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(false);
      await backupCommand();
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("SSH client not found");
    });

    it("should return when no server found", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedServerSelect.resolveServer.mockResolvedValue(undefined);
      await backupCommand("nonexistent");
      expect(mockedServerSelect.resolveServer).toHaveBeenCalledWith(
        "nonexistent",
        "Select a server to backup:",
      );
    });

    it("should show dry-run output for managed server", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedResolvePlatform.mockReturnValue("coolify");

      await backupCommand("1.2.3.4", { dryRun: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Dry Run");
      expect(output).toContain("No changes applied");
      expect(mockedBackupServer).not.toHaveBeenCalled();
    });

    it("should show dry-run output for bare server", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedServerSelect.resolveServer.mockResolvedValue({ ...sampleServer, mode: "bare" as const });
      mockedResolvePlatform.mockReturnValue(undefined);

      await backupCommand("1.2.3.4", { dryRun: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Dry Run");
      expect(output).toContain("bare-config.tar.gz");
      expect(mockedBackupServer).not.toHaveBeenCalled();
    });

    it("should call backupServer and show success on backup", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedBackupServer.mockResolvedValue({
        success: true,
        backupPath: "/backups/coolify-test/2026-01-01",
        manifest: {
          serverName: "coolify-test",
          provider: "hetzner",
          timestamp: "2026-01-01_00-00-00-000",
          coolifyVersion: "4.0.0",
          files: ["coolify-backup.sql.gz", "coolify-config.tar.gz"],
        },
      });

      await backupCommand("1.2.3.4");

      expect(mockedBackupServer).toHaveBeenCalledWith(sampleServer);
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Backup saved to");
      expect(output).toContain("Platform version: 4.0.0");
    });

    it("should show backup failure message when backupServer returns success:false", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedBackupServer.mockResolvedValue({
        success: false,
        error: "pg_dump failed",
        hint: "Check postgres container",
      });

      await backupCommand("1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("pg_dump failed");
      expect(output).toContain("Check postgres container");
    });

    it("should handle backupServer throwing an exception", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedBackupServer.mockRejectedValue(new Error("Connection lost"));

      await backupCommand("1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Connection lost");
    });
  });

  // ---- cleanup subcommand tests ----

  describe("backupCommand cleanup subcommand", () => {
    it("should show success when no orphan backups found", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedExistsSync.mockReturnValue(false); // BACKUPS_DIR doesn't exist

      await backupCommand("cleanup");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("No orphan backups found");
    });

    it("should show orphan list and cancel when user declines", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      // BACKUPS_DIR exists, has an orphan directory not in active servers
      mockedExistsSync.mockImplementation((p) => {
        const path = String(p);
        if (path.includes("backups") && !path.includes("old-server")) return true;
        if (path.includes("old-server")) return true;
        return path.includes("manifest.json");
      });
      mockedReaddirSync
        .mockReturnValueOnce(["old-server"] as unknown as ReturnType<typeof mockedReaddirSync>) // listOrphanBackups reads BACKUPS_DIR
        .mockReturnValueOnce(["2026-02-21_10-00-00-000"] as unknown as ReturnType<typeof mockedReaddirSync>); // listBackups for old-server
      mockedInquirer.prompt.mockResolvedValue({ confirm: false });

      await backupCommand("cleanup");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("old-server");
      expect(output).toContain("Cleanup cancelled");
    });

    it("should remove orphan backups when user confirms", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedExistsSync.mockImplementation((p) => {
        const path = String(p);
        if (path.includes("old-server")) return true;
        return true;
      });
      mockedReaddirSync
        .mockReturnValueOnce(["old-server"] as unknown as ReturnType<typeof mockedReaddirSync>)
        .mockReturnValueOnce(["2026-02-21_10-00-00-000"] as unknown as ReturnType<typeof mockedReaddirSync>);
      mockedInquirer.prompt.mockResolvedValue({ confirm: true });

      await backupCommand("cleanup");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("old-server");
      // rmSync should be called to remove the directory
      const { rmSync } = require("fs");
      expect(rmSync).toHaveBeenCalled();
    });
  });

  // ---- list subcommand tests ----

  describe("backupCommand list subcommand", () => {
    it("should show warning when no servers registered", async () => {
      mockedConfig.getServers.mockReturnValue([]);

      await backupCommand("list");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("No servers registered");
    });

    it("should show no backups message when servers have no backups", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedExistsSync.mockReturnValue(false); // no backup dir

      await backupCommand("list");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("No backups found for any server");
    });

    it("should list backups per server when backups exist", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedExistsSync.mockImplementation((p) => {
        const path = String(p);
        if (path.includes("manifest.json")) return true;
        return true;
      });
      mockedReaddirSync.mockReturnValue(["2026-03-01_00-00-00-000"] as unknown as ReturnType<typeof mockedReaddirSync>);

      await backupCommand("list");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("coolify-test");
      expect(output).toContain("2026-03-01_00-00-00-000");
    });
  });

  // ---- cleanup with --force flag ----

  describe("backupCommand cleanup with --force", () => {
    it("should skip confirmation prompt when --force is set", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedExistsSync.mockImplementation((p) => {
        const path = String(p);
        if (path.includes("old-server")) return true;
        return true;
      });
      mockedReaddirSync
        .mockReturnValueOnce(["old-server"] as unknown as ReturnType<typeof mockedReaddirSync>)
        .mockReturnValueOnce(["2026-02-21_10-00-00-000"] as unknown as ReturnType<typeof mockedReaddirSync>);

      await backupCommand("cleanup", { force: true });

      // inquirer.prompt should NOT have been called
      expect(mockedInquirer.prompt).not.toHaveBeenCalled();
      // rmSync should have been called for cleanup
      const { rmSync } = require("fs");
      expect(rmSync).toHaveBeenCalled();
    });
  });

  // ---- schedule option tests ----

  describe("backupCommand schedule option", () => {
    it("should show error when SSH not available for schedule", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(false);

      await backupCommand("test-server", { schedule: "list" });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("SSH client not found");
    });

    it("should return when no server found for schedule", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedServerSelect.resolveServer.mockResolvedValue(undefined);

      await backupCommand("nonexistent", { schedule: "list" });

      expect(mockedServerSelect.resolveServer).toHaveBeenCalled();
    });
  });

  // ---- backup success with platform info ----

  describe("backupCommand success with platform info", () => {
    it("should display provider and platform info when manifest has platform", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedResolvePlatform.mockReturnValue("coolify");
      mockedBackupServer.mockResolvedValue({
        success: true,
        backupPath: "/backups/coolify-test/2026-01-01",
        manifest: {
          serverName: "coolify-test",
          provider: "hetzner",
          timestamp: "2026-01-01_00-00-00-000",
          coolifyVersion: "4.0.0",
          files: ["coolify-backup.sql.gz", "coolify-config.tar.gz"],
          platform: "coolify",
        },
      });

      await backupCommand("1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Provider: hetzner");
      expect(output).toContain("Platform: coolify");
    });

    it("should not display platform info when resolvePlatform returns undefined", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedServerSelect.resolveServer.mockResolvedValue({ ...sampleServer, mode: "bare" as const });
      mockedResolvePlatform.mockReturnValue(undefined);
      mockedBackupServer.mockResolvedValue({
        success: true,
        backupPath: "/backups/bare-test/2026-01-01",
        manifest: {
          serverName: "bare-test",
          provider: "hetzner",
          timestamp: "2026-01-01_00-00-00-000",
          coolifyVersion: "unknown",
          files: ["bare-config.tar.gz"],
        },
      });

      await backupCommand("1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).not.toContain("Platform:");
    });

    it("should show backup error without hint when error has no hint", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedBackupServer.mockResolvedValue({
        success: false,
        error: "Database dump failed",
      });

      await backupCommand("1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Database dump failed");
    });
  });

  // ---- --all mode tests ----

  describe("backupCommand --all mode", () => {
    it("should show error when SSH not available", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(false);

      await backupCommand(undefined, { all: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("SSH client not found");
    });

    it("should show info when no servers exist", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.getServers.mockReturnValue([]);

      await backupCommand(undefined, { all: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("No servers found");
    });

    it("should backup all servers using backupServer", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.getServers.mockReturnValue([sampleServer, sampleServer2]);
      mockedBackupServer
        .mockResolvedValueOnce({
          success: true,
          backupPath: "/backups/coolify-test/ts",
          manifest: { serverName: "coolify-test", provider: "hetzner", timestamp: "ts", coolifyVersion: "4.0.0", files: [] },
        })
        .mockResolvedValueOnce({
          success: true,
          backupPath: "/backups/coolify-prod/ts",
          manifest: { serverName: "coolify-prod", provider: "digitalocean", timestamp: "ts", coolifyVersion: "4.1.0", files: [] },
        });

      await backupCommand(undefined, { all: true });

      expect(mockedBackupServer).toHaveBeenCalledTimes(2);
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("All 2 server(s) backed up successfully");
    });

    it("should report mixed results when some servers fail", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.getServers.mockReturnValue([sampleServer, sampleServer2]);
      mockedBackupServer
        .mockResolvedValueOnce({
          success: true,
          backupPath: "/backups/coolify-test/ts",
          manifest: { serverName: "coolify-test", provider: "hetzner", timestamp: "ts", coolifyVersion: "4.0.0", files: [] },
        })
        .mockResolvedValueOnce({ success: false, error: "pg_dump error" });

      await backupCommand(undefined, { all: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("1 succeeded");
      expect(output).toContain("1 failed");
    });

    it("should pass dryRun flag to each server backup", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.getServers.mockReturnValue([sampleServer]);

      await backupCommand(undefined, { all: true, dryRun: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      // In --all dry-run, backupSingleServer logs dry-run message per server
      expect(output).toContain("Dry run");
      expect(mockedBackupServer).not.toHaveBeenCalled();
    });

    it("should handle single server backup in --all", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedBackupServer.mockResolvedValue({
        success: true,
        backupPath: "/backups/coolify-test/ts",
        manifest: { serverName: "coolify-test", provider: "hetzner", timestamp: "ts", coolifyVersion: "4.0.0", files: [] },
      });

      await backupCommand(undefined, { all: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("All 1 server(s) backed up successfully");
    });
  });
});
