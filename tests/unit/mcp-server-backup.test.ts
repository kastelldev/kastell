import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { spawn } from "child_process";
import * as config from "../../src/utils/config";
import * as ssh from "../../src/utils/ssh";
import * as providerFactory from "../../src/utils/providerFactory";
import * as tokens from "../../src/core/tokens";
import {
  formatTimestamp,
  getBackupDir,
  buildPgDumpCommand,
  buildConfigTarCommand,
  buildCleanupCommand,
  buildCoolifyVersionCommand,
  buildStopCoolifyCommand,
  buildStartCoolifyCommand,
  buildStartDbCommand,
  buildRestoreDbCommand,
  buildRestoreConfigCommand,
  listBackups,
  loadManifest,
  scpDownload,
  scpUpload,
  tryRestartCoolify,
  createBackup,
  restoreBackup,
  createBareBackup,
  restoreBareBackup,
} from "../../src/core/backup";
import {
  createSnapshot,
  listSnapshots,
  deleteSnapshot,
  restoreSnapshot,
} from "../../src/core/snapshot";
import { handleServerBackup } from "../../src/mcp/tools/serverBackup";
import type { CloudProvider } from "../../src/providers/base";
import { MockChildProcess } from "../helpers/ssh-factories.js";

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
jest.mock("../../src/utils/providerFactory");
jest.mock("../../src/core/tokens");

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedSsh = ssh as jest.Mocked<typeof ssh>;
const mockedProviderFactory = providerFactory as jest.Mocked<typeof providerFactory>;
const mockedTokens = tokens as jest.Mocked<typeof tokens>;
const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockedReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;
const mockedReaddirSync = readdirSync as jest.MockedFunction<typeof readdirSync>;
const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;

const sampleServer = {
  id: "123",
  name: "coolify-test",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-02-20T00:00:00Z",
  mode: "coolify" as const,
};

const manualServer = {
  id: "manual-1234567890",
  name: "manual-srv",
  provider: "hetzner",
  ip: "9.8.7.6",
  region: "unknown",
  size: "unknown",
  createdAt: "2026-02-20T00:00:00Z",
  mode: "coolify" as const,
};

const sampleManifest = {
  serverName: "coolify-test",
  provider: "hetzner",
  timestamp: "2026-02-20_12-00-00-000",
  coolifyVersion: "4.0.0",
  files: ["coolify-backup.sql.gz", "coolify-config.tar.gz"],
};

const mockProvider: CloudProvider = {
  name: "hetzner",
  displayName: "Hetzner Cloud",
  validateToken: jest.fn(),
  getRegions: jest.fn().mockReturnValue([]),
  getServerSizes: jest.fn().mockReturnValue([]),
  getAvailableLocations: jest.fn().mockResolvedValue([]),
  getAvailableServerTypes: jest.fn().mockResolvedValue([]),
  uploadSshKey: jest.fn(),
  createServer: jest.fn(),
  getServerStatus: jest.fn(),
  getServerDetails: jest.fn(),
  destroyServer: jest.fn(),
  rebootServer: jest.fn(),
  createSnapshot: jest.fn(),
  listSnapshots: jest.fn(),
  deleteSnapshot: jest.fn(),
  restoreSnapshot: jest.fn(),
  getSnapshotCostEstimate: jest.fn(),
  findServerByIp: jest.fn().mockResolvedValue(null),
};

function createMockProcess(code: number = 0, stderrData: string = "") {
  const proc = new MockChildProcess(code, 10);
  if (stderrData) {
    setTimeout(() => proc.stderr.emit("data", Buffer.from(stderrData)), 5);
  }
  return proc as unknown as ReturnType<typeof spawn>;
}

function createErrorProcess(errorMessage: string) {
  const proc = new MockChildProcess(0, 99999);
  setTimeout(() => proc.emit("error", new Error(errorMessage)), 10);
  return proc as unknown as ReturnType<typeof spawn>;
}

const originalEnv = process.env;

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...originalEnv };
  process.env.KASTELL_SAFE_MODE = "false";
  delete process.env.QUICKLIFY_SAFE_MODE;
  mockedSsh.assertValidIp.mockImplementation(() => {});
  mockedSsh.sanitizedEnv.mockReturnValue({} as NodeJS.ProcessEnv);
  mockedConfig.BACKUPS_DIR = "/tmp/kastell-backups";
});

afterAll(() => {
  process.env = originalEnv;
});

// ═══════════════════════════════════════════════════════════════════════════════
// Core: Pure Functions (Backup)
// ═══════════════════════════════════════════════════════════════════════════════

describe("core/backup - pure functions", () => {
  test("formatTimestamp formats ISO date correctly", () => {
    const date = new Date("2026-02-20T12:30:45.123Z");
    expect(formatTimestamp(date)).toBe("2026-02-20_12-30-45-123");
  });

  test("formatTimestamp handles midnight", () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    expect(formatTimestamp(date)).toBe("2026-01-01_00-00-00-000");
  });

  test("getBackupDir returns correct path", () => {
    const dir = getBackupDir("my-server");
    expect(dir).toContain("my-server");
  });

  test("buildPgDumpCommand returns pg_dump command", () => {
    const cmd = buildPgDumpCommand();
    expect(cmd).toContain("pg_dump");
    expect(cmd).toContain("coolify-db");
    expect(cmd).toContain("gzip");
  });

  test("buildConfigTarCommand returns tar command with fallback", () => {
    const cmd = buildConfigTarCommand();
    expect(cmd).toContain("tar czf");
    expect(cmd).toContain(".env");
    expect(cmd).toContain("docker-compose.yml");
    expect(cmd).toContain("2>/dev/null ||");
  });

  test("buildCleanupCommand removes tmp files", () => {
    const cmd = buildCleanupCommand();
    expect(cmd).toContain("rm -f");
    expect(cmd).toContain("coolify-backup.sql.gz");
    expect(cmd).toContain("coolify-config.tar.gz");
  });

  test("buildCoolifyVersionCommand returns docker inspect command", () => {
    const cmd = buildCoolifyVersionCommand();
    expect(cmd).toContain("docker inspect coolify");
    expect(cmd).toContain("echo unknown");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Core: Pure Functions (Restore)
// ═══════════════════════════════════════════════════════════════════════════════

describe("core/backup - restore pure functions", () => {
  test("buildStopCoolifyCommand stops compose services", () => {
    const cmd = buildStopCoolifyCommand();
    expect(cmd).toContain("docker compose");
    expect(cmd).toContain("stop");
  });

  test("buildStartCoolifyCommand starts compose services", () => {
    const cmd = buildStartCoolifyCommand();
    expect(cmd).toContain("docker compose");
    expect(cmd).toContain("up -d");
  });

  test("buildStartDbCommand starts only postgres", () => {
    const cmd = buildStartDbCommand();
    expect(cmd).toContain("up -d postgres");
    expect(cmd).toContain("sleep 3");
  });

  test("buildRestoreDbCommand pipes gunzip to psql", () => {
    const cmd = buildRestoreDbCommand();
    expect(cmd).toContain("gunzip -c");
    expect(cmd).toContain("psql -U coolify");
  });

  test("buildRestoreConfigCommand extracts tar", () => {
    const cmd = buildRestoreConfigCommand();
    expect(cmd).toContain("tar xzf");
    expect(cmd).toContain("/data/coolify/source");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Core: Semi-Pure Functions (FS Read)
// ═══════════════════════════════════════════════════════════════════════════════

describe("core/backup - listBackups", () => {
  test("returns sorted backup list in reverse order", () => {
    mockedExistsSync.mockImplementation((p: any) => {
      const path = String(p);
      if (path.includes("coolify-test")) return true;
      if (path.includes("manifest.json")) return true;
      return false;
    });
    mockedReaddirSync.mockReturnValue(["2026-02-18_10-00-00-000", "2026-02-20_12-00-00-000", "2026-02-19_08-00-00-000"] as unknown as ReturnType<typeof mockedReaddirSync>);

    const result = listBackups("coolify-test");
    expect(result).toEqual([
      "2026-02-20_12-00-00-000",
      "2026-02-19_08-00-00-000",
      "2026-02-18_10-00-00-000",
    ]);
  });

  test("returns empty array when directory does not exist", () => {
    mockedExistsSync.mockReturnValue(false);
    expect(listBackups("nonexistent")).toEqual([]);
  });

  test("filters out entries without manifest.json", () => {
    mockedExistsSync.mockImplementation((p: any) => {
      const path = String(p);
      if (path.endsWith("coolify-test")) return true;
      if (path.includes("good") && path.includes("manifest.json")) return true;
      return false;
    });
    mockedReaddirSync.mockReturnValue(["good", "bad"] as unknown as ReturnType<typeof mockedReaddirSync>);

    const result = listBackups("coolify-test");
    expect(result).toEqual(["good"]);
  });

  test("returns empty array on readdirSync error", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockImplementation(() => { throw new Error("EACCES"); });
    expect(listBackups("coolify-test")).toEqual([]);
  });
});

describe("core/backup - loadManifest", () => {
  test("loads valid manifest", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));

    const result = loadManifest("/backups/coolify-test/2026-02-20");
    expect(result).toEqual(sampleManifest);
  });

  test("returns undefined when manifest file does not exist", () => {
    mockedExistsSync.mockReturnValue(false);
    expect(loadManifest("/backups/nonexistent")).toBeUndefined();
  });

  test("returns undefined for corrupt JSON", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("not valid json{{{");
    expect(loadManifest("/backups/corrupt")).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Core: SCP Functions
// ═══════════════════════════════════════════════════════════════════════════════

describe("core/backup - scpDownload", () => {
  test("resolves with code 0 on success", async () => {
    mockedSpawn.mockReturnValue(createMockProcess(0));
    const result = await scpDownload("1.2.3.4", "/tmp/file.gz", "/local/file.gz");
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
  });

  test("resolves with code and stderr on failure", async () => {
    mockedSpawn.mockReturnValue(createMockProcess(1, "Permission denied"));
    const result = await scpDownload("1.2.3.4", "/tmp/file.gz", "/local/file.gz");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Permission denied");
  });

  test("resolves with code 1 on spawn error", async () => {
    mockedSpawn.mockReturnValue(createErrorProcess("spawn scp ENOENT"));
    const result = await scpDownload("1.2.3.4", "/tmp/file.gz", "/local/file.gz");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("spawn scp ENOENT");
  });
});

describe("core/backup - scpUpload", () => {
  test("resolves with code 0 on success", async () => {
    mockedSpawn.mockReturnValue(createMockProcess(0));
    const result = await scpUpload("1.2.3.4", "/local/file.gz", "/tmp/file.gz");
    expect(result.code).toBe(0);
  });

  test("resolves with code and stderr on failure", async () => {
    mockedSpawn.mockReturnValue(createMockProcess(1, "Connection refused"));
    const result = await scpUpload("1.2.3.4", "/local/file.gz", "/tmp/file.gz");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Connection refused");
  });

  test("resolves with code 1 on spawn error", async () => {
    mockedSpawn.mockReturnValue(createErrorProcess("spawn scp ENOENT"));
    const result = await scpUpload("1.2.3.4", "/local/file.gz", "/tmp/file.gz");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("spawn scp ENOENT");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Core: tryRestartCoolify
// ═══════════════════════════════════════════════════════════════════════════════

describe("core/backup - tryRestartCoolify", () => {
  test("calls sshExec with start command", async () => {
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    await tryRestartCoolify("1.2.3.4");
    expect(mockedSsh.sshExec).toHaveBeenCalledWith("1.2.3.4", expect.stringContaining("up -d"));
  });

  test("swallows errors silently", async () => {
    mockedSsh.sshExec.mockRejectedValue(new Error("SSH failed"));
    await expect(tryRestartCoolify("1.2.3.4")).resolves.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Core: createBackup
// ═══════════════════════════════════════════════════════════════════════════════

describe("core/backup - createBackup", () => {
  beforeEach(() => {
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "4.0.0", stderr: "" });
    mockedSpawn.mockImplementation(() => createMockProcess(0));
  });

  test("returns success with manifest on full backup", async () => {
    const result = await createBackup("1.2.3.4", "coolify-test", "hetzner");
    expect(result.success).toBe(true);
    expect(result.manifest).toBeDefined();
    expect(result.manifest!.serverName).toBe("coolify-test");
    expect(result.manifest!.coolifyVersion).toBe("4.0.0");
  });

  test("returns failure when DB dump fails", async () => {
    mockedSsh.sshExec
      .mockResolvedValueOnce({ code: 0, stdout: "4.0.0", stderr: "" }) // version
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "pg_dump error" }); // db dump

    const result = await createBackup("1.2.3.4", "coolify-test", "hetzner");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Database backup failed");
  });

  test("returns failure when config tar fails", async () => {
    mockedSsh.sshExec
      .mockResolvedValueOnce({ code: 0, stdout: "4.0.0", stderr: "" }) // version
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // db dump
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "tar error" }); // config tar

    const result = await createBackup("1.2.3.4", "coolify-test", "hetzner");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Config backup failed");
  });

  test("returns failure with hint on SSH error", async () => {
    mockedSsh.sshExec.mockRejectedValue(new Error("Connection refused"));

    const result = await createBackup("1.2.3.4", "coolify-test", "hetzner");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Connection refused");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Core: restoreBackup
// ═══════════════════════════════════════════════════════════════════════════════

describe("core/backup - restoreBackup", () => {
  beforeEach(() => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
    mockedSpawn.mockImplementation(() => createMockProcess(0));
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
  });

  test("returns success with all steps on full restore", async () => {
    const result = await restoreBackup("1.2.3.4", "coolify-test", "2026-02-20_12-00-00-000");
    expect(result.success).toBe(true);
    expect(result.steps.length).toBe(7); // 2 upload + 5 restore steps (adapter pattern)
    expect(result.steps.every((s) => s.status === "success")).toBe(true);
  });

  test("returns failure when manifest not found", async () => {
    mockedExistsSync.mockReturnValue(false);
    const result = await restoreBackup("1.2.3.4", "coolify-test", "nonexistent");
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found or corrupt");
  });

  test("returns failure when backup file is missing", async () => {
    mockedExistsSync.mockImplementation((p: any) => {
      const path = String(p);
      if (path.includes("manifest.json")) return true;
      if (path.includes("coolify-backup.sql.gz")) return false;
      return true;
    });
    mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));

    const result = await restoreBackup("1.2.3.4", "coolify-test", "2026-02-20_12-00-00-000");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing backup file");
  });

  test("calls tryRestartCoolify on restore DB failure", async () => {
    mockedSsh.sshExec
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // stop
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // start db
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "restore error" }) // restore db FAIL
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // tryRestartCoolify

    const result = await restoreBackup("1.2.3.4", "coolify-test", "2026-02-20_12-00-00-000");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Database restore failed");
    // Verify tryRestartCoolify was called (4th sshExec call is start command)
    expect(mockedSsh.sshExec).toHaveBeenCalledTimes(4);
  });

  test("returns failure with hint on SSH error", async () => {
    mockedSpawn.mockImplementation(() => createMockProcess(0));
    mockedSsh.sshExec.mockRejectedValue(new Error("Connection reset by peer"));

    const result = await restoreBackup("1.2.3.4", "coolify-test", "2026-02-20_12-00-00-000");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Connection reset");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Core: Snapshot Functions
// ═══════════════════════════════════════════════════════════════════════════════

describe("core/snapshot - createSnapshot", () => {
  test("returns success with snapshot and cost estimate", async () => {
    const snap = { id: "snap-1", serverId: "123", name: "kastell-1", status: "available", sizeGb: 20, createdAt: "2026-02-20", costPerMonth: "$1.00" };
    (mockProvider.createSnapshot as jest.Mock).mockResolvedValue(snap);
    (mockProvider.getSnapshotCostEstimate as jest.Mock).mockResolvedValue("$1.00/mo");
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    const result = await createSnapshot(sampleServer, "test-token");
    expect(result.success).toBe(true);
    expect(result.snapshot).toEqual(snap);
    expect(result.costEstimate).toBe("$1.00/mo");
  });

  test("returns success with unknown cost when estimate fails", async () => {
    const snap = { id: "snap-1", serverId: "123", name: "kastell-1", status: "available", sizeGb: 20, createdAt: "2026-02-20", costPerMonth: "$1.00" };
    (mockProvider.createSnapshot as jest.Mock).mockResolvedValue(snap);
    (mockProvider.getSnapshotCostEstimate as jest.Mock).mockRejectedValue(new Error("not supported"));
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    const result = await createSnapshot(sampleServer, "test-token");
    expect(result.success).toBe(true);
    expect(result.costEstimate).toBe("unknown");
  });

  test("returns failure on provider error", async () => {
    (mockProvider.getSnapshotCostEstimate as jest.Mock).mockResolvedValue("$1.00/mo");
    (mockProvider.createSnapshot as jest.Mock).mockRejectedValue(new Error("API rate limit"));
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    const result = await createSnapshot(sampleServer, "test-token");
    expect(result.success).toBe(false);
    expect(result.error).toContain("API rate limit");
  });
});

describe("core/snapshot - listSnapshots", () => {
  test("returns snapshots on success", async () => {
    const snaps = [{ id: "snap-1", serverId: "123", name: "s1", status: "available", sizeGb: 10, createdAt: "2026-02-20", costPerMonth: "$0.50" }];
    (mockProvider.listSnapshots as jest.Mock).mockResolvedValue(snaps);
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    const result = await listSnapshots(sampleServer, "test-token");
    expect(result.snapshots).toEqual(snaps);
    expect(result.error).toBeUndefined();
  });

  test("returns error on provider failure", async () => {
    (mockProvider.listSnapshots as jest.Mock).mockRejectedValue(new Error("Unauthorized"));
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    const result = await listSnapshots(sampleServer, "test-token");
    expect(result.snapshots).toEqual([]);
    expect(result.error).toContain("Unauthorized");
  });
});

describe("core/snapshot - deleteSnapshot", () => {
  test("returns success on delete", async () => {
    (mockProvider.deleteSnapshot as jest.Mock).mockResolvedValue(undefined);
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    const result = await deleteSnapshot(sampleServer, "test-token", "snap-1");
    expect(result.success).toBe(true);
  });

  test("returns error on provider failure", async () => {
    (mockProvider.deleteSnapshot as jest.Mock).mockRejectedValue(new Error("Not found"));
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    const result = await deleteSnapshot(sampleServer, "test-token", "snap-999");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Not found");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Handler: Common Cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("handleServerBackup - common", () => {
  test("returns error when no servers found", async () => {
    mockedConfig.getServers.mockReturnValue([]);

    const result = await handleServerBackup({ action: "backup-list" });
    const data = JSON.parse(result.content[0].text);
    expect(result.isError).toBe(true);
    expect(data.error).toContain("No servers found");
  });

  test("returns error when server not found by name", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(undefined);

    const result = await handleServerBackup({ action: "backup-list", server: "nonexistent" });
    const data = JSON.parse(result.content[0].text);
    expect(result.isError).toBe(true);
    expect(data.error).toContain("Server not found");
  });

  test("returns error when multiple servers and none specified", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer, manualServer]);

    const result = await handleServerBackup({ action: "backup-list" });
    const data = JSON.parse(result.content[0].text);
    expect(result.isError).toBe(true);
    expect(data.error).toContain("Multiple servers");
    expect(data.hint).toContain("Available:");
  });

  test("catches unexpected errors", async () => {
    mockedConfig.getServers.mockImplementation(() => { throw new Error("Unexpected crash"); });

    const result = await handleServerBackup({ action: "backup-list" });
    const data = JSON.parse(result.content[0].text);
    expect(result.isError).toBe(true);
    expect(data.error).toContain("Unexpected crash");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Handler: backup-create
// ═══════════════════════════════════════════════════════════════════════════════

describe("handleServerBackup - backup-create", () => {
  beforeEach(() => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(sampleServer);
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "4.0.0", stderr: "" });
    mockedSpawn.mockImplementation(() => createMockProcess(0));
  });

  test("returns success with manifest on backup creation", async () => {
    const result = await handleServerBackup({ action: "backup-create", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.manifest).toBeDefined();
    expect(data.manifest.serverName).toBe("coolify-test");
    expect(data.suggested_actions).toBeDefined();
  });

  test("returns error on SSH failure", async () => {
    mockedSsh.sshExec
      .mockResolvedValueOnce({ code: 0, stdout: "4.0.0", stderr: "" })
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "Connection timeout" });

    const result = await handleServerBackup({ action: "backup-create", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);
    expect(result.isError).toBe(true);
    expect(data.error).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Handler: backup-list
// ═══════════════════════════════════════════════════════════════════════════════

describe("handleServerBackup - backup-list", () => {
  beforeEach(() => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(sampleServer);
  });

  test("returns backup list with manifest details", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockReturnValue(["2026-02-20_12-00-00-000"] as unknown as ReturnType<typeof mockedReaddirSync>);
    mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));

    const result = await handleServerBackup({ action: "backup-list", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);
    expect(data.backupCount).toBe(1);
    expect(data.backups[0].coolifyVersion).toBe("4.0.0");
    expect(data.backups[0].backupId).toBe("2026-02-20_12-00-00-000");
  });

  test("returns empty message when no backups", async () => {
    mockedExistsSync.mockReturnValue(false);

    const result = await handleServerBackup({ action: "backup-list", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);
    expect(data.backups).toEqual([]);
    expect(data.message).toContain("No backups found");
    expect(data.suggested_actions).toBeDefined();
  });

  test("handles corrupt manifest gracefully", async () => {
    mockedExistsSync.mockImplementation((p: any) => {
      const path = String(p);
      if (path.includes("coolify-test") && !path.includes("manifest")) return true;
      if (path.includes("manifest.json")) return true;
      return false;
    });
    mockedReaddirSync.mockReturnValue(["corrupt-backup"] as unknown as ReturnType<typeof mockedReaddirSync>);
    mockedReadFileSync.mockReturnValue("invalid json{{{");

    const result = await handleServerBackup({ action: "backup-list", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);
    expect(data.backupCount).toBe(1);
    expect(data.backups[0].status).toBe("corrupt/unreadable");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Handler: backup-restore
// ═══════════════════════════════════════════════════════════════════════════════

describe("handleServerBackup - backup-restore", () => {
  beforeEach(() => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(sampleServer);
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
    mockedSpawn.mockImplementation(() => createMockProcess(0));
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
  });

  test("returns success with steps on restore", async () => {
    const result = await handleServerBackup({ action: "backup-restore", server: "coolify-test", backupId: "2026-02-20_12-00-00-000" });
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.steps.length).toBe(7); // 2 upload + 5 restore steps (adapter pattern)
    expect(data.suggested_actions).toBeDefined();
  });

  test("blocks restore in SAFE_MODE", async () => {
    process.env.KASTELL_SAFE_MODE = "true";

    const result = await handleServerBackup({ action: "backup-restore", server: "coolify-test", backupId: "backup-1" });
    const data = JSON.parse(result.content[0].text);
    expect(result.isError).toBe(true);
    expect(data.error).toContain("SAFE_MODE");
  });

  test("requires backupId parameter", async () => {
    const result = await handleServerBackup({ action: "backup-restore", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);
    expect(result.isError).toBe(true);
    expect(data.error).toContain("backupId is required");
  });

  test("returns steps array on restore failure", async () => {
    mockedSsh.sshExec
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // stop
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "db start failed" }) // start db FAIL
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // tryRestartCoolify

    const result = await handleServerBackup({ action: "backup-restore", server: "coolify-test", backupId: "2026-02-20_12-00-00-000" });
    const data = JSON.parse(result.content[0].text);
    expect(result.isError).toBe(true);
    expect(data.steps).toBeDefined();
    expect(data.steps.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Handler: snapshot-create
// ═══════════════════════════════════════════════════════════════════════════════

describe("handleServerBackup - snapshot-create", () => {
  beforeEach(() => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(sampleServer);
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
  });

  test("returns success with snapshot and cost estimate", async () => {
    const snap = { id: "snap-1", serverId: "123", name: "kastell-1", status: "available", sizeGb: 20, createdAt: "2026-02-20", costPerMonth: "$1.00" };
    (mockProvider.createSnapshot as jest.Mock).mockResolvedValue(snap);
    (mockProvider.getSnapshotCostEstimate as jest.Mock).mockResolvedValue("$1.00/mo");
    mockedTokens.getProviderToken.mockReturnValue("test-token");

    const result = await handleServerBackup({ action: "snapshot-create", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.snapshot).toEqual(snap);
    expect(data.costEstimate).toBe("$1.00/mo");
  });

  test("rejects manual server", async () => {
    mockedConfig.getServers.mockReturnValue([manualServer]);
    mockedConfig.findServer.mockReturnValue(manualServer);

    const result = await handleServerBackup({ action: "snapshot-create", server: "manual-srv" });
    const data = JSON.parse(result.content[0].text);
    expect(result.isError).toBe(true);
    expect(data.error).toContain("Manual servers");
    expect(data.suggested_actions[0].command).toContain("backup-create");
  });

  test("returns error when no token", async () => {
    mockedTokens.getProviderToken.mockReturnValue(undefined);

    const result = await handleServerBackup({ action: "snapshot-create", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);
    expect(result.isError).toBe(true);
    expect(data.error).toContain("No API token");
    expect(data.hint).toContain("HETZNER_TOKEN");
  });

  test("returns error on provider failure", async () => {
    mockedTokens.getProviderToken.mockReturnValue("test-token");
    (mockProvider.getSnapshotCostEstimate as jest.Mock).mockResolvedValue("$1.00");
    (mockProvider.createSnapshot as jest.Mock).mockRejectedValue(new Error("Server not found"));

    const result = await handleServerBackup({ action: "snapshot-create", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);
    expect(result.isError).toBe(true);
    expect(data.error).toContain("Server not found");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Handler: snapshot-list
// ═══════════════════════════════════════════════════════════════════════════════

describe("handleServerBackup - snapshot-list", () => {
  beforeEach(() => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(sampleServer);
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
  });

  test("returns snapshots on success", async () => {
    const snaps = [{ id: "snap-1", serverId: "123", name: "s1", status: "available", sizeGb: 10, createdAt: "2026-02-20", costPerMonth: "$0.50" }];
    (mockProvider.listSnapshots as jest.Mock).mockResolvedValue(snaps);
    mockedTokens.getProviderToken.mockReturnValue("test-token");

    const result = await handleServerBackup({ action: "snapshot-list", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);
    expect(data.snapshotCount).toBe(1);
    expect(data.snapshots).toEqual(snaps);
  });

  test("rejects manual server", async () => {
    mockedConfig.getServers.mockReturnValue([manualServer]);
    mockedConfig.findServer.mockReturnValue(manualServer);

    const result = await handleServerBackup({ action: "snapshot-list", server: "manual-srv" });
    const data = JSON.parse(result.content[0].text);
    expect(result.isError).toBe(true);
    expect(data.error).toContain("Manual servers");
  });

  test("returns error when no token", async () => {
    mockedTokens.getProviderToken.mockReturnValue(undefined);

    const result = await handleServerBackup({ action: "snapshot-list", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);
    expect(result.isError).toBe(true);
    expect(data.error).toContain("No API token");
  });

  test("returns empty message when no snapshots", async () => {
    (mockProvider.listSnapshots as jest.Mock).mockResolvedValue([]);
    mockedTokens.getProviderToken.mockReturnValue("test-token");

    const result = await handleServerBackup({ action: "snapshot-list", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);
    expect(result.isError).toBeUndefined();
    expect(data.snapshots).toEqual([]);
    expect(data.message).toContain("No snapshots found");
    expect(data.suggested_actions).toBeDefined();
  });

  test("returns error on provider failure", async () => {
    (mockProvider.listSnapshots as jest.Mock).mockRejectedValue(new Error("API timeout"));
    mockedTokens.getProviderToken.mockReturnValue("test-token");

    const result = await handleServerBackup({ action: "snapshot-list", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);
    expect(result.isError).toBe(true);
    expect(data.error).toContain("API timeout");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Handler: snapshot-delete
// ═══════════════════════════════════════════════════════════════════════════════

describe("handleServerBackup - snapshot-delete", () => {
  beforeEach(() => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(sampleServer);
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
  });

  test("returns success on delete", async () => {
    (mockProvider.deleteSnapshot as jest.Mock).mockResolvedValue(undefined);
    mockedTokens.getProviderToken.mockReturnValue("test-token");

    const result = await handleServerBackup({ action: "snapshot-delete", server: "coolify-test", snapshotId: "snap-1" });
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.message).toContain("Snapshot deleted");
  });

  test("blocks delete in SAFE_MODE", async () => {
    process.env.KASTELL_SAFE_MODE = "true";

    const result = await handleServerBackup({ action: "snapshot-delete", server: "coolify-test", snapshotId: "snap-1" });
    const data = JSON.parse(result.content[0].text);
    expect(result.isError).toBe(true);
    expect(data.error).toContain("SAFE_MODE");
  });

  test("rejects manual server", async () => {
    mockedConfig.getServers.mockReturnValue([manualServer]);
    mockedConfig.findServer.mockReturnValue(manualServer);

    const result = await handleServerBackup({ action: "snapshot-delete", server: "manual-srv", snapshotId: "snap-1" });
    const data = JSON.parse(result.content[0].text);
    expect(result.isError).toBe(true);
    expect(data.error).toContain("Manual servers");
  });

  test("returns error when no token", async () => {
    mockedTokens.getProviderToken.mockReturnValue(undefined);

    const result = await handleServerBackup({ action: "snapshot-delete", server: "coolify-test", snapshotId: "snap-1" });
    const data = JSON.parse(result.content[0].text);
    expect(result.isError).toBe(true);
    expect(data.error).toContain("No API token");
  });

  test("requires snapshotId parameter", async () => {
    mockedTokens.getProviderToken.mockReturnValue("test-token");

    const result = await handleServerBackup({ action: "snapshot-delete", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);
    expect(result.isError).toBe(true);
    expect(data.error).toContain("snapshotId is required");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Handler: bare mode routing
// ═══════════════════════════════════════════════════════════════════════════════

const bareServer = {
  id: "456",
  name: "bare-test",
  provider: "hetzner",
  ip: "5.6.7.8",
  region: "nbg1",
  size: "cax11",
  mode: "bare" as const,
  createdAt: "2026-02-20T00:00:00Z",
};

describe("handleServerBackup - bare mode backup-create", () => {
  beforeEach(() => {
    mockedConfig.getServers.mockReturnValue([bareServer]);
    mockedConfig.findServer.mockReturnValue(bareServer);
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    mockedSpawn.mockImplementation(() => createMockProcess(0));
  });

  test("routes bare server to createBareBackup instead of createBackup", async () => {
    const result = await handleServerBackup({ action: "backup-create", server: "bare-test" });
    const data = JSON.parse(result.content[0].text);
    // createBareBackup uses buildBareConfigTarCommand (not pg_dump) — sshExec called once (config tar)
    expect(data.success).toBe(true);
    expect(data.manifest).toBeDefined();
    expect(data.manifest.mode).toBe("bare");
    expect(data.manifest.coolifyVersion).toBe("n/a");
  });

  test("returns error on bare backup SSH failure", async () => {
    mockedSsh.sshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "tar: Permission denied" });

    const result = await handleServerBackup({ action: "backup-create", server: "bare-test" });
    const data = JSON.parse(result.content[0].text);
    expect(result.isError).toBe(true);
    expect(data.error).toBeDefined();
  });

  test("coolify server still uses createBackup (unchanged)", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(sampleServer);
    // createBackup: version check + db dump + config tar + scp x2 + cleanup
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "4.0.0", stderr: "" });

    const result = await handleServerBackup({ action: "backup-create", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.manifest.coolifyVersion).toBe("4.0.0");
    // coolify backup manifest has no mode field
    expect(data.manifest.mode).toBeUndefined();
  });
});

describe("handleServerBackup - bare mode backup-restore", () => {
  const bareManifest = {
    serverName: "bare-test",
    provider: "hetzner",
    timestamp: "2026-02-20_12-00-00-000",
    coolifyVersion: "n/a",
    files: ["bare-config.tar.gz"],
    mode: "bare",
  };

  beforeEach(() => {
    mockedConfig.getServers.mockReturnValue([bareServer]);
    mockedConfig.findServer.mockReturnValue(bareServer);
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(JSON.stringify(bareManifest));
    mockedSpawn.mockImplementation(() => createMockProcess(0));
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
  });

  test("routes bare server to restoreBareBackup and returns steps", async () => {
    const result = await handleServerBackup({
      action: "backup-restore",
      server: "bare-test",
      backupId: "2026-02-20_12-00-00-000",
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.steps).toBeDefined();
    expect(data.steps.length).toBeGreaterThan(0);
  });

  test("bare restore success includes service restart hint", async () => {
    const result = await handleServerBackup({
      action: "backup-restore",
      server: "bare-test",
      backupId: "2026-02-20_12-00-00-000",
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.hint).toBeDefined();
    expect(data.hint).toContain("restart");
  });

  test("blocks bare restore in SAFE_MODE", async () => {
    process.env.KASTELL_SAFE_MODE = "true";

    const result = await handleServerBackup({
      action: "backup-restore",
      server: "bare-test",
      backupId: "2026-02-20_12-00-00-000",
    });
    const data = JSON.parse(result.content[0].text);
    expect(result.isError).toBe(true);
    expect(data.error).toContain("SAFE_MODE");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Handler: malformed params
// ═══════════════════════════════════════════════════════════════════════════════

describe("handleServerBackup — malformed params", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedSsh.assertValidIp.mockImplementation(() => {});
    mockedSsh.sanitizedEnv.mockReturnValue({} as NodeJS.ProcessEnv);
    mockedConfig.BACKUPS_DIR = "/tmp/kastell-backups";
  });

  test("returns mcpError when server param is empty string", async () => {
    // Arrange
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(undefined as never);

    // Act
    const result = await handleServerBackup({ action: "backup-list", server: "" });

    // Assert
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeTruthy();
  });

  test("returns mcpError when server param is null (as unknown)", async () => {
    // Arrange
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(undefined as never);

    // Act
    const result = await handleServerBackup({ action: "backup-list", server: null as unknown as string });

    // Assert
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeTruthy();
  });

  test("returns mcpError when action param is invalid (as unknown)", async () => {
    // Arrange
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(sampleServer as never);

    // Act
    const result = await handleServerBackup({ action: "nonexistent" as unknown as Parameters<typeof handleServerBackup>[0]["action"], server: "coolify-test" });

    // Assert
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeTruthy();
  });

  test("returns mcpError when SSH connection fails (backup-create)", async () => {
    // Arrange
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(sampleServer as never);
    mockedSsh.sshExec.mockRejectedValue(new Error("SSH connection refused"));

    // Act
    const result = await handleServerBackup({ action: "backup-create", server: "coolify-test" });

    // Assert
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Handler: snapshot-restore
// ═══════════════════════════════════════════════════════════════════════════════

describe("handleServerBackup - snapshot-restore", () => {
  beforeEach(() => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(sampleServer);
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
  });

  test("returns success when snapshot restored", async () => {
    (mockProvider.restoreSnapshot as jest.Mock).mockResolvedValue(undefined);
    mockedTokens.getProviderToken.mockReturnValue("test-token");

    const result = await handleServerBackup({ action: "snapshot-restore", server: "coolify-test", snapshotId: "snap-1" });
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.snapshotId).toBe("snap-1");
    expect(data.message).toContain("unavailable");
  });

  test("requires snapshotId parameter", async () => {
    mockedTokens.getProviderToken.mockReturnValue("test-token");

    const result = await handleServerBackup({ action: "snapshot-restore", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);
    expect(result.isError).toBe(true);
    expect(data.error).toContain("snapshotId is required");
  });
});
