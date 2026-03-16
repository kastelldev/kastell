/**
 * Tests for compliance detail scoring, profile filtering, and compliance formatter.
 * Covers calculateComplianceDetail, filterByProfile, formatComplianceReport.
 */

import { calculateComplianceDetail, filterByProfile } from "../../src/core/audit/compliance/scoring.js";
import { formatComplianceReport } from "../../src/core/audit/formatters/compliance.js";
import type { AuditCategory, AuditCheck, AuditResult } from "../../src/core/audit/types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCheck(
  id: string,
  passed: boolean,
  refs: AuditCheck["complianceRefs"],
): AuditCheck {
  return {
    id,
    category: "Test",
    name: `${id} name`,
    severity: "warning",
    passed,
    currentValue: "test",
    expectedValue: "test",
    complianceRefs: refs,
  };
}

function makeCategory(name: string, checks: AuditCheck[]): AuditCategory {
  return { name, checks, score: 50, maxScore: 100 };
}

function makeResult(categories: AuditCategory[]): AuditResult {
  return {
    serverName: "test-server",
    serverIp: "1.2.3.4",
    platform: "bare",
    timestamp: "2026-01-01T00:00:00Z",
    auditVersion: "1.10.0",
    categories,
    overallScore: 72,
    quickWins: [],
  };
}

const CIS_L1_REF = {
  framework: "CIS" as const,
  controlId: "5.2.8",
  version: "CIS Ubuntu 22.04 v2.0.0",
  description: "CIS control desc",
  coverage: "full" as const,
  level: "L1" as const,
};

const CIS_L2_REF = {
  framework: "CIS" as const,
  controlId: "4.1.3.1",
  version: "CIS Ubuntu 22.04 v2.0.0",
  description: "CIS L2 control",
  coverage: "full" as const,
  level: "L2" as const,
};

const PCI_REF = {
  framework: "PCI-DSS" as const,
  controlId: "2.2.5",
  version: "PCI-DSS v4.0",
  description: "PCI control desc",
  coverage: "partial" as const,
};

const HIPAA_REF = {
  framework: "HIPAA" as const,
  controlId: "§164.312(d)",
  version: "HIPAA §164.312",
  description: "HIPAA control desc",
  coverage: "partial" as const,
};

// ─── calculateComplianceDetail ────────────────────────────────────────────────

describe("calculateComplianceDetail", () => {
  it("returns ComplianceDetailScore[] with controls array", () => {
    const cat = makeCategory("SSH", [
      makeCheck("SSH-A", true, [CIS_L1_REF]),
      makeCheck("SSH-B", false, [CIS_L1_REF]),
    ]);
    const scores = calculateComplianceDetail([cat]);
    expect(scores).toHaveLength(1);
    expect(scores[0].controls).toBeDefined();
    expect(Array.isArray(scores[0].controls)).toBe(true);
  });

  it("each control has controlId, description, passed (boolean), checks array", () => {
    const cat = makeCategory("SSH", [
      makeCheck("SSH-A", true, [{ ...CIS_L1_REF, controlId: "5.2.10" }]),
    ]);
    const scores = calculateComplianceDetail([cat]);
    const ctrl = scores[0].controls[0];
    expect(ctrl.controlId).toBe("5.2.10");
    expect(ctrl.description).toBeDefined();
    expect(typeof ctrl.passed).toBe("boolean");
    expect(Array.isArray(ctrl.checks)).toBe(true);
    expect(ctrl.checks[0]).toMatchObject({ id: "SSH-A", name: expect.any(String), passed: true });
  });

  it("control with ALL checks passed has passed=true", () => {
    const cat = makeCategory("Auth", [
      makeCheck("AUTH-A", true, [{ ...CIS_L1_REF, controlId: "5.3.1" }]),
      makeCheck("AUTH-B", true, [{ ...CIS_L1_REF, controlId: "5.3.1" }]),
    ]);
    const scores = calculateComplianceDetail([cat]);
    const ctrl = scores[0].controls.find((c) => c.controlId === "5.3.1");
    expect(ctrl?.passed).toBe(true);
  });

  it("control with ANY check failed has passed=false", () => {
    const cat = makeCategory("Auth", [
      makeCheck("AUTH-A", true, [{ ...CIS_L1_REF, controlId: "5.3.1" }]),
      makeCheck("AUTH-B", false, [{ ...CIS_L1_REF, controlId: "5.3.1" }]),
    ]);
    const scores = calculateComplianceDetail([cat]);
    const ctrl = scores[0].controls.find((c) => c.controlId === "5.3.1");
    expect(ctrl?.passed).toBe(false);
  });

  it("partial coverage control has hasPartial=true", () => {
    const cat = makeCategory("FW", [
      makeCheck("FW-A", true, [{ ...CIS_L1_REF, coverage: "partial" }]),
    ]);
    const scores = calculateComplianceDetail([cat]);
    const ctrl = scores[0].controls[0];
    expect(ctrl.hasPartial).toBe(true);
  });

  it("returns empty array when no compliance refs exist", () => {
    const cat = makeCategory("SSH", [makeCheck("SSH-A", true, undefined)]);
    expect(calculateComplianceDetail([cat])).toEqual([]);
  });
});

// ─── filterByProfile ──────────────────────────────────────────────────────────

describe("filterByProfile", () => {
  it("filters to only CIS L1 mapped checks for cis-level1", () => {
    const cat = makeCategory("Mixed", [
      makeCheck("CIS-L1-CHECK", true, [CIS_L1_REF]),
      makeCheck("CIS-L2-CHECK", true, [CIS_L2_REF]),
      makeCheck("PCI-CHECK", true, [PCI_REF]),
      makeCheck("NO-REF-CHECK", true, undefined),
    ]);
    const result = makeResult([cat]);
    const filtered = filterByProfile(result, "cis-level1");
    const allChecks = filtered.categories.flatMap((cat) => cat.checks);
    expect(allChecks.map((ch) => ch.id)).toContain("CIS-L1-CHECK");
    expect(allChecks.map((ch) => ch.id)).not.toContain("PCI-CHECK");
    expect(allChecks.map((ch) => ch.id)).not.toContain("NO-REF-CHECK");
  });

  it("does not change overallScore", () => {
    const cat = makeCategory("SSH", [
      makeCheck("SSH-A", true, [CIS_L1_REF]),
      makeCheck("SSH-B", true, [PCI_REF]),
    ]);
    const result = makeResult([cat]);
    const filtered = filterByProfile(result, "cis-level1");
    expect(filtered.overallScore).toBe(result.overallScore);
  });

  it("filters to only PCI-DSS mapped checks for pci-dss", () => {
    const cat = makeCategory("Mixed", [
      makeCheck("CIS-CHECK", true, [CIS_L1_REF]),
      makeCheck("PCI-CHECK", true, [PCI_REF]),
      makeCheck("HIPAA-CHECK", true, [HIPAA_REF]),
    ]);
    const result = makeResult([cat]);
    const filtered = filterByProfile(result, "pci-dss");
    const allChecks = filtered.categories.flatMap((cat) => cat.checks);
    expect(allChecks.map((ch) => ch.id)).toContain("PCI-CHECK");
    expect(allChecks.map((ch) => ch.id)).not.toContain("CIS-CHECK");
    expect(allChecks.map((ch) => ch.id)).not.toContain("HIPAA-CHECK");
  });

  it("removes categories that become empty after filtering", () => {
    const cats = [
      makeCategory("CIS-Only", [makeCheck("CIS-A", true, [CIS_L1_REF])]),
      makeCategory("PCI-Only", [makeCheck("PCI-A", true, [PCI_REF])]),
    ];
    const result = makeResult(cats);
    const filtered = filterByProfile(result, "cis-level1");
    expect(filtered.categories.map((cat) => cat.name)).not.toContain("PCI-Only");
    expect(filtered.categories.map((cat) => cat.name)).toContain("CIS-Only");
  });
});

// ─── formatComplianceReport ───────────────────────────────────────────────────

describe("formatComplianceReport", () => {
  it("output contains Compliance Report header", () => {
    const cat = makeCategory("SSH", [
      makeCheck("SSH-A", true, [CIS_L1_REF]),
    ]);
    const result = makeResult([cat]);
    const output = formatComplianceReport(result, ["CIS"]);
    expect(output).toContain("Compliance Report");
  });

  it("output contains Failing Controls section when failures exist", () => {
    const cat = makeCategory("SSH", [
      makeCheck("SSH-A", true, [CIS_L1_REF]),
      makeCheck("SSH-B", false, [{ ...CIS_L1_REF, controlId: "5.2.99" }]),
    ]);
    const result = makeResult([cat]);
    const output = formatComplianceReport(result, ["CIS"]);
    expect(output).toContain("Failing Controls");
  });

  it("output contains Passing Controls section when passing controls exist", () => {
    const cat = makeCategory("SSH", [
      makeCheck("SSH-A", true, [CIS_L1_REF]),
    ]);
    const result = makeResult([cat]);
    const output = formatComplianceReport(result, ["CIS"]);
    expect(output).toContain("Passing Controls");
  });

  it("shows manual review recommended note when partial controls exist", () => {
    const cat = makeCategory("FW", [
      makeCheck("FW-A", true, [{ ...CIS_L1_REF, coverage: "partial" }]),
    ]);
    const result = makeResult([cat]);
    const output = formatComplianceReport(result, ["CIS"]);
    expect(output).toContain("manual review recommended");
  });

  it("filters to requested frameworks", () => {
    const cat = makeCategory("Mixed", [
      makeCheck("CIS-A", true, [CIS_L1_REF]),
      makeCheck("PCI-A", false, [PCI_REF]),
    ]);
    const result = makeResult([cat]);
    const output = formatComplianceReport(result, ["CIS"]);
    expect(output).toContain("CIS Ubuntu");
    // PCI-DSS framework should not appear when only CIS requested
    expect(output).not.toContain("PCI-DSS v4.0");
  });
});
