/**
 * Unit tests for audit snapshot persistence module.
 * Tests: saveSnapshot, loadSnapshot, listSnapshots
 */

import {
  saveSnapshot,
  loadSnapshot,
  listSnapshots,
} from "../../src/core/audit/snapshot.js";
import type { AuditResult } from "../../src/core/audit/types.js";
import * as fs from "fs";

jest.mock("fs");
jest.mock("../../src/utils/paths.js", () => ({
  KASTELL_DIR: "/home/user/.kastell",
}));
jest.mock("../../src/utils/fileLock", () => ({
  withFileLock: jest.fn((_path: string, fn: () => unknown) => fn()),
}));
jest.mock("../../src/utils/secureWrite", () => ({
  secureWriteFileSync: jest.fn(),
  secureMkdirSync: jest.fn(),
  clearCache: jest.fn(),
}));

const mockedSecureWrite = require("../../src/utils/secureWrite") as {
  secureMkdirSync: jest.Mock;
  secureWriteFileSync: jest.Mock;
};
const mockedFs = fs as jest.Mocked<typeof fs>;

function makeAuditResult(overrides: Partial<AuditResult> = {}): AuditResult {
  return {
    serverName: "test-server",
    serverIp: "1.2.3.4",
    platform: "bare",
    timestamp: "2026-03-08T10:00:00.000Z",
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

describe("saveSnapshot", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFs.existsSync.mockReturnValue(false);
  });

  it("should write JSON to ~/.kastell/snapshots/{safeIp}/{timestamp}.json", async () => {
    await saveSnapshot(makeAuditResult());

    expect(mockedSecureWrite.secureWriteFileSync).toHaveBeenCalled();
    const writePath = mockedSecureWrite.secureWriteFileSync.mock.calls[0][0] as string;
    expect(writePath).toContain("snapshots");
    expect(writePath).toContain("1-2-3-4");
    expect(writePath).toContain(".tmp");
  });

  it("should replace dots with hyphens in directory name", async () => {
    await saveSnapshot(makeAuditResult({ serverIp: "10.0.0.1" }));

    expect(mockedSecureWrite.secureMkdirSync).toHaveBeenCalled();
    const mkdirPath = mockedSecureWrite.secureMkdirSync.mock.calls[0][0] as string;
    expect(mkdirPath).toContain("10-0-0-1");
    expect(mkdirPath).not.toContain("10.0.0.1");
  });

  it("should create directory with secureMkdirSync", async () => {
    await saveSnapshot(makeAuditResult());

    expect(mockedSecureWrite.secureMkdirSync).toHaveBeenCalled();
    expect(mockedSecureWrite.secureMkdirSync.mock.calls[0][0]).toContain("snapshots");
  });

  it("should produce JSON with schemaVersion: 2 (v2 schema)", async () => {
    await saveSnapshot(makeAuditResult());

    const writeContent = mockedSecureWrite.secureWriteFileSync.mock.calls[0][1] as string;
    const parsed = JSON.parse(writeContent);
    expect(parsed.schemaVersion).toBe(2);
  });

  it("should contain full audit result in envelope", async () => {
    const result = makeAuditResult({ overallScore: 85 });
    await saveSnapshot(result);

    const writeContent = mockedSecureWrite.secureWriteFileSync.mock.calls[0][1] as string;
    const parsed = JSON.parse(writeContent);
    expect(parsed.audit.overallScore).toBe(85);
    expect(parsed.audit.serverIp).toBe("1.2.3.4");
  });

  it("should use atomic write (tmp + rename)", async () => {
    await saveSnapshot(makeAuditResult());

    const writePath = mockedSecureWrite.secureWriteFileSync.mock.calls[0][0] as string;
    expect(writePath).toMatch(/\.tmp$/);
    expect(mockedFs.renameSync).toHaveBeenCalled();

    const renameDest = (mockedFs.renameSync as jest.Mock).mock.calls[0][1] as string;
    expect(renameDest).not.toMatch(/\.tmp$/);
    expect(renameDest).toMatch(/\.json$/);
  });

  describe("named snapshots (SNAP-03)", () => {
    it("should include name in filename when provided", async () => {
      await saveSnapshot(makeAuditResult(), "pre-upgrade");

      const writePath = mockedSecureWrite.secureWriteFileSync.mock.calls[0][0] as string;
      expect(writePath).toContain("pre-upgrade");
    });

    it("should store name in SnapshotFile.name field", async () => {
      await saveSnapshot(makeAuditResult(), "pre-upgrade");

      const writeContent = mockedSecureWrite.secureWriteFileSync.mock.calls[0][1] as string;
      const parsed = JSON.parse(writeContent);
      expect(parsed.name).toBe("pre-upgrade");
    });

    it("should sanitize name — replace non-[a-zA-Z0-9_-] with underscore", async () => {
      await saveSnapshot(makeAuditResult(), "my name! @here");

      const writeContent = mockedSecureWrite.secureWriteFileSync.mock.calls[0][1] as string;
      const parsed = JSON.parse(writeContent);
      expect(parsed.name).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(parsed.name).not.toContain(" ");
      expect(parsed.name).not.toContain("!");
      expect(parsed.name).not.toContain("@");
    });

    it("should neutralize path traversal in name", async () => {
      await saveSnapshot(makeAuditResult(), "../../../etc/passwd");

      const writePath = mockedSecureWrite.secureWriteFileSync.mock.calls[0][0] as string;
      expect(writePath).not.toContain("etc/passwd");
      expect(writePath).not.toContain("..");
    });

    it("should truncate name to 64 characters max", async () => {
      const longName = "a".repeat(100);
      await saveSnapshot(makeAuditResult(), longName);

      const writeContent = mockedSecureWrite.secureWriteFileSync.mock.calls[0][1] as string;
      const parsed = JSON.parse(writeContent);
      expect(parsed.name!.length).toBeLessThanOrEqual(64);
    });

    it("should not include name field when no name provided", async () => {
      await saveSnapshot(makeAuditResult());

      const writeContent = mockedSecureWrite.secureWriteFileSync.mock.calls[0][1] as string;
      const parsed = JSON.parse(writeContent);
      expect(parsed.name).toBeUndefined();
    });
  });
});

describe("loadSnapshot", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return parsed SnapshotFile for valid v1 JSON (migrated to v2)", async () => {
    // V1 snapshot: schemaVersion=1, no auditVersion in audit
    const snapshotData = {
      schemaVersion: 1,
      savedAt: "2026-03-08T10:00:00.000Z",
      audit: {
        serverName: "test-server",
        serverIp: "1.2.3.4",
        platform: "bare",
        timestamp: "2026-03-08T10:00:00.000Z",
        categories: [{ name: "SSH", checks: [], score: 80, maxScore: 100 }],
        overallScore: 70,
        quickWins: [],
        // no auditVersion — v1 format
      },
    };
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(snapshotData));

    const result = await loadSnapshot("1.2.3.4", "2026-03-08T10-00-00-000Z.json");
    expect(result).not.toBeNull();
    // V1 is auto-migrated to v2 on load
    expect(result!.schemaVersion).toBe(2);
    expect(result!.audit.serverIp).toBe("1.2.3.4");
  });

  it("should return null for missing file", async () => {
    mockedFs.readFileSync.mockImplementation(() => {
      throw Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
    });

    const result = await loadSnapshot("1.2.3.4", "nonexistent.json");
    expect(result).toBeNull();
  });

  it("should return null for corrupt JSON", async () => {
    mockedFs.readFileSync.mockReturnValue("not valid json {{{");

    const result = await loadSnapshot("1.2.3.4", "bad.json");
    expect(result).toBeNull();
  });

  it("should return null for unknown schema version (SNAP-04)", async () => {
    const unknownSchema = {
      schemaVersion: 99,
      savedAt: "2026-03-08T10:00:00.000Z",
      audit: makeAuditResult(),
    };
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(unknownSchema));

    const result = await loadSnapshot("1.2.3.4", "future.json");
    expect(result).toBeNull();
  });

  it("should return null for missing required fields", async () => {
    mockedFs.readFileSync.mockReturnValue(JSON.stringify({ schemaVersion: 1 }));

    const result = await loadSnapshot("1.2.3.4", "partial.json");
    expect(result).toBeNull();
  });
});

describe("Zod schema backward/forward compatibility", () => {
  it("should validate snapshot without complianceRefs/tags (existing format)", async () => {
    const snapshotData = {
      schemaVersion: 1,
      savedAt: "2026-03-08T10:00:00.000Z",
      audit: makeAuditResult(),
    };
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(snapshotData));

    const result = await loadSnapshot("1.2.3.4", "old-format.json");
    expect(result).not.toBeNull();
    expect(result!.audit.categories[0].checks).toEqual([]);
  });

  it("should validate snapshot with complianceRefs and tags fields (new format)", async () => {
    const auditWithRefs = makeAuditResult();
    auditWithRefs.categories = [
      {
        name: "SSH",
        score: 80,
        maxScore: 100,
        checks: [
          {
            id: "SSH-01",
            category: "SSH",
            name: "Password Auth",
            severity: "critical",
            passed: false,
            currentValue: "yes",
            expectedValue: "no",
            complianceRefs: [
              {
                framework: "CIS",
                controlId: "5.2.1",
                version: "1.0",
                description: "SSH MaxAuthTries",
                coverage: "full",
              },
            ],
            tags: ["ssh", "authentication"],
          },
        ],
      },
    ];

    const snapshotData = {
      schemaVersion: 1,
      savedAt: "2026-03-08T10:00:00.000Z",
      audit: auditWithRefs,
    };
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(snapshotData));

    const result = await loadSnapshot("1.2.3.4", "new-format.json");
    expect(result).not.toBeNull();
    const check = result!.audit.categories[0].checks[0];
    expect(check.complianceRefs).toHaveLength(1);
    expect(check.complianceRefs![0].framework).toBe("CIS");
    expect(check.tags).toEqual(["ssh", "authentication"]);
  });

  it("should reject snapshot with complianceRefs missing required coverage field", async () => {
    const auditWithBadRefs = makeAuditResult();
    auditWithBadRefs.categories = [
      {
        name: "SSH",
        score: 80,
        maxScore: 100,
        checks: [
          {
            id: "SSH-01",
            category: "SSH",
            name: "Password Auth",
            severity: "critical",
            passed: false,
            currentValue: "yes",
            expectedValue: "no",
            complianceRefs: [
              {
                framework: "CIS",
                controlId: "5.2.1",
                version: "1.0",
                description: "SSH MaxAuthTries",
                // coverage intentionally omitted to test Zod rejection
              } as never,
            ],
          },
        ],
      },
    ];

    const snapshotData = {
      schemaVersion: 1,
      savedAt: "2026-03-08T10:00:00.000Z",
      audit: auditWithBadRefs,
    };
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(snapshotData));

    const result = await loadSnapshot("1.2.3.4", "bad-compliance.json");
    expect(result).toBeNull();
  });
});

describe("listSnapshots", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return empty array when snapshots directory does not exist", async () => {
    mockedFs.existsSync.mockReturnValue(false);

    const entries = await listSnapshots("1.2.3.4");
    expect(entries).toEqual([]);
  });

  it("should return list sorted chronologically (oldest first)", async () => {
    mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
      if (String(p).endsWith("snapshots.index.json")) return false;
      return true;
    });
    mockedFs.readdirSync.mockReturnValue([
      "2026-03-08T12-00-00-000Z.json",
      "2026-03-06T10-00-00-000Z.json",
      "2026-03-07T08-00-00-000Z.json",
    ] as unknown as ReturnType<typeof fs.readdirSync>);

    const makeEntry = (ts: string) =>
      JSON.stringify({
        schemaVersion: 1,
        savedAt: ts,
        audit: makeAuditResult({ overallScore: 70 }),
      });

    mockedFs.readFileSync
      .mockReturnValueOnce(makeEntry("2026-03-08T12:00:00.000Z"))
      .mockReturnValueOnce(makeEntry("2026-03-06T10:00:00.000Z"))
      .mockReturnValueOnce(makeEntry("2026-03-07T08:00:00.000Z"));

    const entries = await listSnapshots("1.2.3.4");
    expect(entries).toHaveLength(3);
    expect(entries[0].filename).toBe("2026-03-06T10-00-00-000Z.json");
    expect(entries[2].filename).toBe("2026-03-08T12-00-00-000Z.json");
  });

  it("should include savedAt, overallScore in each entry", async () => {
    mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
      if (String(p).endsWith("snapshots.index.json")) return false;
      return true;
    });
    mockedFs.readdirSync.mockReturnValue([
      "2026-03-08T10-00-00-000Z.json",
    ] as unknown as ReturnType<typeof fs.readdirSync>);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        schemaVersion: 1,
        savedAt: "2026-03-08T10:00:00.000Z",
        audit: makeAuditResult({ overallScore: 85 }),
      }),
    );

    const entries = await listSnapshots("1.2.3.4");
    expect(entries[0].savedAt).toBe("2026-03-08T10:00:00.000Z");
    expect(entries[0].overallScore).toBe(85);
    expect(entries[0].filename).toBe("2026-03-08T10-00-00-000Z.json");
  });

  it("should include name in entry when snapshot was named", async () => {
    mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
      if (String(p).endsWith("snapshots.index.json")) return false;
      return true;
    });
    mockedFs.readdirSync.mockReturnValue([
      "2026-03-08T10-00-00-000Z_pre-upgrade.json",
    ] as unknown as ReturnType<typeof fs.readdirSync>);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        schemaVersion: 1,
        name: "pre-upgrade",
        savedAt: "2026-03-08T10:00:00.000Z",
        audit: makeAuditResult(),
      }),
    );

    const entries = await listSnapshots("1.2.3.4");
    expect(entries[0].name).toBe("pre-upgrade");
  });

  it("should not include corrupt files in results", async () => {
    mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
      if (String(p).endsWith("snapshots.index.json")) return false;
      return true;
    });
    mockedFs.readdirSync.mockReturnValue([
      "2026-03-08T10-00-00-000Z.json",
    ] as unknown as ReturnType<typeof fs.readdirSync>);
    mockedFs.readFileSync.mockReturnValue("not valid json {{{");

    const entries = await listSnapshots("1.2.3.4");
    // corrupt files are silently skipped during index rebuild, not included with corrupt:true
    expect(entries).toHaveLength(0);
  });

  it("should skip non-.json files", async () => {
    mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
      if (String(p).endsWith("snapshots.index.json")) return false;
      return true;
    });
    mockedFs.readdirSync.mockReturnValue([
      "2026-03-08T10-00-00-000Z.json",
      "not-a-snapshot.txt",
      ".lock",
    ] as unknown as ReturnType<typeof fs.readdirSync>);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        schemaVersion: 1,
        savedAt: "2026-03-08T10:00:00.000Z",
        audit: makeAuditResult(),
      }),
    );

    const entries = await listSnapshots("1.2.3.4");
    expect(entries).toHaveLength(1);
  });
});

describe("snapshot index", () => {
  const INDEX_FILENAME = "snapshots.index.json";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("listSnapshots should read from index when available", async () => {
    const indexData = {
      version: 1,
      entries: [
        { filename: "2026-04-01.json", savedAt: "2026-04-01T10:00:00Z", overallScore: 70, checkCount: 50, serverIp: "1.2.3.4" },
        { filename: "2026-04-02.json", savedAt: "2026-04-02T10:00:00Z", overallScore: 75, checkCount: 50, serverIp: "1.2.3.4" },
      ],
    };

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(indexData));

    const entries = await listSnapshots("1.2.3.4");
    expect(entries).toHaveLength(2);
    expect(entries[0].overallScore).toBe(70);
    expect(entries[1].overallScore).toBe(75);
    expect(mockedFs.readdirSync).not.toHaveBeenCalled();
  });

  it("listSnapshots should fallback to file scan when index missing", async () => {
    mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
      if (String(p).includes(INDEX_FILENAME)) return false;
      return true;
    });
    mockedFs.readdirSync.mockReturnValue(["2026-04-01.json"] as unknown as ReturnType<typeof fs.readdirSync>);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify({
      schemaVersion: 2,
      savedAt: "2026-04-01T10:00:00Z",
      audit: {
        serverName: "test",
        serverIp: "1.2.3.4",
        platform: "bare",
        timestamp: "2026-04-01T10:00:00Z",
        auditVersion: "1.0.0",
        overallScore: 70,
        categories: [],
        quickWins: [],
      },
    }));

    const entries = await listSnapshots("1.2.3.4");
    expect(entries).toHaveLength(1);
    expect(mockedFs.readdirSync).toHaveBeenCalled();
  });

  it("listSnapshots should rebuild index after fallback scan", async () => {
    mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
      if (String(p).includes(INDEX_FILENAME)) return false;
      return true;
    });
    mockedFs.readdirSync.mockReturnValue(["2026-04-01.json"] as unknown as ReturnType<typeof fs.readdirSync>);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify({
      schemaVersion: 2,
      savedAt: "2026-04-01T10:00:00Z",
      audit: {
        serverName: "test",
        serverIp: "1.2.3.4",
        platform: "bare",
        timestamp: "2026-04-01T10:00:00Z",
        auditVersion: "1.0.0",
        overallScore: 70,
        categories: [],
        quickWins: [],
      },
    }));

    await listSnapshots("1.2.3.4");
    expect(mockedSecureWrite.secureWriteFileSync).toHaveBeenCalled();
    const writeCall = mockedSecureWrite.secureWriteFileSync.mock.calls.find(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes(INDEX_FILENAME)
    );
    expect(writeCall).toBeDefined();
  });

  it("saveSnapshot should update index", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify({ version: 1, entries: [] }));
    mockedFs.renameSync.mockImplementation(() => {});

    await saveSnapshot(makeAuditResult());

    const indexWrites = mockedSecureWrite.secureWriteFileSync.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes(INDEX_FILENAME)
    );
    expect(indexWrites.length).toBeGreaterThanOrEqual(1);
  });
});
