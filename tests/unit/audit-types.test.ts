import type {
  Severity,
  AuditCheck,
  AuditCategory,
  AuditResult,
  QuickWin,
  AuditHistoryEntry,
  CheckParser,
  ComplianceCoverage,
  ComplianceRef,
} from "../../src/core/audit/types.js";

describe("Audit types", () => {
  it("should accept valid Severity values", () => {
    const severities: Severity[] = ["critical", "warning", "info"];
    expect(severities).toHaveLength(3);
  });

  it("should enforce AuditCheck required fields", () => {
    const check: AuditCheck = {
      id: "SSH-PASSWORD-AUTH",
      category: "SSH",
      name: "Password Authentication",
      severity: "critical",
      passed: false,
      currentValue: "yes",
      expectedValue: "no",
    };

    expect(check.id).toBe("SSH-PASSWORD-AUTH");
    expect(check.category).toBe("SSH");
    expect(check.severity).toBe("critical");
    expect(check.passed).toBe(false);
    expect(check.currentValue).toBe("yes");
    expect(check.expectedValue).toBe("no");
  });

  it("should allow optional fixCommand and explain on AuditCheck", () => {
    const check: AuditCheck = {
      id: "SSH-ROOT-LOGIN",
      category: "SSH",
      name: "Root Login",
      severity: "critical",
      passed: true,
      currentValue: "no",
      expectedValue: "no",
      fixCommand: "sed -i 's/PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config",
      explain: "Root login should be disabled for security",
    };

    expect(check.fixCommand).toBeDefined();
    expect(check.explain).toBeDefined();
  });

  it("should enforce AuditCategory shape", () => {
    const category: AuditCategory = {
      name: "SSH",
      checks: [],
      score: 0,
      maxScore: 100,
    };

    expect(category.name).toBe("SSH");
    expect(category.checks).toEqual([]);
    expect(category.score).toBe(0);
    expect(category.maxScore).toBe(100);
  });

  it("should enforce AuditResult shape", () => {
    const result: AuditResult = {
      serverName: "test-server",
      serverIp: "1.2.3.4",
      platform: "bare",
      timestamp: "2026-01-01T00:00:00Z",
      categories: [],
      overallScore: 0,
      quickWins: [],
    };

    expect(result.platform).toBe("bare");
    expect(result.categories).toEqual([]);
    expect(result.overallScore).toBe(0);
  });

  it("should enforce QuickWin shape", () => {
    const qw: QuickWin = {
      commands: ["ufw enable"],
      currentScore: 30,
      projectedScore: 60,
      description: "Enable firewall for immediate improvement",
    };

    expect(qw.commands).toHaveLength(1);
    expect(qw.projectedScore).toBeGreaterThan(qw.currentScore);
  });

  it("should enforce AuditHistoryEntry shape", () => {
    const entry: AuditHistoryEntry = {
      serverIp: "1.2.3.4",
      serverName: "test-server",
      timestamp: "2026-01-01T00:00:00Z",
      overallScore: 85,
      categoryScores: { SSH: 90, Firewall: 80 },
    };

    expect(entry.categoryScores["SSH"]).toBe(90);
  });

  it("should enforce CheckParser function signature", () => {
    const parser: CheckParser = (_sectionOutput: string, _platform: string) => {
      return [];
    };

    expect(parser("some output", "bare")).toEqual([]);
  });
});

describe("ComplianceCoverage type", () => {
  it("should accept full coverage value", () => {
    const coverage: ComplianceCoverage = "full";
    expect(coverage).toBe("full");
  });

  it("should accept partial coverage value", () => {
    const coverage: ComplianceCoverage = "partial";
    expect(coverage).toBe("partial");
  });
});

describe("ComplianceRef type", () => {
  it("should accept a ComplianceRef with all required fields and coverage=full", () => {
    const ref: ComplianceRef = {
      framework: "CIS",
      controlId: "5.2.1",
      version: "1.0",
      description: "Ensure SSH MaxAuthTries is set to 4 or less",
      coverage: "full",
    };

    expect(ref.framework).toBe("CIS");
    expect(ref.controlId).toBe("5.2.1");
    expect(ref.version).toBe("1.0");
    expect(ref.description).toBeDefined();
    expect(ref.coverage).toBe("full");
  });

  it("should accept a ComplianceRef with coverage=partial", () => {
    const ref: ComplianceRef = {
      framework: "PCI-DSS",
      controlId: "2.2.4",
      version: "4.0",
      description: "Configure system security parameters",
      coverage: "partial",
    };

    expect(ref.coverage).toBe("partial");
  });
});

describe("AuditCheck with complianceRefs and tags", () => {
  it("should be valid without complianceRefs and tags (backward compat)", () => {
    const check: AuditCheck = {
      id: "SSH-PASSWORD-AUTH",
      category: "SSH",
      name: "Password Authentication",
      severity: "critical",
      passed: false,
      currentValue: "yes",
      expectedValue: "no",
    };

    expect(check.complianceRefs).toBeUndefined();
    expect(check.tags).toBeUndefined();
  });

  it("should accept complianceRefs array and tags array", () => {
    const check: AuditCheck = {
      id: "SSH-PASSWORD-AUTH",
      category: "SSH",
      name: "Password Authentication",
      severity: "critical",
      passed: false,
      currentValue: "yes",
      expectedValue: "no",
      complianceRefs: [
        {
          framework: "CIS",
          controlId: "5.2.1",
          version: "1.0",
          description: "SSH MaxAuthTries",
          coverage: "full",
        },
      ],
      tags: ["ssh", "authentication"],
    };

    expect(check.complianceRefs).toHaveLength(1);
    expect(check.complianceRefs![0].framework).toBe("CIS");
    expect(check.tags).toEqual(["ssh", "authentication"]);
  });
});
