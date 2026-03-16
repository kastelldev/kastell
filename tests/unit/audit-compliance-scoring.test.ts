import { calculateComplianceScores } from "../../src/core/audit/compliance/scoring.js";
import type { AuditCategory, AuditCheck } from "../../src/core/audit/types.js";

describe("calculateComplianceScores", () => {
  function makeCheck(id: string, passed: boolean, refs: AuditCheck["complianceRefs"]): AuditCheck {
    return {
      id,
      category: "Test",
      name: id,
      severity: "warning",
      passed,
      currentValue: "test",
      expectedValue: "test",
      complianceRefs: refs,
    };
  }

  function makeCategory(name: string, checks: AuditCheck[]): AuditCategory {
    return { name, checks, score: 0, maxScore: 100 };
  }

  it("returns empty array when no compliance refs exist", () => {
    const cat = makeCategory("SSH", [
      makeCheck("SSH-ROOT-LOGIN", true, undefined),
    ]);
    expect(calculateComplianceScores([cat])).toEqual([]);
  });

  it("calculates pass rate for single framework", () => {
    const cat = makeCategory("SSH", [
      makeCheck("SSH-ROOT-LOGIN", true, [
        { framework: "CIS", controlId: "5.2.10", version: "CIS Ubuntu 22.04 v2.0.0", description: "Test", coverage: "full", level: "L1" },
      ]),
      makeCheck("SSH-PASSWORD-AUTH", false, [
        { framework: "CIS", controlId: "5.2.8", version: "CIS Ubuntu 22.04 v2.0.0", description: "Test", coverage: "full", level: "L1" },
      ]),
    ]);
    const scores = calculateComplianceScores([cat]);
    expect(scores).toHaveLength(1);
    expect(scores[0].framework).toBe("CIS");
    expect(scores[0].passRate).toBe(50); // 1/2 controls pass
    expect(scores[0].totalControls).toBe(2);
    expect(scores[0].passedControls).toBe(1);
  });

  it("control fails if any mapped check fails", () => {
    const cat = makeCategory("Auth", [
      makeCheck("AUTH-A", true, [
        { framework: "CIS", controlId: "5.3.1", version: "CIS Ubuntu 22.04 v2.0.0", description: "Test", coverage: "full" },
      ]),
      makeCheck("AUTH-B", false, [
        { framework: "CIS", controlId: "5.3.1", version: "CIS Ubuntu 22.04 v2.0.0", description: "Test", coverage: "full" },
      ]),
    ]);
    const scores = calculateComplianceScores([cat]);
    expect(scores[0].passedControls).toBe(0); // same control, one check failed
  });

  it("counts partial coverage controls", () => {
    const cat = makeCategory("Auth", [
      makeCheck("AUTH-A", true, [
        { framework: "PCI-DSS", controlId: "8.3.6", version: "PCI-DSS v4.0", description: "Test", coverage: "partial" },
      ]),
    ]);
    const scores = calculateComplianceScores([cat]);
    expect(scores[0].partialCount).toBe(1);
  });

  it("returns scores sorted CIS, PCI-DSS, HIPAA", () => {
    const cat = makeCategory("Auth", [
      makeCheck("AUTH-A", true, [
        { framework: "HIPAA", controlId: "164.312(d)", version: "HIPAA sec164.312", description: "Test", coverage: "partial" },
        { framework: "CIS", controlId: "5.3.1", version: "CIS Ubuntu 22.04 v2.0.0", description: "Test", coverage: "full" },
        { framework: "PCI-DSS", controlId: "8.3.6", version: "PCI-DSS v4.0", description: "Test", coverage: "partial" },
      ]),
    ]);
    const scores = calculateComplianceScores([cat]);
    expect(scores.map((s) => s.framework)).toEqual(["CIS", "PCI-DSS", "HIPAA"]);
  });

  it("version string matches FRAMEWORK_VERSIONS for known frameworks", () => {
    const cat = makeCategory("SSH", [
      makeCheck("SSH-A", true, [
        { framework: "CIS", controlId: "5.2.1", version: "CIS Ubuntu 22.04 v2.0.0", description: "Test", coverage: "full" },
      ]),
    ]);
    const scores = calculateComplianceScores([cat]);
    expect(scores[0].version).toBe("CIS Ubuntu 22.04 v2.0.0");
  });
});
