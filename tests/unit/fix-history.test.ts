import {
  saveFixHistory,
  loadFixHistory,
  generateFixId,
  getLastFixId,
  extractFilePathsFromFixCommand,
  truncateExecutionLog,
  fixHistoryEntrySchema,
} from "../../src/core/audit/fix-history.js";
import type { FixHistoryEntry } from "../../src/core/audit/types.js";
import * as fs from "fs";

jest.mock("fs");
jest.mock("../../src/utils/paths.js", () => ({
  KASTELL_DIR: "/home/user/.kastell",
}));
jest.mock("../../src/utils/fileLock", () => ({
  withFileLock: jest.fn((_path: string, fn: () => unknown) => fn()),
  warnIfPermissionError: jest.fn(),
}));

const mockedFs = fs as jest.Mocked<typeof fs>;

describe("FixHistoryEntry schema", () => {
  it("accepts entry with executionLog and source", () => {
    const entry = {
      fixId: "fix-2026-05-02-001",
      serverIp: "1.2.3.4",
      serverName: "test",
      timestamp: new Date().toISOString(),
      checks: ["KERN-SYNCOOKIES"],
      scoreBefore: 50,
      scoreAfter: 55,
      status: "applied",
      source: "fix",
      executionLog: [{
        checkId: "KERN-SYNCOOKIES",
        command: "sysctl -w net.ipv4.tcp_syncookies=1",
        stdout: "net.ipv4.tcp_syncookies = 1",
        stderr: "",
        durationMs: 120,
        success: true,
      }],
    };
    expect(fixHistoryEntrySchema.safeParse(entry).success).toBe(true);
  });

  it("accepts entry without backupPath (doctor fix)", () => {
    const entry = {
      fixId: "fix-2026-05-02-002",
      serverIp: "1.2.3.4",
      serverName: "test",
      timestamp: new Date().toISOString(),
      checks: ["apt-upgrade"],
      scoreBefore: 50,
      scoreAfter: null,
      status: "applied",
      source: "doctor",
    };
    expect(fixHistoryEntrySchema.safeParse(entry).success).toBe(true);
  });

  it("accepts legacy entry without new fields", () => {
    const legacy = {
      fixId: "fix-2026-03-29-001",
      serverIp: "1.2.3.4",
      serverName: "test",
      timestamp: "2026-03-29T00:00:00Z",
      checks: ["KERN-SYNCOOKIES"],
      scoreBefore: 50,
      scoreAfter: 55,
      status: "applied",
      backupPath: "/root/.kastell/fix-backups/fix-2026-03-29-001",
    };
    expect(fixHistoryEntrySchema.safeParse(legacy).success).toBe(true);
  });
});

describe("truncateExecutionLog", () => {
  it("truncates stdout and stderr beyond limits", () => {
    const log = [{
      checkId: "X",
      command: "y",
      stdout: "a".repeat(5000),
      stderr: "b".repeat(2000),
      durationMs: 100,
      success: true,
    }];
    const result = truncateExecutionLog(log);
    expect(result[0].stdout.length).toBe(4096);
    expect(result[0].stderr.length).toBe(1024);
  });
});

function makeEntry(overrides: Partial<FixHistoryEntry> = {}): FixHistoryEntry {
  return {
    fixId: "fix-2026-03-29-001",
    serverIp: "1.2.3.4",
    serverName: "test-server",
    timestamp: "2026-03-29T10:00:00Z",
    checks: ["SSH-PERMIT-ROOT", "SSH-PASSWORD-AUTH"],
    scoreBefore: 65,
    scoreAfter: 78,
    status: "applied",
    backupPath: "/root/.kastell/fix-backups/fix-2026-03-29-001",
    ...overrides,
  };
}

describe("loadFixHistory", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return empty array when no history file exists", () => {
    mockedFs.existsSync.mockReturnValue(false);
    const history = loadFixHistory("1.2.3.4");
    expect(history).toEqual([]);
  });

  it("should filter entries by serverIp", () => {
    const entries: FixHistoryEntry[] = [
      makeEntry({ serverIp: "1.2.3.4", fixId: "fix-2026-03-29-001" }),
      makeEntry({ serverIp: "5.6.7.8", fixId: "fix-2026-03-29-001" }),
      makeEntry({ serverIp: "1.2.3.4", fixId: "fix-2026-03-29-002" }),
    ];
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(entries));

    const history = loadFixHistory("1.2.3.4");
    expect(history).toHaveLength(2);
    expect(history.every((e: FixHistoryEntry) => e.serverIp === "1.2.3.4")).toBe(true);
  });

  it("should return empty array for corrupt JSON", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue("not valid json{{{");
    const history = loadFixHistory("1.2.3.4");
    expect(history).toEqual([]);
  });

  it("should reject entries with extra fields (Zod .strict())", () => {
    const entriesWithExtra = [
      {
        fixId: "fix-2026-03-29-001",
        serverIp: "1.2.3.4",
        serverName: "test-server",
        timestamp: "2026-03-29T10:00:00Z",
        checks: ["SSH-PERMIT-ROOT"],
        scoreBefore: 65,
        scoreAfter: 78,
        status: "applied",
        backupPath: "/root/.kastell/fix-backups/fix-2026-03-29-001",
        extraField: "should-be-rejected", // extra field — not in schema
      },
    ];
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(entriesWithExtra));
    const history = loadFixHistory("1.2.3.4");
    expect(history).toEqual([]);
  });

  it("should accept entries with scoreAfter as null", () => {
    const entries: FixHistoryEntry[] = [
      makeEntry({ scoreAfter: null, status: "failed" }),
    ];
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(entries));
    const history = loadFixHistory("1.2.3.4");
    expect(history).toHaveLength(1);
    expect(history[0].scoreAfter).toBeNull();
  });
});

describe("saveFixHistory", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should write to ~/.kastell/fix-history.json", async () => {
    mockedFs.existsSync.mockReturnValue(false);
    await saveFixHistory(makeEntry());
    expect(mockedFs.writeFileSync).toHaveBeenCalled();
    const writePath = (mockedFs.writeFileSync as jest.Mock).mock.calls[0][0] as string;
    expect(writePath).toContain("fix-history");
  });

  it("should append to existing history", async () => {
    const existing = [makeEntry({ fixId: "fix-2026-03-29-001", scoreBefore: 50 })];
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(existing));

    await saveFixHistory(makeEntry({ fixId: "fix-2026-03-29-002", scoreBefore: 65 }));

    const writeCall = (mockedFs.writeFileSync as jest.Mock).mock.calls[0];
    const written = JSON.parse(writeCall[1] as string) as FixHistoryEntry[];
    expect(written).toHaveLength(2);
  });

  it("should cap history at 100 entries per server", async () => {
    const existing: FixHistoryEntry[] = Array.from({ length: 100 }, (_, i) =>
      makeEntry({
        serverIp: "1.2.3.4",
        fixId: `fix-2026-01-${String(i + 1).padStart(2, "0")}-001`,
        timestamp: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        scoreBefore: i,
        scoreAfter: i + 5,
      }),
    );
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(existing));

    await saveFixHistory(makeEntry({ serverIp: "1.2.3.4", scoreBefore: 99, scoreAfter: 100 }));

    const writeCall = (mockedFs.writeFileSync as jest.Mock).mock.calls[0];
    const written = JSON.parse(writeCall[1] as string) as FixHistoryEntry[];
    const serverEntries = written.filter((e: FixHistoryEntry) => e.serverIp === "1.2.3.4");
    expect(serverEntries).toHaveLength(100);
    // Latest entry should be the new one (scoreBefore: 99)
    expect(serverEntries[serverEntries.length - 1].scoreBefore).toBe(99);
  });

  it("should use atomic write pattern (tmp + rename)", async () => {
    mockedFs.existsSync.mockReturnValue(false);
    await saveFixHistory(makeEntry());

    const writePath = (mockedFs.writeFileSync as jest.Mock).mock.calls[0][0] as string;
    expect(writePath).toContain(".tmp");
    expect(mockedFs.renameSync).toHaveBeenCalled();
  });

  it("should not cap entries from other servers", async () => {
    const existing: FixHistoryEntry[] = Array.from({ length: 100 }, (_, i) =>
      makeEntry({
        serverIp: "1.2.3.4",
        fixId: `fix-2026-01-${String(i + 1).padStart(2, "0")}-001`,
        timestamp: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      }),
    );
    const otherServerEntry = makeEntry({ serverIp: "5.6.7.8" });
    existing.push(otherServerEntry);

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(existing));

    await saveFixHistory(makeEntry({ serverIp: "1.2.3.4", fixId: "fix-2026-03-30-001" }));

    const writeCall = (mockedFs.writeFileSync as jest.Mock).mock.calls[0];
    const written = JSON.parse(writeCall[1] as string) as FixHistoryEntry[];
    const otherServer = written.filter((e: FixHistoryEntry) => e.serverIp === "5.6.7.8");
    expect(otherServer).toHaveLength(1);
  });
});

describe("generateFixId", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return fix-{today}-001 when no entries today", () => {
    mockedFs.existsSync.mockReturnValue(false);
    const today = new Date().toISOString().split("T")[0];
    const fixId = generateFixId("1.2.3.4");
    expect(fixId).toBe(`fix-${today}-001`);
  });

  it("should increment counter for subsequent fixes on same day", () => {
    const today = new Date().toISOString().split("T")[0];
    const existing: FixHistoryEntry[] = [
      makeEntry({ fixId: `fix-${today}-001` }),
      makeEntry({ fixId: `fix-${today}-002` }),
      makeEntry({ fixId: `fix-${today}-003` }),
    ];
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(existing));

    const fixId = generateFixId("1.2.3.4");
    expect(fixId).toBe(`fix-${today}-004`);
  });

  it("should be independent per server (other servers don't affect counter)", () => {
    const today = new Date().toISOString().split("T")[0];
    // Other server has 5 entries today
    const existing: FixHistoryEntry[] = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ serverIp: "5.6.7.8", fixId: `fix-${today}-00${i + 1}` }),
    );
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(existing));

    // For 1.2.3.4, which has no entries today
    const fixId = generateFixId("1.2.3.4");
    expect(fixId).toBe(`fix-${today}-001`);
  });

  it("should not count entries from previous days", () => {
    const today = new Date().toISOString().split("T")[0];
    const existing: FixHistoryEntry[] = [
      makeEntry({ fixId: "fix-2025-01-01-001" }), // yesterday's fix
      makeEntry({ fixId: "fix-2025-01-01-002" }), // another old fix
    ];
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(existing));

    const fixId = generateFixId("1.2.3.4");
    expect(fixId).toBe(`fix-${today}-001`);
  });
});

describe("getLastFixId", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return null when no history exists", () => {
    mockedFs.existsSync.mockReturnValue(false);
    const result = getLastFixId("1.2.3.4");
    expect(result).toBeNull();
  });

  it("should return last applied fix ID", () => {
    const entries: FixHistoryEntry[] = [
      makeEntry({ fixId: "fix-2026-03-29-001", status: "applied", timestamp: "2026-03-29T10:00:00Z" }),
      makeEntry({ fixId: "fix-2026-03-29-002", status: "applied", timestamp: "2026-03-29T11:00:00Z" }),
    ];
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(entries));

    const result = getLastFixId("1.2.3.4");
    expect(result).toBe("fix-2026-03-29-002");
  });

  it("should skip rolled-back entries", () => {
    const entries: FixHistoryEntry[] = [
      makeEntry({ fixId: "fix-2026-03-29-001", status: "applied" }),
      makeEntry({ fixId: "fix-2026-03-29-002", status: "rolled-back" }),
    ];
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(entries));

    const result = getLastFixId("1.2.3.4");
    expect(result).toBe("fix-2026-03-29-001");
  });

  it("should skip failed entries", () => {
    const entries: FixHistoryEntry[] = [
      makeEntry({ fixId: "fix-2026-03-29-001", status: "applied" }),
      makeEntry({ fixId: "fix-2026-03-29-002", status: "failed" }),
    ];
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(entries));

    const result = getLastFixId("1.2.3.4");
    expect(result).toBe("fix-2026-03-29-001");
  });

  it("should return null when all entries are rolled-back or failed", () => {
    const entries: FixHistoryEntry[] = [
      makeEntry({ fixId: "fix-2026-03-29-001", status: "rolled-back" }),
      makeEntry({ fixId: "fix-2026-03-29-002", status: "failed" }),
    ];
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(entries));

    const result = getLastFixId("1.2.3.4");
    expect(result).toBeNull();
  });
});

describe("extractFilePathsFromFixCommand", () => {
  it("should extract /etc/... paths from sed commands", () => {
    const cmd = "sed -i 's/PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config";
    const paths = extractFilePathsFromFixCommand(cmd);
    expect(paths).toContain("/etc/ssh/sshd_config");
  });

  it("should extract /etc/... paths from echo/append commands", () => {
    const cmd = "echo 'net.ipv4.tcp_syncookies=1' >> /etc/sysctl.conf";
    const paths = extractFilePathsFromFixCommand(cmd);
    expect(paths).toContain("/etc/sysctl.conf");
  });

  it("should return [] for sysctl -w commands", () => {
    const cmd = "sysctl -w net.ipv4.tcp_syncookies=1";
    const paths = extractFilePathsFromFixCommand(cmd);
    expect(paths).toEqual([]);
  });

  it("should return [] for systemctl commands", () => {
    const cmd = "systemctl disable rsync";
    const paths = extractFilePathsFromFixCommand(cmd);
    expect(paths).toEqual([]);
  });

  it("should return [] for useradd commands", () => {
    const cmd = "useradd -r svc";
    const paths = extractFilePathsFromFixCommand(cmd);
    expect(paths).toEqual([]);
  });

  it("should extract paths from chmod commands", () => {
    const cmd = "chmod 600 /etc/ssh/sshd_config";
    const paths = extractFilePathsFromFixCommand(cmd);
    expect(paths).toContain("/etc/ssh/sshd_config");
  });

  it("should extract paths from chown commands", () => {
    const cmd = "chown root:root /etc/crontab";
    const paths = extractFilePathsFromFixCommand(cmd);
    expect(paths).toContain("/etc/crontab");
  });

  it("should not include paths ending with /", () => {
    const cmd = "chmod 700 /etc/cron.d/";
    const paths = extractFilePathsFromFixCommand(cmd);
    expect(paths).not.toContain("/etc/cron.d/");
  });

  it("should extract absolute path from sed-replace command", () => {
    const cmd = "sed-replace:/etc/ssh/sshd_config:old:new";
    const paths = extractFilePathsFromFixCommand(cmd);
    expect(paths).toEqual(["/etc/ssh/sshd_config"]);
  });

  it("should return [] for sed-replace with relative path", () => {
    const cmd = "sed-replace:relative/path:old:new";
    const paths = extractFilePathsFromFixCommand(cmd);
    expect(paths).toEqual([]);
  });
});
