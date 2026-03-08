import { saveAuditHistory, loadAuditHistory, detectTrend } from "../../src/core/audit/history.js";
import type { AuditResult, AuditHistoryEntry } from "../../src/core/audit/types.js";
import * as fs from "fs";

jest.mock("fs");
jest.mock("../../src/utils/config.js", () => ({
  CONFIG_DIR: "/home/user/.kastell",
}));

const mockedFs = fs as jest.Mocked<typeof fs>;

function makeResult(overrides: Partial<AuditResult> = {}): AuditResult {
  return {
    serverName: "test-server",
    serverIp: "1.2.3.4",
    platform: "bare",
    timestamp: "2026-03-08T10:00:00Z",
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
});

describe("saveAuditHistory", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should write to ~/.kastell/audit-history.json", () => {
    mockedFs.existsSync.mockReturnValue(false);

    saveAuditHistory(makeResult());

    expect(mockedFs.writeFileSync).toHaveBeenCalled();
    const writePath = (mockedFs.writeFileSync as jest.Mock).mock.calls[0][0] as string;
    expect(writePath).toContain("audit-history");
  });

  it("should append to existing history", () => {
    const existing = [makeHistoryEntry({ overallScore: 50 })];
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(existing));

    saveAuditHistory(makeResult({ overallScore: 70 }));

    const writeCall = (mockedFs.writeFileSync as jest.Mock).mock.calls[0];
    const written = JSON.parse(writeCall[1] as string) as AuditHistoryEntry[];
    expect(written).toHaveLength(2);
  });

  it("should cap history at 50 entries per server", () => {
    const existing: AuditHistoryEntry[] = Array.from({ length: 50 }, (_, i) =>
      makeHistoryEntry({
        serverIp: "1.2.3.4",
        overallScore: i,
        timestamp: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      }),
    );
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(existing));

    saveAuditHistory(makeResult({ serverIp: "1.2.3.4", overallScore: 99 }));

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
    const trend = detectTrend(70, []);
    expect(trend).toContain("first audit");
  });

  it("should return improvement when score increased", () => {
    const history = [makeHistoryEntry({ overallScore: 60 })];
    const trend = detectTrend(75, history);
    expect(trend).toContain("+15");
    expect(trend.toLowerCase()).toContain("improvement");
  });

  it("should return regression when score decreased", () => {
    const history = [makeHistoryEntry({ overallScore: 80 })];
    const trend = detectTrend(65, history);
    expect(trend).toContain("15");
    expect(trend.toLowerCase()).toContain("regression");
  });

  it("should return unchanged when score is the same", () => {
    const history = [makeHistoryEntry({ overallScore: 70 })];
    const trend = detectTrend(70, history);
    expect(trend.toLowerCase()).toContain("unchanged");
  });

  it("should compare against the most recent entry", () => {
    const history = [
      makeHistoryEntry({ overallScore: 50, timestamp: "2026-03-06T00:00:00Z" }),
      makeHistoryEntry({ overallScore: 80, timestamp: "2026-03-07T00:00:00Z" }),
    ];
    // Compare against most recent (80), not first (50)
    const trend = detectTrend(85, history);
    expect(trend).toContain("+5");
  });
});
