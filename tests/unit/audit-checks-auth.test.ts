import { parseAuthChecks } from "../../src/core/audit/checks/auth.js";

describe("parseAuthChecks", () => {
  // Secure output includes data from all 11 authSection() commands:
  // 1. PAM config (password quality present)
  // 2. sudo group (limited members)
  // 3. Password aging policy (PASS_MAX_DAYS, PASS_MIN_DAYS, PASS_WARN_AGE)
  // 4. No empty password accounts
  // 5. /etc/shadow stat (640 = secure)
  // 6. sudo logging (log_output present)
  // 7. sudo requiretty
  // 8. UID 0 accounts (only root)
  // 9. faillock/pam_tally2 present
  // 10. MFA package installed
  // 11. INACTIVE configured
  const secureOutput = [
    // PAM config (password quality present)
    "auth required pam_unix.so\npassword requisite pam_pwquality.so\nauth required pam_faillock.so preauth",
    // sudo group
    "sudo:x:27:admin",
    // Password aging
    "PASS_MAX_DAYS\t90\nPASS_MIN_DAYS\t1\nPASS_WARN_AGE\t7",
    // No empty password accounts
    "N/A",
    // /etc/shadow permissions
    "640",
    // sudo logging
    "Defaults log_output",
    // sudo requiretty
    "Defaults requiretty",
    // UID 0 accounts (only root) — format includes context word to avoid empty-pw detection heuristic
    "root:0:root",
    // faillock present
    "auth required pam_faillock.so preauth",
    // MFA package installed
    "ii  libpam-google-authenticator 20191231-2 amd64 Two-step verification",
    // INACTIVE configured
    "INACTIVE=30",
    // pam_wheel (AUTH-SU-RESTRICTED)
    "auth required pam_wheel.so use_uid",
    // /etc/gshadow permissions (second standalone perm after shadow 640) — AUTH-GSHADOW-PERMISSIONS
    "640",
    // New auth checks data (auth19..22)
    // AUTH-PWQUALITY-CONFIGURED: pam_pwquality in /etc/pam.d/
    "/etc/pam.d/common-password:password requisite pam_pwquality.so retry=3",
    // AUTH-UMASK-LOGIN-DEFS: UMASK 027
    "UMASK\t027",
    // AUTH-SHA512-HASH: SHA512
    "ENCRYPT_METHOD SHA512",
    // AUTH-PWQUALITY-MINLEN: minlen = 14
    "minlen = 14",
  ].join("\n");

  const insecureOutput = [
    // PAM config (no quality module, no faillock)
    "auth required pam_unix.so",
    // sudo group (many members)
    "sudo:x:27:admin,user1,user2,user3,user4",
    // Password aging not configured
    "N/A",
    // Empty password accounts
    "testuser\nolduser",
    // /etc/shadow permissions (world-readable = insecure)
    "644",
    // no sudo logging
    "NONE",
    // no requiretty
    "NONE",
    // UID 0 accounts (duplicate — toor is also uid 0)
    "root\ntoor",
    // faillock absent
    "NONE",
    // no MFA
    "NONE",
    // INACTIVE not set
    "N/A",
  ].join("\n");

  it("should return 22 checks", () => {
    const checks = parseAuthChecks(secureOutput, "bare");
    expect(checks).toHaveLength(22);
    checks.forEach((check) => {
      expect(check.category).toBe("Auth");
      expect(check.id).toMatch(/^AUTH-[A-Z][A-Z0-9]*(-[A-Z][A-Z0-9]*)+$/);
    });
  });

  it("should return AUTH-NO-EMPTY-PASSWORDS passed when no empty-password accounts", () => {
    const checks = parseAuthChecks(secureOutput, "bare");
    const auth03 = checks.find((c: { id: string }) => c.id === "AUTH-NO-EMPTY-PASSWORDS");
    expect(auth03!.passed).toBe(true);
  });

  it("should return AUTH-NO-EMPTY-PASSWORDS failed when empty-password accounts exist", () => {
    const checks = parseAuthChecks(insecureOutput, "bare");
    const auth03 = checks.find((c: { id: string }) => c.id === "AUTH-NO-EMPTY-PASSWORDS");
    expect(auth03!.passed).toBe(false);
  });

  it("should return AUTH-NO-NOPASSWD-ALL failed when NOPASSWD ALL in sudoers", () => {
    const nopasswdOutput = [
      "auth required pam_unix.so",
      "sudo:x:27:admin\nALL=(ALL) NOPASSWD: ALL",
      "PASS_MAX_DAYS\t99999",
      "N/A",
      "640",
      "NONE",
      "NONE",
      "root",
      "NONE",
      "NONE",
      "N/A",
    ].join("\n");
    const checks = parseAuthChecks(nopasswdOutput, "bare");
    const auth01 = checks.find((c: { id: string }) => c.id === "AUTH-NO-NOPASSWD-ALL");
    expect(auth01!.passed).toBe(false);
    expect(auth01!.severity).toBe("critical");
  });

  it("should return AUTH-SHADOW-PERMISSIONS passed when /etc/shadow is mode 640", () => {
    const checks = parseAuthChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "AUTH-SHADOW-PERMISSIONS");
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("critical");
  });

  it("should return AUTH-SHADOW-PERMISSIONS failed when /etc/shadow is mode 644", () => {
    const checks = parseAuthChecks(insecureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "AUTH-SHADOW-PERMISSIONS");
    expect(check!.passed).toBe(false);
  });

  it("should return AUTH-FAILLOCK-CONFIGURED passed when pam_faillock present", () => {
    const checks = parseAuthChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "AUTH-FAILLOCK-CONFIGURED");
    expect(check!.passed).toBe(true);
  });

  it("should return AUTH-FAILLOCK-CONFIGURED failed when no faillock module", () => {
    const checks = parseAuthChecks(insecureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "AUTH-FAILLOCK-CONFIGURED");
    expect(check!.passed).toBe(false);
  });

  it("should return AUTH-NO-UID0-DUPS passed when only root has UID 0", () => {
    const checks = parseAuthChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "AUTH-NO-UID0-DUPS");
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("critical");
  });

  it("should return AUTH-NO-UID0-DUPS failed when toor also has UID 0", () => {
    const checks = parseAuthChecks(insecureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "AUTH-NO-UID0-DUPS");
    expect(check!.passed).toBe(false);
  });

  it("AUTH-SU-RESTRICTED passes when pam_wheel configured in /etc/pam.d/su", () => {
    const checks = parseAuthChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "AUTH-SU-RESTRICTED");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("AUTH-PASS-MAX-DAYS-SET passes when PASS_MAX_DAYS is 90", () => {
    const checks = parseAuthChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "AUTH-PASS-MAX-DAYS-SET");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("AUTH-GSHADOW-PERMISSIONS passes when second perm value is 640", () => {
    const checks = parseAuthChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "AUTH-GSHADOW-PERMISSIONS");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("should handle N/A output gracefully", () => {
    const checks = parseAuthChecks("N/A", "bare");
    expect(checks).toHaveLength(22);
  });

  it("AUTH-PWQUALITY-CONFIGURED passes when pam_pwquality is in pam.d", () => {
    const checks = parseAuthChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "AUTH-PWQUALITY-CONFIGURED");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("warning");
  });

  it("AUTH-PWQUALITY-CONFIGURED fails when pam_pwquality absent", () => {
    const checks = parseAuthChecks(insecureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "AUTH-PWQUALITY-CONFIGURED");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("AUTH-UMASK-LOGIN-DEFS passes when UMASK is 027", () => {
    const checks = parseAuthChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "AUTH-UMASK-LOGIN-DEFS");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("info");
  });

  it("AUTH-UMASK-LOGIN-DEFS fails when UMASK is not present", () => {
    const checks = parseAuthChecks(insecureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "AUTH-UMASK-LOGIN-DEFS");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("AUTH-SHA512-HASH passes when ENCRYPT_METHOD is SHA512", () => {
    const checks = parseAuthChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "AUTH-SHA512-HASH");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("warning");
  });

  it("AUTH-SHA512-HASH fails when ENCRYPT_METHOD absent or weak", () => {
    const checks = parseAuthChecks(insecureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "AUTH-SHA512-HASH");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("AUTH-PWQUALITY-MINLEN passes when minlen >= 12", () => {
    const checks = parseAuthChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "AUTH-PWQUALITY-MINLEN");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("warning");
    expect(check!.currentValue).toContain("14");
  });

  it("AUTH-PWQUALITY-MINLEN fails when minlen not configured", () => {
    const checks = parseAuthChecks(insecureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "AUTH-PWQUALITY-MINLEN");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });
});
