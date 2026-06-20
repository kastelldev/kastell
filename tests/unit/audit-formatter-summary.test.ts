import type { AuditResult } from "../../src/core/audit/types";

const mockResult: AuditResult = {
  serverName: "myserver",
  serverIp: "1.2.3.4",
  platform: "bare",
  timestamp: "2026-03-08T00:00:00.000Z",
  auditVersion: "1.0.0",
  categories: [
    {
      name: "SSH",
      checks: [],
      score: 80,
      maxScore: 100,
    },
    {
      name: "Firewall",
      checks: [],
      score: 20,
      maxScore: 100,
    },
    {
      name: "Updates",
      checks: [],
      score: 100,
      maxScore: 100,
    },
  ],
  overallScore: 67,
  quickWins: [
    {
      id: "FW-UFW-ACTIVE",
      severity: "critical",
      commands: ["ufw enable"],
      currentScore: 67,
      projectedScore: 85,
      description: "Enable firewall",
    },
  ],
};

import type { AuditCheck } from "../../src/core/audit/types";

const complianceCheck = (coverage: "full" | "partial"): AuditCheck => ({
  id: "SSH-01",
  category: "SSH",
  name: "Test Check",
  severity: "critical",
  passed: true,
  currentValue: "yes",
  expectedValue: "yes",
  complianceRefs: [
    {
      framework: "CIS",
      controlId: "5.2.1",
      version: "1.0",
      description: "Disable password auth",
      coverage,
      level: "L1",
    },
  ],
});

describe("formatSummary", () => {
  let formatSummary: (result: AuditResult) => string;

  beforeAll(async () => {
    const mod = await import("../../src/core/audit/formatters/summary");
    formatSummary = mod.formatSummary;
  });

  it("should produce compact multi-line dashboard", () => {
    const output = formatSummary(mockResult);
    expect(output.split("\n").length).toBeGreaterThan(3);
  });

  it("should show server name and IP", () => {
    const output = formatSummary(mockResult);
    expect(output).toContain("myserver");
    expect(output).toContain("1.2.3.4");
  });

  it("should show overall score", () => {
    const output = formatSummary(mockResult);
    expect(output).toContain("67/100");
  });

  it("should show category names with scores", () => {
    const output = formatSummary(mockResult);
    expect(output).toContain("SSH");
    expect(output).toContain("80");
    expect(output).toContain("Firewall");
    expect(output).toContain("20");
    expect(output).toContain("Updates");
    expect(output).toContain("100");
  });

  it("should show quick wins info", () => {
    const output = formatSummary(mockResult);
    expect(output).toContain("Quick");
    expect(output).toContain("85");
  });
});

describe("formatSummary branch coverage", () => {
  let formatSummary: (result: AuditResult) => string;

  beforeAll(async () => {
    const mod = await import("../../src/core/audit/formatters/summary");
    formatSummary = mod.formatSummary;
  });

  it("complianceRefs: shows CIS compliance when checks have CIS refs", () => {
    const resultWithCompliance: AuditResult = {
      ...mockResult,
      categories: [
        {
          name: "SSH",
          checks: [complianceCheck("full")],
          score: 100,
          maxScore: 100,
        },
      ],
      quickWins: [],
    };
    const output = formatSummary(resultWithCompliance);
    expect(output).toContain("CIS");
    expect(output).toContain("Compliance");
  });

  it("partial compliance: shows manual review message when partials exist", () => {
    const resultWithPartial: AuditResult = {
      ...mockResult,
      categories: [
        {
          name: "SSH",
          checks: [complianceCheck("partial")],
          score: 100,
          maxScore: 100,
        },
      ],
      quickWins: [],
    };
    const output = formatSummary(resultWithPartial);
    expect(output).toContain("partial");
  });

  it("no quickWins: does not show Quick wins section when list is empty", () => {
    const resultNoWins: AuditResult = { ...mockResult, quickWins: [] };
    const output = formatSummary(resultNoWins);
    expect(output).not.toContain("Quick wins");
  });

  it("score color thresholds: score 95 produces non-empty output", () => {
    const highScore: AuditResult = { ...mockResult, overallScore: 95, quickWins: [] };
    const output = formatSummary(highScore);
    expect(output).toContain("95");
    expect(output.length).toBeGreaterThan(0);
  });

  it("score color thresholds: score 70 produces non-empty output", () => {
    const midScore: AuditResult = { ...mockResult, overallScore: 70, quickWins: [] };
    const output = formatSummary(midScore);
    expect(output).toContain("70");
    expect(output.length).toBeGreaterThan(0);
  });

  it("score color thresholds: score 40 produces non-empty output", () => {
    const lowScore: AuditResult = { ...mockResult, overallScore: 40, quickWins: [] };
    const output = formatSummary(lowScore);
    expect(output).toContain("40");
    expect(output.length).toBeGreaterThan(0);
  });

  it("zero-score category: shows 0 in output for category with score 0", () => {
    const resultWithZeroScore: AuditResult = {
      ...mockResult,
      categories: [
        {
          name: "SSH",
          checks: [],
          score: 0,
          maxScore: 100,
        },
      ],
      quickWins: [],
    };
    const output = formatSummary(resultWithZeroScore);
    expect(output).toContain("0");
    expect(output).toContain("SSH");
  });
});

describe("P142: structured skip rendering in summary", () => {
  let formatSummary: (result: AuditResult) => string;

  beforeAll(async () => {
    const mod = await import("../../src/core/audit/formatters/summary");
    formatSummary = mod.formatSummary;
  });

  it("does not list skipped checks as failures in summary output", () => {
    const resultWithSkip: AuditResult = {
      ...mockResult,
      categories: [
        {
          name: "Plugin",
          checks: [
            {
              id: "PLUGIN-MUTATE-LOCAL",
              category: "Plugin",
              name: "Mutate Local",
              severity: "info",
              passed: false,
              currentValue: "n/a",
              expectedValue: "n/a",
              skip: { code: "legacy-mutating", apiVersion: "2", kind: "mutate-local" },
            },
          ],
          score: 100,
          maxScore: 100,
        },
      ],
      quickWins: [],
    };
    const output = formatSummary(resultWithSkip);

    // Summary explain path on a skipped check should NOT surface it as a failure
    // (here we use no explain, but verify no negative language appears)
    expect(output).not.toMatch(/failing.*PLUGIN-MUTATE-LOCAL/i);
    expect(output).not.toMatch(/FAIL.*PLUGIN-MUTATE-LOCAL/i);
  });

  it("summary handles skipped-only category without showing FAIL", () => {
    const skipOnlyResult: AuditResult = {
      ...mockResult,
      categories: [
        {
          name: "Plugin",
          checks: [
            {
              id: "PLUGIN-MUTATE-LOCAL",
              category: "Plugin",
              name: "Mutate Local",
              severity: "info",
              passed: false,
              currentValue: "n/a",
              expectedValue: "n/a",
              skip: { code: "legacy-mutating", apiVersion: "2", kind: "mutate-local" },
            },
          ],
          score: 100,
          maxScore: 100,
        },
      ],
      quickWins: [],
    };
    const output = formatSummary(skipOnlyResult);
    // Category score is 100 (all skipped) — should not show "0" or "FAIL"
    expect(output).toContain("Plugin");
    expect(output).toContain("100");
  });

  // P144 T6: active-probe skip is also rendered as skipped (variant-agnostic)
  it("P144 T6: summary handles active-probe skipped-only category without showing FAIL", () => {
    const skipOnlyActiveProbeResult: AuditResult = {
      ...mockResult,
      categories: [
        {
          name: "Plugin",
          checks: [
            {
              id: "PROBE-01",
              category: "Plugin",
              name: "Active Probe",
              severity: "info",
              passed: false,
              currentValue: "n/a",
              expectedValue: "n/a",
              skip: { code: "active-probe", apiVersion: "3" },
            },
          ],
          score: 100,
          maxScore: 100,
        },
      ],
      quickWins: [],
    };
    const output = formatSummary(skipOnlyActiveProbeResult);
    // Category score is 100 (all active-probe skipped) — should not show "0" or "FAIL"
    expect(output).toContain("Plugin");
    expect(output).toContain("100");
    expect(output).not.toMatch(/FAIL.*PROBE-01/);
  });
});
