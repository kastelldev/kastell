import { CHECK_IDS } from "../../src/core/audit/checkIds.js";
import { parseFileIntegrityChecks } from "../../src/core/audit/checks/fileintegrity.js";

describe("parseFileIntegrityChecks", () => {
  // Simulates SSH batch output with AIDE and auditd fully configured
  const validOutput = [
    // dpkg -l aide
    "ii  aide  0.17.4-1  amd64  Advanced Intrusion Detection Environment",
    // dpkg -l tripwire
    "NOT_INSTALLED",
    // AIDE db exists
    "AIDE_DB_EXISTS",
    // AIDE cron
    "/etc/cron.daily/aide: 30 2 * * * root /usr/sbin/aide --check",
    // dpkg -l auditd
    "ii  auditd  1:3.0.7-1  amd64  User space tools for security auditing",
    // systemctl is-active auditd
    "active",
    // auditctl -l rules
    "-w /etc/passwd -p wa -k identity\n-w /etc/shadow -p wa -k identity\n-w /etc/sudoers -p wa -k identity",
  ].join("\n");

  const missingOutput = [
    // No AIDE
    "NOT_INSTALLED",
    // No tripwire
    "NOT_INSTALLED",
    // No AIDE db
    "AIDE_DB_MISSING",
    // No AIDE cron
    "NO_AIDE_CRON",
    // No auditd
    "NOT_INSTALLED",
    // auditd inactive
    "inactive",
    // No audit rules
    "NO_RULES",
  ].join("\n");

  it("should return 10+ checks for the File Integrity category", () => {
    const checks = parseFileIntegrityChecks(validOutput, "bare");
    expect(checks.length).toBeGreaterThanOrEqual(10);
    checks.forEach((c) => expect(c.category).toBe("File Integrity"));
  });

  it("all check IDs should start with FINT-", () => {
    const checks = parseFileIntegrityChecks(validOutput, "bare");
    checks.forEach((c) => expect(c.id).toMatch(/^FINT-/));
  });

  it("all checks should have explain > 20 chars and fixCommand defined", () => {
    const checks = parseFileIntegrityChecks(validOutput, "bare");
    checks.forEach((c) => {
      expect(c.explain!.length).toBeGreaterThan(20);
      expect(c.fixCommand).toBeDefined();
      expect(c.fixCommand!.length).toBeGreaterThan(0);
    });
  });

  it("severity budget: 0% critical", () => {
    const checks = parseFileIntegrityChecks("", "bare");
    const criticalCount = checks.filter((c) => c.severity === "critical").length;
    expect(criticalCount).toBe(0);
  });

  it("should handle N/A output gracefully", () => {
    const checks = parseFileIntegrityChecks("N/A", "bare");
    expect(checks.length).toBeGreaterThanOrEqual(10);
    checks.forEach((c) => {
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });
  });

  it("should handle empty string output gracefully", () => {
    const checks = parseFileIntegrityChecks("", "bare");
    expect(checks.length).toBeGreaterThanOrEqual(10);
    checks.forEach((c) => expect(c.passed).toBe(false));
  });

  it("FINT-AIDE-INSTALLED passes when 'ii  aide' found in dpkg output", () => {
    const checks = parseFileIntegrityChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.FILEINTEGRITY.FINT_AIDE_INSTALLED);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("FINT-AIDE-INSTALLED fails when NOT_INSTALLED", () => {
    const checks = parseFileIntegrityChecks(missingOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.FILEINTEGRITY.FINT_AIDE_INSTALLED);
    expect(check!.passed).toBe(false);
  });

  it("FINT-TRIPWIRE-INSTALLED fails when NOT_INSTALLED", () => {
    const checks = parseFileIntegrityChecks(missingOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.FILEINTEGRITY.FINT_TRIPWIRE_INSTALLED);
    expect(check!.passed).toBe(false);
  });

  it("FINT-AIDE-DB-EXISTS passes when AIDE_DB_EXISTS found", () => {
    const checks = parseFileIntegrityChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.FILEINTEGRITY.FINT_AIDE_DB_EXISTS);
    expect(check!.passed).toBe(true);
  });

  it("FINT-AIDE-DB-EXISTS fails when AIDE_DB_MISSING", () => {
    const checks = parseFileIntegrityChecks(missingOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.FILEINTEGRITY.FINT_AIDE_DB_EXISTS);
    expect(check!.passed).toBe(false);
  });

  it("FINT-AIDE-CRON passes when aide cron entry found", () => {
    const checks = parseFileIntegrityChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.FILEINTEGRITY.FINT_AIDE_CRON);
    expect(check!.passed).toBe(true);
  });

  it("FINT-AIDE-CRON fails when NO_AIDE_CRON", () => {
    const checks = parseFileIntegrityChecks(missingOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.FILEINTEGRITY.FINT_AIDE_CRON);
    expect(check!.passed).toBe(false);
  });

  it("FINT-AUDITD-INSTALLED passes when 'ii  auditd' found", () => {
    const checks = parseFileIntegrityChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.FILEINTEGRITY.FINT_AUDITD_INSTALLED);
    expect(check!.passed).toBe(true);
  });

  it("FINT-AUDITD-RUNNING passes when auditd active", () => {
    const checks = parseFileIntegrityChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.FILEINTEGRITY.FINT_AUDITD_RUNNING);
    expect(check!.passed).toBe(true);
  });

  it("FINT-AUDITD-RUNNING fails when inactive", () => {
    const checks = parseFileIntegrityChecks(missingOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.FILEINTEGRITY.FINT_AUDITD_RUNNING);
    expect(check!.passed).toBe(false);
  });

  it("FINT-AUDIT-PASSWD-RULE passes when /etc/passwd in auditctl output", () => {
    const checks = parseFileIntegrityChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.FILEINTEGRITY.FINT_AUDIT_PASSWD_RULE);
    expect(check!.passed).toBe(true);
  });

  it("FINT-AUDIT-SHADOW-RULE passes when /etc/shadow in auditctl output", () => {
    const checks = parseFileIntegrityChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.FILEINTEGRITY.FINT_AUDIT_SHADOW_RULE);
    expect(check!.passed).toBe(true);
  });

  it("FINT-AUDIT-SHADOW-RULE fails when NO_RULES", () => {
    const checks = parseFileIntegrityChecks(missingOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.FILEINTEGRITY.FINT_AUDIT_SHADOW_RULE);
    expect(check!.passed).toBe(false);
  });

  it("FINT-AIDE-DB-RECENT passes when no 10-digit epoch in output (AIDE not installed)", () => {
    const checks = parseFileIntegrityChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.FILEINTEGRITY.FINT_AIDE_DB_RECENT);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("FINT-AIDE-DB-RECENT passes when epoch is recent (< 30 days ago)", () => {
    const recentEpoch = Math.floor(Date.now() / 1000) - 86400; // 1 day ago
    const output = validOutput + `\n${recentEpoch}`;
    const checks = parseFileIntegrityChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.FILEINTEGRITY.FINT_AIDE_DB_RECENT);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("FINT-CRITICAL-FILE-MONITORING passes when audit rules for /etc/passwd found", () => {
    const checks = parseFileIntegrityChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.FILEINTEGRITY.FINT_CRITICAL_FILE_MONITORING);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("FINT-CRITICAL-FILE-MONITORING fails when NO_RULES", () => {
    const checks = parseFileIntegrityChecks(missingOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.FILEINTEGRITY.FINT_CRITICAL_FILE_MONITORING);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  describe("[MUTATION-KILLER] FileIntegrity check metadata", () => {
    const checks = parseFileIntegrityChecks(validOutput, "bare");

    const expectedMeta: Array<[string, string, string]> = [
      [CHECK_IDS.FILEINTEGRITY.FINT_AIDE_INSTALLED, "warning", "SAFE"],
      [CHECK_IDS.FILEINTEGRITY.FINT_TRIPWIRE_INSTALLED, "info", "SAFE"],
      [CHECK_IDS.FILEINTEGRITY.FINT_AIDE_DB_EXISTS, "warning", "SAFE"],
      [CHECK_IDS.FILEINTEGRITY.FINT_AIDE_CRON, "warning", "SAFE"],
      [CHECK_IDS.FILEINTEGRITY.FINT_AUDITD_INSTALLED, "warning", "SAFE"],
      [CHECK_IDS.FILEINTEGRITY.FINT_AUDITD_RUNNING, "warning", "SAFE"],
      [CHECK_IDS.FILEINTEGRITY.FINT_AUDIT_PASSWD_RULE, "warning", "SAFE"],
      [CHECK_IDS.FILEINTEGRITY.FINT_AUDIT_SHADOW_RULE, "warning", "SAFE"],
      [CHECK_IDS.FILEINTEGRITY.FINT_AIDE_DB_RECENT, "warning", "SAFE"],
      [CHECK_IDS.FILEINTEGRITY.FINT_CRITICAL_FILE_MONITORING, "warning", "SAFE"],
    ];

    it.each(expectedMeta)("[MUTATION-KILLER] %s has severity=%s, safeToAutoFix=%s", (id, severity, safe) => {
      const c = checks.find((c) => c.id === id);
      expect(c).toBeDefined();
      expect(c!.category).toBe("File Integrity");
      expect(c!.severity).toBe(severity);
      expect(c!.safeToAutoFix).toBe(safe);
    });

    it("[MUTATION-KILLER] every check has non-empty fixCommand and explain", () => {
      checks.forEach((c) => {
        expect(c.fixCommand).toBeDefined();
        expect(c.fixCommand!.length).toBeGreaterThan(0);
        expect(c.explain).toBeDefined();
        expect(c.explain!.length).toBeGreaterThan(10);
      });
    });

    it("[MUTATION-KILLER] all IDs start with FINT-", () => {
      checks.forEach((c) => expect(c.id).toMatch(/^FINT-/));
    });
  });
});
