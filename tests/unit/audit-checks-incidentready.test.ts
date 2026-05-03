import { CHECK_IDS } from "../../src/core/audit/checkIds.js";
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
    "-rw-rw-r-- 1 root utmp 12345 Mar 15 10:00 /var/log/wtmp",
    "-rw-r----- 1 root utmp  6789 Mar 15 10:00 /var/log/btmp",
    "/usr/bin/dc3dd",
    "5",
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
    it("returns at least 12 checks", () => {
      const checks = parseIncidentReadyChecks(validOutput, "bare");
      expect(checks.length).toBeGreaterThanOrEqual(12);
    });

    it("all check IDs start with INCIDENT- or INCID-", () => {
      const checks = parseIncidentReadyChecks("", "bare");
      checks.forEach((c) => expect(c.id).toMatch(/^(INCIDENT|INCID)-/));
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

  describe("INCID-WTMP-EXISTS", () => {
    it("passes when /var/log/wtmp is present in ls output", () => {
      const checks = parseIncidentReadyChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "INCID-WTMP-EXISTS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when /var/log/wtmp not present in output", () => {
      const checks = parseIncidentReadyChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "INCID-WTMP-EXISTS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("INCID-BTMP-EXISTS", () => {
    it("passes when /var/log/btmp is present in ls output", () => {
      const checks = parseIncidentReadyChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "INCID-BTMP-EXISTS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when /var/log/btmp not present in output", () => {
      const checks = parseIncidentReadyChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "INCID-BTMP-EXISTS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("INCID-FORENSIC-TOOLS", () => {
    it("passes when a forensic tool path is in output", () => {
      const checks = parseIncidentReadyChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "INCID-FORENSIC-TOOLS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toContain("dc3dd");
    });

    it("fails when NONE sentinel is present", () => {
      const checks = parseIncidentReadyChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "INCID-FORENSIC-TOOLS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("INCID-LOG-ARCHIVE-EXISTS", () => {
    it("passes when archived log count > 0", () => {
      const checks = parseIncidentReadyChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "INCID-LOG-ARCHIVE-EXISTS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when archived log count is 0", () => {
      const noArchiveOutput = badOutput + "\n0";
      const checks = parseIncidentReadyChecks(noArchiveOutput, "bare");
      const check = checks.find((c) => c.id === "INCID-LOG-ARCHIVE-EXISTS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });
});

describe("[MUTATION-KILLER] IncidentReady check string assertions", () => {
  const validOutput = [
    "AUDITD_INSTALLED",
    "AUDITD_RUNNING",
    "AUDITCTL_RULES:-w /etc/passwd -p wa -k identity",
    "AUDITCTL_RULES:-w /etc/sudoers -p wa -k sudoers",
    "LOG_FORWARDING_ACTIVE:rsyslog",
    "LAST_AVAILABLE",
    "LASTB_AVAILABLE",
    "WTMP_ROTATION_CONFIGURED",
    "-rw-rw-r-- 1 root utmp 12345 Mar 15 10:00 /var/log/wtmp",
    "-rw-r----- 1 root utmp  6789 Mar 15 10:00 /var/log/btmp",
    "/usr/bin/dc3dd",
    "5",
  ].join("\n");

  let checks: ReturnType<typeof parseIncidentReadyChecks>;

  beforeAll(() => {
    checks = parseIncidentReadyChecks(validOutput, "bare");
  });

  it("[MUTATION-KILLER] returns exactly 12 checks", () => {
    expect(checks).toHaveLength(12);
  });

  describe("[MUTATION-KILLER] Check IDs exact order", () => {
    it("returns all 12 check IDs in exact order", () => {
      const ids = checks.map((c) => c.id);
      expect(ids).toEqual([
        "INCIDENT-AUDITD-INSTALLED",
        "INCIDENT-AUDITD-RUNNING",
        "INCIDENT-AUDITD-PASSWD-RULE",
        "INCIDENT-AUDITD-SUDO-RULE",
        "INCIDENT-LOG-FORWARDING",
        "INCIDENT-LAST-ACCESSIBLE",
        "INCIDENT-LASTB-ACCESSIBLE",
        "INCIDENT-WTMP-ROTATION",
        "INCID-WTMP-EXISTS",
        "INCID-BTMP-EXISTS",
        "INCID-FORENSIC-TOOLS",
        "INCID-LOG-ARCHIVE-EXISTS",
      ]);
    });
  });

  describe("[MUTATION-KILLER] INCIDENT-AUDITD-INSTALLED metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "INCIDENT-AUDITD-INSTALLED")!;
      expect(c.id).toBe("INCIDENT-AUDITD-INSTALLED");
      expect(c.name).toBe("auditd Package Installed");
      expect(c.severity).toBe("warning");
      expect(c.category).toBe("Incident Readiness");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "INCIDENT-AUDITD-INSTALLED")!;
      expect(c.expectedValue).toBe("auditd package is installed on the system");
    });

    it("fixCommand contains apt-get install and auditd", () => {
      const c = checks.find((c) => c.id === "INCIDENT-AUDITD-INSTALLED")!;
      expect(c.fixCommand).toContain("apt-get install");
      expect(c.fixCommand).toContain("auditd");
    });

    it("explain mentions Linux Audit daemon and forensic investigation", () => {
      const c = checks.find((c) => c.id === "INCIDENT-AUDITD-INSTALLED")!;
      expect(c.explain).toContain("Linux Audit daemon");
      expect(c.explain).toContain("forensic investigation");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = checks.find((c) => c.id === "INCIDENT-AUDITD-INSTALLED")!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] INCIDENT-AUDITD-RUNNING metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "INCIDENT-AUDITD-RUNNING")!;
      expect(c.id).toBe("INCIDENT-AUDITD-RUNNING");
      expect(c.name).toBe("auditd Service Running");
      expect(c.severity).toBe("warning");
      expect(c.category).toBe("Incident Readiness");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "INCIDENT-AUDITD-RUNNING")!;
      expect(c.expectedValue).toBe("auditd service is active (running)");
    });

    it("fixCommand contains systemctl enable", () => {
      const c = checks.find((c) => c.id === "INCIDENT-AUDITD-RUNNING")!;
      expect(c.fixCommand).toContain("systemctl enable");
      expect(c.fixCommand).toContain("auditd");
    });

    it("explain mentions active and audit events", () => {
      const c = checks.find((c) => c.id === "INCIDENT-AUDITD-RUNNING")!;
      expect(c.explain).toContain("active");
      expect(c.explain).toContain("audit events");
    });

    it("safeToAutoFix is GUARDED", () => {
      const c = checks.find((c) => c.id === "INCIDENT-AUDITD-RUNNING")!;
      expect(c.safeToAutoFix).toBe("GUARDED");
    });
  });

  describe("[MUTATION-KILLER] INCIDENT-AUDITD-PASSWD-RULE metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "INCIDENT-AUDITD-PASSWD-RULE")!;
      expect(c.id).toBe("INCIDENT-AUDITD-PASSWD-RULE");
      expect(c.name).toBe("Audit Rule for /etc/passwd");
      expect(c.severity).toBe("warning");
      expect(c.category).toBe("Incident Readiness");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "INCIDENT-AUDITD-PASSWD-RULE")!;
      expect(c.expectedValue).toBe("auditctl -l shows -w /etc/passwd rule");
    });

    it("fixCommand contains auditctl and /etc/passwd", () => {
      const c = checks.find((c) => c.id === "INCIDENT-AUDITD-PASSWD-RULE")!;
      expect(c.fixCommand).toContain("auditctl -w /etc/passwd");
      expect(c.fixCommand).toContain("kastell.rules");
    });

    it("explain mentions backdoor accounts and audit evidence", () => {
      const c = checks.find((c) => c.id === "INCIDENT-AUDITD-PASSWD-RULE")!;
      expect(c.explain).toContain("backdoor accounts");
      expect(c.explain).toContain("audit evidence");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = checks.find((c) => c.id === "INCIDENT-AUDITD-PASSWD-RULE")!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] INCIDENT-AUDITD-SUDO-RULE metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "INCIDENT-AUDITD-SUDO-RULE")!;
      expect(c.id).toBe("INCIDENT-AUDITD-SUDO-RULE");
      expect(c.name).toBe("Audit Rule for sudo/sudoers");
      expect(c.severity).toBe("info");
      expect(c.category).toBe("Incident Readiness");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "INCIDENT-AUDITD-SUDO-RULE")!;
      expect(c.expectedValue).toBe("auditctl -l shows rule for /etc/sudoers or /var/log/sudo.log");
    });

    it("fixCommand contains auditctl and /etc/sudoers", () => {
      const c = checks.find((c) => c.id === "INCIDENT-AUDITD-SUDO-RULE")!;
      expect(c.fixCommand).toContain("auditctl -w /etc/sudoers");
      expect(c.fixCommand).toContain("kastell.rules");
    });

    it("explain mentions privilege escalation and audit trail", () => {
      const c = checks.find((c) => c.id === "INCIDENT-AUDITD-SUDO-RULE")!;
      expect(c.explain).toContain("privilege escalation");
      expect(c.explain).toContain("audit trail");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = checks.find((c) => c.id === "INCIDENT-AUDITD-SUDO-RULE")!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] INCIDENT-LOG-FORWARDING metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "INCIDENT-LOG-FORWARDING")!;
      expect(c.id).toBe("INCIDENT-LOG-FORWARDING");
      expect(c.name).toBe("Log Forwarding Service Active");
      expect(c.severity).toBe("info");
      expect(c.category).toBe("Incident Readiness");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "INCIDENT-LOG-FORWARDING")!;
      expect(c.expectedValue).toBe("At least one of rsyslog, vector, fluent-bit, or promtail is active");
    });

    it("fixCommand contains rsyslog and systemctl", () => {
      const c = checks.find((c) => c.id === "INCIDENT-LOG-FORWARDING")!;
      expect(c.fixCommand).toContain("rsyslog");
      expect(c.fixCommand).toContain("systemctl enable");
    });

    it("explain mentions remote SIEM and evidence", () => {
      const c = checks.find((c) => c.id === "INCIDENT-LOG-FORWARDING")!;
      expect(c.explain).toContain("remote SIEM");
      expect(c.explain).toContain("evidence");
    });

    it("safeToAutoFix is GUARDED", () => {
      const c = checks.find((c) => c.id === "INCIDENT-LOG-FORWARDING")!;
      expect(c.safeToAutoFix).toBe("GUARDED");
    });
  });

  describe("[MUTATION-KILLER] INCIDENT-LAST-ACCESSIBLE metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "INCIDENT-LAST-ACCESSIBLE")!;
      expect(c.id).toBe("INCIDENT-LAST-ACCESSIBLE");
      expect(c.name).toBe("Login History Accessible (last/wtmp)");
      expect(c.severity).toBe("info");
      expect(c.category).toBe("Incident Readiness");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "INCIDENT-LAST-ACCESSIBLE")!;
      expect(c.expectedValue).toBe("last command returns login history (wtmp is readable and intact)");
    });

    it("fixCommand contains wtmp and chmod", () => {
      const c = checks.find((c) => c.id === "INCIDENT-LAST-ACCESSIBLE")!;
      expect(c.fixCommand).toContain("/var/log/wtmp");
      expect(c.fixCommand).toContain("chmod 664");
    });

    it("explain mentions login and forensics", () => {
      const c = checks.find((c) => c.id === "INCIDENT-LAST-ACCESSIBLE")!;
      expect(c.explain).toContain("login");
      expect(c.explain).toContain("forensics");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = checks.find((c) => c.id === "INCIDENT-LAST-ACCESSIBLE")!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] INCIDENT-LASTB-ACCESSIBLE metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "INCIDENT-LASTB-ACCESSIBLE")!;
      expect(c.id).toBe("INCIDENT-LASTB-ACCESSIBLE");
      expect(c.name).toBe("Failed Login History Accessible (lastb/btmp)");
      expect(c.severity).toBe("info");
      expect(c.category).toBe("Incident Readiness");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "INCIDENT-LASTB-ACCESSIBLE")!;
      expect(c.expectedValue).toBe("lastb command returns failed login history (btmp is readable)");
    });

    it("fixCommand contains btmp and chmod 600", () => {
      const c = checks.find((c) => c.id === "INCIDENT-LASTB-ACCESSIBLE")!;
      expect(c.fixCommand).toContain("/var/log/btmp");
      expect(c.fixCommand).toContain("chmod 600");
    });

    it("explain mentions brute force and credential stuffing", () => {
      const c = checks.find((c) => c.id === "INCIDENT-LASTB-ACCESSIBLE")!;
      expect(c.explain).toContain("brute force");
      expect(c.explain).toContain("credential stuffing");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = checks.find((c) => c.id === "INCIDENT-LASTB-ACCESSIBLE")!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] INCIDENT-WTMP-ROTATION metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "INCIDENT-WTMP-ROTATION")!;
      expect(c.id).toBe("INCIDENT-WTMP-ROTATION");
      expect(c.name).toBe("wtmp/btmp Log Rotation Configured");
      expect(c.severity).toBe("info");
      expect(c.category).toBe("Incident Readiness");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "INCIDENT-WTMP-ROTATION")!;
      expect(c.expectedValue).toBe("logrotate configuration for wtmp and btmp exists");
    });

    it("fixCommand mentions logrotate and monthly rotation", () => {
      const c = checks.find((c) => c.id === "INCIDENT-WTMP-ROTATION")!;
      expect(c.fixCommand).toContain("logrotate");
      expect(c.fixCommand).toContain("monthly rotation");
    });

    it("explain mentions unbounded growth and incident investigation", () => {
      const c = checks.find((c) => c.id === "INCIDENT-WTMP-ROTATION")!;
      expect(c.explain).toContain("unbounded growth");
      expect(c.explain).toContain("incident investigation");
    });

    it("safeToAutoFix is GUARDED", () => {
      const c = checks.find((c) => c.id === "INCIDENT-WTMP-ROTATION")!;
      expect(c.safeToAutoFix).toBe("GUARDED");
    });
  });

  describe("[MUTATION-KILLER] INCID-WTMP-EXISTS metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "INCID-WTMP-EXISTS")!;
      expect(c.id).toBe("INCID-WTMP-EXISTS");
      expect(c.name).toBe("wtmp Login Record File Exists");
      expect(c.severity).toBe("warning");
      expect(c.category).toBe("Incident Readiness");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "INCID-WTMP-EXISTS")!;
      expect(c.expectedValue).toBe("/var/log/wtmp file exists");
    });

    it("fixCommand contains touch and /var/log/wtmp", () => {
      const c = checks.find((c) => c.id === "INCID-WTMP-EXISTS")!;
      expect(c.fixCommand).toContain("touch /var/log/wtmp");
      expect(c.fixCommand).toContain("chmod 664");
    });

    it("explain mentions login/logout events and forensic analysis", () => {
      const c = checks.find((c) => c.id === "INCID-WTMP-EXISTS")!;
      expect(c.explain).toContain("login/logout");
      expect(c.explain).toContain("forensic analysis");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = checks.find((c) => c.id === "INCID-WTMP-EXISTS")!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] INCID-BTMP-EXISTS metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "INCID-BTMP-EXISTS")!;
      expect(c.id).toBe("INCID-BTMP-EXISTS");
      expect(c.name).toBe("btmp Failed Login Record File Exists");
      expect(c.severity).toBe("warning");
      expect(c.category).toBe("Incident Readiness");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "INCID-BTMP-EXISTS")!;
      expect(c.expectedValue).toBe("/var/log/btmp file exists");
    });

    it("fixCommand contains touch and /var/log/btmp", () => {
      const c = checks.find((c) => c.id === "INCID-BTMP-EXISTS")!;
      expect(c.fixCommand).toContain("touch /var/log/btmp");
      expect(c.fixCommand).toContain("chmod 600");
    });

    it("explain mentions brute-force and failed login", () => {
      const c = checks.find((c) => c.id === "INCID-BTMP-EXISTS")!;
      expect(c.explain).toContain("brute-force");
      expect(c.explain).toContain("failed login");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = checks.find((c) => c.id === "INCID-BTMP-EXISTS")!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] INCID-FORENSIC-TOOLS metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "INCID-FORENSIC-TOOLS")!;
      expect(c.id).toBe("INCID-FORENSIC-TOOLS");
      expect(c.name).toBe("Forensic Tools Pre-installed");
      expect(c.severity).toBe("info");
      expect(c.category).toBe("Incident Readiness");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "INCID-FORENSIC-TOOLS")!;
      expect(c.expectedValue).toBe("At least one forensic tool (volatility3, dc3dd) is installed");
    });

    it("fixCommand contains sleuthkit", () => {
      const c = checks.find((c) => c.id === "INCID-FORENSIC-TOOLS")!;
      expect(c.fixCommand).toContain("sleuthkit");
      expect(c.fixCommand).toContain("apt install");
    });

    it("explain mentions rapid incident response and contaminating", () => {
      const c = checks.find((c) => c.id === "INCID-FORENSIC-TOOLS")!;
      expect(c.explain).toContain("rapid incident response");
      expect(c.explain).toContain("contaminating");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = checks.find((c) => c.id === "INCID-FORENSIC-TOOLS")!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] INCID-LOG-ARCHIVE-EXISTS metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "INCID-LOG-ARCHIVE-EXISTS")!;
      expect(c.id).toBe("INCID-LOG-ARCHIVE-EXISTS");
      expect(c.name).toBe("Recent Archived Log Files Present");
      expect(c.severity).toBe("info");
      expect(c.category).toBe("Incident Readiness");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "INCID-LOG-ARCHIVE-EXISTS")!;
      expect(c.expectedValue).toBe("At least 1 recently archived log file in /var/log");
    });

    it("fixCommand contains logrotate", () => {
      const c = checks.find((c) => c.id === "INCID-LOG-ARCHIVE-EXISTS")!;
      expect(c.fixCommand).toContain("logrotate");
      expect(c.fixCommand).toContain("verify log rotation");
    });

    it("explain mentions evidence tampering and log rotation failure", () => {
      const c = checks.find((c) => c.id === "INCID-LOG-ARCHIVE-EXISTS")!;
      expect(c.explain).toContain("evidence");
      expect(c.explain).toContain("log rotation failure");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = checks.find((c) => c.id === "INCID-LOG-ARCHIVE-EXISTS")!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] N/A output preserves all metadata strings", () => {
    it("all 12 checks preserve id, name, severity, category, expectedValue, fixCommand, explain on N/A", () => {
      const naChecks = parseIncidentReadyChecks("N/A", "bare");
      const normalChecks = parseIncidentReadyChecks(validOutput, "bare");
      expect(naChecks).toHaveLength(12);
      for (let i = 0; i < naChecks.length; i++) {
        expect(naChecks[i].id).toBe(normalChecks[i].id);
        expect(naChecks[i].name).toBe(normalChecks[i].name);
        expect(naChecks[i].severity).toBe(normalChecks[i].severity);
        expect(naChecks[i].category).toBe(normalChecks[i].category);
        expect(naChecks[i].expectedValue).toBe(normalChecks[i].expectedValue);
        expect(naChecks[i].fixCommand).toBe(normalChecks[i].fixCommand);
        expect(naChecks[i].explain).toBe(normalChecks[i].explain);
        expect(naChecks[i].safeToAutoFix).toBe(normalChecks[i].safeToAutoFix);
      }
    });
  });

  describe("[MUTATION-KILLER] currentValue strings on pass", () => {
    it("INCIDENT-AUDITD-INSTALLED currentValue on pass", () => {
      const c = checks.find((c) => c.id === "INCIDENT-AUDITD-INSTALLED")!;
      expect(c.currentValue).toBe("auditd is installed");
    });

    it("INCIDENT-AUDITD-RUNNING currentValue on pass", () => {
      const c = checks.find((c) => c.id === "INCIDENT-AUDITD-RUNNING")!;
      expect(c.currentValue).toBe("auditd service is active and running");
    });

    it("INCIDENT-AUDITD-PASSWD-RULE currentValue on pass", () => {
      const c = checks.find((c) => c.id === "INCIDENT-AUDITD-PASSWD-RULE")!;
      expect(c.currentValue).toBe("Audit rule for /etc/passwd exists");
    });

    it("INCIDENT-AUDITD-SUDO-RULE currentValue on pass", () => {
      const c = checks.find((c) => c.id === "INCIDENT-AUDITD-SUDO-RULE")!;
      expect(c.currentValue).toBe("Audit rule for sudo/sudoers exists");
    });

    it("INCIDENT-LOG-FORWARDING currentValue on pass includes service name", () => {
      const c = checks.find((c) => c.id === "INCIDENT-LOG-FORWARDING")!;
      expect(c.currentValue).toBe("Log forwarding active: rsyslog");
    });

    it("INCIDENT-LAST-ACCESSIBLE currentValue on pass", () => {
      const c = checks.find((c) => c.id === "INCIDENT-LAST-ACCESSIBLE")!;
      expect(c.currentValue).toBe("last command works — wtmp is accessible");
    });

    it("INCIDENT-LASTB-ACCESSIBLE currentValue on pass", () => {
      const c = checks.find((c) => c.id === "INCIDENT-LASTB-ACCESSIBLE")!;
      expect(c.currentValue).toBe("lastb output available — btmp is accessible");
    });

    it("INCIDENT-WTMP-ROTATION currentValue on pass", () => {
      const c = checks.find((c) => c.id === "INCIDENT-WTMP-ROTATION")!;
      expect(c.currentValue).toBe("wtmp/btmp rotation is configured via logrotate");
    });

    it("INCID-WTMP-EXISTS currentValue on pass", () => {
      const c = checks.find((c) => c.id === "INCID-WTMP-EXISTS")!;
      expect(c.currentValue).toBe("/var/log/wtmp exists (login records available)");
    });

    it("INCID-BTMP-EXISTS currentValue on pass", () => {
      const c = checks.find((c) => c.id === "INCID-BTMP-EXISTS")!;
      expect(c.currentValue).toBe("/var/log/btmp exists (failed login records available)");
    });

    it("INCID-LOG-ARCHIVE-EXISTS currentValue on pass", () => {
      const c = checks.find((c) => c.id === "INCID-LOG-ARCHIVE-EXISTS")!;
      expect(c.currentValue).toBe("5 recent archived log file(s) found");
    });
  });

  describe("[MUTATION-KILLER] currentValue strings on fail", () => {
    const badOutput = [
      "AUDITD_NOT_INSTALLED",
      "AUDITD_NOT_RUNNING",
      "AUDITCTL_UNAVAIL",
      "LOG_FORWARDING_INACTIVE",
      "LAST_NOT_AVAILABLE",
      "LASTB_NOT_AVAILABLE",
      "WTMP_ROTATION_NOT_CONFIGURED",
      "N/A",
      "NONE",
      "0",
    ].join("\n");

    let failChecks: ReturnType<typeof parseIncidentReadyChecks>;

    beforeAll(() => {
      failChecks = parseIncidentReadyChecks(badOutput, "bare");
    });

    it("INCIDENT-AUDITD-INSTALLED currentValue on fail", () => {
      const c = failChecks.find((c) => c.id === "INCIDENT-AUDITD-INSTALLED")!;
      expect(c.currentValue).toBe("auditd is not installed");
    });

    it("INCIDENT-AUDITD-RUNNING currentValue on fail", () => {
      const c = failChecks.find((c) => c.id === "INCIDENT-AUDITD-RUNNING")!;
      expect(c.currentValue).toBe("auditd service is not running");
    });

    it("INCIDENT-AUDITD-PASSWD-RULE currentValue on fail (unavail)", () => {
      const c = failChecks.find((c) => c.id === "INCIDENT-AUDITD-PASSWD-RULE")!;
      expect(c.currentValue).toBe("auditctl not available — cannot verify audit rules");
    });

    it("INCIDENT-AUDITD-SUDO-RULE currentValue on fail (unavail)", () => {
      const c = failChecks.find((c) => c.id === "INCIDENT-AUDITD-SUDO-RULE")!;
      expect(c.currentValue).toBe("auditctl not available — cannot verify audit rules");
    });

    it("INCIDENT-LOG-FORWARDING currentValue on fail", () => {
      const c = failChecks.find((c) => c.id === "INCIDENT-LOG-FORWARDING")!;
      expect(c.currentValue).toBe("No log forwarding service is active");
    });

    it("INCIDENT-LAST-ACCESSIBLE currentValue on fail", () => {
      const c = failChecks.find((c) => c.id === "INCIDENT-LAST-ACCESSIBLE")!;
      expect(c.currentValue).toBe("last command failed — wtmp not accessible or corrupted");
    });

    it("INCIDENT-LASTB-ACCESSIBLE currentValue on fail", () => {
      const c = failChecks.find((c) => c.id === "INCIDENT-LASTB-ACCESSIBLE")!;
      expect(c.currentValue).toBe("lastb output not available — btmp missing or permission denied");
    });

    it("INCIDENT-WTMP-ROTATION currentValue on fail", () => {
      const c = failChecks.find((c) => c.id === "INCIDENT-WTMP-ROTATION")!;
      expect(c.currentValue).toBe("wtmp/btmp rotation not configured in logrotate");
    });

    it("INCID-LOG-ARCHIVE-EXISTS currentValue on fail", () => {
      const c = failChecks.find((c) => c.id === "INCID-LOG-ARCHIVE-EXISTS")!;
      expect(c.currentValue).toBe("0 archived log files found");
    });
  });
});
