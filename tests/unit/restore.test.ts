import { readFileSync, existsSync } from "fs";
import { spawn } from "child_process";
import { EventEmitter } from "events";
import inquirer from "inquirer";
import * as config from "../../src/utils/config";
import * as sshUtils from "../../src/utils/ssh";
import * as backupModule from "../../src/commands/backup";
import {
  restoreCommand,
  tryRestartCoolify,
  buildStopCoolifyCommand,
  buildStartCoolifyCommand,
  buildStartDbCommand,
  buildRestoreDbCommand,
  buildRestoreConfigCommand,
  buildCleanupCommand,
  loadManifest,
  scpUpload,
} from "../../src/commands/restore";

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
jest.mock("../../src/commands/backup", () => ({
  listBackups: jest.fn(),
  getBackupDir: jest.fn().mockReturnValue("/home/user/.kastell/backups/coolify-test"),
}));

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedSsh = sshUtils as jest.Mocked<typeof sshUtils>;
const mockedBackup = backupModule as jest.Mocked<typeof backupModule>;
const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockedReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;
const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;
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

const sampleManifest = {
  serverName: "coolify-test",
  provider: "hetzner",
  timestamp: "2026-02-21_15-30-45-123",
  coolifyVersion: "4.0.0",
  files: ["coolify-backup.sql.gz", "coolify-config.tar.gz"],
};

function createMockProcess(code: number = 0, stderrData: string = "") {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = null;
  setTimeout(() => {
    if (stderrData) proc.stderr.emit("data", Buffer.from(stderrData));
    proc.emit("close", code);
  }, 10);
  return proc;
}

describe("restore", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  // Pure function tests
  describe("buildStopCoolifyCommand", () => {
    it("should use docker compose with both yaml files", () => {
      const cmd = buildStopCoolifyCommand();
      expect(cmd).toContain("docker compose");
      expect(cmd).toContain("docker-compose.yml");
      expect(cmd).toContain("docker-compose.prod.yml");
      expect(cmd).toContain("stop");
    });
  });

  describe("buildStartCoolifyCommand", () => {
    it("should use docker compose up -d", () => {
      const cmd = buildStartCoolifyCommand();
      expect(cmd).toContain("docker compose");
      expect(cmd).toContain("up -d");
    });
  });

  describe("buildStartDbCommand", () => {
    it("should start only postgres service", () => {
      const cmd = buildStartDbCommand();
      expect(cmd).toContain("up -d postgres");
      expect(cmd).toContain("sleep 3");
    });
  });

  describe("buildRestoreDbCommand", () => {
    it("should gunzip and pipe to psql", () => {
      const cmd = buildRestoreDbCommand();
      expect(cmd).toContain("gunzip -c");
      expect(cmd).toContain("psql");
      expect(cmd).toContain("-U coolify");
      expect(cmd).toContain("-d coolify");
    });
  });

  describe("buildRestoreConfigCommand", () => {
    it("should extract tar to source dir", () => {
      const cmd = buildRestoreConfigCommand();
      expect(cmd).toContain("tar xzf");
      expect(cmd).toContain("/data/coolify/source");
    });
  });

  describe("buildCleanupCommand", () => {
    it("should rm backup files from /tmp", () => {
      const cmd = buildCleanupCommand();
      expect(cmd).toContain("rm -f");
      expect(cmd).toContain("/tmp/coolify-backup.sql.gz");
    });
  });

  describe("scpUpload", () => {
    it("should resolve with code 0 on success", async () => {
      mockedSpawn.mockReturnValue(createMockProcess(0));
      const result = await scpUpload("1.2.3.4", "/local/file", "/tmp/file");
      expect(result.code).toBe(0);
      expect(mockedSpawn).toHaveBeenCalledWith(
        "scp",
        expect.arrayContaining(["/local/file", "root@1.2.3.4:/tmp/file"]),
        expect.any(Object),
      );
    });

    it("should resolve with code 1 and stderr on failure", async () => {
      mockedSpawn.mockReturnValue(createMockProcess(1, "Permission denied"));
      const result = await scpUpload("1.2.3.4", "/local/file", "/tmp/file");
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

      const result = await scpUpload("1.2.3.4", "/local/file", "/tmp/file");
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("ENOENT");
    });
  });

  describe("loadManifest", () => {
    it("should return undefined when manifest does not exist", () => {
      mockedExistsSync.mockReturnValue(false);
      expect(loadManifest("/some/path")).toBeUndefined();
    });

    it("should parse valid manifest", () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
      const result = loadManifest("/some/path");
      expect(result?.serverName).toBe("coolify-test");
      expect(result?.coolifyVersion).toBe("4.0.0");
    });

    it("should return undefined for invalid JSON", () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue("not json{{{");
      expect(loadManifest("/some/path")).toBeUndefined();
    });
  });

  // Command tests
  describe("restoreCommand", () => {
    it("should show error when SSH not available", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(false);
      await restoreCommand();
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("SSH client not found");
    });

    it("should return when no server found", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([]);
      await restoreCommand("nonexistent");
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Server not found");
    });

    it("should show info when no backups exist", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedBackup.listBackups.mockReturnValue([]);

      await restoreCommand("1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("No backups found");
    });

    it("should show error for invalid manifest", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedExistsSync.mockReturnValue(false);

      await restoreCommand("1.2.3.4", { backup: "bad-backup" });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Invalid backup");
    });

    it("should show error for missing backup file", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedExistsSync.mockImplementation((p) => {
        const path = String(p);
        if (path.includes("manifest.json")) return true;
        if (path.includes("coolify-backup.sql.gz")) return false;
        return true;
      });
      mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));

      await restoreCommand("1.2.3.4", { backup: "some-backup" });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Missing backup file");
    });

    it("should show dry-run output", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));

      await restoreCommand("1.2.3.4", { backup: "my-backup", dryRun: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Dry Run");
      expect(output).toContain("No changes applied");
      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
    });

    it("should cancel when first confirm is false", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
      mockedInquirer.prompt = jest.fn().mockResolvedValue({ confirm: false }) as any;

      await restoreCommand("1.2.3.4", { backup: "my-backup" });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("cancelled");
    });

    it("should cancel when name does not match", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
      mockedInquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ confirm: true })
        .mockResolvedValueOnce({ confirmName: "wrong-name" }) as any;

      await restoreCommand("1.2.3.4", { backup: "my-backup" });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("does not match");
    });

    it("should select backup from prompt when not specified", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedBackup.listBackups.mockReturnValue(["2026-02-21_15-30-45-123"]);
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
      mockedInquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ backup: "2026-02-21_15-30-45-123" })
        .mockResolvedValueOnce({ confirm: false }) as any;

      await restoreCommand("1.2.3.4");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("cancelled");
    });

    it("should handle SCP upload failure", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
      mockedInquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ confirm: true })
        .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;
      mockedSpawn.mockReturnValueOnce(createMockProcess(1, "upload failed"));

      await restoreCommand("1.2.3.4", { backup: "my-backup" });

      // Should not proceed to stop Coolify
      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
    });

    it("should handle SCP config upload failure with stderr", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
      mockedInquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ confirm: true })
        .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;
      mockedSpawn
        .mockReturnValueOnce(createMockProcess(0)) // db upload OK
        .mockReturnValueOnce(createMockProcess(1, "upload failed")); // config upload fail

      await restoreCommand("1.2.3.4", { backup: "my-backup" });
      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
    });

    it("should handle SCP config upload failure without stderr", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
      mockedInquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ confirm: true })
        .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;
      mockedSpawn
        .mockReturnValueOnce(createMockProcess(0))
        .mockReturnValueOnce(createMockProcess(1)); // config upload fail, no stderr

      await restoreCommand("1.2.3.4", { backup: "my-backup" });
      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
    });

    it("should handle stop Coolify failure", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
      mockedInquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ confirm: true })
        .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;
      mockedSpawn
        .mockReturnValueOnce(createMockProcess(0))
        .mockReturnValueOnce(createMockProcess(0));
      mockedSsh.sshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "stop error" });

      await restoreCommand("1.2.3.4", { backup: "my-backup" });
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(1);
    });

    it("should complete full restore successfully", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
      mockedInquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ confirm: true })
        .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;
      // SCP uploads
      mockedSpawn
        .mockReturnValueOnce(createMockProcess(0)) // db upload
        .mockReturnValueOnce(createMockProcess(0)); // config upload
      // SSH steps: stop, start-db, restore-db, restore-config, start, cleanup
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // stop
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // start db
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // restore db
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // restore config
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // start all
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // cleanup

      await restoreCommand("1.2.3.4", { backup: "my-backup" });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Restore complete");
      expect(output).toContain("Coolify 4.0.0");
    });

    it("should handle db start failure with stderr", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
      mockedInquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ confirm: true })
        .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;
      mockedSpawn
        .mockReturnValueOnce(createMockProcess(0))
        .mockReturnValueOnce(createMockProcess(0));
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // stop OK
        .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "db start error" }) // db start fail
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // tryRestartCoolify

      await restoreCommand("1.2.3.4", { backup: "my-backup" });
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(3);
    });

    it("should handle db start failure without stderr", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
      mockedInquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ confirm: true })
        .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;
      mockedSpawn
        .mockReturnValueOnce(createMockProcess(0))
        .mockReturnValueOnce(createMockProcess(0));
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // tryRestartCoolify

      await restoreCommand("1.2.3.4", { backup: "my-backup" });
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(3);
    });

    it("should handle db restore failure with stderr", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
      mockedInquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ confirm: true })
        .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;
      mockedSpawn
        .mockReturnValueOnce(createMockProcess(0))
        .mockReturnValueOnce(createMockProcess(0));
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // stop
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // db start
        .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "psql error" }) // db restore fail
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // tryRestartCoolify

      await restoreCommand("1.2.3.4", { backup: "my-backup" });
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(4);
    });

    it("should handle db restore failure without stderr", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
      mockedInquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ confirm: true })
        .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;
      mockedSpawn
        .mockReturnValueOnce(createMockProcess(0))
        .mockReturnValueOnce(createMockProcess(0));
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // tryRestartCoolify

      await restoreCommand("1.2.3.4", { backup: "my-backup" });
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(4);
    });

    it("should handle config restore failure with stderr", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
      mockedInquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ confirm: true })
        .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;
      mockedSpawn
        .mockReturnValueOnce(createMockProcess(0))
        .mockReturnValueOnce(createMockProcess(0));
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // stop
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // db start
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // db restore
        .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "tar error" }) // config restore fail
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // tryRestartCoolify

      await restoreCommand("1.2.3.4", { backup: "my-backup" });
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(5);
    });

    it("should handle config restore failure without stderr", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
      mockedInquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ confirm: true })
        .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;
      mockedSpawn
        .mockReturnValueOnce(createMockProcess(0))
        .mockReturnValueOnce(createMockProcess(0));
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // tryRestartCoolify

      await restoreCommand("1.2.3.4", { backup: "my-backup" });
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(5);
    });

    it("should handle start Coolify failure with stderr", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
      mockedInquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ confirm: true })
        .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;
      mockedSpawn
        .mockReturnValueOnce(createMockProcess(0))
        .mockReturnValueOnce(createMockProcess(0));
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // stop
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // db start
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // db restore
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // config restore
        .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "start error" }); // start fail

      await restoreCommand("1.2.3.4", { backup: "my-backup" });
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(5);
    });

    it("should handle start Coolify failure without stderr", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
      mockedInquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ confirm: true })
        .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;
      mockedSpawn
        .mockReturnValueOnce(createMockProcess(0))
        .mockReturnValueOnce(createMockProcess(0));
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" });

      await restoreCommand("1.2.3.4", { backup: "my-backup" });
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(5);
    });

    it("should handle SCP upload exception", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
      mockedInquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ confirm: true })
        .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;
      // spawn throws synchronously → Promise rejects → catch block triggered
      mockedSpawn.mockImplementationOnce(() => {
        throw new Error("ENOMEM");
      });

      await restoreCommand("1.2.3.4", { backup: "my-backup" });
      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
    });

    it("should handle stop exception", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
      mockedInquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ confirm: true })
        .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;
      mockedSpawn
        .mockReturnValueOnce(createMockProcess(0))
        .mockReturnValueOnce(createMockProcess(0));
      mockedSsh.sshExec.mockRejectedValueOnce(new Error("SSH timeout"));

      await restoreCommand("1.2.3.4", { backup: "my-backup" });
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(1);
    });

    it("should handle db start exception", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
      mockedInquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ confirm: true })
        .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;
      mockedSpawn
        .mockReturnValueOnce(createMockProcess(0))
        .mockReturnValueOnce(createMockProcess(0));
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // stop OK
        .mockRejectedValueOnce(new Error("Connection reset")) // db start throws
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // tryRestartCoolify

      await restoreCommand("1.2.3.4", { backup: "my-backup" });
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(3);
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("SSH connection reset");
    });

    it("should handle db restore exception", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
      mockedInquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ confirm: true })
        .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;
      mockedSpawn
        .mockReturnValueOnce(createMockProcess(0))
        .mockReturnValueOnce(createMockProcess(0));
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // stop
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // db start
        .mockRejectedValueOnce(new Error("psql crash")) // db restore throws
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // tryRestartCoolify

      await restoreCommand("1.2.3.4", { backup: "my-backup" });
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(4);
    });

    it("should handle config restore exception", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
      mockedInquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ confirm: true })
        .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;
      mockedSpawn
        .mockReturnValueOnce(createMockProcess(0))
        .mockReturnValueOnce(createMockProcess(0));
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // stop
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // db start
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // db restore
        .mockRejectedValueOnce(new Error("tar crash")) // config restore throws
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // tryRestartCoolify

      await restoreCommand("1.2.3.4", { backup: "my-backup" });
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(5);
    });

    it("should handle start Coolify exception", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
      mockedInquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ confirm: true })
        .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;
      mockedSpawn
        .mockReturnValueOnce(createMockProcess(0))
        .mockReturnValueOnce(createMockProcess(0));
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // stop
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // db start
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // db restore
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // config restore
        .mockRejectedValueOnce(new Error("compose up failed")); // start throws

      await restoreCommand("1.2.3.4", { backup: "my-backup" });
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(5);
    });

    it("should handle SCP db upload failure without stderr", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
      mockedInquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ confirm: true })
        .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;
      mockedSpawn.mockReturnValueOnce(createMockProcess(1)); // code 1, no stderr

      await restoreCommand("1.2.3.4", { backup: "my-backup" });
      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
    });

    it("should handle stop failure without stderr", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
      mockedInquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ confirm: true })
        .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;
      mockedSpawn
        .mockReturnValueOnce(createMockProcess(0))
        .mockReturnValueOnce(createMockProcess(0));
      mockedSsh.sshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" });

      await restoreCommand("1.2.3.4", { backup: "my-backup" });
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(1);
    });

    describe("rollback — tryRestartCoolify on failure after stop", () => {
      it("should call tryRestartCoolify when db start fails (non-zero code)", async () => {
        mockedSsh.checkSshAvailable.mockReturnValue(true);
        mockedConfig.findServers.mockReturnValue([sampleServer]);
        mockedExistsSync.mockReturnValue(true);
        mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
        mockedInquirer.prompt = jest
          .fn()
          .mockResolvedValueOnce({ confirm: true })
          .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;
        mockedSpawn
          .mockReturnValueOnce(createMockProcess(0))
          .mockReturnValueOnce(createMockProcess(0));
        mockedSsh.sshExec
          .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // stop OK
          .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "db error" }) // db start fail
          .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // tryRestartCoolify

        await restoreCommand("1.2.3.4", { backup: "my-backup" });

        // Last sshExec call should be the restart attempt (buildStartCoolifyCommand)
        const lastCall = mockedSsh.sshExec.mock.calls[2];
        expect(lastCall[1]).toContain("up -d");
      });

      it("should call tryRestartCoolify when db start throws exception", async () => {
        mockedSsh.checkSshAvailable.mockReturnValue(true);
        mockedConfig.findServers.mockReturnValue([sampleServer]);
        mockedExistsSync.mockReturnValue(true);
        mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
        mockedInquirer.prompt = jest
          .fn()
          .mockResolvedValueOnce({ confirm: true })
          .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;
        mockedSpawn
          .mockReturnValueOnce(createMockProcess(0))
          .mockReturnValueOnce(createMockProcess(0));
        mockedSsh.sshExec
          .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // stop OK
          .mockRejectedValueOnce(new Error("Connection reset")) // db start throws
          .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // tryRestartCoolify

        await restoreCommand("1.2.3.4", { backup: "my-backup" });

        expect(mockedSsh.sshExec).toHaveBeenCalledTimes(3);
        const lastCall = mockedSsh.sshExec.mock.calls[2];
        expect(lastCall[1]).toContain("up -d");
      });

      it("should call tryRestartCoolify when db restore fails (non-zero code)", async () => {
        mockedSsh.checkSshAvailable.mockReturnValue(true);
        mockedConfig.findServers.mockReturnValue([sampleServer]);
        mockedExistsSync.mockReturnValue(true);
        mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
        mockedInquirer.prompt = jest
          .fn()
          .mockResolvedValueOnce({ confirm: true })
          .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;
        mockedSpawn
          .mockReturnValueOnce(createMockProcess(0))
          .mockReturnValueOnce(createMockProcess(0));
        mockedSsh.sshExec
          .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // stop
          .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // db start
          .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "psql error" }) // db restore fail
          .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // tryRestartCoolify

        await restoreCommand("1.2.3.4", { backup: "my-backup" });

        expect(mockedSsh.sshExec).toHaveBeenCalledTimes(4);
        const lastCall = mockedSsh.sshExec.mock.calls[3];
        expect(lastCall[1]).toContain("up -d");
      });

      it("should call tryRestartCoolify when config restore fails (non-zero code)", async () => {
        mockedSsh.checkSshAvailable.mockReturnValue(true);
        mockedConfig.findServers.mockReturnValue([sampleServer]);
        mockedExistsSync.mockReturnValue(true);
        mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
        mockedInquirer.prompt = jest
          .fn()
          .mockResolvedValueOnce({ confirm: true })
          .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;
        mockedSpawn
          .mockReturnValueOnce(createMockProcess(0))
          .mockReturnValueOnce(createMockProcess(0));
        mockedSsh.sshExec
          .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // stop
          .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // db start
          .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // db restore
          .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "tar error" }) // config fail
          .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // tryRestartCoolify

        await restoreCommand("1.2.3.4", { backup: "my-backup" });

        expect(mockedSsh.sshExec).toHaveBeenCalledTimes(5);
        const lastCall = mockedSsh.sshExec.mock.calls[4];
        expect(lastCall[1]).toContain("up -d");
      });

      it("should call tryRestartCoolify when config restore throws exception", async () => {
        mockedSsh.checkSshAvailable.mockReturnValue(true);
        mockedConfig.findServers.mockReturnValue([sampleServer]);
        mockedExistsSync.mockReturnValue(true);
        mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
        mockedInquirer.prompt = jest
          .fn()
          .mockResolvedValueOnce({ confirm: true })
          .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;
        mockedSpawn
          .mockReturnValueOnce(createMockProcess(0))
          .mockReturnValueOnce(createMockProcess(0));
        mockedSsh.sshExec
          .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // stop
          .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // db start
          .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // db restore
          .mockRejectedValueOnce(new Error("tar crash")) // config restore throws
          .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // tryRestartCoolify

        await restoreCommand("1.2.3.4", { backup: "my-backup" });

        expect(mockedSsh.sshExec).toHaveBeenCalledTimes(5);
        const lastCall = mockedSsh.sshExec.mock.calls[4];
        expect(lastCall[1]).toContain("up -d");
      });

      it("should not crash if tryRestartCoolify itself fails", async () => {
        mockedSsh.checkSshAvailable.mockReturnValue(true);
        mockedConfig.findServers.mockReturnValue([sampleServer]);
        mockedExistsSync.mockReturnValue(true);
        mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
        mockedInquirer.prompt = jest
          .fn()
          .mockResolvedValueOnce({ confirm: true })
          .mockResolvedValueOnce({ confirmName: "coolify-test" }) as any;
        mockedSpawn
          .mockReturnValueOnce(createMockProcess(0))
          .mockReturnValueOnce(createMockProcess(0));
        mockedSsh.sshExec
          .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // stop
          .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // db start
          .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "psql error" }) // db restore fail
          .mockRejectedValueOnce(new Error("restart also failed")); // tryRestartCoolify throws

        // Should not throw — tryRestartCoolify swallows errors
        await expect(restoreCommand("1.2.3.4", { backup: "my-backup" })).resolves.toBeUndefined();
      });
    });

    describe("tryRestartCoolify", () => {
      it("should call sshExec with start command", async () => {
        mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
        await tryRestartCoolify("1.2.3.4");
        expect(mockedSsh.sshExec).toHaveBeenCalledWith("1.2.3.4", expect.stringContaining("up -d"));
      });

      it("should swallow errors silently", async () => {
        mockedSsh.sshExec.mockRejectedValueOnce(new Error("connection refused"));
        await expect(tryRestartCoolify("1.2.3.4")).resolves.toBeUndefined();
      });
    });

    describe("UX #12 — cross-provider warning and mode mismatch block", () => {
      it("should warn when restoring backup from different provider", async () => {
        mockedSsh.checkSshAvailable.mockReturnValue(true);
        // Server is on digitalocean, but manifest says hetzner
        const doServer = { ...sampleServer, provider: "digitalocean" };
        mockedConfig.findServers.mockReturnValue([doServer]);
        mockedExistsSync.mockReturnValue(true);
        mockedReadFileSync.mockReturnValue(JSON.stringify({
          ...sampleManifest,
          provider: "hetzner", // backup was from hetzner
        }));
        mockedInquirer.prompt = jest
          .fn()
          .mockResolvedValueOnce({ confirm: false }) as any; // cancel after warning

        await restoreCommand("1.2.3.4", { backup: "my-backup" });

        const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
        expect(output).toContain("hetzner");
        expect(output).toContain("digitalocean");
        expect(output).toContain("caution");
      });

      it("should block restore when mode is mismatched (coolify backup → bare server)", async () => {
        mockedSsh.checkSshAvailable.mockReturnValue(true);
        const bareServer = { ...sampleServer, mode: "bare" as const };
        mockedConfig.findServers.mockReturnValue([bareServer]);
        mockedExistsSync.mockReturnValue(true);
        // Manifest has no mode (defaults to coolify)
        mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));

        await restoreCommand("1.2.3.4", { backup: "my-backup" });

        const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
        expect(output).toContain("Mode mismatch");
        // Should not proceed to confirmation
        expect(mockedInquirer.prompt).not.toHaveBeenCalled();
      });

      it("should block restore when mode is mismatched (bare backup → coolify server)", async () => {
        mockedSsh.checkSshAvailable.mockReturnValue(true);
        mockedConfig.findServers.mockReturnValue([sampleServer]); // coolify server
        mockedExistsSync.mockReturnValue(true);
        // Manifest has mode: bare
        mockedReadFileSync.mockReturnValue(JSON.stringify({
          ...sampleManifest,
          mode: "bare",
        }));

        await restoreCommand("1.2.3.4", { backup: "my-backup" });

        const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
        expect(output).toContain("Mode mismatch");
        expect(mockedInquirer.prompt).not.toHaveBeenCalled();
      });

      it("should not block restore when provider matches", async () => {
        mockedSsh.checkSshAvailable.mockReturnValue(true);
        mockedConfig.findServers.mockReturnValue([sampleServer]);
        mockedExistsSync.mockReturnValue(true);
        mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
        // Cancel at first confirm
        mockedInquirer.prompt = jest.fn().mockResolvedValue({ confirm: false }) as any;

        await restoreCommand("1.2.3.4", { backup: "my-backup" });

        const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
        // No mode mismatch, no cross-provider warning
        expect(output).not.toContain("Mode mismatch");
        expect(output).not.toContain("caution");
        expect(output).toContain("cancelled");
      });
    });

    describe("path traversal protection", () => {
      it("should strip directory traversal from --backup option", async () => {
        mockedSsh.checkSshAvailable.mockReturnValue(true);
        mockedConfig.findServers.mockReturnValue([sampleServer]);
        mockedExistsSync.mockReturnValue(false);

        await restoreCommand("1.2.3.4", { backup: "../../etc/passwd" });

        const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
        expect(output).toContain("Invalid backup");
      });

      it("should strip absolute path from --backup option", async () => {
        mockedSsh.checkSshAvailable.mockReturnValue(true);
        mockedConfig.findServers.mockReturnValue([sampleServer]);
        mockedExistsSync.mockReturnValue(false);

        await restoreCommand("1.2.3.4", { backup: "/tmp/evil/my-backup" });

        const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
        expect(output).toContain("Invalid backup");
      });
    });
  });
});
