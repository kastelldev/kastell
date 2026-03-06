import { mkdirSync, existsSync, writeFileSync, readdirSync } from "fs";
import { spawn } from "child_process";
import { EventEmitter } from "events";
import inquirer from "inquirer";
import * as config from "../../src/utils/config";
import * as sshUtils from "../../src/utils/ssh";
import * as serverSelect from "../../src/utils/serverSelect";
import {
  backupCommand,
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
} from "../../src/commands/backup";

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
};

const sampleServer2 = {
  id: "456",
  name: "coolify-prod",
  provider: "digitalocean",
  ip: "5.6.7.8",
  region: "nyc1",
  size: "s-2vcpu-4gb",
  createdAt: "2026-02-21T00:00:00Z",
};

function createMockProcess(code: number = 0, stderrData: string = "") {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = null;
  // Schedule events
  setTimeout(() => {
    if (stderrData) proc.stderr.emit("data", Buffer.from(stderrData));
    proc.emit("close", code);
  }, 10);
  return proc;
}

describe("backup", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
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
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdin = null;
      setTimeout(() => proc.emit("error", new Error("ENOENT")), 10);
      mockedSpawn.mockReturnValue(proc);

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
      ] as any);

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
      mockedReaddirSync.mockReturnValue(["good-backup", "bad-backup"] as any);

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

    it("should show dry-run output", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);

      await backupCommand("1.2.3.4", { dryRun: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Dry Run");
      expect(output).toContain("No changes applied");
      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
    });

    it("should handle database backup failure with stderr", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "4.0.0", stderr: "" })
        .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "pg_dump error" });

      await backupCommand("1.2.3.4");
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(2);
    });

    it("should handle database backup failure without stderr", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "4.0.0", stderr: "" })
        .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" });

      await backupCommand("1.2.3.4");
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(2);
    });

    it("should handle database backup exception", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "4.0.0", stderr: "" })
        .mockRejectedValueOnce(new Error("Connection lost"));

      await backupCommand("1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Connection lost");
    });

    it("should show SSH hint on database backup exception with connection refused", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "4.0.0", stderr: "" })
        .mockRejectedValueOnce(new Error("Connection refused"));

      await backupCommand("1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("SSH connection refused");
    });

    it("should handle config backup failure with stderr", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "4.0.0", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "tar error" });

      await backupCommand("1.2.3.4");
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(3);
    });

    it("should handle config backup failure without stderr", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "4.0.0", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" });

      await backupCommand("1.2.3.4");
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(3);
    });

    it("should handle config backup exception", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "4.0.0", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockRejectedValueOnce(new Error("fail"));

      await backupCommand("1.2.3.4");
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(3);
    });

    it("should complete full backup successfully", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "4.0.0", stderr: "" }) // version
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // pg_dump
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // config tar
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // cleanup
      // SCP downloads
      mockedSpawn
        .mockReturnValueOnce(createMockProcess(0)) // db download
        .mockReturnValueOnce(createMockProcess(0)); // config download

      await backupCommand("1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Backup saved to");
      expect(output).toContain("Platform version: 4.0.0");
      expect(mockedWriteFileSync).toHaveBeenCalled(); // manifest written
    });

    it("should create backup directory with mode 0o700", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "4.0.0", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
      mockedSpawn
        .mockReturnValueOnce(createMockProcess(0))
        .mockReturnValueOnce(createMockProcess(0));

      await backupCommand("1.2.3.4");

      const mkdirSyncMock = mkdirSync as jest.MockedFunction<typeof mkdirSync>;
      expect(mkdirSyncMock).toHaveBeenCalledWith(
        expect.any(String),
        { recursive: true, mode: 0o700 },
      );
    });

    it("should handle SCP db download failure with stderr", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "4.0.0", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
      mockedSpawn.mockReturnValueOnce(createMockProcess(1, "scp: error"));

      await backupCommand("1.2.3.4");
      expect(mockedWriteFileSync).not.toHaveBeenCalled();
    });

    it("should handle SCP db download failure without stderr", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "4.0.0", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
      mockedSpawn.mockReturnValueOnce(createMockProcess(1));

      await backupCommand("1.2.3.4");
      expect(mockedWriteFileSync).not.toHaveBeenCalled();
    });

    it("should handle SCP config download failure with stderr", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "4.0.0", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
      mockedSpawn
        .mockReturnValueOnce(createMockProcess(0)) // db OK
        .mockReturnValueOnce(createMockProcess(1, "scp: error")); // config fail

      await backupCommand("1.2.3.4");
      expect(mockedWriteFileSync).not.toHaveBeenCalled();
    });

    it("should handle SCP config download failure without stderr", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "4.0.0", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
      mockedSpawn
        .mockReturnValueOnce(createMockProcess(0))
        .mockReturnValueOnce(createMockProcess(1)); // config fail, no stderr

      await backupCommand("1.2.3.4");
      expect(mockedWriteFileSync).not.toHaveBeenCalled();
    });

    it("should handle SCP download exception via error event", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "4.0.0", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
      // spawn throws error event
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdin = null;
      setTimeout(() => proc.emit("error", new Error("spawn failed")), 10);
      mockedSpawn.mockReturnValueOnce(proc);

      await backupCommand("1.2.3.4");
      expect(mockedWriteFileSync).not.toHaveBeenCalled();
    });

    it("should handle SCP download exception via synchronous throw", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "4.0.0", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
      // spawn throws synchronously
      mockedSpawn.mockImplementationOnce(() => {
        throw new Error("ENOMEM");
      });

      await backupCommand("1.2.3.4");
      expect(mockedWriteFileSync).not.toHaveBeenCalled();
    });

    it("should handle version check failure gracefully", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" }) // version fails
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // pg_dump
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // config tar
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // cleanup
      mockedSpawn
        .mockReturnValueOnce(createMockProcess(0))
        .mockReturnValueOnce(createMockProcess(0));

      await backupCommand("1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("unknown");
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
        .mockReturnValueOnce(["old-server"] as any) // listOrphanBackups reads BACKUPS_DIR
        .mockReturnValueOnce(["2026-02-21_10-00-00-000"] as any); // listBackups for old-server
      mockedInquirer.prompt.mockResolvedValue({ confirm: false } as any);

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
        .mockReturnValueOnce(["old-server"] as any)
        .mockReturnValueOnce(["2026-02-21_10-00-00-000"] as any);
      mockedInquirer.prompt.mockResolvedValue({ confirm: true } as any);

      await backupCommand("cleanup");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("old-server");
      // rmSync should be called to remove the directory
      const { rmSync } = require("fs");
      expect(rmSync).toHaveBeenCalled();
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

    it("should backup all servers sequentially", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.getServers.mockReturnValue([sampleServer, sampleServer2]);

      // Each server: version + pg_dump + config tar + cleanup = 4 sshExec calls
      mockedSsh.sshExec
        // Server 1
        .mockResolvedValueOnce({ code: 0, stdout: "4.0.0", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        // Server 2
        .mockResolvedValueOnce({ code: 0, stdout: "4.1.0", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

      // SCP downloads for both servers
      mockedSpawn
        .mockReturnValueOnce(createMockProcess(0)) // s1 db
        .mockReturnValueOnce(createMockProcess(0)) // s1 config
        .mockReturnValueOnce(createMockProcess(0)) // s2 db
        .mockReturnValueOnce(createMockProcess(0)); // s2 config

      await backupCommand(undefined, { all: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("All 2 server(s) backed up successfully");
      expect(mockedWriteFileSync).toHaveBeenCalledTimes(2); // manifest per server
    });

    it("should report mixed results when some servers fail", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.getServers.mockReturnValue([sampleServer, sampleServer2]);

      mockedSsh.sshExec
        // Server 1: success
        .mockResolvedValueOnce({ code: 0, stdout: "4.0.0", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        // Server 2: db backup fails
        .mockResolvedValueOnce({ code: 0, stdout: "4.1.0", stderr: "" })
        .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "pg_dump error" });

      // SCP downloads for server 1 only
      mockedSpawn
        .mockReturnValueOnce(createMockProcess(0))
        .mockReturnValueOnce(createMockProcess(0));

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
      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
    });

    it("should handle single server backup in --all", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.getServers.mockReturnValue([sampleServer]);

      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "4.0.0", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

      mockedSpawn
        .mockReturnValueOnce(createMockProcess(0))
        .mockReturnValueOnce(createMockProcess(0));

      await backupCommand(undefined, { all: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("All 1 server(s) backed up successfully");
    });
  });
});
