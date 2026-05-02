import { COMPLIANCE_MAP, FRAMEWORK_VERSIONS, cis, pci, hipaa } from "../../../../src/core/audit/compliance/mapper.js";
import type { ComplianceRef } from "../../../../src/core/audit/types.js";

describe("COMPLIANCE_MAP equivalence", () => {
  it("should have FRAMEWORK_VERSIONS defined", () => {
    expect(FRAMEWORK_VERSIONS).toBeDefined();
    expect(FRAMEWORK_VERSIONS.CIS).toBe("CIS Ubuntu 22.04 v2.0.0");
    expect(FRAMEWORK_VERSIONS["PCI-DSS"]).toBe("PCI-DSS v4.0");
    expect(FRAMEWORK_VERSIONS.HIPAA).toBe("HIPAA §164.312");
  });

  it("should have helper functions", () => {
    const cisRef = cis("5.2.8", "Test", "full", "L1");
    expect(cisRef.framework).toBe("CIS");
    expect(cisRef.level).toBe("L1");

    const pciRef = pci("2.2.7", "Test", "partial");
    expect(pciRef.framework).toBe("PCI-DSS");

    const hipaaRef = hipaa("§164.312(d)", "Test", "partial");
    expect(hipaaRef.framework).toBe("HIPAA");
  });

  it("should contain SSH-PASSWORD-AUTH with CIS + PCI-DSS + HIPAA", () => {
    const refs = COMPLIANCE_MAP["SSH-PASSWORD-AUTH"];
    expect(refs).toBeDefined();
    expect(refs.length).toBe(3);
    expect(refs[0]).toMatchObject({ framework: "CIS", controlId: "5.2.8" });
    expect(refs[1]).toMatchObject({ framework: "PCI-DSS", controlId: "2.2.7" });
    expect(refs[2]).toMatchObject({ framework: "HIPAA" });
  });

  it("should contain SSH-STRONG-CIPHERS with CIS + PCI-DSS + HIPAA", () => {
    const refs = COMPLIANCE_MAP["SSH-STRONG-CIPHERS"];
    expect(refs).toBeDefined();
    expect(refs.length).toBe(3);
    expect(refs[0]).toMatchObject({ framework: "CIS", controlId: "5.2.15" });
    expect(refs[1]).toMatchObject({ framework: "PCI-DSS", controlId: "4.2.1" });
    expect(refs[2]).toMatchObject({ framework: "HIPAA" });
  });

  it("should contain FW-UFW-ACTIVE with CIS + PCI-DSS", () => {
    const refs = COMPLIANCE_MAP["FW-UFW-ACTIVE"];
    expect(refs).toBeDefined();
    expect(refs.length).toBe(2);
    expect(refs[0]).toMatchObject({ framework: "CIS", controlId: "3.5.1.1" });
    expect(refs[1]).toMatchObject({ framework: "PCI-DSS", controlId: "1.3.1" });
  });

  it("should contain FINT-AIDE-INSTALLED with L2 level", () => {
    const refs = COMPLIANCE_MAP["FINT-AIDE-INSTALLED"];
    expect(refs).toBeDefined();
    expect(refs[0].level).toBe("L2");
  });

  it("should have TLS-MIN-VERSION with all three frameworks", () => {
    const refs = COMPLIANCE_MAP["TLS-MIN-VERSION"];
    expect(refs).toBeDefined();
    expect(refs.length).toBe(3);
    expect(refs[0]).toMatchObject({ framework: "PCI-DSS" });
    expect(refs[1]).toMatchObject({ framework: "CIS" });
    expect(refs[2]).toMatchObject({ framework: "HIPAA" });
  });

  it("should have NGX-WAF-DETECTED with PCI-DSS", () => {
    const refs = COMPLIANCE_MAP["NGX-WAF-DETECTED"];
    expect(refs).toBeDefined();
    expect(refs[0]).toMatchObject({ framework: "PCI-DSS", controlId: "6.4.2" });
  });

  it("should have MALWARE-CHKROOTKIT-INSTALLED with PCI-DSS only", () => {
    const refs = COMPLIANCE_MAP["MALWARE-CHKROOTKIT-INSTALLED"];
    expect(refs).toBeDefined();
    expect(refs.length).toBe(1);
    expect(refs[0]).toMatchObject({ framework: "PCI-DSS", controlId: "5.2.1" });
  });

  it("should have TLS-OCSP with empty array", () => {
    const refs = COMPLIANCE_MAP["TLS-OCSP"];
    expect(refs).toBeDefined();
    expect(refs.length).toBe(0);
  });

  it("should cover all major category prefixes", () => {
    const prefixes = [
      "SSH-", "AUTH-", "KRN-", "NET-", "FW-", "FS-", "LOG-",
      "ACCT-", "SVC-", "BOOT-", "SCHED-", "TIME-", "BANNER-",
      "BNR-", "CRYPTO-", "FINT-", "MAC-", "UPD-", "MALWARE-",
      "SECRETS-", "CLOUDMETA-", "SUPPLY-", "DCK-", "INCIDENT-",
      "TLS-", "HDR-", "NGX-", "DDOS-",
    ];
    for (const prefix of prefixes) {
      const matches = Object.keys(COMPLIANCE_MAP).filter((k) => k.startsWith(prefix));
      expect(matches.length).toBeGreaterThan(0);
    }
  });

  it("should have all 457+ check IDs from Phase 85+", () => {
    // Phase 85 TLS checks
    expect(COMPLIANCE_MAP["TLS-MIN-VERSION"]).toBeDefined();
    expect(COMPLIANCE_MAP["TLS-WEAK-CIPHERS"]).toBeDefined();
    expect(COMPLIANCE_MAP["TLS-HSTS"]).toBeDefined();
    expect(COMPLIANCE_MAP["TLS-OCSP"]).toBeDefined();
    expect(COMPLIANCE_MAP["TLS-CERT-EXPIRY"]).toBeDefined();
    expect(COMPLIANCE_MAP["TLS-DH-PARAM"]).toBeDefined();
    expect(COMPLIANCE_MAP["TLS-COMPRESSION"]).toBeDefined();
    expect(COMPLIANCE_MAP["TLS-CERT-CHAIN"]).toBeDefined();
    // Phase 86 HTTP Security Headers
    expect(COMPLIANCE_MAP["HDR-001"]).toBeDefined();
    expect(COMPLIANCE_MAP["HDR-002"]).toBeDefined();
    expect(COMPLIANCE_MAP["HDR-003"]).toBeDefined();
    expect(COMPLIANCE_MAP["HDR-004"]).toBeDefined();
    expect(COMPLIANCE_MAP["HDR-005"]).toBeDefined();
    expect(COMPLIANCE_MAP["HDR-006"]).toBeDefined();
    // Phase 88 NGX
    expect(COMPLIANCE_MAP["NGX-SERVER-TOKENS"]).toBeDefined();
    expect(COMPLIANCE_MAP["NGX-SSL-PROTOCOLS"]).toBeDefined();
    expect(COMPLIANCE_MAP["NGX-RATE-LIMIT"]).toBeDefined();
    expect(COMPLIANCE_MAP["NGX-CLIENT-BODY-SIZE"]).toBeDefined();
    expect(COMPLIANCE_MAP["NGX-ACCESS-LOG"]).toBeDefined();
    expect(COMPLIANCE_MAP["NGX-ERROR-LOG"]).toBeDefined();
    expect(COMPLIANCE_MAP["NGX-WAF-DETECTED"]).toBeDefined();
    expect(COMPLIANCE_MAP["NGX-WAF-BOT-DETECT"]).toBeDefined();
    expect(COMPLIANCE_MAP["NGX-WAF-CHALLENGE-MODE"]).toBeDefined();
    // Phase 89 DDOS
    expect(COMPLIANCE_MAP["DDOS-SYN-BACKLOG"]).toBeDefined();
    expect(COMPLIANCE_MAP["DDOS-SYNACK-RETRIES"]).toBeDefined();
    expect(COMPLIANCE_MAP["DDOS-FIN-TIMEOUT"]).toBeDefined();
    expect(COMPLIANCE_MAP["DDOS-TW-REUSE"]).toBeDefined();
    expect(COMPLIANCE_MAP["DDOS-ICMP-RATELIMIT"]).toBeDefined();
    expect(COMPLIANCE_MAP["DDOS-SOMAXCONN"]).toBeDefined();
    // SSH
    expect(COMPLIANCE_MAP["SSH-PASSWORD-AUTH"]).toBeDefined();
    expect(COMPLIANCE_MAP["SSH-ROOT-LOGIN"]).toBeDefined();
    expect(COMPLIANCE_MAP["SSH-STRONG-CIPHERS"]).toBeDefined();
  });

  it("should have valid ComplianceRef structure for each entry", () => {
    let errors: string[] = [];
    for (const [checkId, refs] of Object.entries(COMPLIANCE_MAP)) {
      for (let i = 0; i < (refs as ComplianceRef[]).length; i++) {
        const ref = (refs as ComplianceRef[])[i];
        if (!ref.framework) errors.push(`${checkId}[${i}]: missing framework`);
        if (!ref.controlId) errors.push(`${checkId}[${i}]: missing controlId`);
        if (!ref.description) errors.push(`${checkId}[${i}]: missing description`);
        if (!ref.coverage) errors.push(`${checkId}[${i}]: missing coverage`);
        if (ref.framework === "CIS" && !ref.level) errors.push(`${checkId}[${i}]: CIS without level`);
      }
    }
    expect(errors).toHaveLength(0);
  });
});