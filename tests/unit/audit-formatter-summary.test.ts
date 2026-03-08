import type { AuditResult } from "../../src/core/audit/types";

const mockResult: AuditResult = {
  serverName: "myserver",
  serverIp: "1.2.3.4",
  platform: "bare",
  timestamp: "2026-03-08T00:00:00.000Z",
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

describe("formatSummary", () => {
  it("should produce compact multi-line dashboard", async () => {
    const { formatSummary } = await import("../../src/core/audit/formatters/summary");
    const output = formatSummary(mockResult);

    // Multiple lines
    expect(output.split("\n").length).toBeGreaterThan(3);
  });

  it("should show server name and IP", async () => {
    const { formatSummary } = await import("../../src/core/audit/formatters/summary");
    const output = formatSummary(mockResult);

    expect(output).toContain("myserver");
    expect(output).toContain("1.2.3.4");
  });

  it("should show overall score", async () => {
    const { formatSummary } = await import("../../src/core/audit/formatters/summary");
    const output = formatSummary(mockResult);

    expect(output).toContain("67/100");
  });

  it("should show category names with scores", async () => {
    const { formatSummary } = await import("../../src/core/audit/formatters/summary");
    const output = formatSummary(mockResult);

    expect(output).toContain("SSH");
    expect(output).toContain("80");
    expect(output).toContain("Firewall");
    expect(output).toContain("20");
    expect(output).toContain("Updates");
    expect(output).toContain("100");
  });

  it("should show quick wins info", async () => {
    const { formatSummary } = await import("../../src/core/audit/formatters/summary");
    const output = formatSummary(mockResult);

    expect(output).toContain("Quick");
    expect(output).toContain("85");
  });
});
