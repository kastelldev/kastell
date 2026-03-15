import { parseAuthChecks } from "../../src/core/audit/checks/auth.js";

describe("parseAuthChecks", () => {
  const secureOutput = [
    // PAM config (password quality present)
    "auth required pam_unix.so\npassword requisite pam_pwquality.so",
    // sudo group
    "sudo:x:27:admin",
    // Password aging
    "PASS_MAX_DAYS\t99999\nPASS_MIN_DAYS\t0\nPASS_WARN_AGE\t7",
    // No empty password accounts
    "N/A",
  ].join("\n");

  const insecureOutput = [
    // PAM config (no quality module)
    "auth required pam_unix.so",
    // sudo group
    "sudo:x:27:admin",
    // Password aging
    "N/A",
    // Empty password accounts
    "testuser\nolduser",
  ].join("\n");

  it("should return 5 checks", () => {
    const checks = parseAuthChecks(secureOutput, "bare");
    expect(checks).toHaveLength(5);
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
    ].join("\n");
    const checks = parseAuthChecks(nopasswdOutput, "bare");
    const auth01 = checks.find((c: { id: string }) => c.id === "AUTH-NO-NOPASSWD-ALL");
    expect(auth01!.passed).toBe(false);
    expect(auth01!.severity).toBe("critical");
  });

  it("should handle N/A output gracefully", () => {
    const checks = parseAuthChecks("N/A", "bare");
    expect(checks).toHaveLength(5);
  });
});
