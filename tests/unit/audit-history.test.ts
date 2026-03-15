import { saveAuditHistory, loadAuditHistory, detectTrend } from "../../src/core/audit/history.js";
import type { AuditResult, AuditHistoryEntry } from "../../src/core/audit/types.js";
import * as fs from "fs";

jest.mock("fs");
jest.mock("../../src/utils/config.js", () => ({
  CONFIG_DIR: "/home/user/.kastell",
}));
jest.mock("../../src/utils/fileLock", () => ({
  withFileLock: jest.fn((_path: string, fn: () => unknown) => fn()),
}));

const mockedFs = fs as jest.Mocked<typeof fs>;

function makeResult(overrides: Partial<AuditResult> = {}): AuditResult {
  return {
    serverName: "test-server",
    serverIp: "1.2.3.4",
    platform: "bare",
    timestamp: "2026-03-08T10:00:00Z",
    auditVersion: "1.0.0",
    categories: [
      { name: "SSH", checks: [], score: 80, maxScore: 100 },
      { name: "Firewall", checks: [], score: 60, maxScore: 100 },
    ],
    overallScore: 70,
    quickWins: [],
    ...overrides,
  };
}

function makeHistoryEntry(overrides: Partial<AuditHistoryEntry> = {}): AuditHistoryEntry {
  return {
    serverIp: "1.2.3.4",
    serverName: "test-server",
    timestamp: "2026-03-07T10:00:00Z",
    overallScore: 60,
    categoryScores: { SSH: 70, Firewall: 50 },
    ...overrides,
  };
}

describe("loadAuditHistory", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return empty array for new server (no history file)", () => {
    mockedFs.existsSync.mockReturnValue(false);

    const history = loadAuditHistory("1.2.3.4");
    expect(history).toEqual([]);
  });

  it("should return filtered entries for specific server IP", () => {
    const entries: AuditHistoryEntry[] = [
      makeHistoryEntry({ serverIp: "1.2.3.4", overallScore: 50 }),
      makeHistoryEntry({ serverIp: "5.6.7.8", overallScore: 90 }),
      makeHistoryEntry({ serverIp: "1.2.3.4", overallScore: 70 }),
    ];

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(entries));

    const history = loadAuditHistory("1.2.3.4");
    expect(history).toHaveLength(2);
    expect(history.every((e: AuditHistoryEntry) => e.serverIp === "1.2.3.4")).toBe(true);
  });

  it("should handle corrupt JSON gracefully", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue("not valid json{{{");

    const history = loadAuditHistory("1.2.3.4");
    expect(history).toEqual([]);
  });

  it("should reject entries with extra fields (Zod .strict())", () => {
    const entriesWithExtra = [
      {
        serverIp: "1.2.3.4",
        serverName: "test-server",
        timestamp: "2026-03-07T10:00:00Z",
        overallScore: 60,
        categoryScores: { SSH: 70 },
        checks: [], // extra field — not in schema
      },
    ];

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(entriesWithExtra));

    const history = loadAuditHistory("1.2.3.4");
    expect(history).toEqual([]);
  });

  it("should accept entries without auditVersion (legacy entries)", () => {
    const legacyEntries = [
      {
        serverIp: "1.2.3.4",
        serverName: "test-server",
        timestamp: "2026-03-07T10:00:00Z",
        overallScore: 60,
        categoryScores: { SSH: 70 },
        // no auditVersion
      },
    ];

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(legacyEntries));

    const history = loadAuditHistory("1.2.3.4");
    expect(history).toHaveLength(1);
    expect(history[0].overallScore).toBe(60);
    expect(history[0].auditVersion).toBeUndefined();
  });
});

describe("saveAuditHistory", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should write to ~/.kastell/audit-history.json", async () => {
    mockedFs.existsSync.mockReturnValue(false);

    await saveAuditHistory(makeResult());

    expect(mockedFs.writeFileSync).toHaveBeenCalled();
    const writePath = (mockedFs.writeFileSync as jest.Mock).mock.calls[0][0] as string;
    expect(writePath).toContain("audit-history");
  });

  it("should append to existing history", async () => {
    const existing = [makeHistoryEntry({ overallScore: 50 })];
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(existing));

    await saveAuditHistory(makeResult({ overallScore: 70 }));

    const writeCall = (mockedFs.writeFileSync as jest.Mock).mock.calls[0];
    const written = JSON.parse(writeCall[1] as string) as AuditHistoryEntry[];
    expect(written).toHaveLength(2);
  });

  it("should persist auditVersion in history entry", async () => {
    mockedFs.existsSync.mockReturnValue(false);

    await saveAuditHistory(makeResult({ auditVersion: "1.10.0" }));

    const writeCall = (mockedFs.writeFileSync as jest.Mock).mock.calls[0];
    const written = JSON.parse(writeCall[1] as string) as AuditHistoryEntry[];
    expect(written[0].auditVersion).toBe("1.10.0");
  });

  it("should cap history at 50 entries per server", async () => {
    const existing: AuditHistoryEntry[] = Array.from({ length: 50 }, (_, i) =>
      makeHistoryEntry({
        serverIp: "1.2.3.4",
        overallScore: i,
        timestamp: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      }),
    );
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(existing));

    await saveAuditHistory(makeResult({ serverIp: "1.2.3.4", overallScore: 99 }));

    const writeCall = (mockedFs.writeFileSync as jest.Mock).mock.calls[0];
    const written = JSON.parse(writeCall[1] as string) as AuditHistoryEntry[];
    const serverEntries = written.filter((e: AuditHistoryEntry) => e.serverIp === "1.2.3.4");
    expect(serverEntries).toHaveLength(50);
    // Latest entry should be the new one
    expect(serverEntries[serverEntries.length - 1].overallScore).toBe(99);
  });
});

describe("detectTrend", () => {
  it('should return "first audit" when no history', () => {
    const trend = detectTrend(70, "1.10.0", []);
    expect(trend).toContain("first audit");
  });

  it("should return improvement when score increased (same version)", () => {
    const history = [makeHistoryEntry({ overallScore: 60, auditVersion: "1.10.0" })];
    const trend = detectTrend(75, "1.10.0", history);
    expect(trend).toContain("+15");
    expect(trend.toLowerCase()).toContain("improvement");
  });

  it("should return regression when score decreased (same version)", () => {
    const history = [makeHistoryEntry({ overallScore: 80, auditVersion: "1.10.0" })];
    const trend = detectTrend(65, "1.10.0", history);
    expect(trend).toContain("15");
    expect(trend.toLowerCase()).toContain("regression");
  });

  it("should return unchanged when score is the same (same version)", () => {
    const history = [makeHistoryEntry({ overallScore: 70, auditVersion: "1.10.0" })];
    const trend = detectTrend(70, "1.10.0", history);
    expect(trend.toLowerCase()).toContain("unchanged");
  });

  it("should compare against the most recent same-version entry", () => {
    const history = [
      makeHistoryEntry({ overallScore: 50, timestamp: "2026-03-06T00:00:00Z", auditVersion: "1.10.0" }),
      makeHistoryEntry({ overallScore: 80, timestamp: "2026-03-07T00:00:00Z", auditVersion: "1.10.0" }),
    ];
    // Compare against most recent (80), not first (50)
    const trend = detectTrend(85, "1.10.0", history);
    expect(trend).toContain("+5");
  });

  it("should return methodology-change when all history is different version", () => {
    const history = [
      makeHistoryEntry({ overallScore: 60, auditVersion: "1.0.0" }),
      makeHistoryEntry({ overallScore: 70, auditVersion: "1.0.0" }),
    ];
    const trend = detectTrend(75, "1.10.0", history);
    expect(trend).toBe("methodology-change");
  });

  it("should filter to same-version entries in mixed-version history", () => {
    const history = [
      makeHistoryEntry({ overallScore: 40, timestamp: "2026-03-05T00:00:00Z", auditVersion: "1.0.0" }),
      makeHistoryEntry({ overallScore: 70, timestamp: "2026-03-06T00:00:00Z", auditVersion: "1.10.0" }),
      makeHistoryEntry({ overallScore: 50, timestamp: "2026-03-07T00:00:00Z", auditVersion: "1.0.0" }),
    ];
    // Most recent 1.10.0 entry has score 70; current=80 → +10 improvement
    const trend = detectTrend(80, "1.10.0", history);
    expect(trend).toContain("+10");
    expect(trend.toLowerCase()).toContain("improvement");
  });

  it("should treat legacy entries (no auditVersion) as version 1.0.0", () => {
    // Legacy entries have no auditVersion — treated as "1.0.0"
    const history = [makeHistoryEntry({ overallScore: 60 })]; // no auditVersion field
    const trend = detectTrend(75, "1.0.0", history);
    expect(trend).toContain("+15");
  });
});
