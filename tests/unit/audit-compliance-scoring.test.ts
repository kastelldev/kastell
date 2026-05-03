import { CHECK_IDS } from "../../src/core/audit/checkIds.js";
import { calculateComplianceScores, calculateComplianceDetail, filterByProfile } from "../../src/core/audit/compliance/scoring.js";
import type { AuditCategory, AuditCheck, AuditResult } from "../../src/core/audit/types.js";

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
      makeCheck(CHECK_IDS.SSH.SSH_ROOT_LOGIN, true, undefined),
    ]);
    expect(calculateComplianceScores([cat])).toEqual([]);
  });

  it("calculates pass rate for single framework", () => {
    const cat = makeCategory("SSH", [
      makeCheck(CHECK_IDS.SSH.SSH_ROOT_LOGIN, true, [
        { framework: "CIS", controlId: "5.2.10", version: "CIS Ubuntu 22.04 v2.0.0", description: "Test", coverage: "full", level: "L1" },
      ]),
      makeCheck(CHECK_IDS.SSH.SSH_PASSWORD_AUTH, false, [
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

  it("uses framework string as version fallback for unknown frameworks", () => {
    const cat = makeCategory("SSH", [
      makeCheck("SSH-A", true, [
        { framework: "UNKNOWN-FW" as never, controlId: "1.1", version: "v1", description: "Test", coverage: "full" },
      ]),
    ]);
    const scores = calculateComplianceScores([cat]);
    expect(scores[0].version).toBe("UNKNOWN-FW");
  });

  it("calculates partiallyPassed correctly — all checks pass with partial coverage", () => {
    const cat = makeCategory("Auth", [
      makeCheck("AUTH-A", true, [
        { framework: "PCI-DSS", controlId: "8.3.6", version: "PCI-DSS v4.0", description: "Test", coverage: "partial" },
      ]),
    ]);
    const scores = calculateComplianceScores([cat]);
    expect(scores[0].partiallyPassed).toBe(1);
    expect(scores[0].passedControls).toBe(0); // not counted as fully passed
    expect(scores[0].passRate).toBe(50); // partial contributes 0.5
  });

  it("returns 0 passRate when controls map is empty", () => {
    const scores = calculateComplianceScores([]);
    expect(scores).toEqual([]);
  });

  it("marks existing control as partial when second check adds partial coverage", () => {
    const cat = makeCategory("Auth", [
      makeCheck("AUTH-A", true, [
        { framework: "CIS", controlId: "5.3.1", version: "CIS Ubuntu 22.04 v2.0.0", description: "Test", coverage: "full" },
      ]),
      makeCheck("AUTH-B", true, [
        { framework: "CIS", controlId: "5.3.1", version: "CIS Ubuntu 22.04 v2.0.0", description: "Test", coverage: "partial" },
      ]),
    ]);
    const scores = calculateComplianceScores([cat]);
    expect(scores[0].partialCount).toBe(1);
    expect(scores[0].partiallyPassed).toBe(1); // allPassed=true, hasPartial=true
    expect(scores[0].passedControls).toBe(0); // not fully passed
  });

  it("marks existing control as failed when second check fails", () => {
    const cat = makeCategory("Auth", [
      makeCheck("AUTH-A", true, [
        { framework: "CIS", controlId: "5.3.1", version: "CIS Ubuntu 22.04 v2.0.0", description: "Test", coverage: "full" },
      ]),
      makeCheck("AUTH-B", false, [
        { framework: "CIS", controlId: "5.3.1", version: "CIS Ubuntu 22.04 v2.0.0", description: "Test", coverage: "partial" },
      ]),
    ]);
    const scores = calculateComplianceScores([cat]);
    expect(scores[0].passedControls).toBe(0);
    expect(scores[0].partiallyPassed).toBe(0); // allPassed is false
    expect(scores[0].partialCount).toBe(1); // hasPartial is true
  });
});

describe("calculateComplianceDetail", () => {
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
    const cat = makeCategory("SSH", [makeCheck("SSH-A", true, undefined)]);
    expect(calculateComplianceDetail([cat])).toEqual([]);
  });

  it("returns per-control check lists", () => {
    const cat = makeCategory("SSH", [
      makeCheck(CHECK_IDS.SSH.SSH_ROOT_LOGIN, true, [
        { framework: "CIS", controlId: "5.2.10", version: "CIS Ubuntu 22.04 v2.0.0", description: "Disable root", coverage: "full", level: "L1" },
      ]),
      makeCheck(CHECK_IDS.SSH.SSH_PASSWORD_AUTH, false, [
        { framework: "CIS", controlId: "5.2.10", version: "CIS Ubuntu 22.04 v2.0.0", description: "Disable root", coverage: "full", level: "L1" },
      ]),
    ]);
    const scores = calculateComplianceDetail([cat]);
    expect(scores).toHaveLength(1);
    expect(scores[0].controls).toHaveLength(1);
    expect(scores[0].controls[0].controlId).toBe("5.2.10");
    expect(scores[0].controls[0].passed).toBe(false); // one check failed
    expect(scores[0].controls[0].checks).toHaveLength(2);
  });

  it("calculates partial coverage in detail scores", () => {
    const cat = makeCategory("Auth", [
      makeCheck("AUTH-A", true, [
        { framework: "PCI-DSS", controlId: "8.3.6", version: "PCI-DSS v4.0", description: "Passwords", coverage: "partial" },
      ]),
    ]);
    const scores = calculateComplianceDetail([cat]);
    expect(scores[0].partiallyPassed).toBe(1);
    expect(scores[0].partialCount).toBe(1);
    expect(scores[0].controls[0].hasPartial).toBe(true);
  });

  it("sorts scores CIS, PCI-DSS, HIPAA", () => {
    const cat = makeCategory("Auth", [
      makeCheck("AUTH-A", true, [
        { framework: "HIPAA", controlId: "164.312(d)", version: "HIPAA", description: "Test", coverage: "full" },
        { framework: "CIS", controlId: "5.3.1", version: "CIS", description: "Test", coverage: "full" },
        { framework: "PCI-DSS", controlId: "8.3.6", version: "PCI-DSS", description: "Test", coverage: "full" },
      ]),
    ]);
    const scores = calculateComplianceDetail([cat]);
    expect(scores.map((s) => s.framework)).toEqual(["CIS", "PCI-DSS", "HIPAA"]);
  });

  it("updates existing control with partial coverage on second check", () => {
    const cat = makeCategory("Auth", [
      makeCheck("AUTH-A", true, [
        { framework: "CIS", controlId: "5.3.1", version: "CIS", description: "Auth", coverage: "full" },
      ]),
      makeCheck("AUTH-B", false, [
        { framework: "CIS", controlId: "5.3.1", version: "CIS", description: "Auth", coverage: "partial" },
      ]),
    ]);
    const scores = calculateComplianceDetail([cat]);
    expect(scores[0].controls[0].passed).toBe(false);
    expect(scores[0].controls[0].hasPartial).toBe(true);
    expect(scores[0].controls[0].checks).toHaveLength(2);
  });

  it("handles multiple checks for different controls", () => {
    const cat = makeCategory("SSH", [
      makeCheck("SSH-A", true, [
        { framework: "CIS", controlId: "5.2.1", version: "CIS", description: "A", coverage: "full" },
      ]),
      makeCheck("SSH-B", true, [
        { framework: "CIS", controlId: "5.2.2", version: "CIS", description: "B", coverage: "full" },
      ]),
    ]);
    const scores = calculateComplianceDetail([cat]);
    expect(scores[0].passedControls).toBe(2);
    expect(scores[0].totalControls).toBe(2);
    expect(scores[0].controls).toHaveLength(2);
  });
});

describe("filterByProfile", () => {
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

  function makeResult(categories: AuditCategory[]): AuditResult {
    return {
      serverName: "test",
      serverIp: "1.2.3.4",
      platform: "bare",
      timestamp: new Date().toISOString(),
      auditVersion: "1.0.0",
      categories,
      overallScore: 75,
      quickWins: [],
    };
  }

  it("filters to only CIS L1 checks for cis-level1 profile", () => {
    const cat: AuditCategory = {
      name: "SSH",
      checks: [
        makeCheck("SSH-A", true, [
          { framework: "CIS", controlId: "5.2.1", version: "CIS", description: "Test", coverage: "full", level: "L1" },
        ]),
        makeCheck("SSH-B", true, [
          { framework: "CIS", controlId: "5.2.2", version: "CIS", description: "Test", coverage: "full", level: "L2" },
        ]),
        makeCheck("SSH-C", true, [
          { framework: "PCI-DSS", controlId: "8.3.6", version: "PCI-DSS", description: "Test", coverage: "full" },
        ]),
      ],
      score: 100,
      maxScore: 100,
    };
    const result = filterByProfile(makeResult([cat]), "cis-level1");
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0].checks).toHaveLength(1);
    expect(result.categories[0].checks[0].id).toBe("SSH-A");
    // overallScore stays unchanged
    expect(result.overallScore).toBe(75);
  });

  it("includes both L1 and L2 for cis-level2 profile", () => {
    const cat: AuditCategory = {
      name: "SSH",
      checks: [
        makeCheck("SSH-A", true, [
          { framework: "CIS", controlId: "5.2.1", version: "CIS", description: "Test", coverage: "full", level: "L1" },
        ]),
        makeCheck("SSH-B", true, [
          { framework: "CIS", controlId: "5.2.2", version: "CIS", description: "Test", coverage: "full", level: "L2" },
        ]),
      ],
      score: 100,
      maxScore: 100,
    };
    const result = filterByProfile(makeResult([cat]), "cis-level2");
    expect(result.categories[0].checks).toHaveLength(2); // no level filter for L2 profile
  });

  it("filters PCI-DSS checks for pci-dss profile", () => {
    const cat: AuditCategory = {
      name: "Auth",
      checks: [
        makeCheck("AUTH-A", true, [
          { framework: "PCI-DSS", controlId: "8.3.6", version: "PCI-DSS", description: "Test", coverage: "full" },
        ]),
        makeCheck("AUTH-B", true, [
          { framework: "CIS", controlId: "5.3.1", version: "CIS", description: "Test", coverage: "full" },
        ]),
      ],
      score: 100,
      maxScore: 100,
    };
    const result = filterByProfile(makeResult([cat]), "pci-dss");
    expect(result.categories[0].checks).toHaveLength(1);
    expect(result.categories[0].checks[0].id).toBe("AUTH-A");
  });

  it("removes categories with no matching checks", () => {
    const cat: AuditCategory = {
      name: "Memory",
      checks: [
        makeCheck("MEM-A", true, [
          { framework: "CIS", controlId: "1.1", version: "CIS", description: "Test", coverage: "full", level: "L1" },
        ]),
      ],
      score: 100,
      maxScore: 100,
    };
    const result = filterByProfile(makeResult([cat]), "pci-dss");
    expect(result.categories).toHaveLength(0);
  });

  it("excludes checks without complianceRefs", () => {
    const cat: AuditCategory = {
      name: "SSH",
      checks: [
        makeCheck("SSH-A", true, undefined),
        makeCheck("SSH-B", true, [
          { framework: "HIPAA", controlId: "164.312(d)", version: "HIPAA", description: "Test", coverage: "full" },
        ]),
      ],
      score: 100,
      maxScore: 100,
    };
    const result = filterByProfile(makeResult([cat]), "hipaa");
    expect(result.categories[0].checks).toHaveLength(1);
    expect(result.categories[0].checks[0].id).toBe("SSH-B");
  });
});
