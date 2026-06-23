import type { AuditResult, AuditCheck } from "../../src/core/audit/types";

const mockResult: AuditResult = {
  serverName: "test-server",
  serverIp: "1.2.3.4",
  platform: "bare",
  timestamp: "2026-03-08T00:00:00.000Z",
  auditVersion: "1.0.0",
  categories: [
    {
      name: "SSH",
      checks: [
        {
          id: "SSH-PASSWORD-AUTH",
          category: "SSH",
          name: "Password Auth",
          severity: "critical",
          passed: true,
          currentValue: "no",
          expectedValue: "no",
        },
        {
          id: "SSH-ROOT-LOGIN",
          category: "SSH",
          name: "Root Login",
          severity: "critical",
          passed: false,
          currentValue: "yes",
          expectedValue: "prohibit-password",
          fixCommand: "sed -i 's/PermitRootLogin yes/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config",
        },
      ],
      score: 50,
      maxScore: 100,
    },
    {
      name: "Firewall",
      checks: [
        {
          id: "FW-UFW-ACTIVE",
          category: "Firewall",
          name: "UFW Enabled",
          severity: "critical",
          passed: true,
          currentValue: "active",
          expectedValue: "active",
        },
      ],
      score: 100,
      maxScore: 100,
    },
  ],
  overallScore: 72,
  quickWins: [
    {
      id: "SSH-ROOT-LOGIN",
      severity: "critical",
      commands: ["sed -i 's/PermitRootLogin yes/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config"],
      currentScore: 72,
      projectedScore: 85,
      description: "Disable root password login",
    },
  ],
};

describe("formatHtmlReport", () => {
  it("should contain DOCTYPE", async () => {
    const { formatHtmlReport } = await import("../../src/core/audit/formatters/report");
    const output = formatHtmlReport(mockResult);

    expect(output).toContain("<!DOCTYPE html>");
  });

  it("should contain inline CSS", async () => {
    const { formatHtmlReport } = await import("../../src/core/audit/formatters/report");
    const output = formatHtmlReport(mockResult);

    expect(output).toContain("<style>");
  });

  it("should contain all category names", async () => {
    const { formatHtmlReport } = await import("../../src/core/audit/formatters/report");
    const output = formatHtmlReport(mockResult);

    expect(output).toContain("SSH");
    expect(output).toContain("Firewall");
  });

  it("should contain server info", async () => {
    const { formatHtmlReport } = await import("../../src/core/audit/formatters/report");
    const output = formatHtmlReport(mockResult);

    expect(output).toContain("test-server");
    expect(output).toContain("1.2.3.4");
  });

  it("should contain overall score", async () => {
    const { formatHtmlReport } = await import("../../src/core/audit/formatters/report");
    const output = formatHtmlReport(mockResult);

    expect(output).toContain("72");
  });

  it("should contain Kastell footer", async () => {
    const { formatHtmlReport } = await import("../../src/core/audit/formatters/report");
    const output = formatHtmlReport(mockResult);

    expect(output).toContain("Kastell");
  });
});

describe("formatMdReport", () => {
  it("should contain server name and score in heading", async () => {
    const { formatMdReport } = await import("../../src/core/audit/formatters/report");
    const output = formatMdReport(mockResult);

    expect(output).toContain("# ");
    expect(output).toContain("test-server");
    expect(output).toContain("72");
  });

  it("should contain category headings", async () => {
    const { formatMdReport } = await import("../../src/core/audit/formatters/report");
    const output = formatMdReport(mockResult);

    expect(output).toContain("## SSH");
    expect(output).toContain("## Firewall");
  });

  it("should contain check table with columns", async () => {
    const { formatMdReport } = await import("../../src/core/audit/formatters/report");
    const output = formatMdReport(mockResult);

    expect(output).toContain("|");
    expect(output).toContain("Severity");
    expect(output).toContain("Status");
  });

  it("should contain quick wins section", async () => {
    const { formatMdReport } = await import("../../src/core/audit/formatters/report");
    const output = formatMdReport(mockResult);

    expect(output).toContain("Quick");
  });

  it("escapes backslashes before pipes in Markdown table cells", async () => {
    const { formatMdReport } = await import("../../src/core/audit/formatters/report");
    const result: AuditResult = {
      ...mockResult,
      categories: [
        {
          name: "Paths",
          checks: [
            {
              id: "PATH-ESCAPING",
              category: "Paths",
              name: "Path escaping",
              severity: "warning",
              passed: false,
              currentValue: String.raw`C:\current\|value`,
              expectedValue: String.raw`C:\expected\|value`,
              fixCommand: String.raw`printf 'C:\fix\|value'`,
            },
          ],
          score: 0,
          maxScore: 100,
        },
      ],
      quickWins: [],
    };

    const output = formatMdReport(result);

    expect(output).toContain(String.raw`C:\\current\\\|value`);
    expect(output).toContain(String.raw`C:\\expected\\\|value`);
    expect(output).toContain(String.raw`printf 'C:\\fix\\\|value'`);
  });
});

describe("P142: structured skip rendering in HTML+MD report", () => {
  const skipCheck: AuditCheck = {
    id: "PLUGIN-MUTATE-LOCAL",
    category: "Plugin",
    name: "Mutate Local",
    severity: "info",
    passed: false,
    currentValue: "n/a",
    expectedValue: "n/a",
    skip: { code: "legacy-mutating", apiVersion: "2", kind: "mutate-local" },
  };

  const resultWithSkip: AuditResult = {
    ...mockResult,
    categories: [
      {
        name: "Plugin",
        checks: [skipCheck],
        score: 100,
        maxScore: 100,
      },
    ],
    quickWins: [],
  };

  it("HTML report uses neutral Skipped state for skipped checks", async () => {
    const { formatHtmlReport } = await import("../../src/core/audit/formatters/report");
    const output = formatHtmlReport(resultWithSkip);

    // Skipped state should be neutral — not a red X (FAIL icon) or checkmark (PASS)
    // We use a "Skipped" class or text. Acceptable: text contains "Skipped" or class contains skipped
    expect(output.toLowerCase()).toMatch(/skipped/);
  });

  it("MD report uses neutral Skipped state for skipped checks", async () => {
    const { formatMdReport } = await import("../../src/core/audit/formatters/report");
    const output = formatMdReport(resultWithSkip);

    // Status column for skipped check should be "Skipped" — not "Pass" or "FAIL"
    expect(output).toContain("Skipped");
    // Should NOT mark the skipped check as PASS or FAIL
    expect(output).not.toMatch(/\|\s*Pass\s*\|.*PLUGIN-MUTATE-LOCAL/);
    expect(output).not.toMatch(/\|\s*FAIL\s*\|.*PLUGIN-MUTATE-LOCAL/);
  });

  // P144 T6: active-probe skip is also rendered as Skipped (variant-agnostic)
  const activeProbeSkipCheck: AuditCheck = {
    id: "PROBE-01",
    category: "Plugin",
    name: "Active Probe",
    severity: "info",
    passed: false,
    currentValue: "n/a",
    expectedValue: "n/a",
    skip: { code: "active-probe", apiVersion: "3" },
  };

  const resultWithActiveProbeSkip: AuditResult = {
    ...mockResult,
    categories: [
      {
        name: "Plugin",
        checks: [activeProbeSkipCheck],
        score: 100,
        maxScore: 100,
      },
    ],
    quickWins: [],
  };

  it("P144 T6: HTML report uses neutral Skipped state for active-probe skipped checks", async () => {
    const { formatHtmlReport } = await import("../../src/core/audit/formatters/report");
    const output = formatHtmlReport(resultWithActiveProbeSkip);

    expect(output.toLowerCase()).toMatch(/skipped/);
  });

  it("P144 T6: MD report uses neutral Skipped state for active-probe skipped checks", async () => {
    const { formatMdReport } = await import("../../src/core/audit/formatters/report");
    const output = formatMdReport(resultWithActiveProbeSkip);

    expect(output).toContain("Skipped");
    expect(output).not.toMatch(/\|\s*Pass\s*\|.*PROBE-01/);
    expect(output).not.toMatch(/\|\s*FAIL\s*\|.*PROBE-01/);
  });
});
