import { parseSSHChecks } from "../../src/core/audit/checks/ssh.js";
import type { AuditCheck } from "../../src/core/audit/types.js";

describe("parseSSHChecks", () => {
  const secureOutput = [
    "passwordauthentication no",
    "permitrootlogin prohibit-password",
    "permitemptypasswords no",
    "pubkeyauthentication yes",
    "maxauthtries 3",
    "x11forwarding no",
  ].join("\n");

  const insecureOutput = [
    "passwordauthentication yes",
    "permitrootlogin yes",
    "permitemptypasswords yes",
    "pubkeyauthentication no",
    "maxauthtries 6",
    "x11forwarding yes",
  ].join("\n");

  it("should return 6 checks for secure sshd output, all passed", () => {
    const checks = parseSSHChecks(secureOutput, "bare");
    expect(checks).toHaveLength(6);
    checks.forEach((check) => {
      expect(check.passed).toBe(true);
      expect(check.category).toBe("SSH");
      expect(check.id).toMatch(/^SSH-[A-Z][A-Z0-9]*(-[A-Z][A-Z0-9]*)+$/);
      expect(check.fixCommand).toBeDefined();
      expect(check.explain).toBeDefined();
    });
  });

  it("should return SSH-PASSWORD-AUTH failed when PasswordAuthentication is yes", () => {
    const checks = parseSSHChecks(insecureOutput, "bare");
    const ssh01 = checks.find((c) => c.id === "SSH-PASSWORD-AUTH");
    expect(ssh01).toBeDefined();
    expect(ssh01!.passed).toBe(false);
    expect(ssh01!.severity).toBe("critical");
    expect(ssh01!.currentValue).toContain("yes");
    expect(ssh01!.expectedValue).toContain("no");
  });

  it("should return SSH-ROOT-LOGIN failed when PermitRootLogin is yes", () => {
    const checks = parseSSHChecks(insecureOutput, "bare");
    const ssh02 = checks.find((c) => c.id === "SSH-ROOT-LOGIN");
    expect(ssh02).toBeDefined();
    expect(ssh02!.passed).toBe(false);
    expect(ssh02!.severity).toBe("critical");
  });

  it("should return SSH-EMPTY-PASSWORDS failed when PermitEmptyPasswords is yes", () => {
    const checks = parseSSHChecks(insecureOutput, "bare");
    const ssh03 = checks.find((c) => c.id === "SSH-EMPTY-PASSWORDS");
    expect(ssh03).toBeDefined();
    expect(ssh03!.passed).toBe(false);
    expect(ssh03!.severity).toBe("critical");
  });

  it("should return SSH-PUBKEY-AUTH failed when PubkeyAuthentication is no", () => {
    const checks = parseSSHChecks(insecureOutput, "bare");
    const ssh04 = checks.find((c) => c.id === "SSH-PUBKEY-AUTH");
    expect(ssh04).toBeDefined();
    expect(ssh04!.passed).toBe(false);
  });

  it("should return SSH-MAX-AUTH-TRIES failed when MaxAuthTries > 5", () => {
    const checks = parseSSHChecks(insecureOutput, "bare");
    const ssh05 = checks.find((c) => c.id === "SSH-MAX-AUTH-TRIES");
    expect(ssh05).toBeDefined();
    expect(ssh05!.passed).toBe(false);
    expect(ssh05!.severity).toBe("warning");
  });

  it("should return SSH-X11-FORWARDING failed when X11Forwarding is yes", () => {
    const checks = parseSSHChecks(insecureOutput, "bare");
    const ssh06 = checks.find((c) => c.id === "SSH-X11-FORWARDING");
    expect(ssh06).toBeDefined();
    expect(ssh06!.passed).toBe(false);
  });

  it("should handle empty/N/A output with all checks failed", () => {
    const checks = parseSSHChecks("N/A", "bare");
    expect(checks).toHaveLength(6);
    checks.forEach((check) => {
      expect(check.passed).toBe(false);
      expect(check.currentValue).toContain("Unable to determine");
    });
  });

  it("should handle empty string output", () => {
    const checks = parseSSHChecks("", "bare");
    expect(checks).toHaveLength(6);
    checks.forEach((check) => {
      expect(check.passed).toBe(false);
    });
  });
});
