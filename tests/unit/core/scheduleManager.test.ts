import { spawnSync } from "child_process";
import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "fs";
import {
  scheduleKey,
  parseScheduleKey,
  sanitizeServerName,
  resolveKastellBin,
  installLocalCron,
  removeLocalCron,
  listLocalCron,
  writeScheduleLog,
  cleanOldScheduleLogs,
  SCHEDULE_MARKERS,
} from "../../../src/core/scheduleManager";

jest.mock("child_process", () => ({ spawnSync: jest.fn() }));
jest.mock("fs", () => ({
  appendFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  readdirSync: jest.fn(),
  statSync: jest.fn(),
  unlinkSync: jest.fn(),
  writeFileSync: jest.fn(),
  chmodSync: jest.fn(),
}));
jest.mock("../../../src/core/backupSchedule.js", () => ({
  validateCronExpr: jest.fn(() => ({ valid: true })),
  saveSchedule: jest.fn(),
  removeSchedule: jest.fn(),
  getSchedules: jest.fn(() => ({})),
}));
jest.mock("../../../src/core/notify.js", () => ({
  dispatchWithCooldown: jest.fn(() => Promise.resolve({ skipped: false, results: [] })),
}));

import * as backupSchedule from "../../../src/core/backupSchedule";
import * as notify from "../../../src/core/notify";

const mockedSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;
const mockedAppendFileSync = appendFileSync as jest.MockedFunction<typeof appendFileSync>;
const mockedMkdirSync = mkdirSync as jest.MockedFunction<typeof mkdirSync>;
const mockedReaddirSync = readdirSync as jest.MockedFunction<typeof readdirSync>;
const mockedStatSync = statSync as jest.MockedFunction<typeof statSync>;
const mockedUnlinkSync = unlinkSync as jest.MockedFunction<typeof unlinkSync>;
const mockedWriteFileSync = writeFileSync as jest.MockedFunction<typeof writeFileSync>;
const mockedValidateCronExpr = backupSchedule.validateCronExpr as jest.MockedFunction<typeof backupSchedule.validateCronExpr>;
const mockedSaveSchedule = backupSchedule.saveSchedule as jest.MockedFunction<typeof backupSchedule.saveSchedule>;
const mockedRemoveSchedule = backupSchedule.removeSchedule as jest.MockedFunction<typeof backupSchedule.removeSchedule>;
const mockedGetSchedules = backupSchedule.getSchedules as jest.MockedFunction<typeof backupSchedule.getSchedules>;
const mockedDispatchWithCooldown = notify.dispatchWithCooldown as jest.MockedFunction<typeof notify.dispatchWithCooldown>;

let originalPlatform: PropertyDescriptor | undefined;

beforeEach(() => {
  jest.clearAllMocks();
  mockedValidateCronExpr.mockReturnValue({ valid: true });
  mockedGetSchedules.mockReturnValue({});
  mockedDispatchWithCooldown.mockResolvedValue({ skipped: false, results: [] });
  // Default: empty dir so cleanOldScheduleLogs doesn't throw when called from writeScheduleLog
  mockedReaddirSync.mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);
  originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
});

afterEach(() => {
  if (originalPlatform) {
    Object.defineProperty(process, "platform", originalPlatform);
  }
});

function setPlatform(platform: string) {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

// ─── scheduleKey ──────────────────────────────────────────────────────────────

describe("scheduleKey", () => {
  it("returns server:type composite key", () => {
    expect(scheduleKey("my-server", "fix")).toBe("my-server:fix");
  });

  it("returns server:audit for audit type", () => {
    expect(scheduleKey("prod", "audit")).toBe("prod:audit");
  });

  it("handles server names with hyphens", () => {
    expect(scheduleKey("my-server-123", "fix")).toBe("my-server-123:fix");
  });
});

// ─── parseScheduleKey ─────────────────────────────────────────────────────────

describe("parseScheduleKey", () => {
  it("parses fix key correctly", () => {
    expect(parseScheduleKey("my-server:fix")).toEqual({ server: "my-server", type: "fix" });
  });

  it("parses audit key correctly", () => {
    expect(parseScheduleKey("my-server:audit")).toEqual({ server: "my-server", type: "audit" });
  });

  it("returns null for key without colon", () => {
    expect(parseScheduleKey("no-colon")).toBeNull();
  });

  it("returns null for unknown type", () => {
    expect(parseScheduleKey("server:unknown")).toBeNull();
  });

  it("uses lastIndexOf for keys with multiple colons", () => {
    expect(parseScheduleKey("has:colon:fix")).toEqual({ server: "has:colon", type: "fix" });
  });

  it("returns null for backup-only keys (e.g. 'backup-only')", () => {
    expect(parseScheduleKey("backup-only")).toBeNull();
  });
});

// ─── sanitizeServerName ───────────────────────────────────────────────────────

describe("sanitizeServerName", () => {
  it("passes valid name unchanged", () => {
    expect(sanitizeServerName("valid-name.123")).toBe("valid-name.123");
  });

  it("passes alphanumeric names", () => {
    expect(sanitizeServerName("server123")).toBe("server123");
  });

  it("throws for names with semicolons", () => {
    expect(() => sanitizeServerName("bad;name")).toThrow();
  });

  it("throws for names with spaces (rm -rf /)", () => {
    expect(() => sanitizeServerName("rm -rf /")).toThrow();
  });

  it("throws for names with dollar sign", () => {
    expect(() => sanitizeServerName("server$var")).toThrow();
  });

  it("throws for names with backtick", () => {
    expect(() => sanitizeServerName("server`cmd`")).toThrow();
  });

  it("throws for names with pipe", () => {
    expect(() => sanitizeServerName("server|pipe")).toThrow();
  });

  it("throws for names with ampersand", () => {
    expect(() => sanitizeServerName("server&bg")).toThrow();
  });
});

// ─── resolveKastellBin ────────────────────────────────────────────────────────

describe("resolveKastellBin", () => {
  it("returns process.argv[1] when set", () => {
    const original = process.argv[1];
    process.argv[1] = "/usr/local/bin/kastell";
    const result = resolveKastellBin();
    process.argv[1] = original;
    expect(result).toBe("/usr/local/bin/kastell");
  });

  it("returns npx tsx path when argv[1] ends with .ts", () => {
    const original = process.argv[1];
    process.argv[1] = "/home/user/kastell/src/index.ts";
    const result = resolveKastellBin();
    process.argv[1] = original;
    expect(result).toContain("npx tsx");
    expect(result).toContain("/home/user/kastell/src/index.ts");
  });

  it("falls back to kastell when argv[1] is undefined", () => {
    const original = process.argv[1];
    process.argv[1] = undefined as unknown as string;
    const result = resolveKastellBin();
    process.argv[1] = original;
    expect(result).toBe("kastell");
  });
});

// ─── SCHEDULE_MARKERS ────────────────────────────────────────────────────────

describe("SCHEDULE_MARKERS", () => {
  it("has kastell-fix-schedule marker", () => {
    expect(SCHEDULE_MARKERS.fix).toBe("# kastell-fix-schedule");
  });

  it("has kastell-audit-schedule marker", () => {
    expect(SCHEDULE_MARKERS.audit).toBe("# kastell-audit-schedule");
  });
});

// ─── installLocalCron ────────────────────────────────────────────────────────

describe("installLocalCron", () => {
  it("returns windowsFallback:true on win32 without calling spawnSync", () => {
    setPlatform("win32");
    const result = installLocalCron("0 3 * * *", "my-server", "fix");
    expect(result.success).toBe(true);
    expect(result.windowsFallback).toBe(true);
    expect(mockedSpawnSync).not.toHaveBeenCalled();
  });

  it("saves to schedules.json on win32", () => {
    setPlatform("win32");
    installLocalCron("0 3 * * *", "my-server", "fix");
    expect(mockedSaveSchedule).toHaveBeenCalledWith("my-server:fix", "0 3 * * *");
  });

  it("returns command string on win32", () => {
    setPlatform("win32");
    const result = installLocalCron("0 3 * * *", "my-server", "fix");
    expect(typeof result.command).toBe("string");
    expect(result.command).toContain("my-server");
  });

  it("uses fix command with --safe --no-interactive on linux for fix type", () => {
    setPlatform("linux");
    mockedSpawnSync.mockReturnValue({ status: 0, stdout: "", stderr: "", pid: 0, output: [], signal: null } as never);
    installLocalCron("0 3 * * *", "my-server", "fix");
    const written = mockedWriteFileSync.mock.calls[0][1] as string;
    expect(written).toContain("fix --safe --server");
    expect(written).toContain("--no-interactive");
    expect(written).toContain("my-server");
  });

  it("uses audit command with --json on linux for audit type", () => {
    setPlatform("linux");
    mockedSpawnSync.mockReturnValue({ status: 0, stdout: "", stderr: "", pid: 0, output: [], signal: null } as never);
    installLocalCron("0 3 * * *", "my-server", "audit");
    const written = mockedWriteFileSync.mock.calls[0][1] as string;
    expect(written).toContain("audit --server");
    expect(written).toContain("--json");
    expect(written).toContain("my-server");
  });

  it("includes kastell-fix-schedule marker in cron entry for fix type", () => {
    setPlatform("linux");
    mockedSpawnSync.mockReturnValue({ status: 0, stdout: "", stderr: "", pid: 0, output: [], signal: null } as never);
    installLocalCron("0 3 * * *", "my-server", "fix");
    const written = mockedWriteFileSync.mock.calls[0][1] as string;
    expect(written).toContain("# kastell-fix-schedule");
  });

  it("includes kastell-audit-schedule marker in cron entry for audit type", () => {
    setPlatform("linux");
    mockedSpawnSync.mockReturnValue({ status: 0, stdout: "", stderr: "", pid: 0, output: [], signal: null } as never);
    installLocalCron("0 3 * * *", "my-server", "audit");
    const written = mockedWriteFileSync.mock.calls[0][1] as string;
    expect(written).toContain("# kastell-audit-schedule");
  });

  it("uses spawnSync crontab -l then crontab tmpFile pattern", () => {
    setPlatform("linux");
    mockedSpawnSync.mockReturnValue({ status: 0, stdout: "", stderr: "", pid: 0, output: [], signal: null } as never);
    installLocalCron("0 3 * * *", "my-server", "fix");
    // First call: crontab -l (read current)
    expect(mockedSpawnSync.mock.calls[0][0]).toBe("crontab");
    expect(mockedSpawnSync.mock.calls[0][1]).toEqual(["-l"]);
    // Second call: crontab tmpFile (install)
    expect(mockedSpawnSync.mock.calls[1][0]).toBe("crontab");
    expect((mockedSpawnSync.mock.calls[1][1] as string[])[0]).toContain(".crontab-tmp");
    // Temp file cleaned up
    expect(mockedUnlinkSync).toHaveBeenCalled();
  });

  it("returns error when cron expression is invalid", () => {
    mockedValidateCronExpr.mockReturnValueOnce({ valid: false, error: "bad expr" });
    setPlatform("linux");
    const result = installLocalCron("bad-expr", "my-server", "fix");
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("returns error when server name is invalid", () => {
    setPlatform("linux");
    const result = installLocalCron("0 3 * * *", "bad;name", "fix");
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("saves to schedules.json on linux", () => {
    setPlatform("linux");
    mockedSpawnSync.mockReturnValue({ status: 0, stdout: "", stderr: "", pid: 0, output: [], signal: null } as never);
    installLocalCron("0 3 * * *", "my-server", "fix");
    expect(mockedSaveSchedule).toHaveBeenCalledWith("my-server:fix", "0 3 * * *");
  });
});

// ─── removeLocalCron ─────────────────────────────────────────────────────────

describe("removeLocalCron", () => {
  it("calls removeSchedule with composite key", () => {
    setPlatform("linux");
    mockedSpawnSync.mockReturnValue({ status: 0, stdout: "", stderr: "", pid: 0, output: [], signal: null } as never);
    removeLocalCron("my-server", "fix");
    expect(mockedRemoveSchedule).toHaveBeenCalledWith("my-server:fix");
  });

  it("filters out fix marker lines via temp file on linux", () => {
    setPlatform("linux");
    mockedSpawnSync.mockReturnValue({ status: 0, stdout: "0 3 * * * kastell fix # kastell-fix-schedule\n0 4 * * * other\n", stderr: "", pid: 0, output: [], signal: null } as never);
    removeLocalCron("my-server", "fix");
    // Should write filtered content to temp file (marker line removed)
    const written = mockedWriteFileSync.mock.calls[0][1] as string;
    expect(written).not.toContain("# kastell-fix-schedule");
    expect(written).toContain("other");
    // Should call crontab with temp file
    expect(mockedSpawnSync.mock.calls[1][0]).toBe("crontab");
    expect((mockedSpawnSync.mock.calls[1][1] as string[])[0]).toContain(".crontab-tmp");
  });

  it("filters out audit marker lines via temp file on linux", () => {
    setPlatform("linux");
    mockedSpawnSync.mockReturnValue({ status: 0, stdout: "0 3 * * * kastell audit # kastell-audit-schedule\n", stderr: "", pid: 0, output: [], signal: null } as never);
    removeLocalCron("my-server", "audit");
    const written = mockedWriteFileSync.mock.calls[0][1] as string;
    expect(written).not.toContain("# kastell-audit-schedule");
  });

  it("does not call spawnSync on win32", () => {
    setPlatform("win32");
    removeLocalCron("my-server", "fix");
    expect(mockedSpawnSync).not.toHaveBeenCalled();
  });

  it("still calls removeSchedule on win32", () => {
    setPlatform("win32");
    removeLocalCron("my-server", "fix");
    expect(mockedRemoveSchedule).toHaveBeenCalledWith("my-server:fix");
  });
});

// ─── listLocalCron ───────────────────────────────────────────────────────────

describe("listLocalCron", () => {
  it("returns empty array when no schedules", () => {
    mockedGetSchedules.mockReturnValue({});
    const result = listLocalCron();
    expect(result).toEqual([]);
  });

  it("filters out non-schedule keys (backup schedule keys)", () => {
    mockedGetSchedules.mockReturnValue({
      "my-server": "0 3 * * *",        // backup key (no type suffix)
      "my-server:fix": "0 4 * * *",     // schedule key
    });
    const result = listLocalCron();
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("fix");
  });

  it("returns parsed schedule entries", () => {
    mockedGetSchedules.mockReturnValue({
      "my-server:fix": "0 3 * * *",
      "prod:audit": "0 4 * * *",
    });
    const result = listLocalCron();
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ server: "my-server", type: "fix", cronExpr: "0 3 * * *" });
    expect(result).toContainEqual({ server: "prod", type: "audit", cronExpr: "0 4 * * *" });
  });

  it("filters by server name when serverFilter provided", () => {
    mockedGetSchedules.mockReturnValue({
      "my-server:fix": "0 3 * * *",
      "other-server:audit": "0 4 * * *",
    });
    const result = listLocalCron("my-server");
    expect(result).toHaveLength(1);
    expect(result[0].server).toBe("my-server");
  });

  it("does not call spawnSync (reads from schedules.json only)", () => {
    setPlatform("win32");
    mockedGetSchedules.mockReturnValue({ "my-server:fix": "0 3 * * *" });
    listLocalCron();
    expect(mockedSpawnSync).not.toHaveBeenCalled();
  });
});

// ─── writeScheduleLog ────────────────────────────────────────────────────────

describe("writeScheduleLog", () => {
  it("creates log directory", () => {
    writeScheduleLog("fix", "my-server", { applied: 3, failed: 1 });
    expect(mockedMkdirSync).toHaveBeenCalledWith(expect.stringContaining("schedule-logs"), expect.objectContaining({ recursive: true }));
  });

  it("appends to correctly named log file", () => {
    writeScheduleLog("fix", "my-server", { applied: 3, failed: 1 });
    const filePath = mockedAppendFileSync.mock.calls[0][0] as string;
    expect(filePath).toMatch(/fix-my-server-\d{4}-\d{2}-\d{2}\.log$/);
  });

  it("formats log line with applied and failed counts", () => {
    writeScheduleLog("audit", "prod", { applied: 5, failed: 2 });
    const content = mockedAppendFileSync.mock.calls[0][1] as string;
    expect(content).toContain("applied=5");
    expect(content).toContain("failed=2");
  });

  it("includes ISO timestamp in log line", () => {
    writeScheduleLog("fix", "my-server", { applied: 1, failed: 0 });
    const content = mockedAppendFileSync.mock.calls[0][1] as string;
    expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("includes scoreDelta when scoreBefore and scoreAfter provided", () => {
    writeScheduleLog("fix", "my-server", { applied: 2, failed: 0, scoreBefore: 60, scoreAfter: 75 });
    const content = mockedAppendFileSync.mock.calls[0][1] as string;
    expect(content).toContain("scoreDelta=15");
  });

  it("omits scoreDelta when scores not provided", () => {
    writeScheduleLog("fix", "my-server", { applied: 1, failed: 0 });
    const content = mockedAppendFileSync.mock.calls[0][1] as string;
    expect(content).not.toContain("scoreDelta");
  });

  it("calls dispatchWithCooldown with correct serverName and findingType", async () => {
    writeScheduleLog("fix", "my-server", { applied: 3, failed: 1 });
    // Allow microtasks to flush
    await Promise.resolve();
    expect(mockedDispatchWithCooldown).toHaveBeenCalledWith(
      "my-server",
      "schedule-fix",
      expect.stringContaining("Schedule fix complete"),
    );
  });

  it("calls dispatchWithCooldown with summary message containing applied/failed", async () => {
    writeScheduleLog("audit", "prod", { applied: 5, failed: 0 });
    await Promise.resolve();
    const msg = mockedDispatchWithCooldown.mock.calls[0][2];
    expect(msg).toContain("applied=5");
    expect(msg).toContain("failed=0");
  });
});

// ─── cleanOldScheduleLogs ────────────────────────────────────────────────────

describe("cleanOldScheduleLogs", () => {
  it("removes files older than 30 days", () => {
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    mockedReaddirSync.mockReturnValue(["old-file.log"] as unknown as ReturnType<typeof readdirSync>);
    mockedStatSync.mockReturnValue({ mtime: oldDate } as ReturnType<typeof statSync>);
    cleanOldScheduleLogs();
    expect(mockedUnlinkSync).toHaveBeenCalledWith(expect.stringContaining("old-file.log"));
  });

  it("keeps files newer than 30 days", () => {
    const newDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    mockedReaddirSync.mockReturnValue(["new-file.log"] as unknown as ReturnType<typeof readdirSync>);
    mockedStatSync.mockReturnValue({ mtime: newDate } as ReturnType<typeof statSync>);
    cleanOldScheduleLogs();
    expect(mockedUnlinkSync).not.toHaveBeenCalled();
  });

  it("handles empty directory gracefully", () => {
    mockedReaddirSync.mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);
    expect(() => cleanOldScheduleLogs()).not.toThrow();
  });

  it("handles readdirSync errors gracefully (dir not exist)", () => {
    mockedReaddirSync.mockImplementation(() => { throw new Error("ENOENT"); });
    expect(() => cleanOldScheduleLogs()).not.toThrow();
  });
});
