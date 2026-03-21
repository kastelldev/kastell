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
