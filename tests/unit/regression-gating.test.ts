import { checkRegression, shouldUpdateBaseline, hasRegression } from "../../src/core/audit/regression.js";
import type { RegressionBaseline, RegressionResult } from "../../src/core/audit/types.js";

function makeBaseline(overrides: Partial<RegressionBaseline> = {}): RegressionBaseline {
  return {
    version: 1,
    serverIp: "1.2.3.4",
    lastUpdated: "2026-04-20T00:00:00Z",
    bestScore: 80,
    passedChecks: ["SSH-KEY-AUTH", "UFW-ENABLED", "KERN-SYNCOOKIES"],
    ...overrides,
  };
}

function makeAuditResult(score: number, passedIds: string[]) {
  return {
    serverName: "test-server",
    serverIp: "1.2.3.4",
    platform: "bare" as const,
    timestamp: "2026-04-21T10:00:00.000Z",
    auditVersion: "1.0.0",
    categories: passedIds.map((id) => ({
      name: "test",
      score: 100,
      maxScore: 100,
      checks: [{
        id,
        name: id,
        passed: true,
        severity: "warning" as const,
        details: "",
        category: "test",
        currentValue: "",
        expectedValue: ""
      }],
    })),
    overallScore: score,
    quickWins: [],
  };
}

describe("score regression detection", () => {
  it("detects regression when current < baseline", () => {
    const baseline = makeBaseline({ bestScore: 80 });
    const audit = makeAuditResult(75, ["SSH-KEY-AUTH", "UFW-ENABLED", "KERN-SYNCOOKIES"]);
    const result = checkRegression(baseline, audit);
    expect(result.currentScore < result.baselineScore).toBe(true);
  });

  it("detects no regression when current >= baseline", () => {
    const baseline = makeBaseline({ bestScore: 80 });
    const audit = makeAuditResult(85, ["SSH-KEY-AUTH", "UFW-ENABLED", "KERN-SYNCOOKIES"]);
    const result = checkRegression(baseline, audit);
    expect(result.currentScore < result.baselineScore).toBe(false);
  });

  it("detects no regression when scores are equal", () => {
    const baseline = makeBaseline({ bestScore: 80 });
    const audit = makeAuditResult(80, ["SSH-KEY-AUTH", "UFW-ENABLED", "KERN-SYNCOOKIES"]);
    const result = checkRegression(baseline, audit);
    expect(result.currentScore < result.baselineScore).toBe(false);
  });
});

describe("shouldUpdateBaseline", () => {
  it("returns true when regression is null (no baseline)", () => {
    expect(shouldUpdateBaseline(null, false)).toBe(true);
  });

  it("returns true when forced regardless of regression", () => {
    const regression: RegressionResult = {
      regressions: ["SSH-KEY-AUTH"],
      newPasses: [],
      baselineScore: 80,
      currentScore: 70,
    };
    expect(shouldUpdateBaseline(regression, true)).toBe(true);
  });

  it("returns true when no regressions and no score regression", () => {
    const regression: RegressionResult = {
      regressions: [],
      newPasses: ["NEW-CHECK"],
      baselineScore: 80,
      currentScore: 85,
    };
    expect(shouldUpdateBaseline(regression, false)).toBe(true);
  });

  it("returns false when check regressions exist", () => {
    const regression: RegressionResult = {
      regressions: ["SSH-KEY-AUTH"],
      newPasses: [],
      baselineScore: 80,
      currentScore: 80,
    };
    expect(shouldUpdateBaseline(regression, false)).toBe(false);
  });

  it("returns false when score regressed", () => {
    const regression: RegressionResult = {
      regressions: [],
      newPasses: [],
      baselineScore: 80,
      currentScore: 75,
    };
    expect(shouldUpdateBaseline(regression, false)).toBe(false);
  });

  it("returns false when both check and score regressed", () => {
    const regression: RegressionResult = {
      regressions: ["SSH-KEY-AUTH"],
      newPasses: [],
      baselineScore: 80,
      currentScore: 70,
    };
    expect(shouldUpdateBaseline(regression, false)).toBe(false);
  });
});

describe("conditional save integration scenarios", () => {
  it("should save when score improved and no check regressions", () => {
    const regression: RegressionResult = {
      regressions: [],
      newPasses: ["NEW-CHECK"],
      baselineScore: 70,
      currentScore: 80,
    };
    expect(shouldUpdateBaseline(regression, false)).toBe(true);
  });

  it("should NOT save when score dropped even without check regressions", () => {
    const regression: RegressionResult = {
      regressions: [],
      newPasses: [],
      baselineScore: 80,
      currentScore: 75,
    };
    expect(shouldUpdateBaseline(regression, false)).toBe(false);
  });

  it("should save when forced despite regression", () => {
    const regression: RegressionResult = {
      regressions: ["SSH-KEY-AUTH"],
      newPasses: [],
      baselineScore: 80,
      currentScore: 70,
    };
    expect(shouldUpdateBaseline(regression, true)).toBe(true);
  });
});

describe("pre-fix soft gate decision", () => {
  it("detects regression when checks regressed", () => {
    const result: RegressionResult = {
      regressions: ["SSH-KEY-AUTH"],
      newPasses: [],
      baselineScore: 80,
      currentScore: 80,
    };
    expect(hasRegression(result)).toBe(true);
  });

  it("detects regression when score regressed", () => {
    const result: RegressionResult = {
      regressions: [],
      newPasses: [],
      baselineScore: 80,
      currentScore: 75,
    };
    expect(hasRegression(result)).toBe(true);
  });

  it("no regression when clean", () => {
    const result: RegressionResult = {
      regressions: [],
      newPasses: ["NEW"],
      baselineScore: 80,
      currentScore: 85,
    };
    expect(hasRegression(result)).toBe(false);
  });
});