import { CHECK_IDS } from "../../src/core/audit/checkIds.js";
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
    // login.defs UID/GID range (ACCT-LOGIN-DEFS-UID-MAX)
    "UID_MIN 1000",
    "UID_MAX 60000",
    "GID_MIN 1000",
    "GID_MAX 60000",
    // Login shell count (ACCT-LOGIN-SHELL-AUDIT) — standalone number <= 10
    "3",
    // Duplicate GIDs (ACCT-GID-CONSISTENCY) — NONE means clean
    "NONE",
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

  it("should return 22 checks for the Accounts category", () => {
    const checks = parseAccountsChecks(validOutput, "bare");
    expect(checks).toHaveLength(22);
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
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_EXTRA_UID0);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("ACCT-NO-EXTRA-UID0 fails when extra UID 0 exists", () => {
    const checks = parseAccountsChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_EXTRA_UID0);
    expect(check!.passed).toBe(false);
  });

  it("ACCT-NO-EMPTY-PASSWORD fails when empty password hash found", () => {
    const checks = parseAccountsChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_EMPTY_PASSWORD);
    expect(check!.passed).toBe(false);
  });

  it("ACCT-NO-RHOSTS passes when no .rhosts found", () => {
    const checks = parseAccountsChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_RHOSTS);
    expect(check!.passed).toBe(true);
  });

  it("ACCT-NO-RHOSTS fails when .rhosts present", () => {
    const checks = parseAccountsChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_RHOSTS);
    expect(check!.passed).toBe(false);
  });

  it("ACCT-SYSTEM-SHELL passes when system accounts use nologin", () => {
    const checks = parseAccountsChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_SYSTEM_SHELL);
    expect(check!.passed).toBe(true);
  });

  it("ACCT-SYSTEM-SHELL fails when system account has /bin/bash", () => {
    const checks = parseAccountsChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_SYSTEM_SHELL);
    expect(check!.passed).toBe(false);
  });

  it("ACCT-MAX-PASSWORD-DAYS fails when set to 99999", () => {
    const checks = parseAccountsChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_MAX_PASSWORD_DAYS);
    expect(check!.passed).toBe(false);
  });

  it("should handle N/A output gracefully", () => {
    const checks = parseAccountsChecks("N/A", "bare");
    expect(checks).toHaveLength(22);
    checks.forEach((c) => {
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });
  });

  it("should handle empty string output gracefully", () => {
    const checks = parseAccountsChecks("", "bare");
    expect(checks).toHaveLength(22);
    checks.forEach((c) => expect(c.passed).toBe(false));
  });

  it("ACCT-TOTAL-USERS-REASONABLE passes when user count is a number > 5 and < 50", () => {
    const checks = parseAccountsChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_TOTAL_USERS_REASONABLE);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("ACCT-NO-WORLD-WRITABLE-HOME passes when no world-writable home dirs", () => {
    const checks = parseAccountsChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_WORLD_WRITABLE_HOME);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("severity budget: <= 40% critical checks", () => {
    const checks = parseAccountsChecks("", "bare");
    const criticalCount = checks.filter((c) => c.severity === "critical").length;
    const ratio = criticalCount / checks.length;
    expect(ratio).toBeLessThanOrEqual(0.4);
  });

  it("ACCT-LOGIN-DEFS-UID-MAX passes when UID_MIN >= 1000 and UID_MAX >= 60000", () => {
    const checks = parseAccountsChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_LOGIN_DEFS_UID_MAX);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toMatch(/UID_MIN=1000/);
  });

  it("ACCT-LOGIN-DEFS-UID-MAX fails when UID_MIN < 1000", () => {
    const output = validOutput.replace("UID_MIN 1000", "UID_MIN 500");
    const checks = parseAccountsChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_LOGIN_DEFS_UID_MAX);
    expect(check!.passed).toBe(false);
  });

  it("ACCT-LOGIN-SHELL-AUDIT passes when login shell count <= 10", () => {
    const checks = parseAccountsChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_LOGIN_SHELL_AUDIT);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toMatch(/3 accounts/);
  });

  it("ACCT-LOGIN-SHELL-AUDIT fails when login shell count > 10", () => {
    const output = validOutput.replace("\n3\n", "\n15\n");
    const checks = parseAccountsChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_LOGIN_SHELL_AUDIT);
    expect(check!.passed).toBe(false);
  });

  it("ACCT-GID-CONSISTENCY passes when duplicate GID check returns NONE", () => {
    const checks = parseAccountsChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_GID_CONSISTENCY);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("ACCT-GID-CONSISTENCY fails when duplicate GIDs found", () => {
    // Use a minimal output without any NONE sentinel but with duplicate GID numbers
    const output = "root:0:/bin/bash\nadmin:1000:/bin/bash\nroot:$6$abc::\n/home/admin admin\n25\n700\nPASS_MAX_DAYS 90\nPASS_MIN_DAYS 1\n1000\n1001";
    const checks = parseAccountsChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_GID_CONSISTENCY);
    expect(check!.passed).toBe(false);
  });

  // --- Branch coverage: ACCT-NO-EMPTY-PASSWORD pass case ---
  it("ACCT-NO-EMPTY-PASSWORD passes when all accounts have password hashes", () => {
    const checks = parseAccountsChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_EMPTY_PASSWORD);
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toBe("No empty password hashes");
  });

  it("ACCT-NO-EMPTY-PASSWORD currentValue lists users with empty passwords", () => {
    const checks = parseAccountsChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_EMPTY_PASSWORD);
    expect(check!.currentValue).toMatch(/Empty password: testuser/);
  });

  // --- Branch coverage: ACCT-HOSTS-EQUIV (not tested at all) ---
  it("ACCT-HOSTS-EQUIV passes when no hosts.equiv present", () => {
    const checks = parseAccountsChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_HOSTS_EQUIV);
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toBe("No hosts.equiv file");
  });

  it("ACCT-HOSTS-EQUIV fails when hosts.equiv file is found", () => {
    const checks = parseAccountsChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_HOSTS_EQUIV);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toBe("/etc/hosts.equiv found");
  });

  // --- Branch coverage: ACCT-NO-NETRC ---
  it("ACCT-NO-NETRC passes when no .netrc present", () => {
    const checks = parseAccountsChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_NETRC);
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toBe("No .netrc files");
  });

  it("ACCT-NO-NETRC fails when .netrc present", () => {
    const checks = parseAccountsChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_NETRC);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toBe(".netrc file found");
  });

  // --- Branch coverage: ACCT-NO-FORWARD ---
  it("ACCT-NO-FORWARD passes when no .forward present", () => {
    const checks = parseAccountsChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_FORWARD);
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toBe("No .forward files");
  });

  it("ACCT-NO-FORWARD fails when .forward file is found", () => {
    // Must not contain "NONE" or "No such file" for the check to detect .forward
    const output = "root:0:/bin/bash\nroot:$6$abc::\n-rw-r--r-- 1 root root 0 .forward\n25\n700";
    const checks = parseAccountsChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_FORWARD);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toBe(".forward file found");
  });

  // --- Branch coverage: ACCT-ROOT-HOME-PERMS ---
  it("ACCT-ROOT-HOME-PERMS passes when others have no access", () => {
    const checks = parseAccountsChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_ROOT_HOME_PERMS);
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toMatch(/\/root permissions: 700/);
  });

  it("ACCT-ROOT-HOME-PERMS fails when others can access", () => {
    const checks = parseAccountsChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_ROOT_HOME_PERMS);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toMatch(/others can access/);
  });

  it("ACCT-ROOT-HOME-PERMS fails when permissions cannot be read", () => {
    // Output with no valid 3-4 digit permission number on its own line
    const output = "root:0:/bin/bash\nroot:$6$abc::\nNONE\nno-perms-here";
    const checks = parseAccountsChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_ROOT_HOME_PERMS);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toBe("Unable to read /root permissions");
  });

  // --- Branch coverage: ACCT-NO-DUPLICATE-UID ---
  it("ACCT-NO-DUPLICATE-UID passes when no duplicates", () => {
    const checks = parseAccountsChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_DUPLICATE_UID);
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toBe("No duplicate UIDs found");
  });

  it("ACCT-NO-DUPLICATE-UID fails when duplicates found", () => {
    const checks = parseAccountsChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_DUPLICATE_UID);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toMatch(/Duplicate UIDs/);
  });

  // --- Branch coverage: ACCT-HOME-OWNERSHIP ---
  it("ACCT-HOME-OWNERSHIP passes when all homes correctly owned", () => {
    // Minimal output with only home ownership line to avoid cross-line regex match
    const output = "/home/admin admin\n/home/bob bob\nroot:$6$abc::";
    const checks = parseAccountsChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_HOME_OWNERSHIP);
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toBe("All home directories correctly owned");
  });

  it("ACCT-HOME-OWNERSHIP fails when ownership is mismatched", () => {
    const checks = parseAccountsChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_HOME_OWNERSHIP);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toMatch(/Mismatched/);
  });

  // --- Branch coverage: ACCT-SHADOW-PERMS ---
  it("ACCT-SHADOW-PERMS passes when shadow data is readable by root", () => {
    const checks = parseAccountsChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_SHADOW_PERMS);
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toBe("/etc/shadow readable by root only");
  });

  it("ACCT-SHADOW-PERMS fails when Permission denied", () => {
    const output = "Permission denied\nNONE";
    const checks = parseAccountsChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_SHADOW_PERMS);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toBe("/etc/shadow access issue detected");
  });

  // --- Branch coverage: ACCT-MAX-PASSWORD-DAYS ---
  it("ACCT-MAX-PASSWORD-DAYS passes when <= 365 and > 0", () => {
    const checks = parseAccountsChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_MAX_PASSWORD_DAYS);
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toBe("PASS_MAX_DAYS = 365");
  });

  it("ACCT-MAX-PASSWORD-DAYS fails when PASS_MAX_DAYS not configured", () => {
    const output = "root:0:/bin/bash\nNONE";
    const checks = parseAccountsChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_MAX_PASSWORD_DAYS);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toBe("PASS_MAX_DAYS not configured");
  });

  it("ACCT-MAX-PASSWORD-DAYS fails when days is 0", () => {
    const output = validOutput.replace("PASS_MAX_DAYS 365", "PASS_MAX_DAYS 0");
    const checks = parseAccountsChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_MAX_PASSWORD_DAYS);
    expect(check!.passed).toBe(false);
  });

  // --- Branch coverage: ACCT-MIN-PASSWORD-DAYS ---
  it("ACCT-MIN-PASSWORD-DAYS passes when > 0", () => {
    const checks = parseAccountsChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_MIN_PASSWORD_DAYS);
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toBe("PASS_MIN_DAYS = 1");
  });

  it("ACCT-MIN-PASSWORD-DAYS fails when 0", () => {
    const checks = parseAccountsChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_MIN_PASSWORD_DAYS);
    expect(check!.passed).toBe(false);
  });

  it("ACCT-MIN-PASSWORD-DAYS fails when not configured", () => {
    const output = "root:0:/bin/bash\nNONE";
    const checks = parseAccountsChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_MIN_PASSWORD_DAYS);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toBe("PASS_MIN_DAYS not configured");
  });

  // --- Branch coverage: ACCT-INACTIVE-LOCK ---
  it("ACCT-INACTIVE-LOCK passes when INACTIVE is configured", () => {
    const output = validOutput + "\nINACTIVE = 30";
    const checks = parseAccountsChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_INACTIVE_LOCK);
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toBe("Inactive lockout configured");
  });

  it("ACCT-INACTIVE-LOCK passes when useradd -f is configured", () => {
    const output = validOutput + "\nuseradd -D -f 30";
    const checks = parseAccountsChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_INACTIVE_LOCK);
    expect(check!.passed).toBe(true);
  });

  it("ACCT-INACTIVE-LOCK fails when no inactive lockout policy", () => {
    const checks = parseAccountsChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_INACTIVE_LOCK);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toBe("No inactive account lockout policy");
  });

  // --- Branch coverage: ACCT-DEFAULT-UMASK ---
  it("ACCT-DEFAULT-UMASK passes with 027", () => {
    const checks = parseAccountsChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_DEFAULT_UMASK);
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toBe("UMASK = 027");
  });

  it("ACCT-DEFAULT-UMASK passes with 077", () => {
    const output = validOutput.replace("UMASK 027", "UMASK 077");
    const checks = parseAccountsChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_DEFAULT_UMASK);
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toBe("UMASK = 077");
  });

  it("ACCT-DEFAULT-UMASK fails with 022", () => {
    const checks = parseAccountsChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_DEFAULT_UMASK);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toBe("UMASK = 022");
  });

  it("ACCT-DEFAULT-UMASK fails when UMASK not configured", () => {
    const output = "root:0:/bin/bash\nNONE";
    const checks = parseAccountsChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_DEFAULT_UMASK);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toBe("UMASK not configured in login.defs");
  });

  // --- Branch coverage: ACCT-NO-EMPTY-HOME ---
  it("ACCT-NO-EMPTY-HOME passes when fewer than 10 users with login shells", () => {
    const checks = parseAccountsChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_EMPTY_HOME);
    expect(check!.passed).toBe(true);
  });

  it("ACCT-NO-EMPTY-HOME filters out root and underscore-prefixed users", () => {
    // root and _apt should be filtered, only testuser remains
    const output = "root:0:/bin/bash\n_apt:100:/bin/bash\ntestuser:1001:/bin/bash\n25\n700\nNONE";
    const checks = parseAccountsChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_EMPTY_HOME);
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toMatch(/1 user\(s\) with login shells/);
  });

  // --- Branch coverage: ACCT-INACTIVE-ACCOUNTS ---
  it("ACCT-INACTIVE-ACCOUNTS passes when N/A", () => {
    const checks = parseAccountsChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_INACTIVE_ACCOUNTS);
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toBe("Inactive account check not available");
  });

  it("ACCT-INACTIVE-ACCOUNTS passes when fewer than 5 inactive", () => {
    // Only lastlog-style lines (no N/A), fewer than 5 non-empty non-header lines
    const output = "Username Port From Latest\nuser1 pts/0 192.168.1.1 Mon Jan 1\nuser2 pts/0 192.168.1.2 Mon Jan 2";
    const checks = parseAccountsChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_INACTIVE_ACCOUNTS);
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toMatch(/2 accounts.*acceptable/);
  });

  it("ACCT-INACTIVE-ACCOUNTS fails when 5+ accounts inactive", () => {
    const inactiveLines = Array.from({ length: 6 }, (_, i) =>
      `user${i} pts/0 192.168.1.${i} Mon Jan ${i + 1}`
    ).join("\n");
    const output = validOutput.replace("N/A", inactiveLines);
    const checks = parseAccountsChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_INACTIVE_ACCOUNTS);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toMatch(/review recommended/);
  });

  // --- Branch coverage: ACCT-TOTAL-USERS-REASONABLE ---
  it("ACCT-TOTAL-USERS-REASONABLE fails when user count >= 50", () => {
    const output = validOutput.replace("\n25\n", "\n55\n");
    const checks = parseAccountsChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_TOTAL_USERS_REASONABLE);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toMatch(/excessive/);
  });

  it("ACCT-TOTAL-USERS-REASONABLE fails when user count not determinable", () => {
    // No standalone number > 5 in output
    const output = "root:0:/bin/bash\nNONE\nabc";
    const checks = parseAccountsChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_TOTAL_USERS_REASONABLE);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toBe("User count not determinable");
  });

  // --- Branch coverage: ACCT-NO-WORLD-WRITABLE-HOME ---
  it("ACCT-NO-WORLD-WRITABLE-HOME fails when world-writable dirs exist", () => {
    const output = validOutput + "\n777 /home/vulnerable";
    const checks = parseAccountsChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_WORLD_WRITABLE_HOME);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toMatch(/world-writable/);
  });

  it("ACCT-NO-WORLD-WRITABLE-HOME passes for perms ending in 0,1,4,5", () => {
    const output = "750 /home/user1\n755 /home/user2\n700 /home/user3\n701 /home/user4";
    const checks = parseAccountsChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_WORLD_WRITABLE_HOME);
    expect(check!.passed).toBe(true);
  });

  // --- Branch coverage: ACCT-LOGIN-DEFS-UID-MAX ---
  it("ACCT-LOGIN-DEFS-UID-MAX fails when UID_MAX < 60000", () => {
    const output = validOutput.replace("UID_MAX 60000", "UID_MAX 10000");
    const checks = parseAccountsChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_LOGIN_DEFS_UID_MAX);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toMatch(/non-standard/);
  });

  it("ACCT-LOGIN-DEFS-UID-MAX fails when UID_MIN or UID_MAX missing", () => {
    const output = "root:0:/bin/bash\nNONE";
    const checks = parseAccountsChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_LOGIN_DEFS_UID_MAX);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toBe("UID_MIN or UID_MAX not found in login.defs");
  });

  // --- Branch coverage: ACCT-LOGIN-SHELL-AUDIT ---
  it("ACCT-LOGIN-SHELL-AUDIT fails when shell count not determinable", () => {
    // Output with no standalone numbers in 0-500 range
    const output = "root:0:/bin/bash\nNONE\nabc";
    const checks = parseAccountsChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_LOGIN_SHELL_AUDIT);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toBe("Login shell count not determinable");
  });

  // --- Branch coverage: ACCT-NO-EXTRA-UID0 currentValue when extras found ---
  it("ACCT-NO-EXTRA-UID0 currentValue lists extra UID 0 accounts", () => {
    const checks = parseAccountsChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_EXTRA_UID0);
    expect(check!.currentValue).toMatch(/Extra UID 0: backdoor/);
  });

  // --- Branch coverage: ACCT-SYSTEM-SHELL currentValue when system accounts have shells ---
  it("ACCT-SYSTEM-SHELL currentValue lists system accounts with shells", () => {
    const checks = parseAccountsChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_SYSTEM_SHELL);
    expect(check!.currentValue).toMatch(/System accounts with shells:/);
    expect(check!.currentValue).toMatch(/games/);
  });

  // --- Branch coverage: .rhosts with "No such file" should pass ---
  it("ACCT-NO-RHOSTS passes when output contains .rhosts with 'No such file'", () => {
    const output = validOutput + "\n.rhosts: No such file or directory";
    const checks = parseAccountsChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_RHOSTS);
    expect(check!.passed).toBe(true);
  });

  // --- Branch coverage: platform parameter (coolify/dokploy) ---
  it("works with coolify platform parameter", () => {
    const checks = parseAccountsChecks(validOutput, "coolify");
    expect(checks).toHaveLength(22);
    expect(checks[0].category).toBe("Accounts");
  });

  it("works with dokploy platform parameter", () => {
    const checks = parseAccountsChecks(validOutput, "dokploy");
    expect(checks).toHaveLength(22);
  });

  // --- Branch coverage: ACCT-NO-WORLD-WRITABLE-HOME perms with last digit 2,3,6 ---
  it("ACCT-NO-WORLD-WRITABLE-HOME detects permission ending in 2 (write)", () => {
    const output = "752 /home/user1";
    const checks = parseAccountsChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_WORLD_WRITABLE_HOME);
    expect(check!.passed).toBe(false);
  });

  it("ACCT-NO-WORLD-WRITABLE-HOME detects permission ending in 3", () => {
    const output = "753 /home/user1";
    const checks = parseAccountsChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_WORLD_WRITABLE_HOME);
    expect(check!.passed).toBe(false);
  });

  it("ACCT-NO-WORLD-WRITABLE-HOME detects permission ending in 6", () => {
    const output = "756 /home/user1";
    const checks = parseAccountsChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_WORLD_WRITABLE_HOME);
    expect(check!.passed).toBe(false);
  });

  describe("mutation-killer tests", () => {
    // --- ACCT-NO-EXTRA-UID0: regex + filter logic ---
    it("[ACCT-NO-EXTRA-UID0] regex matches user:uid: format correctly", () => {
      // Only lines matching /^[^:]+:\d+:/gm are considered
      const output = "root:0:/bin/bash\nnobody:65534:/usr/sbin/nologin";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_EXTRA_UID0);
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toBe("Only root has UID 0");
    });

    it("[ACCT-NO-EXTRA-UID0] detects non-root UID 0 account", () => {
      const output = "root:0:/bin/bash\ntoor:0:/bin/bash";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_EXTRA_UID0);
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toMatch(/Extra UID 0: toor/);
    });

    it("[ACCT-NO-EXTRA-UID0] ignores non-UID-0 accounts", () => {
      const output = "root:0:/bin/bash\nadmin:1000:/bin/bash\nnobody:65534:/bin/false";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_EXTRA_UID0);
      expect(check!.passed).toBe(true);
    });

    it("[ACCT-NO-EXTRA-UID0] uid comparison uses string equality '0' not number", () => {
      // uid "00" should NOT match "0"
      const output = "root:0:/bin/bash\nfake:00:/bin/bash";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_EXTRA_UID0);
      expect(check!.passed).toBe(true); // "00" !== "0"
    });

    // --- ACCT-NO-EMPTY-PASSWORD: regex /^[^:]+::/gm ---
    it("[ACCT-NO-EMPTY-PASSWORD] detects multiple empty passwords", () => {
      const output = "user1::\nuser2::\nuser3:$6$hash::";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_EMPTY_PASSWORD);
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toMatch(/user1, user2/);
    });

    it("[ACCT-NO-EMPTY-PASSWORD] passes when all have hashes", () => {
      const output = "root:$6$abc::\ndaemon:*::\nadmin:$6$xyz::";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_EMPTY_PASSWORD);
      expect(check!.passed).toBe(true);
    });

    // --- ACCT-NO-RHOSTS: .rhosts + negation logic ---
    it("[ACCT-NO-RHOSTS] passes when output contains NONE with .rhosts", () => {
      const output = ".rhosts NONE";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_RHOSTS);
      expect(check!.passed).toBe(true);
    });

    it("[ACCT-NO-RHOSTS] passes when .rhosts not in output at all", () => {
      const output = "no dangerous files found";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_RHOSTS);
      expect(check!.passed).toBe(true);
    });

    it("[ACCT-NO-RHOSTS] fails when .rhosts present without NONE or No such file", () => {
      const output = "-rw-r--r-- 1 user user 0 .rhosts";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_RHOSTS);
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe(".rhosts file found");
    });

    // --- ACCT-HOSTS-EQUIV: same pattern as rhosts ---
    it("[ACCT-HOSTS-EQUIV] passes when hosts.equiv not in output", () => {
      const output = "clean output";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_HOSTS_EQUIV);
      expect(check!.passed).toBe(true);
    });

    it("[ACCT-HOSTS-EQUIV] passes when hosts.equiv with NONE", () => {
      const output = "hosts.equiv NONE";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_HOSTS_EQUIV);
      expect(check!.passed).toBe(true);
    });

    it("[ACCT-HOSTS-EQUIV] passes when hosts.equiv with No such file", () => {
      const output = "hosts.equiv: No such file or directory";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_HOSTS_EQUIV);
      expect(check!.passed).toBe(true);
    });

    // --- ACCT-NO-NETRC: pattern ---
    it("[ACCT-NO-NETRC] passes when .netrc not in output at all", () => {
      const output = "clean output";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_NETRC);
      expect(check!.passed).toBe(true);
    });

    it("[ACCT-NO-NETRC] passes when .netrc with No such file", () => {
      const output = ".netrc: No such file or directory";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_NETRC);
      expect(check!.passed).toBe(true);
    });

    // --- ACCT-NO-FORWARD: pattern ---
    it("[ACCT-NO-FORWARD] passes when .forward not in output", () => {
      const output = "clean output";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_FORWARD);
      expect(check!.passed).toBe(true);
    });

    it("[ACCT-NO-FORWARD] passes when .forward with NONE", () => {
      const output = ".forward NONE";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_FORWARD);
      expect(check!.passed).toBe(true);
    });

    // --- ACCT-SYSTEM-SHELL: regex and root filter ---
    it("[ACCT-SYSTEM-SHELL] matches /bin/sh shell", () => {
      const output = "daemon:/bin/sh";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_SYSTEM_SHELL);
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toMatch(/daemon/);
    });

    it("[ACCT-SYSTEM-SHELL] matches /bin/zsh shell", () => {
      const output = "sysuser:/bin/zsh";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_SYSTEM_SHELL);
      expect(check!.passed).toBe(false);
    });

    it("[ACCT-SYSTEM-SHELL] matches /bin/csh shell", () => {
      const output = "sysuser:/bin/csh";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_SYSTEM_SHELL);
      expect(check!.passed).toBe(false);
    });

    it("[ACCT-SYSTEM-SHELL] filters out root from non-root check", () => {
      const output = "root:/bin/bash";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_SYSTEM_SHELL);
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toBe("All system accounts have nologin/false shells");
    });

    it("[ACCT-SYSTEM-SHELL] passes when only nologin shells", () => {
      const output = "daemon:/usr/sbin/nologin\nbin:/bin/false";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_SYSTEM_SHELL);
      expect(check!.passed).toBe(true);
    });

    // --- ACCT-ROOT-HOME-PERMS: last digit === 0 ---
    it("[ACCT-ROOT-HOME-PERMS] passes with 750 (last digit 0)", () => {
      const output = "\n750\n";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_ROOT_HOME_PERMS);
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toMatch(/750/);
    });

    it("[ACCT-ROOT-HOME-PERMS] fails with 701 (last digit 1)", () => {
      const output = "\n701\n";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_ROOT_HOME_PERMS);
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toMatch(/others can access/);
    });

    it("[ACCT-ROOT-HOME-PERMS] passes with 4-digit 1700", () => {
      const output = "\n1700\n";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_ROOT_HOME_PERMS);
      expect(check!.passed).toBe(true);
    });

    // --- ACCT-NO-DUPLICATE-UID: regex /^[^:]+:\d+$/gm ---
    it("[ACCT-NO-DUPLICATE-UID] passes when NONE sentinel is present", () => {
      const output = "NONE\nsome other data";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_DUPLICATE_UID);
      expect(check!.passed).toBe(true);
    });

    it("[ACCT-NO-DUPLICATE-UID] filters out empty trimmed lines and NONE", () => {
      const output = "  \nNONE\n";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_DUPLICATE_UID);
      expect(check!.passed).toBe(true);
    });

    // --- ACCT-HOME-OWNERSHIP: dir name vs owner ---
    it("[ACCT-HOME-OWNERSHIP] detects mismatch when dir name differs from owner", () => {
      const output = "/home/alice bob";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_HOME_OWNERSHIP);
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toMatch(/Mismatched/);
    });

    it("[ACCT-HOME-OWNERSHIP] passes when dir name matches owner", () => {
      const output = "/home/alice alice";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_HOME_OWNERSHIP);
      expect(check!.passed).toBe(true);
    });

    it("[ACCT-HOME-OWNERSHIP] passes when no /home lines in output", () => {
      const output = "no home dirs";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_HOME_OWNERSHIP);
      expect(check!.passed).toBe(true);
    });

    // --- ACCT-SHADOW-PERMS: includes(":") && !includes("Permission denied") ---
    it("[ACCT-SHADOW-PERMS] fails when no colon in output (no shadow data)", () => {
      const output = "nothing here";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_SHADOW_PERMS);
      expect(check!.passed).toBe(false);
    });

    it("[ACCT-SHADOW-PERMS] passes when colon present and no Permission denied", () => {
      const output = "root:$6$hash::";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_SHADOW_PERMS);
      expect(check!.passed).toBe(true);
    });

    it("[ACCT-SHADOW-PERMS] fails when both colon and Permission denied present", () => {
      const output = "root:$6$hash::\nPermission denied";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_SHADOW_PERMS);
      expect(check!.passed).toBe(false);
    });

    // --- ACCT-MAX-PASSWORD-DAYS: days <= 365 && days > 0 ---
    it("[ACCT-MAX-PASSWORD-DAYS] passes with 90 days", () => {
      const output = "PASS_MAX_DAYS 90";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_MAX_PASSWORD_DAYS);
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toBe("PASS_MAX_DAYS = 90");
    });

    it("[ACCT-MAX-PASSWORD-DAYS] passes with exactly 365", () => {
      const output = "PASS_MAX_DAYS 365";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_MAX_PASSWORD_DAYS);
      expect(check!.passed).toBe(true);
    });

    it("[ACCT-MAX-PASSWORD-DAYS] fails with 366", () => {
      const output = "PASS_MAX_DAYS 366";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_MAX_PASSWORD_DAYS);
      expect(check!.passed).toBe(false);
    });

    it("[ACCT-MAX-PASSWORD-DAYS] passes with exactly 1 (> 0 boundary)", () => {
      const output = "PASS_MAX_DAYS 1";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_MAX_PASSWORD_DAYS);
      expect(check!.passed).toBe(true);
    });

    // --- ACCT-MIN-PASSWORD-DAYS: days > 0 ---
    it("[ACCT-MIN-PASSWORD-DAYS] passes with exactly 1", () => {
      const output = "PASS_MIN_DAYS 1";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_MIN_PASSWORD_DAYS);
      expect(check!.passed).toBe(true);
    });

    it("[ACCT-MIN-PASSWORD-DAYS] fails with exactly 0", () => {
      const output = "PASS_MIN_DAYS 0";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_MIN_PASSWORD_DAYS);
      expect(check!.passed).toBe(false);
    });

    // --- ACCT-INACTIVE-LOCK: two regex branches ---
    it("[ACCT-INACTIVE-LOCK] passes with INACTIVE=30 (= sign)", () => {
      const output = "INACTIVE=30";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_INACTIVE_LOCK);
      expect(check!.passed).toBe(true);
    });

    it("[ACCT-INACTIVE-LOCK] passes with INACTIVE 30 (space, no =)", () => {
      const output = "INACTIVE 30";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_INACTIVE_LOCK);
      expect(check!.passed).toBe(true);
    });

    it("[ACCT-INACTIVE-LOCK] fails when INACTIVE has no number", () => {
      const output = "INACTIVE disabled";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_INACTIVE_LOCK);
      expect(check!.passed).toBe(false);
    });

    // --- ACCT-DEFAULT-UMASK: exact match 027 or 077 ---
    it("[ACCT-DEFAULT-UMASK] fails with 022 (not 027 or 077)", () => {
      const output = "UMASK 022";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_DEFAULT_UMASK);
      expect(check!.passed).toBe(false);
    });

    it("[ACCT-DEFAULT-UMASK] fails with 002 (not 027 or 077)", () => {
      const output = "UMASK 002";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_DEFAULT_UMASK);
      expect(check!.passed).toBe(false);
    });

    // --- ACCT-NO-EMPTY-HOME: login shell list check ---
    it("[ACCT-NO-EMPTY-HOME] detects /bin/fish as login shell", () => {
      const output = "testuser:1001:/bin/fish\n25\n700";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_EMPTY_HOME);
      expect(check!.currentValue).toMatch(/1 user\(s\)/);
    });

    it("[ACCT-NO-EMPTY-HOME] does not detect /usr/sbin/nologin as login shell", () => {
      const output = "testuser:1001:/usr/sbin/nologin\n25\n700";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_EMPTY_HOME);
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toMatch(/No users with unexpected/);
    });

    it("[ACCT-NO-EMPTY-HOME] passes when < 10 suspicious users (boundary)", () => {
      const users = Array.from({ length: 9 }, (_, i) => `user${i}:${1001 + i}:/bin/bash`).join("\n");
      const output = users + "\n25\n700";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_EMPTY_HOME);
      expect(check!.passed).toBe(true);
    });

    it("[ACCT-NO-EMPTY-HOME] fails when exactly 10 suspicious users", () => {
      const users = Array.from({ length: 10 }, (_, i) => `user${i}:${1001 + i}:/bin/bash`).join("\n");
      const output = users + "\n25\n700";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_EMPTY_HOME);
      expect(check!.passed).toBe(false);
    });

    // --- ACCT-INACTIVE-ACCOUNTS: header and N/A filter ---
    it("[ACCT-INACTIVE-ACCOUNTS] filters out lines starting with 'Username'", () => {
      const output = "Username Port From Latest\nuser1 pts/0 10.0.0.1 Jan 1";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_INACTIVE_ACCOUNTS);
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toMatch(/1 accounts/);
    });

    it("[ACCT-INACTIVE-ACCOUNTS] counts exactly 4 as pass (< 5)", () => {
      const lines = Array.from({ length: 4 }, (_, i) =>
        `user${i} pts/0 10.0.0.${i} Jan ${i + 1}`
      ).join("\n");
      const checks = parseAccountsChecks(lines, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_INACTIVE_ACCOUNTS);
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toMatch(/4 accounts.*acceptable/);
    });

    it("[ACCT-INACTIVE-ACCOUNTS] counts exactly 5 as fail (>= 5)", () => {
      const lines = Array.from({ length: 5 }, (_, i) =>
        `user${i} pts/0 10.0.0.${i} Jan ${i + 1}`
      ).join("\n");
      const checks = parseAccountsChecks(lines, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_INACTIVE_ACCOUNTS);
      expect(check!.passed).toBe(false);
    });

    // --- ACCT-TOTAL-USERS-REASONABLE: standalone number > 5 ---
    it("[ACCT-TOTAL-USERS-REASONABLE] ignores numbers <= 5", () => {
      const output = "3\n4\n5\nno more";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_TOTAL_USERS_REASONABLE);
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("User count not determinable");
    });

    it("[ACCT-TOTAL-USERS-REASONABLE] picks first number > 5", () => {
      const output = "3\n6\n30";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_TOTAL_USERS_REASONABLE);
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toMatch(/6 user accounts/);
    });

    it("[ACCT-TOTAL-USERS-REASONABLE] boundary: 49 passes, 50 fails", () => {
      const output49 = "49";
      const checks49 = parseAccountsChecks(output49, "bare");
      const check49 = checks49.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_TOTAL_USERS_REASONABLE);
      expect(check49!.passed).toBe(true);

      const output50 = "50";
      const checks50 = parseAccountsChecks(output50, "bare");
      const check50 = checks50.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_TOTAL_USERS_REASONABLE);
      expect(check50!.passed).toBe(false);
    });

    // --- ACCT-NO-WORLD-WRITABLE-HOME: [2, 3, 6, 7].includes(lastDigit) ---
    it("[ACCT-NO-WORLD-WRITABLE-HOME] perms ending in 0 passes (not writable)", () => {
      const output = "750 /home/user1";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_WORLD_WRITABLE_HOME);
      expect(check!.passed).toBe(true);
    });

    it("[ACCT-NO-WORLD-WRITABLE-HOME] perms ending in 1 passes (execute only)", () => {
      const output = "751 /home/user1";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_WORLD_WRITABLE_HOME);
      expect(check!.passed).toBe(true);
    });

    it("[ACCT-NO-WORLD-WRITABLE-HOME] perms ending in 4 passes (read only)", () => {
      const output = "754 /home/user1";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_WORLD_WRITABLE_HOME);
      expect(check!.passed).toBe(true);
    });

    it("[ACCT-NO-WORLD-WRITABLE-HOME] perms ending in 5 passes (read+exec)", () => {
      const output = "755 /home/user1";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_WORLD_WRITABLE_HOME);
      expect(check!.passed).toBe(true);
    });

    it("[ACCT-NO-WORLD-WRITABLE-HOME] perms ending in 7 fails (rwx)", () => {
      const output = "757 /home/user1";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_WORLD_WRITABLE_HOME);
      expect(check!.passed).toBe(false);
    });

    it("[ACCT-NO-WORLD-WRITABLE-HOME] no /home lines means pass (no dirs to check)", () => {
      const output = "nothing here";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_NO_WORLD_WRITABLE_HOME);
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toBe("No world-writable home directories");
    });

    // --- ACCT-LOGIN-DEFS-UID-MAX: uidMin >= 1000 && uidMax >= 60000 ---
    it("[ACCT-LOGIN-DEFS-UID-MAX] passes with UID_MIN=1000, UID_MAX=60000 (exact boundaries)", () => {
      const output = "UID_MIN 1000\nUID_MAX 60000";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_LOGIN_DEFS_UID_MAX);
      expect(check!.passed).toBe(true);
    });

    it("[ACCT-LOGIN-DEFS-UID-MAX] fails with UID_MIN=999", () => {
      const output = "UID_MIN 999\nUID_MAX 60000";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_LOGIN_DEFS_UID_MAX);
      expect(check!.passed).toBe(false);
    });

    it("[ACCT-LOGIN-DEFS-UID-MAX] fails with UID_MAX=59999", () => {
      const output = "UID_MIN 1000\nUID_MAX 59999";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_LOGIN_DEFS_UID_MAX);
      expect(check!.passed).toBe(false);
    });

    // --- ACCT-LOGIN-SHELL-AUDIT: shellCount <= 10 boundary + last number ---
    it("[ACCT-LOGIN-SHELL-AUDIT] passes with exactly 10", () => {
      const output = "10";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_LOGIN_SHELL_AUDIT);
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toMatch(/10 accounts/);
    });

    it("[ACCT-LOGIN-SHELL-AUDIT] fails with 11", () => {
      const output = "11";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_LOGIN_SHELL_AUDIT);
      expect(check!.passed).toBe(false);
    });

    it("[ACCT-LOGIN-SHELL-AUDIT] uses last standalone number in 0-499 range", () => {
      // Multiple numbers: picks last one
      const output = "5\n8";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_LOGIN_SHELL_AUDIT);
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toMatch(/8 accounts/);
    });

    // --- ACCT-GID-CONSISTENCY: NONE sentinel + standalone digit detection ---
    it("[ACCT-GID-CONSISTENCY] passes when NONE on its own line", () => {
      const output = "NONE";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_GID_CONSISTENCY);
      expect(check!.passed).toBe(true);
    });

    it("[ACCT-GID-CONSISTENCY] fails when standalone numbers present (no NONE)", () => {
      const output = "1000\n1001";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_GID_CONSISTENCY);
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toMatch(/Duplicate GIDs found/);
    });

    it("[ACCT-GID-CONSISTENCY] fails when NONE not on own line but numbers present", () => {
      const output = "not-NONE\n1000";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_GID_CONSISTENCY);
      expect(check!.passed).toBe(false);
    });

    it("[ACCT-GID-CONSISTENCY] passes when non-digit lines and no NONE (no dupes)", () => {
      const output = "no duplicates found";
      const checks = parseAccountsChecks(output, "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.ACCOUNTS.ACCT_GID_CONSISTENCY);
      expect(check!.passed).toBe(true);
    });
  });
});
