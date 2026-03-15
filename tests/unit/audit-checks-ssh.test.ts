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
    "clientaliveinterval 300",
    "clientalivecountmax 3",
    "logingracetime 60",
    "ignorerhosts yes",
    "hostbasedauthentication no",
    "maxsessions 10",
    "usedns no",
    "permituserenvironment no",
    "loglevel VERBOSE",
    "ciphers aes256-ctr,aes192-ctr,aes128-ctr",
    "macs hmac-sha2-256,hmac-sha2-512",
    "kexalgorithms curve25519-sha256,diffie-hellman-group16-sha512",
  ].join("\n");

  const insecureOutput = [
    "passwordauthentication yes",
    "permitrootlogin yes",
    "permitemptypasswords yes",
    "pubkeyauthentication no",
    "maxauthtries 6",
    "x11forwarding yes",
    "clientaliveinterval 0",
    "clientalivecountmax 10",
    "logingracetime 120",
    "ignorerhosts no",
    "hostbasedauthentication yes",
    "maxsessions 20",
    "usedns yes",
    "permituserenvironment yes",
    "loglevel QUIET",
    "ciphers 3des-cbc,aes256-ctr",
    "macs hmac-md5,hmac-sha2-256",
    "kexalgorithms diffie-hellman-group1-sha1,curve25519-sha256",
  ].join("\n");

  it("should return 18 checks for secure sshd output, all passed", () => {
    const checks = parseSSHChecks(secureOutput, "bare");
    expect(checks).toHaveLength(18);
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

  it("should return SSH-CLIENT-ALIVE-INTERVAL passed with 300, failed with 0", () => {
    const passChecks = parseSSHChecks("clientaliveinterval 300", "bare");
    const pass = passChecks.find((c) => c.id === "SSH-CLIENT-ALIVE-INTERVAL");
    expect(pass!.passed).toBe(true);

    const failChecks = parseSSHChecks("clientaliveinterval 0", "bare");
    const fail = failChecks.find((c) => c.id === "SSH-CLIENT-ALIVE-INTERVAL");
    expect(fail!.passed).toBe(false);
  });

  it("should return SSH-IGNORE-RHOSTS passed with yes, failed with no", () => {
    const passChecks = parseSSHChecks("ignorerhosts yes", "bare");
    const pass = passChecks.find((c) => c.id === "SSH-IGNORE-RHOSTS");
    expect(pass!.passed).toBe(true);
    expect(pass!.severity).toBe("critical");

    const failChecks = parseSSHChecks("ignorerhosts no", "bare");
    const fail = failChecks.find((c) => c.id === "SSH-IGNORE-RHOSTS");
    expect(fail!.passed).toBe(false);
  });

  it("should return SSH-STRONG-CIPHERS failed when output contains 3des-cbc", () => {
    const failChecks = parseSSHChecks("ciphers 3des-cbc,aes256-ctr", "bare");
    const fail = failChecks.find((c) => c.id === "SSH-STRONG-CIPHERS");
    expect(fail!.passed).toBe(false);

    const passChecks = parseSSHChecks("ciphers aes256-ctr,aes192-ctr,aes128-ctr", "bare");
    const pass = passChecks.find((c) => c.id === "SSH-STRONG-CIPHERS");
    expect(pass!.passed).toBe(true);
  });

  it("should return SSH-STRONG-MACS failed when output contains hmac-md5", () => {
    const failChecks = parseSSHChecks("macs hmac-md5,hmac-sha2-256", "bare");
    const fail = failChecks.find((c) => c.id === "SSH-STRONG-MACS");
    expect(fail!.passed).toBe(false);

    const passChecks = parseSSHChecks("macs hmac-sha2-256,hmac-sha2-512", "bare");
    const pass = passChecks.find((c) => c.id === "SSH-STRONG-MACS");
    expect(pass!.passed).toBe(true);
  });

  it("should return SSH-STRONG-KEX failed when output contains diffie-hellman-group1-sha1", () => {
    const failChecks = parseSSHChecks("kexalgorithms diffie-hellman-group1-sha1,curve25519-sha256", "bare");
    const fail = failChecks.find((c) => c.id === "SSH-STRONG-KEX");
    expect(fail!.passed).toBe(false);

    const passChecks = parseSSHChecks("kexalgorithms curve25519-sha256,diffie-hellman-group16-sha512", "bare");
    const pass = passChecks.find((c) => c.id === "SSH-STRONG-KEX");
    expect(pass!.passed).toBe(true);
  });

  it("should not count umac-64-etm as a weak MAC", () => {
    const checks = parseSSHChecks("macs umac-64-etm@openssh.com,hmac-sha2-256", "bare");
    const mac = checks.find((c) => c.id === "SSH-STRONG-MACS");
    expect(mac!.passed).toBe(true);
  });

  it("severity budget: no more than 55% critical checks in SSH category", () => {
    const checks = parseSSHChecks(secureOutput, "bare");
    expect(checks).toHaveLength(18);
    const criticalCount = checks.filter((c: AuditCheck) => c.severity === "critical").length;
    const maxAllowed = Math.ceil(18 * 0.55);
    expect(criticalCount).toBeLessThanOrEqual(maxAllowed);
  });

  it("should handle empty/N/A output with all checks failed", () => {
    const checks = parseSSHChecks("N/A", "bare");
    expect(checks).toHaveLength(18);
    checks.forEach((check) => {
      expect(check.passed).toBe(false);
      expect(check.currentValue).toContain("Unable to determine");
    });
  });

  it("should handle empty string output", () => {
    const checks = parseSSHChecks("", "bare");
    expect(checks).toHaveLength(18);
    checks.forEach((check) => {
      expect(check.passed).toBe(false);
    });
  });
});
