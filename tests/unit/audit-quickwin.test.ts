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
    auditVersion: "1.0.0",
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

  it("should default to max 7 quick wins", () => {
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
    expect(wins).toHaveLength(7);
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

  it("should prioritize compliance-ref checks in sort order", () => {
    // Both checks have same severity — compliance-ref check should sort higher via 1.5x boost
    const result = makeResult([
      makeCategory("Auth", [
        makeCheck({
          id: "AUTH-NO-COMPLIANCE",
          category: "Auth",
          name: "No Compliance Ref Check",
          severity: "warning",
          passed: false,
          fixCommand: "fix-no-compliance",
        }),
        makeCheck({
          id: "AUTH-WITH-COMPLIANCE",
          category: "Auth",
          name: "With Compliance Ref Check",
          severity: "warning",
          passed: false,
          fixCommand: "fix-with-compliance",
          complianceRefs: [
            {
              framework: "CIS",
              controlId: "5.2.1",
              version: "2.0.0",
              description: "test control",
              coverage: "full",
            },
          ],
        }),
      ]),
    ]);

    const wins = calculateQuickWins(result);
    // The compliance-ref check should appear first due to 1.5x effective impact boost
    expect(wins[0].description).toContain("With Compliance Ref Check");
  });

  it("should not inflate projected score with compliance boost", () => {
    // Both checks have complianceRefs — projected score should use baseImpact not effectiveImpact
    const result = makeResult([
      makeCategory("Test", [
        makeCheck({
          id: "T-01",
          category: "Test",
          name: "Check One",
          severity: "warning",
          passed: false,
          fixCommand: "fix-one",
          complianceRefs: [
            { framework: "CIS", controlId: "1.1", version: "2.0.0", description: "d", coverage: "full" },
          ],
        }),
        makeCheck({
          id: "T-02",
          category: "Test",
          name: "Check Two",
          severity: "warning",
          passed: false,
          fixCommand: "fix-two",
          complianceRefs: [
            { framework: "PCI-DSS", controlId: "2.1", version: "4.0", description: "d", coverage: "partial" },
          ],
        }),
      ]),
    ]);

    const wins = calculateQuickWins(result);
    expect(wins.length).toBeGreaterThan(0);

    // Each win's projectedScore should never exceed currentScore + 100
    // (base impact per check is at most 50 for 2 equal-weight checks in 1 category)
    const lastProjected = wins[wins.length - 1].projectedScore;
    expect(lastProjected).toBeLessThanOrEqual(100);

    // Projected score should be strictly based on base (unboosted) impact
    // With 2 equal warning checks in 1 category, total weight=4, each base impact = (2/4)*100/1 = 50
    // currentScore = 0, after both fixes projected = 100
    const secondProjected = wins.length >= 2 ? wins[1].projectedScore : wins[0].projectedScore;
    expect(secondProjected).toBe(100);
  });
});
