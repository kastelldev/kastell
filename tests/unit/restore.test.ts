import { readFileSync, existsSync } from "fs";
import { spawn } from "child_process";
import { EventEmitter } from "events";
import inquirer from "inquirer";
import * as config from "../../src/utils/config";
import * as sshUtils from "../../src/utils/ssh";
import * as coreBackup from "../../src/core/backup";
import * as adapterFactory from "../../src/adapters/factory";
import {
  tryRestartCoolify,
  buildStopCoolifyCommand,
  buildStartCoolifyCommand,
  buildStartDbCommand,
  buildRestoreDbCommand,
  buildRestoreConfigCommand,
  buildCleanupCommand,
  loadManifest,
  scpUpload,
} from "../../src/core/backup";
import { restoreCommand } from "../../src/commands/restore";

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
jest.mock("../../src/core/backup", () => {
  const actual = jest.requireActual("../../src/core/backup");
  return {
    ...actual,
    listBackups: jest.fn(),
    getBackupDir: jest.fn().mockReturnValue("/home/user/.kastell/backups/coolify-test"),
  };
});
jest.mock("../../src/adapters/factory", () => ({
  getAdapter: jest.fn(),
  resolvePlatform: jest.fn().mockReturnValue("coolify"),
  detectPlatform: jest.fn(),
}));

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedSsh = sshUtils as jest.Mocked<typeof sshUtils>;
const mockedBackup = coreBackup as jest.Mocked<typeof coreBackup>;
const mockedAdapterFactory = adapterFactory as jest.Mocked<typeof adapterFactory>;
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
  mode: "coolify" as const,
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

const defaultCoolifyAdapter = {
  name: "coolify",
  port: 8000,
  defaultLogService: "coolify",
  platformPorts: [80, 443, 8000],
  restoreBackup: jest.fn(),
  getCloudInit: jest.fn(),
  healthCheck: jest.fn(),
  createBackup: jest.fn(),
  getStatus: jest.fn(),
  update: jest.fn(),
};

const defaultDokployAdapter = {
  name: "dokploy",
  port: 3000,
  defaultLogService: "dokploy",
  platformPorts: [80, 443, 3000],
  restoreBackup: jest.fn(),
  getCloudInit: jest.fn(),
  healthCheck: jest.fn(),
  createBackup: jest.fn(),
  getStatus: jest.fn(),
  update: jest.fn(),
};

describe("restore", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
    mockedSsh.resolveScpPath.mockReturnValue("scp");
    mockedAdapterFactory.getAdapter.mockImplementation((platform: string) =>
      platform === "dokploy" ? defaultDokployAdapter as any : defaultCoolifyAdapter as any,
    );
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

    describe("adapter-delegated restore (actual, non-dry-run)", () => {
      const mockRestoreBackup = jest.fn();
      const mockCoolifyAdapter = {
        name: "coolify",
        port: 8000,
        defaultLogService: "coolify",
        platformPorts: [80, 443, 8000],
        restoreBackup: mockRestoreBackup,
        getCloudInit: jest.fn(),
        healthCheck: jest.fn(),
        createBackup: jest.fn(),
        getStatus: jest.fn(),
        update: jest.fn(),
      };
      const mockDokployAdapter = {
        name: "dokploy",
        port: 3000,
        defaultLogService: "dokploy",
        platformPorts: [80, 443, 3000],
        restoreBackup: mockRestoreBackup,
        getCloudInit: jest.fn(),
        healthCheck: jest.fn(),
        createBackup: jest.fn(),
        getStatus: jest.fn(),
        update: jest.fn(),
      };

      function setupActualRestore(manifest = sampleManifest, server = sampleServer) {
        mockedSsh.checkSshAvailable.mockReturnValue(true);
        mockedConfig.findServers.mockReturnValue([server]);
        mockedExistsSync.mockReturnValue(true);
        mockedReadFileSync.mockReturnValue(JSON.stringify(manifest));
        mockedInquirer.prompt = jest
          .fn()
          .mockResolvedValueOnce({ confirm: true })
          .mockResolvedValueOnce({ confirmName: server.name }) as any;
        mockedAdapterFactory.getAdapter.mockImplementation((platform: string) =>
          platform === "dokploy" ? mockDokployAdapter as any : mockCoolifyAdapter as any,
        );
      }

      beforeEach(() => {
        mockRestoreBackup.mockReset();
      });

      it("should complete full restore successfully via adapter (coolify)", async () => {
        setupActualRestore();
        mockRestoreBackup.mockResolvedValue({
          success: true,
          steps: [
            { name: "Upload backup files", status: "success" },
            { name: "Stop Coolify", status: "success" },
            { name: "Restore database", status: "success" },
            { name: "Start Coolify", status: "success" },
          ],
        });

        await restoreCommand("1.2.3.4", { backup: "my-backup" });

        const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
        expect(output).toContain("Restore complete");
        expect(output).toContain("Coolify 4.0.0");
        expect(output).toContain(":8000");
        expect(mockedAdapterFactory.getAdapter).toHaveBeenCalledWith("coolify");
        expect(mockRestoreBackup).toHaveBeenCalledWith(
          "1.2.3.4",
          expect.stringContaining("my-backup"),
          expect.objectContaining({ coolifyVersion: "4.0.0" }),
        );
      });

      it("should route to dokploy adapter when manifest has platform: dokploy", async () => {
        const dokployManifest = {
          ...sampleManifest,
          platform: "dokploy",
          files: ["dokploy-backup.sql.gz", "dokploy-config.tar.gz"],
        };
        const dokployServer = { ...sampleServer, platform: "dokploy" };
        setupActualRestore(dokployManifest, dokployServer);
        mockRestoreBackup.mockResolvedValue({
          success: true,
          steps: [
            { name: "Upload backup files", status: "success" },
            { name: "Scale down Dokploy", status: "success" },
            { name: "Restore database", status: "success" },
            { name: "Scale up Dokploy", status: "success" },
          ],
        });

        await restoreCommand("1.2.3.4", { backup: "my-backup" });

        const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
        expect(output).toContain("Restore complete");
        expect(output).toContain("Dokploy 4.0.0");
        expect(output).toContain(":3000");
        expect(mockedAdapterFactory.getAdapter).toHaveBeenCalledWith("dokploy");
      });

      it("should default to coolify adapter when manifest has no platform field", async () => {
        const noPlatformManifest = { ...sampleManifest };
        delete (noPlatformManifest as any).platform;
        setupActualRestore(noPlatformManifest);
        mockRestoreBackup.mockResolvedValue({
          success: true,
          steps: [{ name: "Restore", status: "success" }],
        });

        await restoreCommand("1.2.3.4", { backup: "my-backup" });

        expect(mockedAdapterFactory.getAdapter).toHaveBeenCalledWith("coolify");
        const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
        expect(output).toContain(":8000");
      });

      it("should show failure details when adapter.restoreBackup returns failure", async () => {
        setupActualRestore();
        mockRestoreBackup.mockResolvedValue({
          success: false,
          steps: [
            { name: "Upload backup files", status: "success" },
            { name: "Stop Coolify", status: "success" },
            { name: "Restore database", status: "failure", error: "psql error" },
          ],
          error: "Database restore failed",
          hint: "Check database connectivity",
        });

        await restoreCommand("1.2.3.4", { backup: "my-backup" });

        const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
        expect(output).toContain("restore failed");
        expect(output).toContain("psql error");
        expect(output).toContain("Database restore failed");
        expect(output).toContain("Check database connectivity");
      });

      it("should show failure step with default 'failed' when no error message", async () => {
        setupActualRestore();
        mockRestoreBackup.mockResolvedValue({
          success: false,
          steps: [
            { name: "Upload backup files", status: "failure" },
          ],
        });

        await restoreCommand("1.2.3.4", { backup: "my-backup" });

        const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
        expect(output).toContain("Upload backup files: failed");
      });

      it("should handle adapter.restoreBackup throwing an exception", async () => {
        setupActualRestore();
        mockRestoreBackup.mockRejectedValue(new Error("SSH timeout"));

        await restoreCommand("1.2.3.4", { backup: "my-backup" });

        const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
        expect(output).toContain("SSH timeout");
      });

      it("should not call sshExec directly during adapter-delegated restore", async () => {
        setupActualRestore();
        mockRestoreBackup.mockResolvedValue({
          success: true,
          steps: [{ name: "All steps", status: "success" }],
        });

        await restoreCommand("1.2.3.4", { backup: "my-backup" });

        // sshExec should NOT be called -- adapter handles SSH internally
        expect(mockedSsh.sshExec).not.toHaveBeenCalled();
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

    describe("platform-aware dry-run", () => {
      it("should show Dokploy-specific commands in dry-run when platform is dokploy", async () => {
        mockedSsh.checkSshAvailable.mockReturnValue(true);
        mockedConfig.findServers.mockReturnValue([{ ...sampleServer, platform: "dokploy" }]);
        mockedExistsSync.mockReturnValue(true);
        mockedReadFileSync.mockReturnValue(
          JSON.stringify({
            ...sampleManifest,
            platform: "dokploy",
            files: ["dokploy-backup.sql.gz", "dokploy-config.tar.gz"],
          }),
        );

        await restoreCommand("1.2.3.4", { backup: "my-backup", dryRun: true });

        const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
        expect(output).toContain("Dry Run");
        expect(output).toContain("docker service scale");
        expect(output).toContain("dokploy-postgres");
        expect(output).not.toContain("docker compose");
      });

      it("should show Coolify-specific commands in dry-run when platform is coolify (regression)", async () => {
        mockedSsh.checkSshAvailable.mockReturnValue(true);
        mockedConfig.findServers.mockReturnValue([sampleServer]);
        mockedExistsSync.mockReturnValue(true);
        mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));

        await restoreCommand("1.2.3.4", { backup: "my-backup", dryRun: true });

        const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
        expect(output).toContain("Dry Run");
        expect(output).toContain("docker compose");
        expect(output).not.toContain("docker service scale");
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
