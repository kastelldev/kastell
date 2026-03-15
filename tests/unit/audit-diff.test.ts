/**
 * Tests for the audit diff engine: diffAudits, resolveSnapshotRef,
 * formatDiffTerminal, formatDiffJson.
 */

import { jest } from "@jest/globals";

// Mock snapshot module before any import of diff.ts
jest.mock("../../src/core/audit/snapshot.js", () => ({
  loadSnapshot: jest.fn(),
  listSnapshots: jest.fn(),
}));

import type { AuditCheck, AuditResult, SnapshotFile, SnapshotListEntry } from "../../src/core/audit/types.js";
import { diffAudits, resolveSnapshotRef, formatDiffTerminal, formatDiffJson } from "../../src/core/audit/diff.js";
import { loadSnapshot, listSnapshots } from "../../src/core/audit/snapshot.js";

const mockLoadSnapshot = loadSnapshot as jest.MockedFunction<typeof loadSnapshot>;
const mockListSnapshots = listSnapshots as jest.MockedFunction<typeof listSnapshots>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCheck(overrides: Partial<AuditCheck> & { id: string }): AuditCheck {
  const base: AuditCheck = {
    id: overrides.id,
    category: overrides.category ?? "SSH",
    name: overrides.name ?? `Check ${overrides.id}`,
    severity: overrides.severity ?? "warning",
    passed: overrides.passed ?? false,
    currentValue: overrides.currentValue ?? "actual",
    expectedValue: overrides.expectedValue ?? "expected",
  };
  return { ...base, ...overrides };
}

function makeAuditResult(checks: Partial<AuditCheck & { id: string }>[], score = 50): AuditResult {
  return {
    serverName: "test-server",
    serverIp: "10.0.0.1",
    platform: "bare",
    timestamp: "2026-01-01T00:00:00.000Z",
    categories: [
      {
        name: "SSH",
        checks: checks.map((c) => makeCheck(c as Partial<AuditCheck> & { id: string })),
        score,
        maxScore: 100,
      },
    ],
    overallScore: score,
    quickWins: [],
  };
}

function makeSnapshotFile(audit: AuditResult, name?: string): SnapshotFile {
  return {
    schemaVersion: 1,
    savedAt: "2026-01-01T00:00:00.000Z",
    audit,
    ...(name ? { name } : {}),
  };
}

// ─── diffAudits ───────────────────────────────────────────────────────────────

describe("diffAudits", () => {
  const check1 = makeCheck({ id: "SSH-PASSWORD-AUTH", passed: true });
  const check2 = makeCheck({ id: "SSH-ROOT-LOGIN", passed: true });
  const identicalAudit = makeAuditResult([{ ...check1 }, { ...check2 }], 80);

  it("identical audits: 0 improvements, 0 regressions, all unchanged", () => {
    const result = diffAudits(identicalAudit, identicalAudit);
    expect(result.improvements).toHaveLength(0);
    expect(result.regressions).toHaveLength(0);
    expect(result.unchanged).toHaveLength(2);
  });

  it("one check improved (failed->passed): 1 improvement, correct entry", () => {
    const before = makeAuditResult([{ id: "SSH-PASSWORD-AUTH", passed: false }], 40);
    const after = makeAuditResult([{ id: "SSH-PASSWORD-AUTH", passed: true }], 80);
    const result = diffAudits(before, after);
    expect(result.improvements).toHaveLength(1);
    expect(result.improvements[0].id).toBe("SSH-PASSWORD-AUTH");
    expect(result.improvements[0].status).toBe("improved");
    expect(result.improvements[0].before).toBe(false);
    expect(result.improvements[0].after).toBe(true);
  });

  it("one check regressed (passed->failed): 1 regression, correct entry", () => {
    const before = makeAuditResult([{ id: "FW-UFW-ACTIVE", passed: true }], 80);
    const after = makeAuditResult([{ id: "FW-UFW-ACTIVE", passed: false }], 40);
    const result = diffAudits(before, after);
    expect(result.regressions).toHaveLength(1);
    expect(result.regressions[0].id).toBe("FW-UFW-ACTIVE");
    expect(result.regressions[0].status).toBe("regressed");
  });

  it("mixed changes: correct counts for each category", () => {
    const before = makeAuditResult([
      { id: "SSH-PASSWORD-AUTH", passed: false },
      { id: "SSH-ROOT-LOGIN", passed: true },
      { id: "SSH-EMPTY-PASSWORDS", passed: true },
    ], 60);
    const after = makeAuditResult([
      { id: "SSH-PASSWORD-AUTH", passed: true },   // improved
      { id: "SSH-ROOT-LOGIN", passed: false },  // regressed
      { id: "SSH-EMPTY-PASSWORDS", passed: true },   // unchanged
    ], 60);
    const result = diffAudits(before, after);
    expect(result.improvements).toHaveLength(1);
    expect(result.regressions).toHaveLength(1);
    expect(result.unchanged).toHaveLength(1);
  });

  it("added checks (present in after, not before): classified as 'added'", () => {
    const before = makeAuditResult([{ id: "SSH-PASSWORD-AUTH", passed: true }], 80);
    const after = makeAuditResult([
      { id: "SSH-PASSWORD-AUTH", passed: true },
      { id: "SSH-ROOT-LOGIN", passed: true },
    ], 90);
    const result = diffAudits(before, after);
    expect(result.added).toHaveLength(1);
    expect(result.added[0].id).toBe("SSH-ROOT-LOGIN");
    expect(result.added[0].before).toBeNull();
    expect(result.added[0].after).toBe(true);
  });

  it("removed checks (present in before, not after): classified as 'removed'", () => {
    const before = makeAuditResult([
      { id: "SSH-PASSWORD-AUTH", passed: true },
      { id: "SSH-ROOT-LOGIN", passed: true },
    ], 90);
    const after = makeAuditResult([{ id: "SSH-PASSWORD-AUTH", passed: true }], 80);
    const result = diffAudits(before, after);
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0].id).toBe("SSH-ROOT-LOGIN");
    expect(result.removed[0].before).toBe(true);
    expect(result.removed[0].after).toBeNull();
  });

  it("computes correct scoreDelta (after - before)", () => {
    const before = makeAuditResult([{ id: "SSH-PASSWORD-AUTH", passed: false }], 40);
    const after = makeAuditResult([{ id: "SSH-PASSWORD-AUTH", passed: true }], 80);
    const result = diffAudits(before, after);
    expect(result.scoreBefore).toBe(40);
    expect(result.scoreAfter).toBe(80);
    expect(result.scoreDelta).toBe(40);
  });

  it("uses custom labels when provided", () => {
    const audit = makeAuditResult([{ id: "SSH-PASSWORD-AUTH", passed: true }], 80);
    const result = diffAudits(audit, audit, { before: "baseline", after: "current" });
    expect(result.beforeLabel).toBe("baseline");
    expect(result.afterLabel).toBe("current");
  });

  it("falls back to timestamp when no labels provided", () => {
    const audit = makeAuditResult([{ id: "SSH-PASSWORD-AUTH", passed: true }], 80);
    const result = diffAudits(audit, audit);
    expect(result.beforeLabel).toBe(audit.timestamp);
    expect(result.afterLabel).toBe(audit.timestamp);
  });
});

// ─── resolveSnapshotRef ───────────────────────────────────────────────────────

describe("resolveSnapshotRef", () => {
  const serverIp = "10.0.0.1";
  const audit = makeAuditResult([{ id: "SSH-PASSWORD-AUTH", passed: true }], 80);

  beforeEach(() => {
    mockLoadSnapshot.mockReset();
    mockListSnapshots.mockReset();
  });

  it("'latest' returns last entry from listSnapshots", async () => {
    const entries: SnapshotListEntry[] = [
      { filename: "old.json", savedAt: "2026-01-01T00:00:00Z", overallScore: 50 },
      { filename: "new.json", savedAt: "2026-01-02T00:00:00Z", overallScore: 80 },
    ];
    mockListSnapshots.mockResolvedValue(entries);
    mockLoadSnapshot.mockResolvedValue(makeSnapshotFile(audit));

    const result = await resolveSnapshotRef(serverIp, "latest");
    expect(result).not.toBeNull();
    expect(mockListSnapshots).toHaveBeenCalledWith(serverIp);
    expect(mockLoadSnapshot).toHaveBeenCalledWith(serverIp, "new.json");
  });

  it("'latest' on empty list returns null", async () => {
    mockListSnapshots.mockResolvedValue([]);
    const result = await resolveSnapshotRef(serverIp, "latest");
    expect(result).toBeNull();
  });

  it("filename ref delegates to loadSnapshot", async () => {
    mockLoadSnapshot.mockResolvedValue(makeSnapshotFile(audit));
    const result = await resolveSnapshotRef(serverIp, "2026-01-01T00-00-00-000Z.json");
    expect(result).not.toBeNull();
    expect(mockLoadSnapshot).toHaveBeenCalledWith(serverIp, "2026-01-01T00-00-00-000Z.json");
  });

  it("name ref scans listSnapshots and loads matching entry", async () => {
    const entries: SnapshotListEntry[] = [
      { filename: "snap1.json", savedAt: "2026-01-01T00:00:00Z", overallScore: 50, name: "baseline" },
    ];
    mockListSnapshots.mockResolvedValue(entries);
    // First call (filename match) returns null, triggering name scan
    mockLoadSnapshot.mockResolvedValueOnce(null);
    mockLoadSnapshot.mockResolvedValueOnce(makeSnapshotFile(audit));

    const result = await resolveSnapshotRef(serverIp, "baseline");
    expect(result).not.toBeNull();
    expect(mockLoadSnapshot).toHaveBeenCalledWith(serverIp, "snap1.json");
  });

  it("returns null when no match found", async () => {
    mockListSnapshots.mockResolvedValue([]);
    mockLoadSnapshot.mockResolvedValue(null);
    const result = await resolveSnapshotRef(serverIp, "nonexistent");
    expect(result).toBeNull();
  });

  describe("cross-server", () => {
    it("called with different serverIp loads from that server's snapshot directory", async () => {
      const crossServerIp = "10.0.0.99";
      const entries: SnapshotListEntry[] = [
        { filename: "remote.json", savedAt: "2026-01-02T00:00:00Z", overallScore: 75 },
      ];
      mockListSnapshots.mockResolvedValue(entries);
      mockLoadSnapshot.mockResolvedValue(makeSnapshotFile(audit));

      await resolveSnapshotRef(crossServerIp, "latest");

      expect(mockListSnapshots).toHaveBeenCalledWith(crossServerIp);
      expect(mockLoadSnapshot).toHaveBeenCalledWith(crossServerIp, "remote.json");
    });
  });
});

// ─── formatDiffTerminal ───────────────────────────────────────────────────────

describe("formatDiffTerminal", () => {
  const audit1 = makeAuditResult([{ id: "SSH-PASSWORD-AUTH", passed: false }], 40);
  const audit2 = makeAuditResult([{ id: "SSH-PASSWORD-AUTH", passed: true }], 80);

  it("includes 'Kastell Audit Diff' header", () => {
    const diff = diffAudits(audit1, audit2, { before: "v1", after: "v2" });
    const output = formatDiffTerminal(diff);
    expect(output).toContain("Kastell Audit Diff");
  });

  it("shows score delta with + prefix for positive", () => {
    const diff = diffAudits(audit1, audit2);
    const output = formatDiffTerminal(diff);
    expect(output).toContain("+40");
  });

  it("shows regression count in output", () => {
    const before = makeAuditResult([{ id: "SSH-PASSWORD-AUTH", passed: true }], 80);
    const after = makeAuditResult([{ id: "SSH-PASSWORD-AUTH", passed: false }], 40);
    const diff = diffAudits(before, after);
    const output = formatDiffTerminal(diff);
    // Should mention 1 regression
    expect(output).toMatch(/1\s*regression/i);
  });

  it("shows improvement count in output", () => {
    const diff = diffAudits(audit1, audit2);
    const output = formatDiffTerminal(diff);
    expect(output).toMatch(/1\s*improvement/i);
  });

  it("lists individual regressions with check ID and name", () => {
    const before = makeAuditResult([{ id: "FW-UFW-ACTIVE", name: "Firewall Check", passed: true }], 80);
    const after = makeAuditResult([{ id: "FW-UFW-ACTIVE", name: "Firewall Check", passed: false }], 40);
    const diff = diffAudits(before, after);
    const output = formatDiffTerminal(diff);
    expect(output).toContain("FW-UFW-ACTIVE");
    expect(output).toContain("Firewall Check");
  });

  it("lists individual improvements with check ID and name", () => {
    const diff = diffAudits(audit1, audit2);
    const output = formatDiffTerminal(diff);
    expect(output).toContain("SSH-PASSWORD-AUTH");
  });

  it("omits 'Added' section when no added checks", () => {
    const diff = diffAudits(audit1, audit2);
    const output = formatDiffTerminal(diff);
    expect(output).not.toMatch(/Added checks/i);
  });

  it("omits 'Removed' section when no removed checks", () => {
    const diff = diffAudits(audit1, audit2);
    const output = formatDiffTerminal(diff);
    expect(output).not.toMatch(/Removed checks/i);
  });
});

// ─── formatDiffJson ───────────────────────────────────────────────────────────

describe("formatDiffJson", () => {
  const audit1 = makeAuditResult([{ id: "SSH-PASSWORD-AUTH", passed: false }], 40);
  const audit2 = makeAuditResult([{ id: "SSH-PASSWORD-AUTH", passed: true }], 80);

  it("returns valid JSON string", () => {
    const diff = diffAudits(audit1, audit2);
    const json = formatDiffJson(diff);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("output contains all AuditDiffResult fields when parsed", () => {
    const diff = diffAudits(audit1, audit2);
    const parsed = JSON.parse(formatDiffJson(diff));
    expect(parsed).toHaveProperty("beforeLabel");
    expect(parsed).toHaveProperty("afterLabel");
    expect(parsed).toHaveProperty("scoreBefore");
    expect(parsed).toHaveProperty("scoreAfter");
    expect(parsed).toHaveProperty("scoreDelta");
    expect(parsed).toHaveProperty("improvements");
    expect(parsed).toHaveProperty("regressions");
    expect(parsed).toHaveProperty("unchanged");
    expect(parsed).toHaveProperty("added");
    expect(parsed).toHaveProperty("removed");
  });

  it("regressions array matches input regressions", () => {
    const before = makeAuditResult([{ id: "FW-UFW-ACTIVE", passed: true }], 80);
    const after = makeAuditResult([{ id: "FW-UFW-ACTIVE", passed: false }], 40);
    const diff = diffAudits(before, after);
    const parsed = JSON.parse(formatDiffJson(diff));
    expect(parsed.regressions).toHaveLength(1);
    expect(parsed.regressions[0].id).toBe("FW-UFW-ACTIVE");
  });
});
