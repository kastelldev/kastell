import { CHECK_IDS } from "../../src/core/audit/checkIds.js";
import { COMPLIANCE_MAP, FRAMEWORK_VERSIONS, cis, pci, hipaa } from "../../src/core/audit/compliance/mapper.js";
import { CHECK_REGISTRY, mergeComplianceRefs } from "../../src/core/audit/checks/index.js";
import type { AuditCategory, AuditCheck, ComplianceCoverage } from "../../src/core/audit/types.js";

describe("Compliance mapper CI guards", () => {
  let liveCheckIds: Set<string>;

  beforeAll(() => {
    liveCheckIds = new Set(
      CHECK_REGISTRY.flatMap((e) => {
        // Cloud Metadata returns [] on bare-metal/empty input (Phase 48-01 decision).
        // Use VPS sentinel to generate check IDs for compliance mapping validation.
        const input = e.name === "Cloud Metadata" ? "IS_VPS\nMETADATA_BLOCKED\nCLOUDINIT_CLEAN\nIMDSV2_AVAILABLE\nCLOUDINIT_NO_SENSITIVE_ENV" : "";
        return e.parser(input, "bare").map((c) => c.id);
      }),
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

  it("PCI-DSS mapping covers 80+ refs", () => {
    const pciCount = Object.values(COMPLIANCE_MAP)
      .flat()
      .filter((r) => r.framework === "PCI-DSS").length;
    expect(pciCount).toBeGreaterThanOrEqual(80);
  });

  it("HIPAA mapping covers 40+ refs", () => {
    const hipaaCount = Object.values(COMPLIANCE_MAP)
      .flat()
      .filter((r) => r.framework === "HIPAA").length;
    expect(hipaaCount).toBeGreaterThanOrEqual(40);
  });

  it("partial coverage entries exist in mapper", () => {
    const partials = Object.values(COMPLIANCE_MAP)
      .flat()
      .filter((r) => r.coverage === "partial");
    expect(partials.length).toBeGreaterThan(0);
  });

  it("full coverage entries exist in mapper", () => {
    const fulls = Object.values(COMPLIANCE_MAP)
      .flat()
      .filter((r) => r.coverage === "full");
    expect(fulls.length).toBeGreaterThan(0);
  });

  describe("mergeComplianceRefs", () => {
    it("injects compliance refs without mutating originals", () => {
      const mockCheck: AuditCheck = {
        id: CHECK_IDS.SSH.SSH_PASSWORD_AUTH,
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
        [CHECK_IDS.SSH.SSH_PASSWORD_AUTH]: [
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

// ─── cis() helper: exact field values ────────────────────────────────────────

describe("cis() builder — exact output values", () => {
  it("returns framework='CIS' exactly", () => {
    const ref = cis("1.1", "desc", "full");
    expect(ref.framework).toBe("CIS");
  });

  it("returns exact version string from FRAMEWORK_VERSIONS", () => {
    const ref = cis("1.1", "desc", "full");
    expect(ref.version).toBe("CIS Ubuntu 22.04 v2.0.0");
  });

  it("returns the exact controlId passed", () => {
    const ref = cis("5.2.8", "Ensure SSH PasswordAuthentication is disabled", "full");
    expect(ref.controlId).toBe("5.2.8");
  });

  it("returns the exact description passed", () => {
    const ref = cis("5.2.8", "Ensure SSH PasswordAuthentication is disabled", "full");
    expect(ref.description).toBe("Ensure SSH PasswordAuthentication is disabled");
  });

  it("returns coverage='full' when full passed", () => {
    const ref = cis("1.1", "desc", "full");
    expect(ref.coverage).toBe("full");
  });

  it("returns coverage='partial' when partial passed", () => {
    const ref = cis("1.1", "desc", "partial");
    expect(ref.coverage).toBe("partial");
  });

  it("defaults level to 'L1' when not specified", () => {
    const ref = cis("1.1", "desc", "full");
    expect(ref.level).toBe("L1");
  });

  it("returns level='L2' when L2 passed explicitly", () => {
    const ref = cis("4.1.4.1", "Ensure AIDE is installed", "full", "L2");
    expect(ref.level).toBe("L2");
  });

  it("does not set extra fields beyond the 6 defined", () => {
    const ref = cis("1.1", "desc", "full");
    const keys = Object.keys(ref).sort();
    expect(keys).toEqual(["controlId", "coverage", "description", "framework", "level", "version"].sort());
  });
});

// ─── pci() helper ─────────────────────────────────────────────────────────────

describe("pci() builder — exact output values", () => {
  it("returns framework='PCI-DSS' exactly", () => {
    const ref = pci("2.2.7", "desc", "partial");
    expect(ref.framework).toBe("PCI-DSS");
  });

  it("returns exact version string from FRAMEWORK_VERSIONS", () => {
    const ref = pci("2.2.7", "desc", "full");
    expect(ref.version).toBe("PCI-DSS v4.0");
  });

  it("returns the exact controlId passed", () => {
    const ref = pci("4.2.1", "Strong cryptography for data in transit", "full");
    expect(ref.controlId).toBe("4.2.1");
  });

  it("returns coverage='full' when full passed", () => {
    const ref = pci("2.2.7", "desc", "full");
    expect(ref.coverage).toBe("full");
  });

  it("returns coverage='partial' when partial passed", () => {
    const ref = pci("2.2.7", "desc", "partial");
    expect(ref.coverage).toBe("partial");
  });

  it("does NOT set a level field (PCI has no level)", () => {
    const ref = pci("2.2.7", "desc", "partial");
    expect(ref.level).toBeUndefined();
  });
});

// ─── hipaa() helper ───────────────────────────────────────────────────────────

describe("hipaa() builder — exact output values", () => {
  it("returns framework='HIPAA' exactly", () => {
    const ref = hipaa("§164.312(d)", "desc", "partial");
    expect(ref.framework).toBe("HIPAA");
  });

  it("returns exact version string from FRAMEWORK_VERSIONS", () => {
    const ref = hipaa("§164.312(d)", "desc", "full");
    expect(ref.version).toBe("HIPAA §164.312");
  });

  it("returns the exact controlId passed", () => {
    const ref = hipaa("§164.312(a)(2)(iii)", "Automatic logoff", "partial");
    expect(ref.controlId).toBe("§164.312(a)(2)(iii)");
  });

  it("returns coverage='partial' correctly", () => {
    const ref = hipaa("§164.312(d)", "desc", "partial");
    expect(ref.coverage).toBe("partial");
  });

  it("does NOT set a level field (HIPAA has no level)", () => {
    const ref = hipaa("§164.312(d)", "desc", "partial");
    expect(ref.level).toBeUndefined();
  });
});

// ─── COMPLIANCE_MAP data integrity — exact value spot checks ─────────────────

describe("COMPLIANCE_MAP — exact spot-check assertions", () => {
  it("SSH-PASSWORD-AUTH has CIS control 5.2.8 as first ref", () => {
    const refs = COMPLIANCE_MAP[CHECK_IDS.SSH.SSH_PASSWORD_AUTH];
    expect(refs).toBeDefined();
    expect(refs[0].framework).toBe("CIS");
    expect(refs[0].controlId).toBe("5.2.8");
    expect(refs[0].coverage).toBe("full");
    expect(refs[0].level).toBe("L1");
  });

  it("SSH-PASSWORD-AUTH has exactly 3 compliance refs", () => {
    const refs = COMPLIANCE_MAP[CHECK_IDS.SSH.SSH_PASSWORD_AUTH];
    expect(refs).toHaveLength(3);
  });

  it("SSH-PASSWORD-AUTH refs include PCI-DSS and HIPAA", () => {
    const refs = COMPLIANCE_MAP[CHECK_IDS.SSH.SSH_PASSWORD_AUTH];
    const frameworks = refs.map((r) => r.framework);
    expect(frameworks).toContain("PCI-DSS");
    expect(frameworks).toContain("HIPAA");
  });

  it("SSH-ROOT-LOGIN has exactly 2 refs (CIS + PCI-DSS)", () => {
    const refs = COMPLIANCE_MAP[CHECK_IDS.SSH.SSH_ROOT_LOGIN];
    expect(refs).toHaveLength(2);
    const frameworks = refs.map((r) => r.framework);
    expect(frameworks).toContain("CIS");
    expect(frameworks).toContain("PCI-DSS");
  });

  it("SSH-EMPTY-PASSWORDS has exactly 1 ref (CIS only)", () => {
    const refs = COMPLIANCE_MAP[CHECK_IDS.SSH.SSH_EMPTY_PASSWORDS];
    expect(refs).toHaveLength(1);
    expect(refs[0].framework).toBe("CIS");
    expect(refs[0].controlId).toBe("5.2.11");
  });

  it("FW-UFW-ACTIVE has CIS 3.5.1.1 as first CIS ref", () => {
    const refs = COMPLIANCE_MAP[CHECK_IDS.FIREWALL.FW_UFW_ACTIVE];
    expect(refs).toBeDefined();
    const cisRef = refs.find((r) => r.framework === "CIS");
    expect(cisRef).toBeDefined();
    expect(cisRef!.controlId).toBe("3.5.1.1");
  });

  it("LOG-SYSLOG-ACTIVE has refs from all 3 frameworks", () => {
    const refs = COMPLIANCE_MAP[CHECK_IDS.LOGGING.LOG_SYSLOG_ACTIVE];
    const frameworks = refs.map((r) => r.framework);
    expect(frameworks).toContain("CIS");
    expect(frameworks).toContain("PCI-DSS");
    expect(frameworks).toContain("HIPAA");
  });

  it("LOG-AUDIT-LOGIN-RULES CIS ref has level L2", () => {
    const refs = COMPLIANCE_MAP[CHECK_IDS.LOGGING.LOG_AUDIT_LOGIN_RULES];
    const cisRef = refs.find((r) => r.framework === "CIS");
    expect(cisRef!.level).toBe("L2");
  });

  it("FINT-AIDE-INSTALLED has CIS level L2", () => {
    const refs = COMPLIANCE_MAP[CHECK_IDS.FILEINTEGRITY.FINT_AIDE_INSTALLED];
    const cisRef = refs.find((r) => r.framework === "CIS");
    expect(cisRef!.level).toBe("L2");
  });

  it("CRYPTO-NO-SSLV3 has 3 refs: CIS + PCI-DSS + HIPAA with coverage=full", () => {
    const refs = COMPLIANCE_MAP[CHECK_IDS.CRYPTO.CRYPTO_NO_SSLV3];
    expect(refs).toHaveLength(3);
    // PCI ref has coverage full
    const pciRef = refs.find((r) => r.framework === "PCI-DSS");
    expect(pciRef!.coverage).toBe("full");
    // HIPAA ref has coverage full
    const hipaaRef = refs.find((r) => r.framework === "HIPAA");
    expect(hipaaRef!.coverage).toBe("full");
  });

  it("DCK-ROOTLESS-MODE maps to PCI-DSS 2.2.5 with coverage=partial", () => {
    const refs = COMPLIANCE_MAP[CHECK_IDS.DOCKER.DCK_ROOTLESS_MODE];
    expect(refs).toBeDefined();
    expect(refs[0].framework).toBe("PCI-DSS");
    expect(refs[0].controlId).toBe("2.2.5");
    expect(refs[0].coverage).toBe("partial");
  });

  it("SECRETS-SSH-KEY-PERMS has both PCI-DSS and HIPAA refs", () => {
    const refs = COMPLIANCE_MAP[CHECK_IDS.SECRETS.SECRETS_SSH_KEY_PERMS];
    const frameworks = refs.map((r) => r.framework);
    expect(frameworks).toContain("PCI-DSS");
    expect(frameworks).toContain("HIPAA");
  });

  it("coverage field is always 'full' or 'partial' — never any other value", () => {
    const invalidCoverage: string[] = [];
    for (const [checkId, refs] of Object.entries(COMPLIANCE_MAP)) {
      for (const ref of refs) {
        if (ref.coverage !== "full" && ref.coverage !== "partial") {
          invalidCoverage.push(`${checkId}: ${ref.coverage}`);
        }
      }
    }
    expect(invalidCoverage).toEqual([]);
  });

  it("level field (when present) is always 'L1' or 'L2' — never any other value", () => {
    const invalidLevel: string[] = [];
    for (const [checkId, refs] of Object.entries(COMPLIANCE_MAP)) {
      for (const ref of refs) {
        if (ref.level !== undefined && ref.level !== "L1" && ref.level !== "L2") {
          invalidLevel.push(`${checkId}: ${ref.level}`);
        }
      }
    }
    expect(invalidLevel).toEqual([]);
  });

  it("framework field is always one of the 3 known values", () => {
    const validFrameworks = new Set(["CIS", "PCI-DSS", "HIPAA"]);
    const invalid: string[] = [];
    for (const [checkId, refs] of Object.entries(COMPLIANCE_MAP)) {
      for (const ref of refs) {
        if (!validFrameworks.has(ref.framework)) {
          invalid.push(`${checkId}: ${ref.framework}`);
        }
      }
    }
    expect(invalid).toEqual([]);
  });

  it("all controlId fields are non-empty strings", () => {
    const empty: string[] = [];
    for (const [checkId, refs] of Object.entries(COMPLIANCE_MAP)) {
      for (const ref of refs) {
        if (!ref.controlId || ref.controlId.trim() === "") {
          empty.push(checkId);
        }
      }
    }
    expect(empty).toEqual([]);
  });

  it("all description fields are non-empty strings", () => {
    const empty: string[] = [];
    for (const [checkId, refs] of Object.entries(COMPLIANCE_MAP)) {
      for (const ref of refs) {
        if (!ref.description || ref.description.trim() === "") {
          empty.push(checkId);
        }
      }
    }
    expect(empty).toEqual([]);
  });
});

// ─── mergeComplianceRefs additional coverage ──────────────────────────────────

describe("mergeComplianceRefs — additional mutation-killing assertions", () => {
  it("returns a NEW array (not the same reference as input)", () => {
    const mockCheck: AuditCheck = { id: CHECK_IDS.SSH.SSH_ROOT_LOGIN, category: "SSH", name: "Root Login", severity: "critical", passed: false, currentValue: "yes", expectedValue: "no" };
    const mockCategory: AuditCategory = { name: "SSH", checks: [mockCheck], score: 0, maxScore: 100 };
    const result = mergeComplianceRefs([mockCategory], COMPLIANCE_MAP);
    expect(result).not.toBe([mockCategory]);
    expect(result[0]).not.toBe(mockCategory);
  });

  it("returns same number of categories as input", () => {
    const cat1: AuditCategory = { name: "SSH", checks: [], score: 0, maxScore: 0 };
    const cat2: AuditCategory = { name: "Kernel", checks: [], score: 0, maxScore: 0 };
    const result = mergeComplianceRefs([cat1, cat2], {});
    expect(result).toHaveLength(2);
  });

  it("merges multiple refs when check has 3 compliance mappings", () => {
    const mockCheck: AuditCheck = { id: CHECK_IDS.SSH.SSH_PASSWORD_AUTH, category: "SSH", name: "Pw Auth", severity: "critical", passed: false, currentValue: "yes", expectedValue: "no" };
    const mockCategory: AuditCategory = { name: "SSH", checks: [mockCheck], score: 0, maxScore: 100 };
    const result = mergeComplianceRefs([mockCategory], COMPLIANCE_MAP);
    expect(result[0].checks[0].complianceRefs).toHaveLength(3);
  });

  it("preserves all other check fields when merging refs", () => {
    const mockCheck: AuditCheck = {
      id: CHECK_IDS.SSH.SSH_PASSWORD_AUTH,
      category: "SSH",
      name: "Password Authentication",
      severity: "critical",
      passed: false,
      currentValue: "yes",
      expectedValue: "no",
    };
    const mockCategory: AuditCategory = { name: "SSH", checks: [mockCheck], score: 0, maxScore: 100 };
    const result = mergeComplianceRefs([mockCategory], COMPLIANCE_MAP);
    const merged = result[0].checks[0];
    expect(merged.id).toBe(CHECK_IDS.SSH.SSH_PASSWORD_AUTH);
    expect(merged.category).toBe("SSH");
    expect(merged.name).toBe("Password Authentication");
    expect(merged.severity).toBe("critical");
    expect(merged.passed).toBe(false);
  });

  it("handles empty checks array without throwing", () => {
    const emptyCategory: AuditCategory = { name: "Empty", checks: [], score: 100, maxScore: 100 };
    const result = mergeComplianceRefs([emptyCategory], COMPLIANCE_MAP);
    expect(result[0].checks).toHaveLength(0);
  });

  it("handles empty categories array without throwing", () => {
    const result = mergeComplianceRefs([], COMPLIANCE_MAP);
    expect(result).toHaveLength(0);
    expect(result).toEqual([]);
  });
});
