import { mkdirSync, existsSync, writeFileSync } from "fs";
import { spawn } from "child_process";
import * as sshUtils from "../../src/utils/ssh";
import { MockChildProcess } from "../helpers/ssh-factories.js";
import {
  buildBareConfigTarCommand,
  buildBareRestoreConfigCommand,
  buildBareCleanupCommand,
  createBareBackup,
  restoreBareBackup,
  restoreBackup,
  formatTimestamp,
  getBackupDir,
  loadManifest,
  scpDownload,
  scpUpload,
} from "../../src/core/backup";

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
jest.mock("../../src/utils/ssh");

const mockedSsh = sshUtils as jest.Mocked<typeof sshUtils>;
const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockedWriteFileSync = writeFileSync as jest.MockedFunction<typeof writeFileSync>;
const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;

function createMockProcess(code: number = 0, stderrData: string = "") {
  const proc = new MockChildProcess(code, 10);
  if (stderrData) {
    setTimeout(() => proc.stderr.emit("data", Buffer.from(stderrData)), 5);
  }
  return proc as unknown as ReturnType<typeof spawn>;
}

describe("core/backup — bare backup/restore", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── Pure function tests ─────────────────────────────────────────────────────

  describe("buildBareConfigTarCommand", () => {
    it("should produce a tar command targeting /etc config files", () => {
      const cmd = buildBareConfigTarCommand();
      expect(cmd).toContain("tar czf");
      expect(cmd).toContain("/tmp/bare-config.tar.gz");
    });

    it("should include nginx config path", () => {
      const cmd = buildBareConfigTarCommand();
      expect(cmd).toContain("etc/nginx");
    });

    it("should include ssh config path", () => {
      const cmd = buildBareConfigTarCommand();
      expect(cmd).toContain("etc/ssh/sshd_config");
    });

    it("should include ufw config path", () => {
      const cmd = buildBareConfigTarCommand();
      expect(cmd).toContain("etc/ufw");
    });

    it("should include crontab path", () => {
      const cmd = buildBareConfigTarCommand();
      expect(cmd).toContain("etc/crontab");
    });

    it("should include fail2ban path", () => {
      const cmd = buildBareConfigTarCommand();
      expect(cmd).toContain("etc/fail2ban");
    });

    it("should NOT contain Coolify-specific paths", () => {
      const cmd = buildBareConfigTarCommand();
      expect(cmd).not.toContain("coolify");
      expect(cmd).not.toContain("pg_dump");
    });

    it("should use --ignore-failed-read to handle missing optional paths", () => {
      const cmd = buildBareConfigTarCommand();
      expect(cmd).toContain("--ignore-failed-read");
    });
  });

  describe("buildBareRestoreConfigCommand", () => {
    it("should produce tar extract targeting /", () => {
      const cmd = buildBareRestoreConfigCommand();
      expect(cmd).toContain("tar xzf");
      expect(cmd).toContain("/tmp/bare-config.tar.gz");
      expect(cmd).toContain("-C /");
    });

    it("should NOT contain Coolify source dir", () => {
      const cmd = buildBareRestoreConfigCommand();
      expect(cmd).not.toContain("/data/coolify");
    });
  });

  describe("buildBareCleanupCommand", () => {
    it("should remove bare-config.tar.gz from /tmp", () => {
      const cmd = buildBareCleanupCommand();
      expect(cmd).toContain("rm -f");
      expect(cmd).toContain("/tmp/bare-config.tar.gz");
    });

    it("should NOT remove coolify backup files", () => {
      const cmd = buildBareCleanupCommand();
      expect(cmd).not.toContain("coolify-backup");
    });
  });

  // ─── createBareBackup tests ───────────────────────────────────────────────────

  describe("createBareBackup", () => {
    it("should call sshExec with bare config tar command (not pg_dump)", async () => {
      mockedSsh.assertValidIp.mockReturnValue(undefined);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // config tar
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // cleanup
      mockedSpawn.mockReturnValue(createMockProcess(0)); // scp download

      await createBareBackup("1.2.3.4", "bare-server", "hetzner");

      const firstCall = mockedSsh.sshExec.mock.calls[0];
      expect(firstCall[1]).toContain("bare-config.tar.gz");
      expect(firstCall[1]).not.toContain("pg_dump");
      expect(firstCall[1]).not.toContain("docker");
    });

    it("should write manifest with mode:'bare'", async () => {
      mockedSsh.assertValidIp.mockReturnValue(undefined);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
      mockedSpawn.mockReturnValue(createMockProcess(0));

      await createBareBackup("1.2.3.4", "bare-server", "hetzner");

      expect(mockedWriteFileSync).toHaveBeenCalled();
      const manifestCall = mockedWriteFileSync.mock.calls[0];
      const manifestJson = JSON.parse(manifestCall[1] as string);
      expect(manifestJson.mode).toBe("bare");
    });

    it("should write manifest with coolifyVersion:'n/a'", async () => {
      mockedSsh.assertValidIp.mockReturnValue(undefined);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
      mockedSpawn.mockReturnValue(createMockProcess(0));

      await createBareBackup("1.2.3.4", "bare-server", "hetzner");

      const manifestCall = mockedWriteFileSync.mock.calls[0];
      const manifestJson = JSON.parse(manifestCall[1] as string);
      expect(manifestJson.coolifyVersion).toBe("n/a");
    });

    it("should download only single tar file (not DB dump + config)", async () => {
      mockedSsh.assertValidIp.mockReturnValue(undefined);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
      mockedSpawn.mockReturnValue(createMockProcess(0));

      await createBareBackup("1.2.3.4", "bare-server", "hetzner");

      // Only one SCP download (bare-config.tar.gz), not two
      expect(mockedSpawn).toHaveBeenCalledTimes(1);
    });

    it("should include bare-config.tar.gz in manifest files list", async () => {
      mockedSsh.assertValidIp.mockReturnValue(undefined);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
      mockedSpawn.mockReturnValue(createMockProcess(0));

      await createBareBackup("1.2.3.4", "bare-server", "hetzner");

      const manifestCall = mockedWriteFileSync.mock.calls[0];
      const manifestJson = JSON.parse(manifestCall[1] as string);
      expect(manifestJson.files).toEqual(["bare-config.tar.gz"]);
    });

    it("should return success:true on success", async () => {
      mockedSsh.assertValidIp.mockReturnValue(undefined);
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
      mockedSpawn.mockReturnValue(createMockProcess(0));

      const result = await createBareBackup("1.2.3.4", "bare-server", "hetzner");
      expect(result.success).toBe(true);
      expect(result.backupPath).toBeDefined();
      expect(result.manifest).toBeDefined();
    });

    it("should return success:false when config tar fails", async () => {
      mockedSsh.assertValidIp.mockReturnValue(undefined);
      mockedSsh.sshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "tar error" });

      const result = await createBareBackup("1.2.3.4", "bare-server", "hetzner");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Config backup failed");
    });

    it("should return success:false when SCP download fails", async () => {
      mockedSsh.assertValidIp.mockReturnValue(undefined);
      mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
      mockedSpawn.mockReturnValue(createMockProcess(1, "scp error"));

      const result = await createBareBackup("1.2.3.4", "bare-server", "hetzner");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Failed to download config backup");
    });

    it("should handle exceptions and return success:false", async () => {
      mockedSsh.assertValidIp.mockReturnValue(undefined);
      mockedSsh.sshExec.mockRejectedValueOnce(new Error("SSH down"));

      const result = await createBareBackup("1.2.3.4", "bare-server", "hetzner");
      expect(result.success).toBe(false);
    });
  });

  // ─── restoreBareBackup tests ──────────────────────────────────────────────────

  describe("restoreBareBackup", () => {
    it("should upload and extract config tar (no Coolify stop/start)", async () => {
      mockedSsh.assertValidIp.mockReturnValue(undefined);
      mockedExistsSync.mockImplementation((p) => {
        const path = String(p);
        if (path.includes("manifest.json")) return true;
        if (path.includes("bare-config.tar.gz")) return true;
        return true;
      });
      // loadManifest reads manifest.json
      const { readFileSync } = jest.requireMock("fs");
      readFileSync.mockReturnValue(
        JSON.stringify({
          serverName: "bare-server",
          provider: "hetzner",
          timestamp: "2026-02-28_08-00-00-000",
          coolifyVersion: "n/a",
          files: ["bare-config.tar.gz"],
          mode: "bare",
        }),
      );
      // SCP upload
      mockedSpawn.mockReturnValue(createMockProcess(0));
      // SSH exec: extract + cleanup
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // extract
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // cleanup

      const result = await restoreBareBackup("1.2.3.4", "bare-server", "2026-02-28_08-00-00-000");
      expect(result.success).toBe(true);
    });

    it("should NOT call buildStopCoolifyCommand or buildStartCoolifyCommand", async () => {
      mockedSsh.assertValidIp.mockReturnValue(undefined);
      mockedExistsSync.mockReturnValue(true);
      const { readFileSync } = jest.requireMock("fs");
      readFileSync.mockReturnValue(
        JSON.stringify({
          serverName: "bare-server",
          provider: "hetzner",
          timestamp: "2026-02-28_08-00-00-000",
          coolifyVersion: "n/a",
          files: ["bare-config.tar.gz"],
          mode: "bare",
        }),
      );
      mockedSpawn.mockReturnValue(createMockProcess(0));
      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // extract
        .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // cleanup

      await restoreBareBackup("1.2.3.4", "bare-server", "2026-02-28_08-00-00-000");

      // No call should contain docker compose stop or start
      for (const call of mockedSsh.sshExec.mock.calls) {
        expect(call[1]).not.toContain("docker compose");
        expect(call[1]).not.toContain("docker-compose");
      }
    });

    it("should return success:false when backup file missing", async () => {
      mockedSsh.assertValidIp.mockReturnValue(undefined);
      mockedExistsSync.mockImplementation((p) => {
        const path = String(p);
        if (path.includes("manifest.json")) return true;
        // bare-config.tar.gz doesn't exist
        return false;
      });
      const { readFileSync } = jest.requireMock("fs");
      readFileSync.mockReturnValue(
        JSON.stringify({
          serverName: "bare-server",
          provider: "hetzner",
          timestamp: "2026-02-28_08-00-00-000",
          coolifyVersion: "n/a",
          files: ["bare-config.tar.gz"],
          mode: "bare",
        }),
      );

      const result = await restoreBareBackup("1.2.3.4", "bare-server", "2026-02-28_08-00-00-000");
      expect(result.success).toBe(false);
      expect(result.error).toContain("bare-config.tar.gz");
    });

    it("should return success:false when manifest missing", async () => {
      mockedSsh.assertValidIp.mockReturnValue(undefined);
      mockedExistsSync.mockReturnValue(false);

      const result = await restoreBareBackup("1.2.3.4", "bare-server", "bad-backup");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should return success:false on SCP upload failure", async () => {
      mockedSsh.assertValidIp.mockReturnValue(undefined);
      mockedExistsSync.mockReturnValue(true);
      const { readFileSync } = jest.requireMock("fs");
      readFileSync.mockReturnValue(
        JSON.stringify({
          serverName: "bare-server",
          provider: "hetzner",
          timestamp: "2026-02-28_08-00-00-000",
          coolifyVersion: "n/a",
          files: ["bare-config.tar.gz"],
          mode: "bare",
        }),
      );
      mockedSpawn.mockReturnValue(createMockProcess(1, "upload failed"));

      const result = await restoreBareBackup("1.2.3.4", "bare-server", "2026-02-28_08-00-00-000");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Upload failed");
    });

    it("should return success:false on extract failure", async () => {
      mockedSsh.assertValidIp.mockReturnValue(undefined);
      mockedExistsSync.mockReturnValue(true);
      const { readFileSync } = jest.requireMock("fs");
      readFileSync.mockReturnValue(
        JSON.stringify({
          serverName: "bare-server",
          provider: "hetzner",
          timestamp: "2026-02-28_08-00-00-000",
          coolifyVersion: "n/a",
          files: ["bare-config.tar.gz"],
          mode: "bare",
        }),
      );
      mockedSpawn.mockReturnValue(createMockProcess(0)); // upload OK
      mockedSsh.sshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "tar extract error" }); // extract fail

      const result = await restoreBareBackup("1.2.3.4", "bare-server", "2026-02-28_08-00-00-000");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Config restore failed");
    });

    it("should return path traversal error for ../ in backupId", async () => {
      mockedSsh.assertValidIp.mockReturnValue(undefined);

      const result = await restoreBareBackup("1.2.3.4", "bare-server", "../../etc/passwd");
      expect(result.success).toBe(false);
      expect(result.error).toContain("path traversal");
    });

    it("should handle exceptions and return success:false", async () => {
      mockedSsh.assertValidIp.mockReturnValue(undefined);
      mockedExistsSync.mockReturnValue(true);
      const { readFileSync } = jest.requireMock("fs");
      readFileSync.mockReturnValue(
        JSON.stringify({
          serverName: "bare-server",
          provider: "hetzner",
          timestamp: "2026-02-28_08-00-00-000",
          coolifyVersion: "n/a",
          files: ["bare-config.tar.gz"],
          mode: "bare",
        }),
      );
      mockedSpawn.mockImplementationOnce(() => {
        throw new Error("ENOMEM");
      });

      const result = await restoreBareBackup("1.2.3.4", "bare-server", "2026-02-28_08-00-00-000");
      expect(result.success).toBe(false);
    });
  });
});

describe("SCP binary path resolution (BUGF-01)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("scpDownload should use resolveScpPath result as spawn binary", async () => {
    mockedSsh.resolveScpPath = jest.fn().mockReturnValue("/custom/path/scp.exe");
    mockedSpawn.mockReturnValue(createMockProcess(0));
    await scpDownload("1.2.3.4", "/tmp/file.gz", "/local/file.gz");
    const [binary] = mockedSpawn.mock.calls[0];
    expect(binary).toBe("/custom/path/scp.exe");
  });

  it("scpUpload should use resolveScpPath result as spawn binary", async () => {
    mockedSsh.resolveScpPath = jest.fn().mockReturnValue("/custom/path/scp.exe");
    mockedSpawn.mockReturnValue(createMockProcess(0));
    await scpUpload("1.2.3.4", "/local/file.gz", "/tmp/file.gz");
    const [binary] = mockedSpawn.mock.calls[0];
    expect(binary).toBe("/custom/path/scp.exe");
  });
});

// Mock getAdapter for restoreBackup delegation tests
jest.mock("../../src/adapters/factory", () => ({
  getAdapter: jest.fn(),
}));

import { getAdapter } from "../../src/adapters/factory";
const mockGetAdapter = getAdapter as jest.MockedFunction<typeof getAdapter>;

describe("restoreBackup — adapter delegation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.KASTELL_SAFE_MODE = "false";
  });

  it("should delegate to DokployAdapter when manifest.platform is 'dokploy'", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedExistsSync.mockReturnValue(true);
    const { readFileSync } = jest.requireMock("fs");
    readFileSync.mockReturnValue(
      JSON.stringify({
        serverName: "dok-server",
        provider: "hetzner",
        timestamp: "2026-01-01_00-00-00",
        coolifyVersion: "v0.26.6",
        files: ["dokploy-backup.sql.gz", "dokploy-config.tar.gz"],
        platform: "dokploy",
      }),
    );

    const mockRestoreBackup = jest.fn().mockResolvedValue({
      success: true,
      steps: [{ name: "Restore database", status: "success" }],
    });
    mockGetAdapter.mockReturnValue({
      name: "dokploy",
      restoreBackup: mockRestoreBackup,
    } as unknown as ReturnType<typeof mockGetAdapter>);

    const result = await restoreBackup("1.2.3.4", "dok-server", "2026-01-01_00-00-00");
    expect(result.success).toBe(true);
    expect(mockGetAdapter).toHaveBeenCalledWith("dokploy");
    expect(mockRestoreBackup).toHaveBeenCalled();
  });

  it("should default to 'coolify' when manifest.platform is undefined", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedExistsSync.mockReturnValue(true);
    const { readFileSync } = jest.requireMock("fs");
    readFileSync.mockReturnValue(
      JSON.stringify({
        serverName: "old-server",
        provider: "hetzner",
        timestamp: "2026-01-01_00-00-00",
        coolifyVersion: "4.0.0",
        files: ["coolify-backup.sql.gz", "coolify-config.tar.gz"],
      }),
    );

    const mockRestoreBackup = jest.fn().mockResolvedValue({
      success: true,
      steps: [{ name: "Restore database", status: "success" }],
    });
    mockGetAdapter.mockReturnValue({
      name: "coolify",
      restoreBackup: mockRestoreBackup,
    } as unknown as ReturnType<typeof mockGetAdapter>);

    const result = await restoreBackup("1.2.3.4", "old-server", "2026-01-01_00-00-00");
    expect(result.success).toBe(true);
    expect(mockGetAdapter).toHaveBeenCalledWith("coolify");
  });
});

describe("SCP security hardening (SEC-01, SEC-02)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("scpDownload", () => {
    it("should spawn with stdio[0] === 'ignore' (not 'inherit')", async () => {
      mockedSpawn.mockReturnValue(createMockProcess(0));
      await scpDownload("1.2.3.4", "/tmp/file.gz", "/local/file.gz");
      const [, , opts] = mockedSpawn.mock.calls[0];
      expect((opts as Record<string, unknown> & { stdio: unknown[] }).stdio[0]).toBe("ignore");
    });

    it("should include -o BatchMode=yes in SCP args", async () => {
      mockedSpawn.mockReturnValue(createMockProcess(0));
      await scpDownload("1.2.3.4", "/tmp/file.gz", "/local/file.gz");
      const [, args] = mockedSpawn.mock.calls[0];
      const argsStr = (args as string[]).join(" ");
      expect(argsStr).toContain("BatchMode=yes");
    });

    it("should reject with timeout error when SCP hangs", async () => {
      jest.useFakeTimers();
      // Process that never closes
      const hangingProc = new MockChildProcess(0, 400000);
      (hangingProc as unknown as { kill: jest.Mock }).kill = jest.fn();
      mockedSpawn.mockReturnValue(hangingProc as unknown as ReturnType<typeof spawn>);

      const promise = scpDownload("1.2.3.4", "/tmp/file.gz", "/local/file.gz");
      jest.advanceTimersByTime(300_001);
      // Flush microtasks so the rejection propagates before we check
      await Promise.resolve();
      let caughtError: Error | undefined;
      await promise.catch((e: Error) => { caughtError = e; });
      expect(caughtError).toBeDefined();
      expect(caughtError!.message).toMatch(/timeout/i);
      jest.useRealTimers();
    });

    it("should kill the child process (SIGTERM) on timeout", async () => {
      jest.useFakeTimers();
      const hangingProc = new MockChildProcess(0, 400000);
      const killMock = jest.fn();
      (hangingProc as unknown as { kill: jest.Mock }).kill = killMock;
      mockedSpawn.mockReturnValue(hangingProc as unknown as ReturnType<typeof spawn>);

      const promise = scpDownload("1.2.3.4", "/tmp/file.gz", "/local/file.gz");
      jest.advanceTimersByTime(300_001);
      await Promise.resolve();
      await promise.catch(() => {});
      expect(killMock).toHaveBeenCalledWith("SIGTERM");
      jest.useRealTimers();
    });
  });

  describe("scpUpload", () => {
    it("should spawn with stdio[0] === 'ignore' (not 'inherit')", async () => {
      mockedSpawn.mockReturnValue(createMockProcess(0));
      await scpUpload("1.2.3.4", "/local/file.gz", "/tmp/file.gz");
      const [, , opts] = mockedSpawn.mock.calls[0];
      expect((opts as Record<string, unknown> & { stdio: unknown[] }).stdio[0]).toBe("ignore");
    });

    it("should include -o BatchMode=yes in SCP args", async () => {
      mockedSpawn.mockReturnValue(createMockProcess(0));
      await scpUpload("1.2.3.4", "/local/file.gz", "/tmp/file.gz");
      const [, args] = mockedSpawn.mock.calls[0];
      const argsStr = (args as string[]).join(" ");
      expect(argsStr).toContain("BatchMode=yes");
    });

    it("should reject with timeout error when SCP hangs", async () => {
      jest.useFakeTimers();
      const hangingProc = new MockChildProcess(0, 400000);
      (hangingProc as unknown as { kill: jest.Mock }).kill = jest.fn();
      mockedSpawn.mockReturnValue(hangingProc as unknown as ReturnType<typeof spawn>);

      const promise = scpUpload("1.2.3.4", "/local/file.gz", "/tmp/file.gz");
      jest.advanceTimersByTime(300_001);
      // Flush microtasks so the rejection propagates before we check
      await Promise.resolve();
      let caughtError: Error | undefined;
      await promise.catch((e: Error) => { caughtError = e; });
      expect(caughtError).toBeDefined();
      expect(caughtError!.message).toMatch(/timeout/i);
      jest.useRealTimers();
    });

    it("should kill the child process (SIGTERM) on timeout", async () => {
      jest.useFakeTimers();
      const hangingProc = new MockChildProcess(0, 400000);
      const killMock = jest.fn();
      (hangingProc as unknown as { kill: jest.Mock }).kill = killMock;
      mockedSpawn.mockReturnValue(hangingProc as unknown as ReturnType<typeof spawn>);

      const promise = scpUpload("1.2.3.4", "/local/file.gz", "/tmp/file.gz");
      jest.advanceTimersByTime(300_001);
      await Promise.resolve();
      await promise.catch(() => {});
      expect(killMock).toHaveBeenCalledWith("SIGTERM");
      jest.useRealTimers();
    });
  });
});
