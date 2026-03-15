import { parseCryptoChecks } from "../../src/core/audit/checks/crypto.js";

describe("parseCryptoChecks", () => {
  // Simulates realistic SSH batch output for the CRYPTO section
  const validOutput = [
    // openssl version
    "OpenSSL 3.0.2 15 Mar 2022 (Library: OpenSSL 3.0.2 15 Mar 2022)",
    // sshd -T ciphers/macs/kexalgorithms
    "ciphers chacha20-poly1305@openssh.com,aes128-ctr,aes192-ctr,aes256-ctr",
    "macs hmac-sha2-256,hmac-sha2-512,umac-128@openssh.com",
    "kexalgorithms curve25519-sha256,ecdh-sha2-nistp256,ecdh-sha2-nistp384",
    // SSH host key listing
    "/etc/ssh/ssh_host_ecdsa_key",
    "/etc/ssh/ssh_host_ed25519_key",
    "/etc/ssh/ssh_host_rsa_key",
    // LUKS disk
    "sda2  crypto_LUKS",
    // openssl.cnf MinProtocol
    "MinProtocol = TLSv1.2",
    // TLS ports
    "LISTEN 0 511 0.0.0.0:443 0.0.0.0:* users:((\"nginx\",pid=1234,fd=6))",
    // Certificate enddate (future date)
    "notAfter=Dec 31 23:59:59 2030 GMT",
    // SSH host key permissions (stat -c '%a %n' /etc/ssh/ssh_host_*_key)
    "600 /etc/ssh/ssh_host_rsa_key",
    "600 /etc/ssh/ssh_host_ecdsa_key",
    "600 /etc/ssh/ssh_host_ed25519_key",
    // Weak OpenSSL cipher count (openssl ciphers | grep -ci 'NULL|RC4|DES|MD5') — low count
    "2",
  ].join("\n");

  const insecureOutput = [
    // openssl version (old)
    "OpenSSL 1.0.2k  26 Jan 2017",
    // sshd with weak ciphers/macs/kex
    "ciphers 3des-cbc,aes128-ctr,arcfour256,aes256-ctr",
    "macs hmac-md5,hmac-sha2-256,hmac-sha1-96",
    "kexalgorithms diffie-hellman-group1-sha1,curve25519-sha256",
    // No ED25519 key
    "/etc/ssh/ssh_host_rsa_key",
    // No LUKS
    "NO_LUKS",
    // TLS min protocol too low
    "MinProtocol = TLSv1.0",
    // No TLS ports
    "NO_TLS_PORTS",
    // Cert N/A
    "N/A",
  ].join("\n");

  it("should return 15 checks for the Crypto category", () => {
    const checks = parseCryptoChecks(validOutput, "bare");
    expect(checks).toHaveLength(15);
    checks.forEach((c) => expect(c.category).toBe("Crypto"));
  });

  it("all check IDs should start with CRYPTO-", () => {
    const checks = parseCryptoChecks(validOutput, "bare");
    checks.forEach((c) => expect(c.id).toMatch(/^CRYPTO-/));
  });

  it("all checks should have explain > 20 chars and fixCommand defined", () => {
    const checks = parseCryptoChecks(validOutput, "bare");
    checks.forEach((c) => {
      expect(c.explain!.length).toBeGreaterThan(20);
      expect(c.fixCommand).toBeDefined();
      expect(c.fixCommand!.length).toBeGreaterThan(0);
    });
  });

  it("severity budget: <= 1 critical check (CRYPTO-HOST-KEY-PERMS)", () => {
    const checks = parseCryptoChecks("", "bare");
    const criticalCount = checks.filter((c) => c.severity === "critical").length;
    expect(criticalCount).toBe(1);
  });

  it("should handle N/A output gracefully", () => {
    const checks = parseCryptoChecks("N/A", "bare");
    expect(checks).toHaveLength(15);
    checks.forEach((c) => {
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });
  });

  it("should handle empty string output gracefully", () => {
    const checks = parseCryptoChecks("", "bare");
    expect(checks).toHaveLength(15);
    checks.forEach((c) => expect(c.passed).toBe(false));
  });

  it("CRYPTO-OPENSSL-INSTALLED passes when OpenSSL version present", () => {
    const checks = parseCryptoChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === "CRYPTO-OPENSSL-INSTALLED");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("CRYPTO-OPENSSL-INSTALLED fails when NOT_INSTALLED", () => {
    const checks = parseCryptoChecks("NOT_INSTALLED\nN/A\nN/A\nNO_LUKS\nN/A\nNO_TLS_PORTS\nN/A", "bare");
    const check = checks.find((c) => c.id === "CRYPTO-OPENSSL-INSTALLED");
    expect(check!.passed).toBe(false);
  });

  it("CRYPTO-SSH-WEAK-CIPHERS passes when no weak ciphers", () => {
    const checks = parseCryptoChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === "CRYPTO-SSH-WEAK-CIPHERS");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("CRYPTO-SSH-WEAK-CIPHERS fails when 3des-cbc or arcfour present", () => {
    const checks = parseCryptoChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === "CRYPTO-SSH-WEAK-CIPHERS");
    expect(check!.passed).toBe(false);
  });

  it("CRYPTO-SSH-WEAK-MACS passes when no weak MACs", () => {
    const checks = parseCryptoChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === "CRYPTO-SSH-WEAK-MACS");
    expect(check!.passed).toBe(true);
  });

  it("CRYPTO-SSH-WEAK-MACS fails when hmac-md5 present", () => {
    const checks = parseCryptoChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === "CRYPTO-SSH-WEAK-MACS");
    expect(check!.passed).toBe(false);
  });

  it("CRYPTO-SSH-WEAK-KEX passes when no weak KEX", () => {
    const checks = parseCryptoChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === "CRYPTO-SSH-WEAK-KEX");
    expect(check!.passed).toBe(true);
  });

  it("CRYPTO-SSH-WEAK-KEX fails when diffie-hellman-group1-sha1 present", () => {
    const checks = parseCryptoChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === "CRYPTO-SSH-WEAK-KEX");
    expect(check!.passed).toBe(false);
  });

  it("CRYPTO-SSH-ED25519-KEY passes when ed25519 key found", () => {
    const checks = parseCryptoChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === "CRYPTO-SSH-ED25519-KEY");
    expect(check!.passed).toBe(true);
  });

  it("CRYPTO-SSH-ED25519-KEY fails when no ed25519 key", () => {
    const checks = parseCryptoChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === "CRYPTO-SSH-ED25519-KEY");
    expect(check!.passed).toBe(false);
  });

  it("CRYPTO-LUKS-DISK passes when crypto_LUKS found", () => {
    const checks = parseCryptoChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === "CRYPTO-LUKS-DISK");
    expect(check!.passed).toBe(true);
  });

  it("CRYPTO-LUKS-DISK fails when NO_LUKS", () => {
    const checks = parseCryptoChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === "CRYPTO-LUKS-DISK");
    expect(check!.passed).toBe(false);
  });

  it("CRYPTO-TLS-MIN-PROTOCOL passes when MinProtocol=TLSv1.2", () => {
    const checks = parseCryptoChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === "CRYPTO-TLS-MIN-PROTOCOL");
    expect(check!.passed).toBe(true);
  });

  it("CRYPTO-TLS-MIN-PROTOCOL fails when MinProtocol=TLSv1.0", () => {
    const checks = parseCryptoChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === "CRYPTO-TLS-MIN-PROTOCOL");
    expect(check!.passed).toBe(false);
  });

  it("CRYPTO-CERT-NOT-EXPIRED passes when cert enddate is in future", () => {
    const checks = parseCryptoChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === "CRYPTO-CERT-NOT-EXPIRED");
    expect(check!.passed).toBe(true);
  });

  it("CRYPTO-CERT-NOT-EXPIRED passes when NO_TLS_PORTS (not applicable)", () => {
    const checks = parseCryptoChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === "CRYPTO-CERT-NOT-EXPIRED");
    expect(check!.passed).toBe(true);
  });

  it("CRYPTO-OPENSSL-MODERN passes when OpenSSL 3.x", () => {
    const checks = parseCryptoChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === "CRYPTO-OPENSSL-MODERN");
    expect(check!.passed).toBe(true);
  });

  it("CRYPTO-OPENSSL-MODERN fails when OpenSSL 1.0.x", () => {
    const checks = parseCryptoChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === "CRYPTO-OPENSSL-MODERN");
    expect(check!.passed).toBe(false);
  });

  it("CRYPTO-HOST-KEY-PERMS passes when all host keys have mode 600", () => {
    const checks = parseCryptoChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === "CRYPTO-HOST-KEY-PERMS");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("CRYPTO-WEAK-SSH-KEYS passes when no DSA host key present", () => {
    const checks = parseCryptoChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === "CRYPTO-WEAK-SSH-KEYS");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("CRYPTO-WEAK-SSH-KEYS fails when DSA host key is present", () => {
    const output = validOutput + "\n/etc/ssh/ssh_host_dsa_key";
    const checks = parseCryptoChecks(output, "bare");
    const check = checks.find((c) => c.id === "CRYPTO-WEAK-SSH-KEYS");
    expect(check!.passed).toBe(false);
  });

  it("CRYPTO-NO-WEAK-OPENSSL-CIPHERS passes when weak count < 5", () => {
    const checks = parseCryptoChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === "CRYPTO-NO-WEAK-OPENSSL-CIPHERS");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });
});
