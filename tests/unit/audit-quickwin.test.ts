import { calculateQuickWins } from "../../src/core/audit/quickwin.js";
import type { AuditResult, AuditCheck, AuditCategory, QuickWin } from "../../src/core/audit/types.js";

function makeCheck(overrides: Partial<AuditCheck> = {}): AuditCheck {
  return {
    id: "TEST-01",
    category: "Test",
    name: "Test Check",
    severity: "warning",
    passed: true,
    currentValue: "bad",
    expectedValue: "good",
    ...overrides,
  };
}

function makeCategory(name: string, checks: AuditCheck[]): AuditCategory {
  const totalWeight = checks.reduce((sum, c) => {
    const w = c.severity === "critical" ? 3 : c.severity === "warning" ? 2 : 1;
    return sum + w;
  }, 0);
  const passedWeight = checks.filter(c => c.passed).reduce((sum, c) => {
    const w = c.severity === "critical" ? 3 : c.severity === "warning" ? 2 : 1;
    return sum + w;
  }, 0);
  const score = totalWeight > 0 ? Math.round((passedWeight / totalWeight) * 100) : 0;
  return { name, checks, score, maxScore: totalWeight > 0 ? 100 : 0 };
}

function makeResult(categories: AuditCategory[]): AuditResult {
  const sum = categories.reduce((acc, c) => acc + c.score, 0);
  const overallScore = categories.length > 0 ? Math.round(sum / categories.length) : 0;
  return {
    serverName: "test-server",
    serverIp: "1.2.3.4",
    platform: "bare",
    timestamp: new Date().toISOString(),
    categories,
    overallScore,
    quickWins: [],
  };
}

describe("calculateQuickWins", () => {
  it("should return top fixes sorted by score impact", () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({ id: "SSH-PASSWORD-AUTH", category: "SSH", severity: "critical", passed: false, fixCommand: "fix-critical" }),
        makeCheck({ id: "SSH-ROOT-LOGIN", category: "SSH", severity: "info", passed: false, fixCommand: "fix-info" }),
      ]),
      makeCategory("Firewall", [
        makeCheck({ id: "FW-UFW-ACTIVE", category: "Firewall", severity: "warning", passed: false, fixCommand: "fix-warning" }),
      ]),
    ]);

    const wins = calculateQuickWins(result);
    expect(wins.length).toBeGreaterThan(0);
    // With cumulative scoring, projected scores should be monotonically increasing
    for (let i = 1; i < wins.length; i++) {
      expect(wins[i].projectedScore).toBeGreaterThanOrEqual(wins[i - 1].projectedScore);
    }
  });

  it("should include projected score after applying fixes", () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({ id: "SSH-PASSWORD-AUTH", category: "SSH", severity: "critical", passed: false, fixCommand: "fix-it" }),
        makeCheck({ id: "SSH-ROOT-LOGIN", category: "SSH", severity: "warning", passed: true }),
      ]),
    ]);

    const wins = calculateQuickWins(result);
    expect(wins.length).toBeGreaterThan(0);
    expect(wins[0].projectedScore).toBeGreaterThan(wins[0].currentScore);
  });

  it("should give critical fixes higher impact than info fixes", () => {
    const result = makeResult([
      makeCategory("Mixed", [
        makeCheck({ id: "M-01", category: "Mixed", severity: "critical", passed: false, fixCommand: "fix-critical" }),
        makeCheck({ id: "M-02", category: "Mixed", severity: "info", passed: false, fixCommand: "fix-info" }),
        makeCheck({ id: "M-03", category: "Mixed", severity: "warning", passed: true }),
      ]),
    ]);

    const wins = calculateQuickWins(result);
    // Critical fix should be first (higher impact)
    const criticalWin = wins.find(w => w.commands.includes("fix-critical"));
    const infoWin = wins.find(w => w.commands.includes("fix-info"));
    expect(criticalWin).toBeDefined();
    expect(infoWin).toBeDefined();

    // With cumulative scoring, critical fix comes first (higher individual impact)
    // and info fix's projected score includes both fixes
    expect(wins[0].commands).toContain("fix-critical");
    expect(infoWin!.projectedScore).toBeGreaterThanOrEqual(criticalWin!.projectedScore);
  });

  it("should default to max 5 quick wins", () => {
    const checks = Array.from({ length: 10 }, (_, i) =>
      makeCheck({
        id: `T-${String(i + 1).padStart(2, "0")}`,
        category: "Test",
        severity: "warning",
        passed: false,
        fixCommand: `fix-${i}`,
      }),
    );

    const result = makeResult([makeCategory("Test", checks)]);
    const wins = calculateQuickWins(result);
    expect(wins).toHaveLength(5);
  });

  it("should respect custom maxWins parameter", () => {
    const checks = Array.from({ length: 10 }, (_, i) =>
      makeCheck({
        id: `T-${String(i + 1).padStart(2, "0")}`,
        category: "Test",
        severity: "warning",
        passed: false,
        fixCommand: `fix-${i}`,
      }),
    );

    const result = makeResult([makeCategory("Test", checks)]);
    const wins = calculateQuickWins(result, 3);
    expect(wins).toHaveLength(3);
  });

  it("should exclude checks without fixCommand", () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({ id: "SSH-PASSWORD-AUTH", category: "SSH", severity: "critical", passed: false }), // no fixCommand
        makeCheck({ id: "SSH-ROOT-LOGIN", category: "SSH", severity: "warning", passed: false, fixCommand: "fix-it" }),
      ]),
    ]);

    const wins = calculateQuickWins(result);
    const allCommands = wins.flatMap(w => w.commands);
    expect(allCommands).not.toContain(undefined);
    expect(wins.every(w => w.commands.length > 0)).toBe(true);
  });

  it("should return empty array when no fixable checks exist", () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({ id: "SSH-PASSWORD-AUTH", category: "SSH", severity: "critical", passed: true }),
      ]),
    ]);

    const wins = calculateQuickWins(result);
    expect(wins).toEqual([]);
  });
});
