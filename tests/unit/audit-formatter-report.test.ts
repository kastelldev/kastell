import type { AuditResult } from "../../src/core/audit/types";

const mockResult: AuditResult = {
  serverName: "test-server",
  serverIp: "1.2.3.4",
  platform: "bare",
  timestamp: "2026-03-08T00:00:00.000Z",
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
});
