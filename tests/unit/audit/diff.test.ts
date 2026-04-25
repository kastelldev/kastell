import { buildCategorySummary, formatCompareSummaryTerminal, formatCompareSummaryJson } from "../../../src/core/audit/diff.js";
import type { AuditResult } from "../../../src/core/audit/types.js";

describe("buildCategorySummary", () => {
  function makeAuditResult(overrides: Partial<AuditResult> = {}): AuditResult {
    return {
      serverName: "test-server",
      serverIp: "1.2.3.4",
      platform: "bare",
      timestamp: new Date().toISOString(),
      auditVersion: "2.0.0",
      categories: [],
      overallScore: 0,
      quickWins: [],
      ...overrides,
    };
  }

  function makeCat(name: string, score: number, checks: Array<{ id: string; passed: boolean }>) {
    return {
      name,
      score,
      maxScore: 100,
      checks: checks.map((c) => ({
        id: c.id,
        category: name,
        name: c.id,
        severity: "warning" as const,
        passed: c.passed,
        currentValue: "",
        expectedValue: "",
        description: "",
      })),
    };
  }

  it("returns empty categories for two empty audits", () => {
    const a = makeAuditResult({ overallScore: 100 });
    const b = makeAuditResult({ overallScore: 100 });
    const result = buildCategorySummary(a, b);
    expect(result.categories).toHaveLength(0);
    expect(result.scoreDelta).toBe(0);
    expect(result.weakestCategory).toBeNull();
  });

  it("compares matching categories", () => {
    const a = makeAuditResult({
      overallScore: 80,
      categories: [makeCat("SSH", 90, [{ id: "SSH-1", passed: true }, { id: "SSH-2", passed: false }])],
    });
    const b = makeAuditResult({
      overallScore: 60,
      categories: [makeCat("SSH", 50, [{ id: "SSH-1", passed: true }, { id: "SSH-2", passed: false }])],
    });
    const result = buildCategorySummary(a, b, { before: "server-a", after: "server-b" });
    expect(result.beforeLabel).toBe("server-a");
    expect(result.afterLabel).toBe("server-b");
    expect(result.scoreDelta).toBe(-20);
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0].category).toBe("SSH");
    expect(result.categories[0].scoreBefore).toBe(90);
    expect(result.categories[0].scoreAfter).toBe(50);
    expect(result.categories[0].delta).toBe(-40);
  });

  it("handles category present in only one audit", () => {
    const a = makeAuditResult({
      overallScore: 80,
      categories: [makeCat("SSH", 90, [{ id: "SSH-1", passed: true }])],
    });
    const b = makeAuditResult({
      overallScore: 60,
      categories: [makeCat("Docker", 70, [{ id: "DOCKER-1", passed: true }])],
    });
    const result = buildCategorySummary(a, b);
    expect(result.categories).toHaveLength(2);
    const ssh = result.categories.find((c) => c.category === "SSH")!;
    expect(ssh.scoreBefore).toBe(90);
    expect(ssh.scoreAfter).toBe(0);
    const docker = result.categories.find((c) => c.category === "Docker")!;
    expect(docker.scoreBefore).toBe(0);
    expect(docker.scoreAfter).toBe(70);
  });

  it("identifies weakest category", () => {
    const a = makeAuditResult({
      overallScore: 80,
      categories: [
        makeCat("SSH", 90, [{ id: "SSH-1", passed: true }]),
        makeCat("Firewall", 60, [{ id: "FW-1", passed: false }]),
      ],
    });
    const b = makeAuditResult({
      overallScore: 70,
      categories: [
        makeCat("SSH", 40, [{ id: "SSH-1", passed: false }]),
        makeCat("Firewall", 80, [{ id: "FW-1", passed: true }]),
      ],
    });
    const result = buildCategorySummary(a, b, { before: "prod", after: "staging" });
    expect(result.weakestCategory).toEqual({
      label: "staging",
      category: "SSH",
      score: 40,
    });
  });
});

describe("formatCompareSummaryTerminal", () => {
  it("renders without throwing", () => {
    const summary = {
      beforeLabel: "prod",
      afterLabel: "staging",
      scoreBefore: 87,
      scoreAfter: 62,
      scoreDelta: -25,
      categories: [
        { category: "SSH", scoreBefore: 92, scoreAfter: 45, delta: -47, passedBefore: 10, passedAfter: 5, totalBefore: 11, totalAfter: 11 },
        { category: "Firewall", scoreBefore: 88, scoreAfter: 88, delta: 0, passedBefore: 5, passedAfter: 5, totalBefore: 5, totalAfter: 5 },
      ],
      weakestCategory: { label: "staging", category: "SSH", score: 45 },
    };
    const output = formatCompareSummaryTerminal(summary);
    expect(output).toContain("prod");
    expect(output).toContain("staging");
    expect(output).toContain("SSH");
    expect(output).toContain("Firewall");
    expect(output).toContain("87");
    expect(output).toContain("62");
  });
});

describe("formatCompareSummaryJson", () => {
  it("returns valid JSON", () => {
    const summary = {
      beforeLabel: "a",
      afterLabel: "b",
      scoreBefore: 80,
      scoreAfter: 70,
      scoreDelta: -10,
      categories: [],
      weakestCategory: null,
    };
    const json = formatCompareSummaryJson(summary);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.scoreBefore).toBe(80);
  });
});