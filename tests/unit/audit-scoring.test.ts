import { calculateCategoryScore, calculateOverallScore, CATEGORY_WEIGHTS } from "../../src/core/audit/scoring.js";
import type { AuditCheck, AuditCategory } from "../../src/core/audit/types.js";

function makeCheck(overrides: Partial<AuditCheck> = {}): AuditCheck {
  return {
    id: "TEST-01",
    category: "Test",
    name: "Test Check",
    severity: "warning",
    passed: true,
    currentValue: "good",
    expectedValue: "good",
    ...overrides,
  };
}

describe("calculateCategoryScore", () => {
  it("should return score 100 when all checks pass", () => {
    const checks: AuditCheck[] = [
      makeCheck({ id: "T-01", severity: "critical", passed: true }),
      makeCheck({ id: "T-02", severity: "warning", passed: true }),
      makeCheck({ id: "T-03", severity: "info", passed: true }),
    ];

    const result = calculateCategoryScore(checks);
    expect(result.score).toBe(100);
  });

  it("should return score 0 when all checks fail", () => {
    const checks: AuditCheck[] = [
      makeCheck({ id: "T-01", severity: "critical", passed: false }),
      makeCheck({ id: "T-02", severity: "warning", passed: false }),
      makeCheck({ id: "T-03", severity: "info", passed: false }),
    ];

    const result = calculateCategoryScore(checks);
    expect(result.score).toBe(0);
  });

  it("should weight critical checks more than warning, warning more than info", () => {
    // Only critical fails: should lose more score
    const critFail: AuditCheck[] = [
      makeCheck({ id: "T-01", severity: "critical", passed: false }),
      makeCheck({ id: "T-02", severity: "warning", passed: true }),
      makeCheck({ id: "T-03", severity: "info", passed: true }),
    ];

    // Only info fails: should lose less score
    const infoFail: AuditCheck[] = [
      makeCheck({ id: "T-01", severity: "critical", passed: true }),
      makeCheck({ id: "T-02", severity: "warning", passed: true }),
      makeCheck({ id: "T-03", severity: "info", passed: false }),
    ];

    const critResult = calculateCategoryScore(critFail);
    const infoResult = calculateCategoryScore(infoFail);

    // Critical failure should result in lower score than info failure
    expect(critResult.score).toBeLessThan(infoResult.score);
  });

  it("should return score 0 and maxScore 0 for empty checks", () => {
    const result = calculateCategoryScore([]);
    expect(result.score).toBe(0);
    expect(result.maxScore).toBe(0);
  });

  it("should return maxScore based on total weights", () => {
    const checks: AuditCheck[] = [
      makeCheck({ id: "T-01", severity: "critical", passed: true }),
      makeCheck({ id: "T-02", severity: "warning", passed: false }),
    ];

    const result = calculateCategoryScore(checks);
    // critical=3, warning=2, total=5, passed=3
    expect(result.maxScore).toBe(100);
    expect(result.score).toBe(60); // 3/5 * 100 = 60
  });

  // P142 Task 2: skip-aware scoring
  it("P142 Task 2: all-skipped category returns { score: 0, maxScore: 0 }", () => {
    // All checks are v2 mutating-skip (passed=false, skip metadata present).
    // Skipped checks are excluded from scoring — neither pass nor fail weight.
    // Returns { 0, 0 } to signal "no scoring info available" and keep
    // detectSkippedCategories separate (it inspects currentValue only).
    const checks: AuditCheck[] = [
      makeCheck({ id: "S-01", severity: "critical", passed: false, currentValue: "", skip: { code: "legacy-mutating", apiVersion: "2", kind: "mutate-local" } }),
      makeCheck({ id: "S-02", severity: "warning", passed: false, currentValue: "", skip: { code: "legacy-mutating", apiVersion: "2", kind: "mutate-global" } }),
    ];
    const result = calculateCategoryScore(checks);
    expect(result.score).toBe(0);
    expect(result.maxScore).toBe(0);
  });

  it("P142 Task 2: mixed category excludes skipped check severity weight from denominator", () => {
    // Two checks: a passed read check (warning, weight 2) and a skipped
    // mutating check (critical, weight 3). Without skip-aware logic, total
    // weight would be 5 with 2/5 = 40. With skip-aware logic, skipped is
    // excluded, so the only counted check passes, score = 100.
    const checks: AuditCheck[] = [
      makeCheck({ id: "M-01", severity: "warning", passed: true, currentValue: "ok" }),
      makeCheck({ id: "M-02", severity: "critical", passed: false, currentValue: "", skip: { code: "legacy-mutating", apiVersion: "2", kind: "mutate-local" } }),
    ];
    const result = calculateCategoryScore(checks);
    expect(result.maxScore).toBe(100);
    expect(result.score).toBe(100);
  });

  // P144 T6: Active Probe skip is also score-neutral (excluded from denominator)
  it("P144 T6: all-skipped category with active-probe variant returns { score: 0, maxScore: 0 }", () => {
    // v3 active-probe skipped checks are also excluded from scoring.
    const checks: AuditCheck[] = [
      makeCheck({ id: "P-01", severity: "critical", passed: false, currentValue: "", skip: { code: "active-probe", apiVersion: "3" } }),
      makeCheck({ id: "P-02", severity: "warning", passed: false, currentValue: "", skip: { code: "active-probe", apiVersion: "3" } }),
    ];
    const result = calculateCategoryScore(checks);
    expect(result.score).toBe(0);
    expect(result.maxScore).toBe(0);
  });

  it("P144 T6: mixed category excludes active-probe check severity weight from denominator", () => {
    // One passed read check (warning, weight 2) + one skipped active-probe
    // check (critical, weight 3). Score-neutral: skipped excluded, score = 100.
    const checks: AuditCheck[] = [
      makeCheck({ id: "M-01", severity: "warning", passed: true, currentValue: "ok" }),
      makeCheck({ id: "M-02", severity: "critical", passed: false, currentValue: "", skip: { code: "active-probe", apiVersion: "3" } }),
    ];
    const result = calculateCategoryScore(checks);
    expect(result.maxScore).toBe(100);
    expect(result.score).toBe(100);
  });
});

describe("calculateOverallScore", () => {
  it("should produce weighted average for SSH and Firewall (both weight 3)", () => {
    const categories: AuditCategory[] = [
      { name: "SSH", checks: [], score: 80, maxScore: 100 },
      { name: "Firewall", checks: [], score: 60, maxScore: 100 },
    ];

    const overall = calculateOverallScore(categories);
    // SSH=weight3, Firewall=weight3: (80*3 + 60*3) / (3+3) = 420/6 = 70
    // Coincidentally same as simple average, but computed via weighted path
    expect(overall).toBe(70);
  });

  it("should return 0 for empty categories", () => {
    const overall = calculateOverallScore([]);
    expect(overall).toBe(0);
  });

  it("should return 0 for categories with maxScore=0", () => {
    const categories: AuditCategory[] = [
      { name: "SSH", checks: [], score: 0, maxScore: 0 },
    ];
    const overall = calculateOverallScore(categories);
    expect(overall).toBe(0);
  });

  it("should round to nearest integer", () => {
    const categories: AuditCategory[] = [
      { name: "SSH", checks: [], score: 33, maxScore: 100 },
      { name: "Firewall", checks: [], score: 33, maxScore: 100 },
      { name: "Docker", checks: [], score: 34, maxScore: 100 },
    ];

    const overall = calculateOverallScore(categories);
    // SSH=3, Firewall=3, Docker=2: (33*3 + 33*3 + 34*2) / (3+3+2) = 266/8 = 33.25 -> 33
    expect(overall).toBe(33);
  });

  it("should handle single category", () => {
    const categories: AuditCategory[] = [
      { name: "SSH", checks: [], score: 95, maxScore: 100 },
    ];

    const overall = calculateOverallScore(categories);
    expect(overall).toBe(95);
  });

  it("should weight SSH higher than default-weight category", () => {
    // SSH (weight 3) score=100, Banners (weight 1) score=0
    // Weighted: (100*3 + 0*1) / (3+1) = 300/4 = 75
    // Simple average would be: (100 + 0) / 2 = 50
    const categories: AuditCategory[] = [
      { name: "SSH", checks: [], score: 100, maxScore: 100 },
      { name: "Banners", checks: [], score: 0, maxScore: 100 },
    ];

    const overall = calculateOverallScore(categories);
    expect(overall).toBe(75); // weighted, not 50 (simple)
  });

  it("should use weight 1 for categories not in CATEGORY_WEIGHTS", () => {
    // NTP (unknown, weight 1), SSH (weight 3)
    // (40*1 + 80*3) / (1+3) = 280/4 = 70
    const categories: AuditCategory[] = [
      { name: "NTP", checks: [], score: 40, maxScore: 100 },
      { name: "SSH", checks: [], score: 80, maxScore: 100 },
    ];

    const overall = calculateOverallScore(categories);
    expect(overall).toBe(70);
  });

  it("should export CATEGORY_WEIGHTS with correct values", () => {
    expect(CATEGORY_WEIGHTS["SSH"]).toBe(3);
    expect(CATEGORY_WEIGHTS["Firewall"]).toBe(3);
    expect(CATEGORY_WEIGHTS["Auth"]).toBe(3);
    expect(CATEGORY_WEIGHTS["Docker"]).toBe(2);
    expect(CATEGORY_WEIGHTS["TLS"]).toBe(2);
  });
});
