import { parseAccountsChecks } from "../../src/core/audit/checks/accounts.js";

describe("parseAccountsChecks", () => {
  const validOutput = [
    // /etc/passwd data (user:uid:shell)
    "root:0:/bin/bash",
    "daemon:1:/usr/sbin/nologin",
    "bin:2:/usr/sbin/nologin",
    "sys:3:/usr/sbin/nologin",
    "nobody:65534:/usr/sbin/nologin",
    "admin:1000:/bin/bash",
    // /etc/shadow data (user:hash)
    "root:$6$abc::",
    "daemon:*::",
    "admin:$6$xyz::",
    // Home dir ownership
    "/home/admin admin",
    // Dangerous files
    "NONE",
    // System accounts with shells
    "sync:/bin/sync",
    // Total user count (standalone number > 5, must come before "700" to avoid false match)
    "25",
    // Root home perms
    "700",
    // login.defs
    "PASS_MAX_DAYS 365",
    "PASS_MIN_DAYS 1",
    "UMASK 027",
    // Duplicate UIDs
    "NONE",
    // lastlog output (no inactive accounts — N/A means not available)
    "N/A",
    // Home directory permissions (not world-writable)
    "750 /home/admin",
  ].join("\n");

  const insecureOutput = [
    // Extra UID 0 account
    "root:0:/bin/bash",
    "backdoor:0:/bin/bash",
    "admin:1000:/bin/bash",
    // Shadow with empty password
    "root:$6$abc::",
    "testuser:::",
    // Home dir mismatch
    "/home/admin root",
    // Dangerous files present
    "-rw-r--r-- 1 root root 0 .rhosts",
    "-rw-r--r-- 1 root root 0 .netrc",
    "-rw-r--r-- 1 root root 0 hosts.equiv",
    // System account with bash
    "games:/bin/bash",
    // Root home world-readable
    "755",
    // Weak password policy
    "PASS_MAX_DAYS 99999",
    "PASS_MIN_DAYS 0",
    "UMASK 022",
    // Duplicate UIDs
    "dup1:1000",
    "dup2:1000",
  ].join("\n");

  it("should return 19 checks for the Accounts category", () => {
    const checks = parseAccountsChecks(validOutput, "bare");
    expect(checks).toHaveLength(19);
    checks.forEach((c) => expect(c.category).toBe("Accounts"));
  });

  it("all check IDs should start with ACCT-", () => {
    const checks = parseAccountsChecks(validOutput, "bare");
    checks.forEach((c) => expect(c.id).toMatch(/^ACCT-/));
  });

  it("all checks should have explain > 20 chars and fixCommand defined", () => {
    const checks = parseAccountsChecks(validOutput, "bare");
    checks.forEach((c) => {
      expect(c.explain!.length).toBeGreaterThan(20);
      expect(c.fixCommand).toBeDefined();
      expect(c.fixCommand!.length).toBeGreaterThan(0);
    });
  });

  it("ACCT-NO-EXTRA-UID0 passes when only root has UID 0", () => {
    const checks = parseAccountsChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === "ACCT-NO-EXTRA-UID0");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("ACCT-NO-EXTRA-UID0 fails when extra UID 0 exists", () => {
    const checks = parseAccountsChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === "ACCT-NO-EXTRA-UID0");
    expect(check!.passed).toBe(false);
  });

  it("ACCT-NO-EMPTY-PASSWORD fails when empty password hash found", () => {
    const checks = parseAccountsChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === "ACCT-NO-EMPTY-PASSWORD");
    expect(check!.passed).toBe(false);
  });

  it("ACCT-NO-RHOSTS passes when no .rhosts found", () => {
    const checks = parseAccountsChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === "ACCT-NO-RHOSTS");
    expect(check!.passed).toBe(true);
  });

  it("ACCT-NO-RHOSTS fails when .rhosts present", () => {
    const checks = parseAccountsChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === "ACCT-NO-RHOSTS");
    expect(check!.passed).toBe(false);
  });

  it("ACCT-SYSTEM-SHELL passes when system accounts use nologin", () => {
    const checks = parseAccountsChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === "ACCT-SYSTEM-SHELL");
    expect(check!.passed).toBe(true);
  });

  it("ACCT-SYSTEM-SHELL fails when system account has /bin/bash", () => {
    const checks = parseAccountsChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === "ACCT-SYSTEM-SHELL");
    expect(check!.passed).toBe(false);
  });

  it("ACCT-MAX-PASSWORD-DAYS fails when set to 99999", () => {
    const checks = parseAccountsChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === "ACCT-MAX-PASSWORD-DAYS");
    expect(check!.passed).toBe(false);
  });

  it("should handle N/A output gracefully", () => {
    const checks = parseAccountsChecks("N/A", "bare");
    expect(checks).toHaveLength(19);
    checks.forEach((c) => {
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });
  });

  it("should handle empty string output gracefully", () => {
    const checks = parseAccountsChecks("", "bare");
    expect(checks).toHaveLength(19);
    checks.forEach((c) => expect(c.passed).toBe(false));
  });

  it("ACCT-TOTAL-USERS-REASONABLE passes when user count is a number > 5 and < 50", () => {
    const checks = parseAccountsChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === "ACCT-TOTAL-USERS-REASONABLE");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("ACCT-NO-WORLD-WRITABLE-HOME passes when no world-writable home dirs", () => {
    const checks = parseAccountsChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === "ACCT-NO-WORLD-WRITABLE-HOME");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("severity budget: <= 40% critical checks", () => {
    const checks = parseAccountsChecks("", "bare");
    const criticalCount = checks.filter((c) => c.severity === "critical").length;
    const ratio = criticalCount / checks.length;
    expect(ratio).toBeLessThanOrEqual(0.4);
  });
});
