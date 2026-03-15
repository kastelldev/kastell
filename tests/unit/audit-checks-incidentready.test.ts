import { parseIncidentReadyChecks } from "../../src/core/audit/checks/incidentready.js";

describe("parseIncidentReadyChecks", () => {
  const validOutput = [
    "AUDITD_INSTALLED",
    "AUDITD_RUNNING",
    "AUDITCTL_RULES:-w /etc/passwd -p wa -k identity",
    "AUDITCTL_RULES:-w /etc/sudoers -p wa -k sudoers",
    "LOG_FORWARDING_ACTIVE:rsyslog",
    "LAST_AVAILABLE",
    "LASTB_AVAILABLE",
    "WTMP_ROTATION_CONFIGURED",
  ].join("\n");

  const badOutput = [
    "AUDITD_NOT_INSTALLED",
    "AUDITD_NOT_RUNNING",
    "AUDITCTL_UNAVAIL",
    "LOG_FORWARDING_INACTIVE",
    "LAST_NOT_AVAILABLE",
    "LASTB_NOT_AVAILABLE",
    "WTMP_ROTATION_NOT_CONFIGURED",
  ].join("\n");

  describe("N/A handling", () => {
    it("returns checks with passed=false and currentValue='Unable to determine' for N/A input", () => {
      const checks = parseIncidentReadyChecks("N/A", "bare");
      checks.forEach((c) => {
        expect(c.passed).toBe(false);
        expect(c.currentValue).toBe("Unable to determine");
      });
    });

    it("returns checks with passed=false for empty string input", () => {
      const checks = parseIncidentReadyChecks("", "bare");
      checks.forEach((c) => {
        expect(c.passed).toBe(false);
      });
    });
  });

  describe("check count and shape", () => {
    it("returns at least 6 checks", () => {
      const checks = parseIncidentReadyChecks(validOutput, "bare");
      expect(checks.length).toBeGreaterThanOrEqual(6);
    });

    it("all check IDs start with INCIDENT-", () => {
      const checks = parseIncidentReadyChecks("", "bare");
      checks.forEach((c) => expect(c.id).toMatch(/^INCIDENT-/));
    });

    it("all checks have explain.length > 20", () => {
      const checks = parseIncidentReadyChecks("", "bare");
      checks.forEach((c) => expect((c.explain ?? "").length).toBeGreaterThan(20));
    });

    it("all checks have fixCommand defined", () => {
      const checks = parseIncidentReadyChecks("", "bare");
      checks.forEach((c) => expect(c.fixCommand).toBeDefined());
    });

    it("category is 'Incident Readiness' on all checks", () => {
      const checks = parseIncidentReadyChecks(validOutput, "bare");
      checks.forEach((c) => expect(c.category).toBe("Incident Readiness"));
    });
  });

  describe("severity budget", () => {
    it("has at most 40% critical severity checks", () => {
      const checks = parseIncidentReadyChecks(validOutput, "bare");
      const criticalCount = checks.filter((c) => c.severity === "critical").length;
      expect(criticalCount / checks.length).toBeLessThanOrEqual(0.4);
    });
  });

  describe("INCIDENT-AUDITD-INSTALLED", () => {
    it("passes when AUDITD_INSTALLED is present", () => {
      const checks = parseIncidentReadyChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "INCIDENT-AUDITD-INSTALLED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when AUDITD_NOT_INSTALLED is present", () => {
      const checks = parseIncidentReadyChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "INCIDENT-AUDITD-INSTALLED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("INCIDENT-AUDITD-RUNNING", () => {
    it("passes when AUDITD_RUNNING is present", () => {
      const checks = parseIncidentReadyChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "INCIDENT-AUDITD-RUNNING");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when AUDITD_NOT_RUNNING is present", () => {
      const checks = parseIncidentReadyChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "INCIDENT-AUDITD-RUNNING");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("INCIDENT-AUDITD-PASSWD-RULE", () => {
    it("passes when audit rule for /etc/passwd exists", () => {
      const checks = parseIncidentReadyChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "INCIDENT-AUDITD-PASSWD-RULE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when AUDITCTL_UNAVAIL is present", () => {
      const checks = parseIncidentReadyChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "INCIDENT-AUDITD-PASSWD-RULE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });

    it("fails when no /etc/passwd rule in auditctl output", () => {
      const output = "AUDITD_INSTALLED\nAUDITD_RUNNING\nAUDITCTL_RULES:-w /etc/sudoers -p wa";
      const checks = parseIncidentReadyChecks(output, "bare");
      const check = checks.find((c) => c.id === "INCIDENT-AUDITD-PASSWD-RULE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("INCIDENT-AUDITD-SUDO-RULE", () => {
    it("passes when audit rule for sudoers exists", () => {
      const checks = parseIncidentReadyChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "INCIDENT-AUDITD-SUDO-RULE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when no sudo audit rule present", () => {
      const output = "AUDITD_INSTALLED\nAUDITD_RUNNING\nAUDITCTL_RULES:-w /etc/passwd -p wa";
      const checks = parseIncidentReadyChecks(output, "bare");
      const check = checks.find((c) => c.id === "INCIDENT-AUDITD-SUDO-RULE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("INCIDENT-LOG-FORWARDING", () => {
    it("passes when a log forwarding service is active", () => {
      const checks = parseIncidentReadyChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "INCIDENT-LOG-FORWARDING");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when LOG_FORWARDING_INACTIVE is present", () => {
      const checks = parseIncidentReadyChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "INCIDENT-LOG-FORWARDING");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("INCIDENT-LAST-ACCESSIBLE", () => {
    it("passes when LAST_AVAILABLE is present", () => {
      const checks = parseIncidentReadyChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "INCIDENT-LAST-ACCESSIBLE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when LAST_NOT_AVAILABLE is present", () => {
      const checks = parseIncidentReadyChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "INCIDENT-LAST-ACCESSIBLE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("INCIDENT-LASTB-ACCESSIBLE", () => {
    it("passes when LASTB_AVAILABLE is present", () => {
      const checks = parseIncidentReadyChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "INCIDENT-LASTB-ACCESSIBLE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when LASTB_NOT_AVAILABLE is present", () => {
      const checks = parseIncidentReadyChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "INCIDENT-LASTB-ACCESSIBLE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("INCIDENT-WTMP-ROTATION", () => {
    it("passes when wtmp rotation is configured", () => {
      const checks = parseIncidentReadyChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "INCIDENT-WTMP-ROTATION");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when wtmp rotation is not configured", () => {
      const checks = parseIncidentReadyChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "INCIDENT-WTMP-ROTATION");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });
});
