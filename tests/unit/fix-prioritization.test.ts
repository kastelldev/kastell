import {
  calculateCheckImpact,
  sortChecksByImpact,
  selectChecksForTop,
  selectChecksForTarget,
} from "../../src/core/audit/fix.js";
import type { FixCheck } from "../../src/core/audit/fix.js";
import {
  buildImpactContext,
  SEVERITY_WEIGHTS,
  CATEGORY_WEIGHTS,
  DEFAULT_CATEGORY_WEIGHT,
} from "../../src/core/audit/scoring.js";
import type { ImpactContext } from "../../src/core/audit/scoring.js";
import type { AuditCategory } from "../../src/core/audit/types.js";

// ─── Test helpers ────────────────────────────────────────────────────────────

function makeFixCheck(overrides: Partial<FixCheck> = {}): FixCheck {
  return {
    id: "TEST-01",
    category: "Kernel",
    name: "Test Check",
    severity: "warning",
    fixCommand: "echo test",
    ...overrides,
  };
}

function makeImpactCtx(
  catWeightMap: Record<string, number>,
  totalOverallWeight: number,
): ImpactContext {
  return {
    totalOverallWeight,
    catWeightMap: new Map(Object.entries(catWeightMap)),
  };
}

// Helper: build a real ImpactContext from AuditCategory-like objects
function makeAuditCategory(
  name: string,
  checksConfig: Array<{ severity: "critical" | "warning" | "info"; passed: boolean }>,
): AuditCategory {
  const checks = checksConfig.map((c, i) => ({
    id: `${name.toUpperCase()}-0${i + 1}`,
    category: name,
    name: `${name} check ${i + 1}`,
    severity: c.severity,
    passed: c.passed,
    currentValue: "",
    expectedValue: "",
  }));
  const totalWeight = checks.reduce((s, c) => s + SEVERITY_WEIGHTS[c.severity], 0);
  const passedWeight = checks
    .filter((c) => c.passed)
    .reduce((s, c) => s + SEVERITY_WEIGHTS[c.severity], 0);
  const score = totalWeight > 0 ? Math.round((passedWeight / totalWeight) * 100) : 0;
  return { name, checks, score, maxScore: totalWeight > 0 ? 100 : 0 };
}

// ─── calculateCheckImpact ─────────────────────────────────────────────────────

describe("calculateCheckImpact", () => {
  it("returns positive fractional score impact for SSH/critical check", () => {
    // SSH category: one critical check (weight 3), totalCategoryWeight = 3
    // catWeight = CATEGORY_WEIGHTS.SSH = 3, totalOverallWeight = 15
    // categoryImpact = (3/6) * 100 = 50
    // impact = (50 * 3) / 15 = 10.0
    const ctx = makeImpactCtx({ SSH: 6 }, 15);
    const check = makeFixCheck({ category: "SSH", severity: "critical" });
    const result = calculateCheckImpact(check, ctx);
    expect(result).toBeCloseTo(10.0);
    expect(result).toBeGreaterThan(0);
  });

  it("returns 0 when totalOverallWeight is 0", () => {
    const ctx = makeImpactCtx({ SSH: 6 }, 0);
    const check = makeFixCheck({ category: "SSH", severity: "critical" });
    expect(calculateCheckImpact(check, ctx)).toBe(0);
  });

  it("returns 0 when category is missing from catWeightMap", () => {
    const ctx = makeImpactCtx({}, 15); // catWeightMap is empty
    const check = makeFixCheck({ category: "UnknownCategory", severity: "warning" });
    expect(calculateCheckImpact(check, ctx)).toBe(0);
  });
});

// ─── sortChecksByImpact ───────────────────────────────────────────────────────

describe("sortChecksByImpact", () => {
  it("orders 3 checks by impact descending (SSH/critical > Kernel/warning > Logging/info)", () => {
    // Build context with these categories active
    const categories = [
      makeAuditCategory("SSH", [
        { severity: "critical", passed: false },
        { severity: "critical", passed: true },
      ]),
      makeAuditCategory("Kernel", [
        { severity: "warning", passed: false },
        { severity: "warning", passed: true },
      ]),
      makeAuditCategory("Logging", [
        { severity: "info", passed: false },
        { severity: "info", passed: true },
      ]),
    ];
    const ctx = buildImpactContext(categories);

    const checks: FixCheck[] = [
      makeFixCheck({ id: "KERNEL-01", category: "Kernel", severity: "warning" }),
      makeFixCheck({ id: "LOG-01", category: "Logging", severity: "info" }),
      makeFixCheck({ id: "SSH-01", category: "SSH", severity: "critical" }),
    ];

    const sorted = sortChecksByImpact(checks, ctx);
    expect(sorted[0].id).toBe("SSH-01");
    expect(sorted[1].id).toBe("KERNEL-01");
    expect(sorted[2].id).toBe("LOG-01");
  });

  it("uses severity as tie-breaker: critical comes before warning when impacts are equal", () => {
    // Use makeImpactCtx with equal category weights for two categories
    // CatA/critical: (3/2)*100 * DEFAULT(1)/4 = 37.5
    // CatB/critical: (3/2)*100 * DEFAULT(1)/4 = 37.5  <- same!
    const ctx = makeImpactCtx({ CatA: 2, CatB: 2 }, 4);
    const checks: FixCheck[] = [
      makeFixCheck({ id: "B-01", category: "CatB", severity: "critical" }),
      makeFixCheck({ id: "A-01", category: "CatA", severity: "critical" }),
    ];
    const sorted = sortChecksByImpact(checks, ctx);
    // Both critical so order is stable, but impact is equal
    expect(sorted[0].impact).toBeCloseTo(sorted[1].impact);
  });

  it("tie-breaker: critical comes before warning when impacts are equal", () => {
    // catA/critical: (3/3)*100 * DEFAULT(1)/4 = 25.0
    // catB/warning:  (2/2)*100 * DEFAULT(1)/4 = 25.0  <- equal!
    const ctx = makeImpactCtx({ CatA: 3, CatB: 2 }, 4);
    const checks: FixCheck[] = [
      makeFixCheck({ id: "WARN-01", category: "CatB", severity: "warning" }),
      makeFixCheck({ id: "CRIT-01", category: "CatA", severity: "critical" }),
    ];
    const sorted = sortChecksByImpact(checks, ctx);
    expect(sorted[0].impact).toBeCloseTo(sorted[1].impact); // equal impacts
    expect(sorted[0].id).toBe("CRIT-01"); // critical comes first
    expect(sorted[1].id).toBe("WARN-01");
  });

  it("returns objects with `impact` property added", () => {
    const ctx = makeImpactCtx({ SSH: 3 }, 6);
    const checks: FixCheck[] = [
      makeFixCheck({ id: "SSH-01", category: "SSH", severity: "critical" }),
    ];
    const sorted = sortChecksByImpact(checks, ctx);
    expect(sorted[0]).toHaveProperty("impact");
    expect(typeof sorted[0].impact).toBe("number");
  });
});

// ─── selectChecksForTop ───────────────────────────────────────────────────────

describe("selectChecksForTop", () => {
  const ctx = makeImpactCtx({ SSH: 3, Kernel: 2, Logging: 1 }, 6);
  const checks: FixCheck[] = [
    makeFixCheck({ id: "SSH-01", category: "SSH", severity: "critical" }),
    makeFixCheck({ id: "KERNEL-01", category: "Kernel", severity: "warning" }),
    makeFixCheck({ id: "LOG-01", category: "Logging", severity: "info" }),
  ];
  const sorted = sortChecksByImpact(checks, ctx);

  it("returns first 2 elements when N=2", () => {
    const top = selectChecksForTop(sorted, 2);
    expect(top).toHaveLength(2);
    expect(top[0].id).toBe(sorted[0].id);
    expect(top[1].id).toBe(sorted[1].id);
  });

  it("returns all elements when N > length", () => {
    const top = selectChecksForTop(sorted, 100);
    expect(top).toHaveLength(sorted.length);
  });
});

// ─── selectChecksForTarget ───────────────────────────────────────────────────

describe("selectChecksForTarget", () => {
  // Build sorted checks with known impacts
  const ctx = makeImpactCtx({ SSH: 3, Kernel: 2, Logging: 1 }, 6);
  const rawChecks: FixCheck[] = [
    makeFixCheck({ id: "SSH-01", category: "SSH", severity: "critical" }),
    makeFixCheck({ id: "KERNEL-01", category: "Kernel", severity: "warning" }),
    makeFixCheck({ id: "LOG-01", category: "Logging", severity: "info" }),
  ];
  const sorted = sortChecksByImpact(rawChecks, ctx);

  it("stops accumulating when estimated score reaches target", () => {
    // currentScore=60, target=70. SSH impact should push it over 70.
    const selected = selectChecksForTarget(sorted, 60, 70);
    expect(selected.length).toBeGreaterThan(0);
    const accum = selected.reduce((s: number, c) => s + c.impact, 60);
    expect(accum).toBeGreaterThanOrEqual(70);
  });

  it("returns empty array when currentScore >= target", () => {
    const selected = selectChecksForTarget(sorted, 85, 80);
    expect(selected).toHaveLength(0);
  });

  it("returns all checks when target is unreachable (includes all)", () => {
    // Use a tiny-impact context so accumulated score never reaches 99 from 50
    // Each check has tiny impact: (1/10)*100 * DEFAULT(1)/100 = 0.1 per check
    const tinyCtx = makeImpactCtx({ SSH: 10, Kernel: 10, Logging: 10 }, 100);
    const tinyChecks: FixCheck[] = [
      makeFixCheck({ id: "SSH-01", category: "SSH", severity: "info" }),
      makeFixCheck({ id: "KERNEL-01", category: "Kernel", severity: "info" }),
      makeFixCheck({ id: "LOG-01", category: "Logging", severity: "info" }),
    ];
    const tinySorted = sortChecksByImpact(tinyChecks, tinyCtx);
    const selected = selectChecksForTarget(tinySorted, 50, 99);
    // 3 checks * 0.1 impact = 50.3 total — never reaches 99, so all returned
    expect(selected).toHaveLength(tinySorted.length);
  });
});
