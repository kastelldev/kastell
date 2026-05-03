import { CHECK_IDS } from "../../src/core/audit/checkIds.js";
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
    const auth03 = checks.find((c: { id: string }) => c.id === CHECK_IDS.AUTH.AUTH_NO_EMPTY_PASSWORDS);
    expect(auth03!.passed).toBe(true);
  });

  it("should return AUTH-NO-EMPTY-PASSWORDS failed when empty-password accounts exist", () => {
    const checks = parseAuthChecks(insecureOutput, "bare");
    const auth03 = checks.find((c: { id: string }) => c.id === CHECK_IDS.AUTH.AUTH_NO_EMPTY_PASSWORDS);
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
    const auth01 = checks.find((c: { id: string }) => c.id === CHECK_IDS.AUTH.AUTH_NO_NOPASSWD_ALL);
    expect(auth01!.passed).toBe(false);
    expect(auth01!.severity).toBe("critical");
  });

  it("should return AUTH-SHADOW-PERMISSIONS passed when /etc/shadow is mode 640", () => {
    const checks = parseAuthChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.AUTH.AUTH_SHADOW_PERMISSIONS);
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("critical");
  });

  it("should return AUTH-SHADOW-PERMISSIONS failed when /etc/shadow is mode 644", () => {
    const checks = parseAuthChecks(insecureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.AUTH.AUTH_SHADOW_PERMISSIONS);
    expect(check!.passed).toBe(false);
  });

  it("should return AUTH-FAILLOCK-CONFIGURED passed when pam_faillock present", () => {
    const checks = parseAuthChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.AUTH.AUTH_FAILLOCK_CONFIGURED);
    expect(check!.passed).toBe(true);
  });

  it("should return AUTH-FAILLOCK-CONFIGURED failed when no faillock module", () => {
    const checks = parseAuthChecks(insecureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.AUTH.AUTH_FAILLOCK_CONFIGURED);
    expect(check!.passed).toBe(false);
  });

  it("should return AUTH-NO-UID0-DUPS passed when only root has UID 0", () => {
    const checks = parseAuthChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.AUTH.AUTH_NO_UID0_DUPS);
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("critical");
  });

  it("should return AUTH-NO-UID0-DUPS failed when toor also has UID 0", () => {
    const checks = parseAuthChecks(insecureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.AUTH.AUTH_NO_UID0_DUPS);
    expect(check!.passed).toBe(false);
  });

  it("AUTH-SU-RESTRICTED passes when pam_wheel configured in /etc/pam.d/su", () => {
    const checks = parseAuthChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.AUTH.AUTH_SU_RESTRICTED);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("AUTH-PASS-MAX-DAYS-SET passes when PASS_MAX_DAYS is 90", () => {
    const checks = parseAuthChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.AUTH.AUTH_PASS_MAX_DAYS_SET);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("AUTH-GSHADOW-PERMISSIONS passes when second perm value is 640", () => {
    const checks = parseAuthChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.AUTH.AUTH_GSHADOW_PERMISSIONS);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("should handle N/A output gracefully", () => {
    const checks = parseAuthChecks("N/A", "bare");
    expect(checks).toHaveLength(22);
  });

  it("AUTH-PWQUALITY-CONFIGURED passes when pam_pwquality is in pam.d", () => {
    const checks = parseAuthChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.AUTH.AUTH_PWQUALITY_CONFIGURED);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("warning");
  });

  it("AUTH-PWQUALITY-CONFIGURED fails when pam_pwquality absent", () => {
    const checks = parseAuthChecks(insecureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.AUTH.AUTH_PWQUALITY_CONFIGURED);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("AUTH-UMASK-LOGIN-DEFS passes when UMASK is 027", () => {
    const checks = parseAuthChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.AUTH.AUTH_UMASK_LOGIN_DEFS);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("info");
  });

  it("AUTH-UMASK-LOGIN-DEFS fails when UMASK is not present", () => {
    const checks = parseAuthChecks(insecureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.AUTH.AUTH_UMASK_LOGIN_DEFS);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("AUTH-SHA512-HASH passes when ENCRYPT_METHOD is SHA512", () => {
    const checks = parseAuthChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.AUTH.AUTH_SHA512_HASH);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("warning");
  });

  it("AUTH-SHA512-HASH fails when ENCRYPT_METHOD absent or weak", () => {
    const checks = parseAuthChecks(insecureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.AUTH.AUTH_SHA512_HASH);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("AUTH-PWQUALITY-MINLEN passes when minlen >= 12", () => {
    const checks = parseAuthChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.AUTH.AUTH_PWQUALITY_MINLEN);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("warning");
    expect(check!.currentValue).toContain("14");
  });

  it("AUTH-PWQUALITY-MINLEN fails when minlen not configured", () => {
    const checks = parseAuthChecks(insecureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === CHECK_IDS.AUTH.AUTH_PWQUALITY_MINLEN);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  // ──────────────────────────────────────────────────────────
  // Mutation-killer tests
  // ──────────────────────────────────────────────────────────

  describe("ID array assertion — exact order from secure output", () => {
    it("should return all 22 check IDs in exact declaration order", () => {
      const checks = parseAuthChecks(secureOutput, "bare");
      const ids = checks.map((c) => c.id);
      expect(ids).toEqual([
        CHECK_IDS.AUTH.AUTH_NO_NOPASSWD_ALL,
        CHECK_IDS.AUTH.AUTH_PASSWORD_AGING,
        CHECK_IDS.AUTH.AUTH_NO_EMPTY_PASSWORDS,
        CHECK_IDS.AUTH.AUTH_ROOT_LOGIN_RESTRICTED,
        CHECK_IDS.AUTH.AUTH_PWD_QUALITY,
        CHECK_IDS.AUTH.AUTH_FAILLOCK_CONFIGURED,
        CHECK_IDS.AUTH.AUTH_SHADOW_PERMISSIONS,
        CHECK_IDS.AUTH.AUTH_SUDO_LOG,
        CHECK_IDS.AUTH.AUTH_SUDO_REQUIRETTY,
        CHECK_IDS.AUTH.AUTH_NO_UID0_DUPS,
        CHECK_IDS.AUTH.AUTH_PASS_MIN_DAYS,
        CHECK_IDS.AUTH.AUTH_PASS_WARN_AGE,
        CHECK_IDS.AUTH.AUTH_INACTIVE_LOCK,
        CHECK_IDS.AUTH.AUTH_SUDO_WHEEL_ONLY,
        CHECK_IDS.AUTH.AUTH_MFA_PRESENT,
        CHECK_IDS.AUTH.AUTH_SU_RESTRICTED,
        CHECK_IDS.AUTH.AUTH_PASS_MAX_DAYS_SET,
        CHECK_IDS.AUTH.AUTH_GSHADOW_PERMISSIONS,
        CHECK_IDS.AUTH.AUTH_PWQUALITY_CONFIGURED,
        CHECK_IDS.AUTH.AUTH_UMASK_LOGIN_DEFS,
        CHECK_IDS.AUTH.AUTH_SHA512_HASH,
        CHECK_IDS.AUTH.AUTH_PWQUALITY_MINLEN,
      ]);
    });
  });

  describe("N/A blanket assertion — all checks fail with Unable to determine", () => {
    it.each(["N/A", "", "  ", " N/A "])("input %j → all 22 checks fail with Unable to determine", (input) => {
      const checks = parseAuthChecks(input, "bare");
      expect(checks).toHaveLength(22);
      for (const check of checks) {
        expect(check.passed).toBe(false);
        expect(check.currentValue).toBe("Unable to determine");
      }
    });
  });

  describe("AUTH-PASS-MIN-DAYS boundary — passes at >= 1", () => {
    const mkOutput = (val: number) => `PASS_MIN_DAYS\t${val}`;
    const findCheck = (output: string) =>
      parseAuthChecks(output, "bare").find((c) => c.id === CHECK_IDS.AUTH.AUTH_PASS_MIN_DAYS)!;

    it("PASS_MIN_DAYS=0 → fail (boundary: below threshold)", () => {
      const check = findCheck(mkOutput(0));
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("PASS_MIN_DAYS = 0");
    });

    it("PASS_MIN_DAYS=1 → pass (boundary: exact threshold)", () => {
      const check = findCheck(mkOutput(1));
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("PASS_MIN_DAYS = 1");
    });

    it("PASS_MIN_DAYS=2 → pass (above threshold)", () => {
      const check = findCheck(mkOutput(2));
      expect(check.passed).toBe(true);
    });
  });

  describe("AUTH-PASS-WARN-AGE boundary — passes at >= 7", () => {
    const mkOutput = (val: number) => `PASS_WARN_AGE\t${val}`;
    const findCheck = (output: string) =>
      parseAuthChecks(output, "bare").find((c) => c.id === CHECK_IDS.AUTH.AUTH_PASS_WARN_AGE)!;

    it("PASS_WARN_AGE=6 → fail (boundary: below threshold)", () => {
      const check = findCheck(mkOutput(6));
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("PASS_WARN_AGE = 6");
    });

    it("PASS_WARN_AGE=7 → pass (boundary: exact threshold)", () => {
      const check = findCheck(mkOutput(7));
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("PASS_WARN_AGE = 7");
    });

    it("PASS_WARN_AGE=8 → pass (above threshold)", () => {
      const check = findCheck(mkOutput(8));
      expect(check.passed).toBe(true);
    });
  });

  describe("AUTH-INACTIVE-LOCK boundary — passes at 0..90 inclusive", () => {
    const mkOutput = (val: number) => `INACTIVE=${val}`;
    const findCheck = (output: string) =>
      parseAuthChecks(output, "bare").find((c) => c.id === CHECK_IDS.AUTH.AUTH_INACTIVE_LOCK)!;

    it("INACTIVE=0 → pass (boundary: lower inclusive)", () => {
      const check = findCheck(mkOutput(0));
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("INACTIVE = 0 days");
    });

    it("INACTIVE=90 → pass (boundary: upper inclusive)", () => {
      const check = findCheck(mkOutput(90));
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("INACTIVE = 90 days");
    });

    it("INACTIVE=91 → fail (boundary: above upper limit)", () => {
      const check = findCheck(mkOutput(91));
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("INACTIVE = 91 days");
    });

    it("INACTIVE not present → fail", () => {
      const check = findCheck("some unrelated text");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("INACTIVE not configured");
    });
  });

  describe("AUTH-PASS-MAX-DAYS-SET boundary — passes at > 0 and <= 365", () => {
    const mkOutput = (val: number) => `PASS_MAX_DAYS\t${val}`;
    const findCheck = (output: string) =>
      parseAuthChecks(output, "bare").find((c) => c.id === CHECK_IDS.AUTH.AUTH_PASS_MAX_DAYS_SET)!;

    it("PASS_MAX_DAYS=0 → fail (boundary: zero not allowed)", () => {
      const check = findCheck(mkOutput(0));
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("PASS_MAX_DAYS = 0");
    });

    it("PASS_MAX_DAYS=1 → pass (boundary: minimum valid)", () => {
      const check = findCheck(mkOutput(1));
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("PASS_MAX_DAYS = 1");
    });

    it("PASS_MAX_DAYS=365 → pass (boundary: upper inclusive)", () => {
      const check = findCheck(mkOutput(365));
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("PASS_MAX_DAYS = 365");
    });

    it("PASS_MAX_DAYS=366 → fail (boundary: above upper limit)", () => {
      const check = findCheck(mkOutput(366));
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("PASS_MAX_DAYS = 366");
    });

    it("PASS_MAX_DAYS not present → fail", () => {
      const check = findCheck("some unrelated text");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("PASS_MAX_DAYS not configured");
    });
  });

  describe("AUTH-PWQUALITY-MINLEN boundary — passes at >= 12", () => {
    const mkOutput = (val: number) => `minlen = ${val}`;
    const findCheck = (output: string) =>
      parseAuthChecks(output, "bare").find((c) => c.id === CHECK_IDS.AUTH.AUTH_PWQUALITY_MINLEN)!;

    it("minlen=11 → fail (boundary: below threshold)", () => {
      const check = findCheck(mkOutput(11));
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("minlen = 11");
    });

    it("minlen=12 → pass (boundary: exact threshold)", () => {
      const check = findCheck(mkOutput(12));
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("minlen = 12");
    });

    it("minlen=13 → pass (above threshold)", () => {
      const check = findCheck(mkOutput(13));
      expect(check.passed).toBe(true);
    });
  });

  describe("AUTH-SHADOW-PERMISSIONS — 000/600/640 pass, 644 fail", () => {
    const findCheck = (output: string) =>
      parseAuthChecks(output, "bare").find((c) => c.id === CHECK_IDS.AUTH.AUTH_SHADOW_PERMISSIONS)!;

    it("mode 000 → pass", () => {
      const check = findCheck("000");
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("Mode: 000");
    });

    it("mode 600 → pass", () => {
      const check = findCheck("600");
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("Mode: 600");
    });

    it("mode 640 → pass", () => {
      const check = findCheck("640");
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("Mode: 640");
    });

    it("mode 644 → fail (world-readable)", () => {
      const check = findCheck("644");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("Unable to determine /etc/shadow permissions");
    });

    it("mode 755 → fail (not in allowed set)", () => {
      const check = findCheck("755");
      expect(check.passed).toBe(false);
    });

    it("no permission value → fail", () => {
      const check = findCheck("some random text");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("Unable to determine /etc/shadow permissions");
    });
  });

  // ──────────────────────────────────────────────────────────
  // Mutation-killer tests — targeting survived mutants
  // ──────────────────────────────────────────────────────────

  describe("Mutation killers: L19 NOPASSWD regex variations", () => {
    const find = (output: string) =>
      parseAuthChecks(output, "bare").find((c) => c.id === CHECK_IDS.AUTH.AUTH_NO_NOPASSWD_ALL)!;

    it("NOPASSWD:ALL without space → fail", () => {
      expect(find("NOPASSWD:ALL").passed).toBe(false);
    });

    it("nopasswd: all (lowercase) → fail", () => {
      expect(find("nopasswd: all").passed).toBe(false);
    });

    it("NOPASSWD:  ALL (extra spaces) → fail", () => {
      expect(find("NOPASSWD:  ALL").passed).toBe(false);
    });

    it("NOPASSWD: SOME → pass (not ALL)", () => {
      expect(find("NOPASSWD: SOME").passed).toBe(true);
    });

    it("empty string has no NOPASSWD → pass=false because isNA", () => {
      expect(find("").passed).toBe(false);
    });

    it("clean output without NOPASSWD → pass", () => {
      expect(find("sudo:x:27:admin").passed).toBe(true);
      expect(find("sudo:x:27:admin").currentValue).toBe("No NOPASSWD: ALL rules found");
    });

    it("currentValue shows detection message when NOPASSWD:ALL found", () => {
      const check = find("NOPASSWD: ALL");
      expect(check.currentValue).toBe("NOPASSWD: ALL found in sudo config");
    });
  });

  describe("Mutation killers: L38 PASS_MAX_DAYS regex", () => {
    const find = (output: string) =>
      parseAuthChecks(output, "bare").find((c) => c.id === CHECK_IDS.AUTH.AUTH_PASSWORD_AGING)!;

    it("PASS_MAX_DAYS with tab → pass", () => {
      expect(find("PASS_MAX_DAYS\t90").passed).toBe(true);
      expect(find("PASS_MAX_DAYS\t90").currentValue).toBe("PASS_MAX_DAYS = 90");
    });

    it("PASS_MAX_DAYS with spaces → pass", () => {
      expect(find("PASS_MAX_DAYS   90").passed).toBe(true);
    });

    it("PASS_MAX_DAYS absent → fail", () => {
      const check = find("some unrelated text");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("Password aging not configured");
    });

    it("PASS_MAX_DAYS with value 0 → pass (just checks configured)", () => {
      // auth02 only checks if configured, not the value
      expect(find("PASS_MAX_DAYS 0").passed).toBe(true);
    });

    it("PASS_MAX_DAYS with value 99999 → pass (auth02 only checks presence)", () => {
      expect(find("PASS_MAX_DAYS 99999").passed).toBe(true);
    });
  });

  describe("Mutation killers: L45-48 passMaxDays conditional/equality", () => {
    const findAging = (output: string) =>
      parseAuthChecks(output, "bare").find((c) => c.id === CHECK_IDS.AUTH.AUTH_PASSWORD_AGING)!;

    it("isNA=true → passed=false even if content has PASS_MAX_DAYS", () => {
      // N/A triggers isNA=true, so passed should be false
      const check = findAging("N/A");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("Unable to determine");
    });

    it("passMaxDays is null when no match → passed=false, correct currentValue", () => {
      const check = findAging("random text without pass max days");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("Password aging not configured");
    });

    it("passMaxDays is not null when match → correct currentValue format", () => {
      const check = findAging("PASS_MAX_DAYS 45");
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("PASS_MAX_DAYS = 45");
    });
  });

  describe("Mutation killers: L60 lines split/map/filter chain", () => {
    const find = (output: string) =>
      parseAuthChecks(output, "bare").find((c) => c.id === CHECK_IDS.AUTH.AUTH_NO_EMPTY_PASSWORDS)!;

    it("output with only whitespace lines → no empty pw users detected", () => {
      const check = find("   \n   \n   ");
      // All lines become empty after trim, filter(Boolean) removes them → passed=false because isNA
      expect(check.passed).toBe(false);
    });

    it("output with newlines and valid username → detects empty pw user", () => {
      const check = find("some_config=value\n\nhacker\n");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toContain("hacker");
    });

    it("lines are trimmed before processing", () => {
      // Username with leading/trailing whitespace should still be detected
      const check = find("  testuser  ");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toContain("testuser");
    });
  });

  describe("Mutation killers: L65-70 empty password filter skip conditions", () => {
    const find = (output: string) =>
      parseAuthChecks(output, "bare").find((c) => c.id === CHECK_IDS.AUTH.AUTH_NO_EMPTY_PASSWORDS)!;

    // Each of these lines should be SKIPPED (not treated as a username)
    const skipLines = [
      { label: "= sign (config line)", line: "PASS_MAX_DAYS=90" },
      { label: ":x: (passwd line)", line: "root:x:0:0:root:/root:/bin/bash" },
      { label: "pam_ (PAM module)", line: "pam_unix.so" },
      { label: "PASS_ (password policy)", line: "PASS_MIN_DAYS 1" },
      { label: "auth  (PAM auth)", line: "auth required pam_unix.so" },
      { label: "password  (PAM password)", line: "password requisite pam_pwquality.so" },
      // N/A is excluded from this test — it triggers isNA=true which sets passed=false globally
      { label: "sudo keyword", line: "sudo:x:27:admin" },
      { label: "requisite keyword", line: "requisite pam_permit.so" },
      { label: "session keyword", line: "session optional pam_loginuid.so" },
      { label: "account keyword", line: "account required pam_permit.so" },
      { label: "include keyword", line: "include system-auth" },
      { label: "optional keyword", line: "optional pam_motd.so" },
      { label: "required keyword", line: "required pam_securetty.so" },
      { label: "sufficient keyword", line: "sufficient pam_rootok.so" },
      { label: "nullok keyword", line: "nullok_secure" },
      { label: "common keyword", line: "common-auth" },
      { label: "substack keyword", line: "substack password-auth" },
    ];

    it.each(skipLines)("skips line with $label", ({ line }) => {
      // These lines should be filtered out, not treated as usernames
      const check = find(line);
      expect(check.passed).toBe(true);
      // Should not appear in currentValue as an empty password user
      expect(check.currentValue).toBe("No accounts with empty passwords");
    });

    it("does NOT skip a plain username (detects as empty pw user)", () => {
      const check = find("hackerman");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toContain("hackerman");
    });

    it("skips config lines but detects usernames in mixed output", () => {
      const output = [
        "auth required pam_unix.so",
        "PASS_MAX_DAYS 90",
        "sudo:x:27:admin",
        "baduser",
      ].join("\n");
      const check = find(output);
      expect(check.passed).toBe(false);
      expect(check.currentValue).toContain("baduser");
      // Should NOT contain config line text
      expect(check.currentValue).not.toContain("pam_unix");
    });

    it("username pattern rejects strings with spaces", () => {
      // L74: /^[a-z_][a-z0-9_-]{0,31}$/i — spaces disqualify
      const check = find("not a username");
      expect(check.passed).toBe(true);
    });

    it("username pattern rejects strings longer than 32 chars", () => {
      const longName = "a" + "b".repeat(32); // 33 chars
      const check = find(longName);
      expect(check.passed).toBe(true);
    });

    it("username pattern accepts valid 32-char username", () => {
      const name32 = "a" + "b".repeat(31); // 32 chars
      const check = find(name32);
      expect(check.passed).toBe(false);
      expect(check.currentValue).toContain(name32);
    });

    it("username pattern accepts underscore-start and hyphens", () => {
      const check = find("_my-user_01");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toContain("_my-user_01");
    });

    it("username pattern is case-insensitive", () => {
      const check = find("TestUser");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toContain("TestUser");
    });
  });

  describe("Mutation killers: L83-93 emptyPwUsers length and fixCommand", () => {
    const find = (output: string) =>
      parseAuthChecks(output, "bare").find((c) => c.id === CHECK_IDS.AUTH.AUTH_NO_EMPTY_PASSWORDS)!;

    it("zero empty pw users → passed=true, currentValue says no accounts", () => {
      const check = find("auth required pam_unix.so");
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("No accounts with empty passwords");
    });

    it("one empty pw user → passed=false, fixCommand targets that user", () => {
      const check = find("baduser");
      expect(check.passed).toBe(false);
      expect(check.fixCommand).toBe("passwd -l baduser");
    });

    it("two empty pw users → fixCommand targets first user only", () => {
      const check = find("alice\nbob");
      expect(check.passed).toBe(false);
      expect(check.fixCommand).toBe("passwd -l alice");
      expect(check.currentValue).toContain("alice");
      expect(check.currentValue).toContain("bob");
    });

    it("no empty pw users → fixCommand is the awk detection command", () => {
      const check = find("auth required pam_unix.so");
      expect(check.fixCommand).toContain("awk");
      expect(check.fixCommand).toContain("/etc/shadow");
    });

    it("isNA → passed=false, currentValue=Unable to determine", () => {
      const check = find("N/A");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("Unable to determine");
    });
  });

  describe("Mutation killers: L98-104 AUTH-ROOT-LOGIN-RESTRICTED", () => {
    const find = (output: string) =>
      parseAuthChecks(output, "bare").find((c) => c.id === CHECK_IDS.AUTH.AUTH_ROOT_LOGIN_RESTRICTED)!;

    it("'root' on its own line without prohibit-password → fail", () => {
      const check = find("root");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("Root direct login may be enabled");
    });

    it("'root' with prohibit-password → pass", () => {
      const check = find("root\nprohibit-password");
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("Root direct login restricted");
    });

    it("no 'root' line at all → pass", () => {
      const check = find("admin\nuser1");
      expect(check.passed).toBe(true);
    });

    it("'rootuser' (not exact 'root') → pass (regex uses ^root$)", () => {
      const check = find("rootuser");
      expect(check.passed).toBe(true);
    });

    it("'root' embedded in longer line → pass (not ^root$ on own line)", () => {
      const check = find("the root user is disabled");
      expect(check.passed).toBe(true);
    });

    it("isNA → passed=false", () => {
      const check = find("N/A");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("Unable to determine");
    });

    it("severity is warning", () => {
      const check = find("root");
      expect(check.severity).toBe("warning");
    });
  });

  describe("Mutation killers: L117 AUTH-PWD-QUALITY OR logic", () => {
    const find = (output: string) =>
      parseAuthChecks(output, "bare").find((c) => c.id === CHECK_IDS.AUTH.AUTH_PWD_QUALITY)!;

    it("pam_pwquality present → pass", () => {
      expect(find("pam_pwquality.so").passed).toBe(true);
      expect(find("pam_pwquality.so").currentValue).toBe("Password quality module configured");
    });

    it("pam_cracklib present → pass", () => {
      expect(find("pam_cracklib.so").passed).toBe(true);
    });

    it("PAM_PWQUALITY uppercase → pass (case insensitive)", () => {
      expect(find("PAM_PWQUALITY").passed).toBe(true);
    });

    it("neither present → fail", () => {
      const check = find("pam_unix.so only");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("No password quality module found");
    });

    it("isNA → fail", () => {
      expect(find("N/A").passed).toBe(false);
    });
  });

  describe("Mutation killers: L138 AUTH-FAILLOCK-CONFIGURED pam_tally2 alternative", () => {
    const find = (output: string) =>
      parseAuthChecks(output, "bare").find((c) => c.id === CHECK_IDS.AUTH.AUTH_FAILLOCK_CONFIGURED)!;

    it("pam_faillock → pass", () => {
      expect(find("pam_faillock.so").passed).toBe(true);
    });

    it("pam_tally2 → pass", () => {
      expect(find("pam_tally2.so").passed).toBe(true);
    });

    it("PAM_FAILLOCK uppercase → pass", () => {
      expect(find("PAM_FAILLOCK").passed).toBe(true);
    });

    it("neither → fail", () => {
      expect(find("pam_unix.so").passed).toBe(false);
      expect(find("pam_unix.so").currentValue).toBe("No account lockout module found in PAM config");
    });

    it("pam_faillock → currentValue mentions configured", () => {
      expect(find("pam_faillock").currentValue).toBe("pam_faillock or pam_tally2 configured");
    });
  });

  describe("Mutation killers: L157 AUTH-SHADOW-PERMISSIONS regex", () => {
    const find = (output: string) =>
      parseAuthChecks(output, "bare").find((c) => c.id === CHECK_IDS.AUTH.AUTH_SHADOW_PERMISSIONS)!;

    it("660 is not in the secure set → fail", () => {
      const check = find("660");
      expect(check.passed).toBe(false);
    });

    it("perm embedded in text (no own line) → not matched", () => {
      const check = find("mode is 640 here");
      expect(check.passed).toBe(false);
    });

    it("700 on its own line → not matched by shadow regex (000|600|640)", () => {
      const check = find("700");
      expect(check.passed).toBe(false);
    });
  });

  describe("Mutation killers: L178 AUTH-SUDO-LOG", () => {
    const find = (output: string) =>
      parseAuthChecks(output, "bare").find((c) => c.id === CHECK_IDS.AUTH.AUTH_SUDO_LOG)!;

    it("log_output → pass", () => {
      expect(find("Defaults log_output").passed).toBe(true);
      expect(find("Defaults log_output").currentValue).toBe("Sudo logging configured (log_output or syslog)");
    });

    it("syslog → pass", () => {
      expect(find("Defaults syslog").passed).toBe(true);
    });

    it("LOG_OUTPUT uppercase → pass", () => {
      expect(find("LOG_OUTPUT").passed).toBe(true);
    });

    it("neither → fail", () => {
      expect(find("no logging here").passed).toBe(false);
      expect(find("no logging here").currentValue).toBe("Sudo logging not configured");
    });
  });

  describe("Mutation killers: L197 AUTH-SUDO-REQUIRETTY", () => {
    const find = (output: string) =>
      parseAuthChecks(output, "bare").find((c) => c.id === CHECK_IDS.AUTH.AUTH_SUDO_REQUIRETTY)!;

    it("requiretty → pass", () => {
      expect(find("Defaults requiretty").passed).toBe(true);
      expect(find("Defaults requiretty").currentValue).toBe("requiretty configured in sudoers");
    });

    it("REQUIRETTY uppercase → pass", () => {
      expect(find("REQUIRETTY").passed).toBe(true);
    });

    it("absent → fail", () => {
      expect(find("no tty config").passed).toBe(false);
      expect(find("no tty config").currentValue).toBe("requiretty not configured in sudoers");
    });
  });

  describe("Mutation killers: L218 AUTH-NO-UID0-DUPS regex + logical", () => {
    const find = (output: string) =>
      parseAuthChecks(output, "bare").find((c) => c.id === CHECK_IDS.AUTH.AUTH_NO_UID0_DUPS)!;

    it("only root → pass (hasOnlyRoot=true)", () => {
      const check = find("root:0:root");
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("Only root has UID 0");
    });

    it("toor present → fail", () => {
      const check = find("root\ntoor");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("Multiple accounts with UID 0 detected");
    });

    it("non-root username on own line → fail (regex catches it)", () => {
      const check = find("root\nadmin");
      expect(check.passed).toBe(false);
    });

    it("root alone on its own line → pass (regex negative lookahead allows root)", () => {
      const check = find("root");
      expect(check.passed).toBe(true);
    });

    it("rootbackup on own line → pass (starts with root, negative lookahead blocks)", () => {
      const check = find("rootbackup");
      expect(check.passed).toBe(true);
    });

    it("admin_user on own line → fail (non-root UID 0 alias)", () => {
      const check = find("admin_user");
      expect(check.passed).toBe(false);
    });

    it("isNA → fail", () => {
      expect(find("N/A").passed).toBe(false);
    });
  });

  describe("Mutation killers: L237-279 PASS_MIN_DAYS/PASS_WARN_AGE/INACTIVE regex", () => {
    it("PASS_MIN_DAYS with multiple spaces → parsed correctly", () => {
      const check = parseAuthChecks("PASS_MIN_DAYS   5", "bare")
        .find((c) => c.id === CHECK_IDS.AUTH.AUTH_PASS_MIN_DAYS)!;
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("PASS_MIN_DAYS = 5");
    });

    it("PASS_WARN_AGE with tab → parsed correctly", () => {
      const check = parseAuthChecks("PASS_WARN_AGE\t14", "bare")
        .find((c) => c.id === CHECK_IDS.AUTH.AUTH_PASS_WARN_AGE)!;
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("PASS_WARN_AGE = 14");
    });

    it("INACTIVE with = sign (no space) → parsed correctly", () => {
      const check = parseAuthChecks("INACTIVE=30", "bare")
        .find((c) => c.id === CHECK_IDS.AUTH.AUTH_INACTIVE_LOCK)!;
      expect(check.passed).toBe(true);
    });

    it("INACTIVE with = and spaces → parsed correctly", () => {
      const check = parseAuthChecks("INACTIVE = 30", "bare")
        .find((c) => c.id === CHECK_IDS.AUTH.AUTH_INACTIVE_LOCK)!;
      expect(check.passed).toBe(true);
    });

    it("INACTIVE with just space (no =) → parsed correctly", () => {
      const check = parseAuthChecks("INACTIVE 30", "bare")
        .find((c) => c.id === CHECK_IDS.AUTH.AUTH_INACTIVE_LOCK)!;
      expect(check.passed).toBe(true);
    });

    it("inactive lowercase → parsed (case insensitive)", () => {
      const check = parseAuthChecks("inactive=30", "bare")
        .find((c) => c.id === CHECK_IDS.AUTH.AUTH_INACTIVE_LOCK)!;
      expect(check.passed).toBe(true);
    });
  });

  describe("Mutation killers: L299-311 AUTH-SUDO-WHEEL-ONLY parsing", () => {
    const find = (output: string) =>
      parseAuthChecks(output, "bare").find((c) => c.id === CHECK_IDS.AUTH.AUTH_SUDO_WHEEL_ONLY)!;

    it("sudo group with 1 member → pass", () => {
      const check = find("sudo:x:27:admin");
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("1 sudo member(s): admin");
    });

    it("sudo group with 3 members → pass (boundary)", () => {
      const check = find("sudo:x:27:a,b,c");
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("3 sudo member(s): a, b, c");
    });

    it("sudo group with 4 members → fail (above limit)", () => {
      const check = find("sudo:x:27:a,b,c,d");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("4 sudo member(s): a, b, c, d");
    });

    it("sudo group with no members → pass, shows no members", () => {
      const check = find("sudo:x:27:");
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("No sudo group members found");
    });

    it("no sudo group line → pass (0 members)", () => {
      const check = find("some random text");
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("No sudo group members found");
    });

    it("sudo group with spaces in member list → trims correctly", () => {
      const check = find("sudo:x:27: admin , user1 ");
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("2 sudo member(s): admin, user1");
    });

    it("isNA → fail", () => {
      expect(find("N/A").passed).toBe(false);
    });
  });

  describe("Mutation killers: L321 AUTH-MFA-PRESENT", () => {
    const find = (output: string) =>
      parseAuthChecks(output, "bare").find((c) => c.id === CHECK_IDS.AUTH.AUTH_MFA_PRESENT)!;

    it("libpam-google-authenticator → pass", () => {
      expect(find("ii  libpam-google-authenticator").passed).toBe(true);
      expect(find("libpam-google-authenticator").currentValue).toContain("MFA package detected");
    });

    it("libpam-oath → pass", () => {
      expect(find("libpam-oath").passed).toBe(true);
    });

    it("LIBPAM-GOOGLE-AUTHENTICATOR uppercase → pass", () => {
      expect(find("LIBPAM-GOOGLE-AUTHENTICATOR").passed).toBe(true);
    });

    it("neither present → fail", () => {
      const check = find("no mfa installed");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("No MFA package installed");
    });
  });

  describe("Mutation killers: L340 AUTH-SU-RESTRICTED", () => {
    const find = (output: string) =>
      parseAuthChecks(output, "bare").find((c) => c.id === CHECK_IDS.AUTH.AUTH_SU_RESTRICTED)!;

    it("pam_wheel → pass", () => {
      expect(find("auth required pam_wheel.so use_uid").passed).toBe(true);
      expect(find("pam_wheel").currentValue).toBe("pam_wheel configured in /etc/pam.d/su");
    });

    it("PAM_WHEEL uppercase → pass", () => {
      expect(find("PAM_WHEEL").passed).toBe(true);
    });

    it("absent → fail", () => {
      expect(find("no wheel config").passed).toBe(false);
      expect(find("no wheel config").currentValue).toBe("pam_wheel not found in /etc/pam.d/su");
    });
  });

  describe("Mutation killers: L359-376 AUTH-PASS-MAX-DAYS-SET detailed", () => {
    const find = (output: string) =>
      parseAuthChecks(output, "bare").find((c) => c.id === CHECK_IDS.AUTH.AUTH_PASS_MAX_DAYS_SET)!;

    it("PASS_MAX_DAYS 90 → pass", () => {
      const check = find("PASS_MAX_DAYS\t90");
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("PASS_MAX_DAYS = 90");
    });

    it("PASS_MAX_DAYS absent → fail with correct message", () => {
      const check = find("no config");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("PASS_MAX_DAYS not configured");
    });
  });

  describe("Mutation killers: L381-400 AUTH-GSHADOW-PERMISSIONS", () => {
    const find = (output: string) =>
      parseAuthChecks(output, "bare").find((c) => c.id === CHECK_IDS.AUTH.AUTH_GSHADOW_PERMISSIONS)!;

    it("two standalone perms: 640 + 640 → gshadow pass", () => {
      const check = find("640\n640");
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("Mode: 640");
    });

    it("two standalone perms: 640 + 644 → gshadow fail (644 not secure)", () => {
      const check = find("640\n644");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("Mode: 644");
    });

    it("two standalone perms: 640 + 000 → gshadow pass", () => {
      const check = find("640\n000");
      expect(check.passed).toBe(true);
    });

    it("two standalone perms: 640 + 600 → gshadow pass", () => {
      const check = find("640\n600");
      expect(check.passed).toBe(true);
    });

    it("only one perm value → gshadow null → fail", () => {
      const check = find("640");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("Unable to determine /etc/gshadow permissions");
    });

    it("three perms: 640 + 755 + 000 → gshadow=755 (second match) → fail", () => {
      const check = find("640\n755\n000");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("Mode: 755");
    });

    it("two standalone perms: 000 + 640 → gshadow=640 → pass", () => {
      const check = find("000\n640");
      expect(check.passed).toBe(true);
    });
  });

  describe("Mutation killers: L404 AUTH-PWQUALITY-CONFIGURED", () => {
    const find = (output: string) =>
      parseAuthChecks(output, "bare").find((c) => c.id === CHECK_IDS.AUTH.AUTH_PWQUALITY_CONFIGURED)!;

    it("pam_cracklib → pass", () => {
      expect(find("pam_cracklib.so retry=3").passed).toBe(true);
      expect(find("pam_cracklib").currentValue).toBe("pam_pwquality or pam_cracklib configured in /etc/pam.d/");
    });

    it("pam_pwquality → pass", () => {
      expect(find("password requisite pam_pwquality.so").passed).toBe(true);
    });

    it("neither → fail", () => {
      expect(find("no quality module").passed).toBe(false);
      expect(find("no quality module").currentValue).toBe("No password quality module in /etc/pam.d/");
    });
  });

  describe("Mutation killers: L423-441 AUTH-UMASK-LOGIN-DEFS", () => {
    const find = (output: string) =>
      parseAuthChecks(output, "bare").find((c) => c.id === CHECK_IDS.AUTH.AUTH_UMASK_LOGIN_DEFS)!;

    it("UMASK 027 → pass", () => {
      const check = find("UMASK\t027");
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("UMASK = 027");
    });

    it("UMASK 022 → pass", () => {
      const check = find("UMASK\t022");
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("UMASK = 022");
    });

    it("UMASK 077 → fail (not 027 or 022)", () => {
      const check = find("UMASK\t077");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("UMASK = 077");
    });

    it("UMASK 002 → fail", () => {
      const check = find("UMASK\t002");
      expect(check.passed).toBe(false);
    });

    it("UMASK not present → fail", () => {
      const check = find("no umask");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("UMASK not set in /etc/login.defs");
    });

    it("UMASK at start of line required (regex ^UMASK)", () => {
      const check = find("XUMASK 027");
      expect(check.passed).toBe(false);
    });
  });

  describe("Mutation killers: L444-462 AUTH-SHA512-HASH", () => {
    const find = (output: string) =>
      parseAuthChecks(output, "bare").find((c) => c.id === CHECK_IDS.AUTH.AUTH_SHA512_HASH)!;

    it("ENCRYPT_METHOD SHA512 → pass", () => {
      const check = find("ENCRYPT_METHOD SHA512");
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("ENCRYPT_METHOD = SHA512");
    });

    it("ENCRYPT_METHOD YESCRYPT → pass", () => {
      const check = find("ENCRYPT_METHOD YESCRYPT");
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("ENCRYPT_METHOD = YESCRYPT");
    });

    it("ENCRYPT_METHOD yescrypt lowercase → pass (toUpperCase applied)", () => {
      const check = find("ENCRYPT_METHOD yescrypt");
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("ENCRYPT_METHOD = YESCRYPT");
    });

    it("ENCRYPT_METHOD MD5 → fail (weak algorithm)", () => {
      const check = find("ENCRYPT_METHOD MD5");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("ENCRYPT_METHOD = MD5");
    });

    it("ENCRYPT_METHOD DES → fail", () => {
      const check = find("ENCRYPT_METHOD DES");
      expect(check.passed).toBe(false);
    });

    it("no ENCRYPT_METHOD → fail", () => {
      const check = find("no encrypt config");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("ENCRYPT_METHOD not configured");
    });

    it("ENCRYPT_METHOD at start of line required", () => {
      const check = find("XENCRYPT_METHOD SHA512");
      expect(check.passed).toBe(false);
    });
  });

  describe("Mutation killers: L465-483 AUTH-PWQUALITY-MINLEN", () => {
    const find = (output: string) =>
      parseAuthChecks(output, "bare").find((c) => c.id === CHECK_IDS.AUTH.AUTH_PWQUALITY_MINLEN)!;

    it("minlen = 14 → pass", () => {
      const check = find("minlen = 14");
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("minlen = 14");
    });

    it("minlen=8 → fail (below 12)", () => {
      const check = find("minlen=8");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("minlen = 8");
    });

    it("minlen with no space around = → parsed", () => {
      const check = find("minlen=12");
      expect(check.passed).toBe(true);
    });

    it("minlen not present → fail", () => {
      const check = find("no minlen config");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toBe("minlen not configured in pwquality.conf");
    });

    it("MINLEN uppercase → parsed (case insensitive regex)", () => {
      const check = find("MINLEN = 15");
      expect(check.passed).toBe(true);
    });
  });

  describe("Mutation killers: secure output comprehensive field checks", () => {
    let checks: ReturnType<typeof parseAuthChecks>;
    beforeAll(() => {
      checks = parseAuthChecks([
        "auth required pam_unix.so\npassword requisite pam_pwquality.so\nauth required pam_faillock.so preauth",
        "sudo:x:27:admin",
        "PASS_MAX_DAYS\t90\nPASS_MIN_DAYS\t1\nPASS_WARN_AGE\t7",
        "N/A",
        "640",
        "Defaults log_output",
        "Defaults requiretty",
        "root:0:root",
        "auth required pam_faillock.so preauth",
        "ii  libpam-google-authenticator 20191231-2 amd64 Two-step verification",
        "INACTIVE=30",
        "auth required pam_wheel.so use_uid",
        "640",
        "/etc/pam.d/common-password:password requisite pam_pwquality.so retry=3",
        "UMASK\t027",
        "ENCRYPT_METHOD SHA512",
        "minlen = 14",
      ].join("\n"), "bare");
    });

    it("all 22 checks pass on secure output", () => {
      for (const check of checks) {
        expect({ id: check.id, passed: check.passed }).toEqual(
          expect.objectContaining({ passed: true }),
        );
      }
    });

    it("every check has non-empty fixCommand", () => {
      for (const check of checks) {
        expect(check.fixCommand).toBeTruthy();
        expect(check.fixCommand!.length).toBeGreaterThan(0);
      }
    });

    it("every check has non-empty explain", () => {
      for (const check of checks) {
        expect(check.explain).toBeTruthy();
        expect(check.explain!.length).toBeGreaterThan(0);
      }
    });

    it("every check has correct category", () => {
      for (const check of checks) {
        expect(check.category).toBe("Auth");
      }
    });
  });

  describe("Mutation killers: insecure output comprehensive fail checks", () => {
    const insecure = [
      "auth required pam_unix.so",
      "sudo:x:27:admin,user1,user2,user3,user4",
      "N/A",
      "testuser\nolduser",
      "644",
      "NONE",
      "NONE",
      "root\ntoor",
      "NONE",
      "NONE",
      "N/A",
    ].join("\n");

    let checks: ReturnType<typeof parseAuthChecks>;
    beforeAll(() => {
      checks = parseAuthChecks(insecure, "bare");
    });

    it("AUTH-NO-NOPASSWD-ALL passes (no NOPASSWD in insecure output)", () => {
      expect(checks.find((c) => c.id === CHECK_IDS.AUTH.AUTH_NO_NOPASSWD_ALL)!.passed).toBe(true);
    });

    it("AUTH-PASSWORD-AGING fails", () => {
      expect(checks.find((c) => c.id === CHECK_IDS.AUTH.AUTH_PASSWORD_AGING)!.passed).toBe(false);
    });

    it("AUTH-NO-EMPTY-PASSWORDS fails with user list", () => {
      const check = checks.find((c) => c.id === CHECK_IDS.AUTH.AUTH_NO_EMPTY_PASSWORDS)!;
      expect(check.passed).toBe(false);
      expect(check.currentValue).toContain("testuser");
      expect(check.currentValue).toContain("olduser");
    });

    it("AUTH-ROOT-LOGIN-RESTRICTED fails (root + toor, no prohibit-password)", () => {
      expect(checks.find((c) => c.id === CHECK_IDS.AUTH.AUTH_ROOT_LOGIN_RESTRICTED)!.passed).toBe(false);
    });

    it("AUTH-PWD-QUALITY fails", () => {
      expect(checks.find((c) => c.id === CHECK_IDS.AUTH.AUTH_PWD_QUALITY)!.passed).toBe(false);
    });

    it("AUTH-FAILLOCK-CONFIGURED fails", () => {
      expect(checks.find((c) => c.id === CHECK_IDS.AUTH.AUTH_FAILLOCK_CONFIGURED)!.passed).toBe(false);
    });

    it("AUTH-SUDO-WHEEL-ONLY fails (5 members)", () => {
      const check = checks.find((c) => c.id === CHECK_IDS.AUTH.AUTH_SUDO_WHEEL_ONLY)!;
      expect(check.passed).toBe(false);
      expect(check.currentValue).toContain("5 sudo member");
    });

    it("AUTH-NO-UID0-DUPS fails (toor present)", () => {
      expect(checks.find((c) => c.id === CHECK_IDS.AUTH.AUTH_NO_UID0_DUPS)!.passed).toBe(false);
    });

    it("AUTH-MFA-PRESENT fails", () => {
      expect(checks.find((c) => c.id === CHECK_IDS.AUTH.AUTH_MFA_PRESENT)!.passed).toBe(false);
    });

    it("AUTH-SU-RESTRICTED fails", () => {
      expect(checks.find((c) => c.id === CHECK_IDS.AUTH.AUTH_SU_RESTRICTED)!.passed).toBe(false);
    });

    it("AUTH-SUDO-LOG fails", () => {
      expect(checks.find((c) => c.id === CHECK_IDS.AUTH.AUTH_SUDO_LOG)!.passed).toBe(false);
    });

    it("AUTH-SUDO-REQUIRETTY fails", () => {
      expect(checks.find((c) => c.id === CHECK_IDS.AUTH.AUTH_SUDO_REQUIRETTY)!.passed).toBe(false);
    });
  });

  describe("Mutation killers: safeToAutoFix field presence", () => {
    it("checks with safeToAutoFix='SAFE' are correctly marked", () => {
      const checks = parseAuthChecks("PASS_MAX_DAYS 90", "bare");
      const withSafe = checks.filter((c) => c.safeToAutoFix === "SAFE");
      // Most auth checks have safeToAutoFix: "SAFE" — at least 15+
      expect(withSafe.length).toBeGreaterThanOrEqual(15);
    });

    it("AUTH-NO-EMPTY-PASSWORDS has no safeToAutoFix (conditional fixCommand)", () => {
      const checks = parseAuthChecks("baduser", "bare");
      const check = checks.find((c) => c.id === CHECK_IDS.AUTH.AUTH_NO_EMPTY_PASSWORDS)!;
      // This check does NOT have safeToAutoFix set
      expect(check.safeToAutoFix).toBeUndefined();
    });
  });

  describe("Mutation killers: severity field correctness", () => {
    const checks = parseAuthChecks("placeholder", "bare");
    const findById = (id: string) => checks.find((c) => c.id === id)!;

    it("critical checks", () => {
      expect(findById(CHECK_IDS.AUTH.AUTH_NO_NOPASSWD_ALL).severity).toBe("critical");
      expect(findById(CHECK_IDS.AUTH.AUTH_NO_EMPTY_PASSWORDS).severity).toBe("critical");
      expect(findById(CHECK_IDS.AUTH.AUTH_SHADOW_PERMISSIONS).severity).toBe("critical");
      expect(findById(CHECK_IDS.AUTH.AUTH_NO_UID0_DUPS).severity).toBe("critical");
    });

    it("warning checks", () => {
      expect(findById(CHECK_IDS.AUTH.AUTH_ROOT_LOGIN_RESTRICTED).severity).toBe("warning");
      expect(findById(CHECK_IDS.AUTH.AUTH_FAILLOCK_CONFIGURED).severity).toBe("warning");
      expect(findById(CHECK_IDS.AUTH.AUTH_SUDO_LOG).severity).toBe("warning");
      expect(findById(CHECK_IDS.AUTH.AUTH_GSHADOW_PERMISSIONS).severity).toBe("warning");
      expect(findById(CHECK_IDS.AUTH.AUTH_PWQUALITY_CONFIGURED).severity).toBe("warning");
      expect(findById(CHECK_IDS.AUTH.AUTH_SHA512_HASH).severity).toBe("warning");
      expect(findById(CHECK_IDS.AUTH.AUTH_PWQUALITY_MINLEN).severity).toBe("warning");
    });

    it("info checks", () => {
      expect(findById(CHECK_IDS.AUTH.AUTH_PASSWORD_AGING).severity).toBe("info");
      expect(findById(CHECK_IDS.AUTH.AUTH_PWD_QUALITY).severity).toBe("info");
      expect(findById(CHECK_IDS.AUTH.AUTH_SUDO_REQUIRETTY).severity).toBe("info");
      expect(findById(CHECK_IDS.AUTH.AUTH_PASS_MIN_DAYS).severity).toBe("info");
      expect(findById(CHECK_IDS.AUTH.AUTH_PASS_WARN_AGE).severity).toBe("info");
      expect(findById(CHECK_IDS.AUTH.AUTH_INACTIVE_LOCK).severity).toBe("info");
      expect(findById(CHECK_IDS.AUTH.AUTH_SUDO_WHEEL_ONLY).severity).toBe("info");
      expect(findById(CHECK_IDS.AUTH.AUTH_MFA_PRESENT).severity).toBe("info");
      expect(findById(CHECK_IDS.AUTH.AUTH_SU_RESTRICTED).severity).toBe("info");
      expect(findById(CHECK_IDS.AUTH.AUTH_PASS_MAX_DAYS_SET).severity).toBe("info");
      expect(findById(CHECK_IDS.AUTH.AUTH_UMASK_LOGIN_DEFS).severity).toBe("info");
    });
  });

  describe("[MUTATION-KILLER] Auth check metadata completeness", () => {
    const checks = parseAuthChecks(secureOutput, "bare");
    const findById = (id: string) => checks.find((c) => c.id === id)!;

    const expectedMeta: Array<[string, string, string]> = [
      [CHECK_IDS.AUTH.AUTH_NO_NOPASSWD_ALL, "critical", "SAFE"],
      [CHECK_IDS.AUTH.AUTH_PASSWORD_AGING, "info", "SAFE"],
      [CHECK_IDS.AUTH.AUTH_NO_EMPTY_PASSWORDS, "critical", ""],
      [CHECK_IDS.AUTH.AUTH_ROOT_LOGIN_RESTRICTED, "warning", "SAFE"],
      [CHECK_IDS.AUTH.AUTH_PWD_QUALITY, "info", "SAFE"],
      [CHECK_IDS.AUTH.AUTH_FAILLOCK_CONFIGURED, "warning", "SAFE"],
      [CHECK_IDS.AUTH.AUTH_SHADOW_PERMISSIONS, "critical", "SAFE"],
      [CHECK_IDS.AUTH.AUTH_SUDO_LOG, "warning", "SAFE"],
      [CHECK_IDS.AUTH.AUTH_SUDO_REQUIRETTY, "info", "SAFE"],
      [CHECK_IDS.AUTH.AUTH_NO_UID0_DUPS, "critical", "SAFE"],
      [CHECK_IDS.AUTH.AUTH_PASS_MIN_DAYS, "info", "SAFE"],
      [CHECK_IDS.AUTH.AUTH_PASS_WARN_AGE, "info", "SAFE"],
      [CHECK_IDS.AUTH.AUTH_INACTIVE_LOCK, "info", "SAFE"],
      [CHECK_IDS.AUTH.AUTH_SUDO_WHEEL_ONLY, "info", "SAFE"],
      [CHECK_IDS.AUTH.AUTH_MFA_PRESENT, "info", "SAFE"],
      [CHECK_IDS.AUTH.AUTH_SU_RESTRICTED, "info", "SAFE"],
      [CHECK_IDS.AUTH.AUTH_PASS_MAX_DAYS_SET, "info", "SAFE"],
      [CHECK_IDS.AUTH.AUTH_GSHADOW_PERMISSIONS, "warning", "SAFE"],
      [CHECK_IDS.AUTH.AUTH_PWQUALITY_CONFIGURED, "warning", "SAFE"],
      [CHECK_IDS.AUTH.AUTH_UMASK_LOGIN_DEFS, "info", "SAFE"],
      [CHECK_IDS.AUTH.AUTH_SHA512_HASH, "warning", "SAFE"],
      [CHECK_IDS.AUTH.AUTH_PWQUALITY_MINLEN, "warning", "SAFE"],
    ];

    it.each(expectedMeta)("[MUTATION-KILLER] %s has severity=%s, safeToAutoFix=%s", (id, severity, safe) => {
      const c = findById(id);
      expect(c).toBeDefined();
      expect(c.category).toBe("Auth");
      expect(c.severity).toBe(severity);
      if (safe) expect(c.safeToAutoFix).toBe(safe);
    });

    it("[MUTATION-KILLER] every check has non-empty fixCommand and explain", () => {
      checks.forEach((c) => {
        expect(c.fixCommand).toBeDefined();
        expect(c.fixCommand!.length).toBeGreaterThan(0);
        expect(c.explain).toBeDefined();
        expect(c.explain!.length).toBeGreaterThan(10);
        expect(c.expectedValue).toBeDefined();
        expect(c.expectedValue!.length).toBeGreaterThan(0);
      });
    });

    it("[MUTATION-KILLER] all IDs start with AUTH-", () => {
      checks.forEach((c) => expect(c.id).toMatch(/^AUTH-/));
    });
  });
});
