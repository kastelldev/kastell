import { COMPLIANCE_MAP, FRAMEWORK_VERSIONS } from "../../src/core/audit/compliance/mapper.js";
import { CHECK_REGISTRY, mergeComplianceRefs } from "../../src/core/audit/checks/index.js";
import type { AuditCategory, AuditCheck } from "../../src/core/audit/types.js";

describe("Compliance mapper CI guards", () => {
  let liveCheckIds: Set<string>;

  beforeAll(() => {
    liveCheckIds = new Set(
      CHECK_REGISTRY.flatMap((e) => e.parser("", "bare").map((c) => c.id)),
    );
  });

  it("every check ID in COMPLIANCE_MAP exists in CHECK_REGISTRY", () => {
    const orphans = Object.keys(COMPLIANCE_MAP).filter(
      (id) => !liveCheckIds.has(id),
    );
    expect(orphans).toEqual([]);
  });

  it("every ComplianceRef version matches FRAMEWORK_VERSIONS", () => {
    const mismatches: string[] = [];
    for (const [checkId, refs] of Object.entries(COMPLIANCE_MAP)) {
      for (const ref of refs) {
        const expected =
          FRAMEWORK_VERSIONS[ref.framework as keyof typeof FRAMEWORK_VERSIONS];
        if (expected && ref.version !== expected) {
          mismatches.push(
            `${checkId} -> ${ref.framework}: "${ref.version}" != "${expected}"`,
          );
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("CIS mapping covers 200+ distinct check IDs", () => {
    const cisCoveredChecks = Object.entries(COMPLIANCE_MAP).filter(
      ([, refs]) => refs.some((r) => r.framework === "CIS"),
    ).length;
    expect(cisCoveredChecks).toBeGreaterThanOrEqual(200);
  });

  it("every CIS ref has a level field (L1 or L2)", () => {
    const missing: string[] = [];
    for (const [checkId, refs] of Object.entries(COMPLIANCE_MAP)) {
      for (const ref of refs) {
        if (ref.framework === "CIS" && !ref.level) {
          missing.push(checkId);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("FRAMEWORK_VERSIONS has all three frameworks", () => {
    expect(FRAMEWORK_VERSIONS.CIS).toBe("CIS Ubuntu 22.04 v2.0.0");
    expect(FRAMEWORK_VERSIONS["PCI-DSS"]).toBe("PCI-DSS v4.0");
    expect(FRAMEWORK_VERSIONS.HIPAA).toBe("HIPAA §164.312");
  });

  describe("mergeComplianceRefs", () => {
    it("injects compliance refs without mutating originals", () => {
      const mockCheck: AuditCheck = {
        id: "SSH-PASSWORD-AUTH",
        category: "SSH",
        name: "Password Authentication",
        severity: "critical",
        passed: false,
        currentValue: "yes",
        expectedValue: "no",
      };
      const mockCategory: AuditCategory = {
        name: "SSH",
        checks: [mockCheck],
        score: 0,
        maxScore: 100,
      };
      const map = {
        "SSH-PASSWORD-AUTH": [
          {
            framework: "CIS",
            controlId: "5.2.8",
            version: "CIS Ubuntu 22.04 v2.0.0",
            description: "Test",
            coverage: "full" as const,
            level: "L1" as const,
          },
        ],
      };

      const result = mergeComplianceRefs([mockCategory], map);

      // Original not mutated
      expect(mockCheck.complianceRefs).toBeUndefined();
      // Result has refs
      expect(result[0].checks[0].complianceRefs).toHaveLength(1);
      expect(result[0].checks[0].complianceRefs![0].controlId).toBe("5.2.8");
    });

    it("leaves checks without mapping unchanged", () => {
      const mockCheck: AuditCheck = {
        id: "UNKNOWN-CHECK",
        category: "Test",
        name: "Unknown",
        severity: "info",
        passed: true,
        currentValue: "n/a",
        expectedValue: "n/a",
      };
      const mockCategory: AuditCategory = {
        name: "Test",
        checks: [mockCheck],
        score: 100,
        maxScore: 100,
      };

      const result = mergeComplianceRefs([mockCategory], {});
      expect(result[0].checks[0].complianceRefs).toBeUndefined();
    });
  });
});
