import { formatRegressionSummary, extractPassedCheckIds } from "../../src/core/audit/regression";
import type { RegressionResult } from "../../src/core/audit/types";

describe("formatRegressionSummary", () => {
  it("should return regression warning lines with warn severity", () => {
    const result: RegressionResult = {
      regressions: ["SSH-ROOT", "FW-UFW"],
      newPasses: [],
      baselineScore: 72,
      currentScore: 68,
    };
    const lines = formatRegressionSummary(result);
    expect(lines).toContainEqual({
      severity: "warn",
      text: "Regression: 2 check(s) regressed: SSH-ROOT, FW-UFW",
    });
    expect(lines).toContainEqual({
      severity: "info",
      text: "Best score: 72",
    });
  });

  it("should return new passes lines with info severity", () => {
    const result: RegressionResult = {
      regressions: [],
      newPasses: ["KERN-01", "KERN-02"],
      baselineScore: 60,
      currentScore: 65,
    };
    const lines = formatRegressionSummary(result);
    expect(lines).toContainEqual({
      severity: "info",
      text: "New passes: 2 check(s) now passing: KERN-01, KERN-02",
    });
    expect(lines).toContainEqual({
      severity: "info",
      text: "Best score: 60",
    });
  });

  it("should return both regression and new pass lines when both exist", () => {
    const result: RegressionResult = {
      regressions: ["SSH-ROOT"],
      newPasses: ["KERN-01"],
      baselineScore: 60,
      currentScore: 62,
    };
    const lines = formatRegressionSummary(result);
    expect(lines.length).toBe(3);
    expect(lines[0].severity).toBe("warn");
    expect(lines[1].severity).toBe("info");
    expect(lines[2].severity).toBe("info");
  });

  it("should return only best score when no regressions or new passes", () => {
    const result: RegressionResult = {
      regressions: [],
      newPasses: [],
      baselineScore: 70,
      currentScore: 70,
    };
    const lines = formatRegressionSummary(result);
    expect(lines).toEqual([{ severity: "info", text: "Best score: 70" }]);
  });
});

describe("extractPassedCheckIds", () => {
  it("should extract sorted list of passed check IDs", () => {
    const audit = {
      categories: [
        {
          checks: [
            { id: "B-CHECK", passed: true },
            { id: "A-CHECK", passed: true },
            { id: "C-CHECK", passed: false },
          ],
        },
      ],
    } as any;
    const result = extractPassedCheckIds(audit);
    expect(result).toEqual(["A-CHECK", "B-CHECK"]);
  });

  it("should return empty array when no checks passed", () => {
    const audit = {
      categories: [{ checks: [{ id: "X", passed: false }] }],
    } as any;
    expect(extractPassedCheckIds(audit)).toEqual([]);
  });
});
