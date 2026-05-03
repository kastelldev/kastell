import { CHECK_IDS } from "../../src/core/audit/checkIds.js";
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
    // DH params (CRYPTO-DH-PARAMS-SIZE) — no custom DH file
    "NO_DH_PARAMS",
    // World-readable keys (CRYPTO-NO-WORLD-READABLE-KEYS) — none found
    "NONE",
    // CA cert count (CRYPTO-CERT-COUNT) — a standalone number
    "128",
    // Nginx TLS (CRYPTO-NGINX-TLS-MODERN) — nginx not installed
    "NO_NGINX",
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

  it("should return 19 checks for the Crypto category", () => {
    const checks = parseCryptoChecks(validOutput, "bare");
    expect(checks).toHaveLength(19);
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

  it("severity budget: 2 critical checks (CRYPTO-HOST-KEY-PERMS and CRYPTO-NO-WORLD-READABLE-KEYS)", () => {
    const checks = parseCryptoChecks("", "bare");
    const criticalCount = checks.filter((c) => c.severity === "critical").length;
    expect(criticalCount).toBe(2);
  });

  it("should handle N/A output gracefully", () => {
    const checks = parseCryptoChecks("N/A", "bare");
    expect(checks).toHaveLength(19);
    checks.forEach((c) => {
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });
  });

  it("should handle empty string output gracefully", () => {
    const checks = parseCryptoChecks("", "bare");
    expect(checks).toHaveLength(19);
    checks.forEach((c) => expect(c.passed).toBe(false));
  });

  it("CRYPTO-OPENSSL-INSTALLED passes when OpenSSL version present", () => {
    const checks = parseCryptoChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.CRYPTO.CRYPTO_OPENSSL_INSTALLED);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("CRYPTO-OPENSSL-INSTALLED fails when NOT_INSTALLED", () => {
    const checks = parseCryptoChecks("NOT_INSTALLED\nN/A\nN/A\nNO_LUKS\nN/A\nNO_TLS_PORTS\nN/A", "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.CRYPTO.CRYPTO_OPENSSL_INSTALLED);
    expect(check!.passed).toBe(false);
  });

  it("CRYPTO-SSH-WEAK-CIPHERS passes when no weak ciphers", () => {
    const checks = parseCryptoChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.CRYPTO.CRYPTO_SSH_WEAK_CIPHERS);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("CRYPTO-SSH-WEAK-CIPHERS fails when 3des-cbc or arcfour present", () => {
    const checks = parseCryptoChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.CRYPTO.CRYPTO_SSH_WEAK_CIPHERS);
    expect(check!.passed).toBe(false);
  });

  it("CRYPTO-SSH-WEAK-MACS passes when no weak MACs", () => {
    const checks = parseCryptoChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.CRYPTO.CRYPTO_SSH_WEAK_MACS);
    expect(check!.passed).toBe(true);
  });

  it("CRYPTO-SSH-WEAK-MACS fails when hmac-md5 present", () => {
    const checks = parseCryptoChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.CRYPTO.CRYPTO_SSH_WEAK_MACS);
    expect(check!.passed).toBe(false);
  });

  it("CRYPTO-SSH-WEAK-KEX passes when no weak KEX", () => {
    const checks = parseCryptoChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.CRYPTO.CRYPTO_SSH_WEAK_KEX);
    expect(check!.passed).toBe(true);
  });

  it("CRYPTO-SSH-WEAK-KEX fails when diffie-hellman-group1-sha1 present", () => {
    const checks = parseCryptoChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.CRYPTO.CRYPTO_SSH_WEAK_KEX);
    expect(check!.passed).toBe(false);
  });

  it("CRYPTO-SSH-ED25519-KEY passes when ed25519 key found", () => {
    const checks = parseCryptoChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.CRYPTO.CRYPTO_SSH_ED25519_KEY);
    expect(check!.passed).toBe(true);
  });

  it("CRYPTO-SSH-ED25519-KEY fails when no ed25519 key", () => {
    const checks = parseCryptoChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.CRYPTO.CRYPTO_SSH_ED25519_KEY);
    expect(check!.passed).toBe(false);
  });

  it("CRYPTO-LUKS-DISK passes when crypto_LUKS found", () => {
    const checks = parseCryptoChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.CRYPTO.CRYPTO_LUKS_DISK);
    expect(check!.passed).toBe(true);
  });

  it("CRYPTO-LUKS-DISK fails when NO_LUKS", () => {
    const checks = parseCryptoChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.CRYPTO.CRYPTO_LUKS_DISK);
    expect(check!.passed).toBe(false);
  });

  it("CRYPTO-TLS-MIN-PROTOCOL passes when MinProtocol=TLSv1.2", () => {
    const checks = parseCryptoChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.CRYPTO.CRYPTO_TLS_MIN_PROTOCOL);
    expect(check!.passed).toBe(true);
  });

  it("CRYPTO-TLS-MIN-PROTOCOL fails when MinProtocol=TLSv1.0", () => {
    const checks = parseCryptoChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.CRYPTO.CRYPTO_TLS_MIN_PROTOCOL);
    expect(check!.passed).toBe(false);
  });

  it("CRYPTO-CERT-NOT-EXPIRED passes when cert enddate is in future", () => {
    const checks = parseCryptoChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.CRYPTO.CRYPTO_CERT_NOT_EXPIRED);
    expect(check!.passed).toBe(true);
  });

  it("CRYPTO-CERT-NOT-EXPIRED passes when NO_TLS_PORTS (not applicable)", () => {
    const checks = parseCryptoChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.CRYPTO.CRYPTO_CERT_NOT_EXPIRED);
    expect(check!.passed).toBe(true);
  });

  it("CRYPTO-OPENSSL-MODERN passes when OpenSSL 3.x", () => {
    const checks = parseCryptoChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.CRYPTO.CRYPTO_OPENSSL_MODERN);
    expect(check!.passed).toBe(true);
  });

  it("CRYPTO-OPENSSL-MODERN fails when OpenSSL 1.0.x", () => {
    const checks = parseCryptoChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.CRYPTO.CRYPTO_OPENSSL_MODERN);
    expect(check!.passed).toBe(false);
  });

  it("CRYPTO-HOST-KEY-PERMS passes when all host keys have mode 600", () => {
    const checks = parseCryptoChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.CRYPTO.CRYPTO_HOST_KEY_PERMS);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("CRYPTO-WEAK-SSH-KEYS passes when no DSA host key present", () => {
    const checks = parseCryptoChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.CRYPTO.CRYPTO_WEAK_SSH_KEYS);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("CRYPTO-WEAK-SSH-KEYS fails when DSA host key is present", () => {
    const output = validOutput + "\n/etc/ssh/ssh_host_dsa_key";
    const checks = parseCryptoChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.CRYPTO.CRYPTO_WEAK_SSH_KEYS);
    expect(check!.passed).toBe(false);
  });

  it("CRYPTO-NO-WEAK-OPENSSL-CIPHERS passes when weak count < 5", () => {
    const checks = parseCryptoChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.CRYPTO.CRYPTO_NO_WEAK_OPENSSL_CIPHERS);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("CRYPTO-DH-PARAMS-SIZE passes when NO_DH_PARAMS (system defaults)", () => {
    const checks = parseCryptoChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.CRYPTO.CRYPTO_DH_PARAMS_SIZE);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toMatch(/system defaults/i);
  });

  it("CRYPTO-DH-PARAMS-SIZE passes when DH params are 4096 bits", () => {
    const output = validOutput.replace("NO_DH_PARAMS", "DH Parameters: (4096 bit)");
    const checks = parseCryptoChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.CRYPTO.CRYPTO_DH_PARAMS_SIZE);
    expect(check!.passed).toBe(true);
  });

  it("CRYPTO-DH-PARAMS-SIZE fails when DH params are 1024 bits", () => {
    const output = validOutput.replace("NO_DH_PARAMS", "DH Parameters: (1024 bit)");
    const checks = parseCryptoChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.CRYPTO.CRYPTO_DH_PARAMS_SIZE);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toMatch(/1024 bits \(too small\)/);
  });

  it("CRYPTO-NO-WORLD-READABLE-KEYS passes when NONE sentinel present", () => {
    const checks = parseCryptoChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.CRYPTO.CRYPTO_NO_WORLD_READABLE_KEYS);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("critical");
  });

  it("CRYPTO-NO-WORLD-READABLE-KEYS fails when .key file paths found", () => {
    const output = validOutput.replace("NONE\n128", "/etc/ssl/private/server.key\n128");
    const checks = parseCryptoChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.CRYPTO.CRYPTO_NO_WORLD_READABLE_KEYS);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toMatch(/world-readable/i);
  });

  it("CRYPTO-CERT-COUNT passes when CA cert count > 0", () => {
    const checks = parseCryptoChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.CRYPTO.CRYPTO_CERT_COUNT);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toMatch(/128 CA certificate/);
  });

  it("CRYPTO-CERT-COUNT fails when count is 0", () => {
    const output = validOutput.replace("\n128\n", "\n0\n");
    const checks = parseCryptoChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.CRYPTO.CRYPTO_CERT_COUNT);
    expect(check!.passed).toBe(false);
  });

  it("CRYPTO-NGINX-TLS-MODERN passes when NO_NGINX", () => {
    const checks = parseCryptoChecks(validOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.CRYPTO.CRYPTO_NGINX_TLS_MODERN);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toMatch(/not installed/i);
  });

  it("CRYPTO-NGINX-TLS-MODERN passes when ssl_protocols has TLSv1.2 only", () => {
    const output = validOutput.replace("NO_NGINX", "ssl_protocols TLSv1.2 TLSv1.3;");
    const checks = parseCryptoChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.CRYPTO.CRYPTO_NGINX_TLS_MODERN);
    expect(check!.passed).toBe(true);
  });

  it("CRYPTO-NGINX-TLS-MODERN fails when ssl_protocols includes TLSv1.0", () => {
    const output = validOutput.replace("NO_NGINX", "ssl_protocols TLSv1 TLSv1.1 TLSv1.2;");
    const checks = parseCryptoChecks(output, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.CRYPTO.CRYPTO_NGINX_TLS_MODERN);
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toMatch(/legacy/i);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Mutation-killer tests
  // ──────────────────────────────────────────────────────────────────────────
  describe("mutation-killer tests", () => {
    // Helper: build output replacing specific lines from validOutput base
    const base = [
      "OpenSSL 3.0.2 15 Mar 2022 (Library: OpenSSL 3.0.2 15 Mar 2022)",
      "ciphers chacha20-poly1305@openssh.com,aes128-ctr,aes192-ctr,aes256-ctr",
      "macs hmac-sha2-256,hmac-sha2-512,umac-128@openssh.com",
      "kexalgorithms curve25519-sha256,ecdh-sha2-nistp256,ecdh-sha2-nistp384",
      "/etc/ssh/ssh_host_ecdsa_key",
      "/etc/ssh/ssh_host_ed25519_key",
      "/etc/ssh/ssh_host_rsa_key",
      "sda2  crypto_LUKS",
      "MinProtocol = TLSv1.2",
      'LISTEN 0 511 0.0.0.0:443 0.0.0.0:* users:(("nginx",pid=1234,fd=6))',
      "notAfter=Dec 31 23:59:59 2030 GMT",
      "600 /etc/ssh/ssh_host_rsa_key",
      "600 /etc/ssh/ssh_host_ecdsa_key",
      "600 /etc/ssh/ssh_host_ed25519_key",
      "2",
      "NO_DH_PARAMS",
      "NONE",
      "128",
      "NO_NGINX",
    ].join("\n");

    const find = (checks: ReturnType<typeof parseCryptoChecks>, id: string) =>
      checks.find((c) => c.id === id)!;

    // ── CRYPTO-OPENSSL-INSTALLED ────────────────────────────────────────
    it("OPENSSL-INSTALLED: fails when OpenSSL regex does not match (no version number)", () => {
      const output = base.replace(/OpenSSL 3\.0\.2.*/g, "libssl installed");
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_OPENSSL_INSTALLED);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("OpenSSL not installed");
    });

    it("OPENSSL-INSTALLED: fails when both OpenSSL version AND NOT_INSTALLED present (&& operator)", () => {
      const output = base.replace(
        "OpenSSL 3.0.2 15 Mar 2022 (Library: OpenSSL 3.0.2 15 Mar 2022)",
        "OpenSSL 3.0.2 NOT_INSTALLED"
      );
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_OPENSSL_INSTALLED);
      expect(c.passed).toBe(false);
    });

    it("OPENSSL-INSTALLED: currentValue extracts version string when installed", () => {
      const c = find(parseCryptoChecks(base, "bare"), CHECK_IDS.CRYPTO.CRYPTO_OPENSSL_INSTALLED);
      expect(c.passed).toBe(true);
      expect(c.currentValue).toMatch(/OpenSSL 3\.0\.2/);
    });

    it("OPENSSL-INSTALLED: passes with case-insensitive openssl match", () => {
      const output = base.replace(
        "OpenSSL 3.0.2 15 Mar 2022 (Library: OpenSSL 3.0.2 15 Mar 2022)",
        "openssl 1.1.1k"
      );
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_OPENSSL_INSTALLED);
      expect(c.passed).toBe(true);
    });

    // ── CRYPTO-SSH-WEAK-CIPHERS ─────────────────────────────────────────
    it("WEAK-CIPHERS: fails when ciphers line is missing entirely", () => {
      const lines = base.split("\n").filter((l) => !l.startsWith("ciphers "));
      const c = find(parseCryptoChecks(lines.join("\n"), "bare"), CHECK_IDS.CRYPTO.CRYPTO_SSH_WEAK_CIPHERS);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("SSH cipher configuration not found");
    });

    it("WEAK-CIPHERS: detects blowfish-cbc specifically", () => {
      const output = base.replace(
        "ciphers chacha20-poly1305@openssh.com,aes128-ctr,aes192-ctr,aes256-ctr",
        "ciphers aes128-ctr,blowfish-cbc,aes256-ctr"
      );
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_SSH_WEAK_CIPHERS);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toMatch(/blowfish-cbc/);
    });

    it("WEAK-CIPHERS: detects cast128-cbc specifically", () => {
      const output = base.replace(
        "ciphers chacha20-poly1305@openssh.com,aes128-ctr,aes192-ctr,aes256-ctr",
        "ciphers aes128-ctr,cast128-cbc"
      );
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_SSH_WEAK_CIPHERS);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toMatch(/cast128-cbc/);
    });

    it("WEAK-CIPHERS: currentValue lists all weak ciphers found", () => {
      const output = base.replace(
        "ciphers chacha20-poly1305@openssh.com,aes128-ctr,aes192-ctr,aes256-ctr",
        "ciphers arcfour,3des-cbc,aes256-ctr"
      );
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_SSH_WEAK_CIPHERS);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toMatch(/arcfour/);
      expect(c.currentValue).toMatch(/3des-cbc/);
    });

    it("WEAK-CIPHERS: passes with only strong ciphers", () => {
      const c = find(parseCryptoChecks(base, "bare"), CHECK_IDS.CRYPTO.CRYPTO_SSH_WEAK_CIPHERS);
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("No weak ciphers configured");
    });

    // ── CRYPTO-SSH-WEAK-MACS ────────────────────────────────────────────
    it("WEAK-MACS: fails when macs line is missing entirely", () => {
      const lines = base.split("\n").filter((l) => !l.startsWith("macs "));
      const c = find(parseCryptoChecks(lines.join("\n"), "bare"), CHECK_IDS.CRYPTO.CRYPTO_SSH_WEAK_MACS);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("SSH MAC configuration not found");
    });

    it("WEAK-MACS: detects hmac-sha1-96 specifically", () => {
      const output = base.replace(
        "macs hmac-sha2-256,hmac-sha2-512,umac-128@openssh.com",
        "macs hmac-sha2-256,hmac-sha1-96"
      );
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_SSH_WEAK_MACS);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toMatch(/hmac-sha1-96/);
    });

    it("WEAK-MACS: detects umac-64@openssh.com specifically", () => {
      const output = base.replace(
        "macs hmac-sha2-256,hmac-sha2-512,umac-128@openssh.com",
        "macs hmac-sha2-256,umac-64@openssh.com"
      );
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_SSH_WEAK_MACS);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toMatch(/umac-64/);
    });

    it("WEAK-MACS: passes with only strong MACs", () => {
      const c = find(parseCryptoChecks(base, "bare"), CHECK_IDS.CRYPTO.CRYPTO_SSH_WEAK_MACS);
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("No weak MACs configured");
    });

    // ── CRYPTO-SSH-WEAK-KEX ─────────────────────────────────────────────
    it("WEAK-KEX: fails when kexalgorithms line is missing entirely", () => {
      const lines = base.split("\n").filter((l) => !l.startsWith("kexalgorithms "));
      const c = find(parseCryptoChecks(lines.join("\n"), "bare"), CHECK_IDS.CRYPTO.CRYPTO_SSH_WEAK_KEX);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("SSH KEX configuration not found");
    });

    it("WEAK-KEX: detects diffie-hellman-group14-sha1 specifically", () => {
      const output = base.replace(
        "kexalgorithms curve25519-sha256,ecdh-sha2-nistp256,ecdh-sha2-nistp384",
        "kexalgorithms curve25519-sha256,diffie-hellman-group14-sha1"
      );
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_SSH_WEAK_KEX);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toMatch(/diffie-hellman-group14-sha1/);
    });

    it("WEAK-KEX: detects both weak KEX algorithms together", () => {
      const output = base.replace(
        "kexalgorithms curve25519-sha256,ecdh-sha2-nistp256,ecdh-sha2-nistp384",
        "kexalgorithms diffie-hellman-group1-sha1,diffie-hellman-group14-sha1"
      );
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_SSH_WEAK_KEX);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toMatch(/diffie-hellman-group1-sha1/);
      expect(c.currentValue).toMatch(/diffie-hellman-group14-sha1/);
    });

    it("WEAK-KEX: passes with only strong KEX algorithms", () => {
      const c = find(parseCryptoChecks(base, "bare"), CHECK_IDS.CRYPTO.CRYPTO_SSH_WEAK_KEX);
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("No weak KEX algorithms");
    });

    // ── CRYPTO-LUKS-DISK ────────────────────────────────────────────────
    it("LUKS-DISK: fails when crypto_luks present but also NO_LUKS (&& operator)", () => {
      const output = base.replace("sda2  crypto_LUKS", "sda2  crypto_LUKS\nNO_LUKS");
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_LUKS_DISK);
      expect(c.passed).toBe(false);
    });

    it("LUKS-DISK: fails when no crypto_luks at all", () => {
      const output = base.replace("sda2  crypto_LUKS", "sda2  ext4");
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_LUKS_DISK);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("No LUKS encrypted volumes found");
    });

    it("LUKS-DISK: passes when crypto_luks present without NO_LUKS", () => {
      const c = find(parseCryptoChecks(base, "bare"), CHECK_IDS.CRYPTO.CRYPTO_LUKS_DISK);
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("LUKS disk encryption detected");
    });

    // ── CRYPTO-TLS-MIN-PROTOCOL ─────────────────────────────────────────
    it("TLS-MIN-PROTOCOL: passes with TLSv1.3", () => {
      const output = base.replace("MinProtocol = TLSv1.2", "MinProtocol = TLSv1.3");
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_TLS_MIN_PROTOCOL);
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("MinProtocol = TLSv1.3");
    });

    it("TLS-MIN-PROTOCOL: fails with TLSv1.1", () => {
      const output = base.replace("MinProtocol = TLSv1.2", "MinProtocol = TLSv1.1");
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_TLS_MIN_PROTOCOL);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toMatch(/too low/);
    });

    it("TLS-MIN-PROTOCOL: fails when MinProtocol is not configured and NO_TLS_PORTS present", () => {
      const lines = base.split("\n").filter((l) => !l.startsWith("MinProtocol"));
      lines.push("NO_TLS_PORTS");
      const c = find(parseCryptoChecks(lines.join("\n"), "bare"), CHECK_IDS.CRYPTO.CRYPTO_TLS_MIN_PROTOCOL);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("TLS ports active but MinProtocol not configured");
    });

    it("TLS-MIN-PROTOCOL: fails when MinProtocol is not configured and no NO_TLS_PORTS", () => {
      const lines = base.split("\n").filter((l) => !l.startsWith("MinProtocol"));
      const c = find(parseCryptoChecks(lines.join("\n"), "bare"), CHECK_IDS.CRYPTO.CRYPTO_TLS_MIN_PROTOCOL);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("MinProtocol not configured in openssl.cnf");
    });

    // ── CRYPTO-CERT-NOT-EXPIRED ─────────────────────────────────────────
    it("CERT-NOT-EXPIRED: passes when NO_TLS_PORTS", () => {
      const output = "NO_TLS_PORTS\nN/A";
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_CERT_NOT_EXPIRED);
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("No HTTPS ports active (not applicable)");
    });

    it("CERT-NOT-EXPIRED: passes when N/A without NO_TLS_PORTS and no notAfter", () => {
      const output = base.replace("notAfter=Dec 31 23:59:59 2030 GMT", "N/A")
        .replace("NO_TLS_PORTS", "");
      // N/A is present in output
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_CERT_NOT_EXPIRED);
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("Certificate check not applicable");
    });

    it("CERT-NOT-EXPIRED: fails when cert date is in the past", () => {
      const output = base.replace(
        "notAfter=Dec 31 23:59:59 2030 GMT",
        "notAfter=Jan 1 00:00:00 2020 GMT"
      );
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_CERT_NOT_EXPIRED);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toMatch(/EXPIRED/);
    });

    it("CERT-NOT-EXPIRED: fails when cert date is unparseable", () => {
      const output = base.replace(
        "notAfter=Dec 31 23:59:59 2030 GMT",
        "notAfter=GARBAGE_DATE"
      );
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_CERT_NOT_EXPIRED);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toMatch(/Unparseable cert date/);
    });

    it("CERT-NOT-EXPIRED: fails when no notAfter and no N/A sentinel", () => {
      const output = base
        .replace("notAfter=Dec 31 23:59:59 2030 GMT", "some other line")
        .replace("NO_TLS_PORTS", "")
        .split("\n")
        .filter((l) => l.trim() !== "N/A")
        .join("\n");
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_CERT_NOT_EXPIRED);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Could not determine certificate expiry");
    });

    it("CERT-NOT-EXPIRED: passes with future cert date and shows valid until", () => {
      const c = find(parseCryptoChecks(base, "bare"), CHECK_IDS.CRYPTO.CRYPTO_CERT_NOT_EXPIRED);
      expect(c.passed).toBe(true);
      expect(c.currentValue).toMatch(/valid until/);
    });

    // ── CRYPTO-NO-SSLV3 ────────────────────────────────────────────────
    it("NO-SSLV3: fails when Protocol includes SSLv3", () => {
      const output = base + "\nProtocol = SSLv3 TLSv1.2";
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_NO_SSLV3);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toMatch(/SSLv3 appears enabled/);
    });

    it("NO-SSLV3: passes when no Protocol line with SSLv3", () => {
      const c = find(parseCryptoChecks(base, "bare"), CHECK_IDS.CRYPTO.CRYPTO_NO_SSLV3);
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("SSLv3 not enabled");
    });

    it("NO-SSLV3: passes when Protocol line exists but without SSLv3", () => {
      const output = base + "\nProtocol = TLSv1.2 TLSv1.3";
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_NO_SSLV3);
      expect(c.passed).toBe(true);
    });

    // ── CRYPTO-OPENSSL-MODERN ───────────────────────────────────────────
    it("OPENSSL-MODERN: passes with 1.1.x version", () => {
      const output = base.replace(
        "OpenSSL 3.0.2 15 Mar 2022 (Library: OpenSSL 3.0.2 15 Mar 2022)",
        "OpenSSL 1.1.1k"
      );
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_OPENSSL_MODERN);
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("OpenSSL 1.1.1");
    });

    it("OPENSSL-MODERN: fails with 0.9.x version", () => {
      const output = base.replace(
        "OpenSSL 3.0.2 15 Mar 2022 (Library: OpenSSL 3.0.2 15 Mar 2022)",
        "OpenSSL 0.9.8"
      );
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_OPENSSL_MODERN);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("OpenSSL 0.9.8");
    });

    it("OPENSSL-MODERN: fails when NOT_INSTALLED", () => {
      const output = "NOT_INSTALLED\n" + base.replace(
        "OpenSSL 3.0.2 15 Mar 2022 (Library: OpenSSL 3.0.2 15 Mar 2022)",
        ""
      );
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_OPENSSL_MODERN);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("OpenSSL not installed");
    });

    it("OPENSSL-MODERN: fails when version not detectable", () => {
      const output = base.replace(
        "OpenSSL 3.0.2 15 Mar 2022 (Library: OpenSSL 3.0.2 15 Mar 2022)",
        "some crypto library"
      );
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_OPENSSL_MODERN);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("OpenSSL version not detected");
    });

    it("OPENSSL-MODERN: 1.0.x is explicitly legacy (isLegacy check)", () => {
      const output = base.replace(
        "OpenSSL 3.0.2 15 Mar 2022 (Library: OpenSSL 3.0.2 15 Mar 2022)",
        "OpenSSL 1.0.2k"
      );
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_OPENSSL_MODERN);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("OpenSSL 1.0.2");
    });

    // ── CRYPTO-WEAK-SSH-KEYS ────────────────────────────────────────────
    it("WEAK-SSH-KEYS: fails when ssh_host_dsa_key present", () => {
      const output = base + "\n/etc/ssh/ssh_host_dsa_key";
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_WEAK_SSH_KEYS);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toMatch(/DSA host key present/);
    });

    it("WEAK-SSH-KEYS: passes when no dsa key", () => {
      const c = find(parseCryptoChecks(base, "bare"), CHECK_IDS.CRYPTO.CRYPTO_WEAK_SSH_KEYS);
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("No DSA host keys found");
    });

    // ── CRYPTO-HOST-KEY-PERMS ───────────────────────────────────────────
    it("HOST-KEY-PERMS: passes with mode 640", () => {
      const output = base
        .replace("600 /etc/ssh/ssh_host_rsa_key", "640 /etc/ssh/ssh_host_rsa_key")
        .replace("600 /etc/ssh/ssh_host_ecdsa_key", "640 /etc/ssh/ssh_host_ecdsa_key")
        .replace("600 /etc/ssh/ssh_host_ed25519_key", "640 /etc/ssh/ssh_host_ed25519_key");
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_HOST_KEY_PERMS);
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("All SSH host keys have restrictive permissions");
    });

    it("HOST-KEY-PERMS: fails with mode 644", () => {
      const output = base.replace("600 /etc/ssh/ssh_host_rsa_key", "644 /etc/ssh/ssh_host_rsa_key");
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_HOST_KEY_PERMS);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toMatch(/1 key\(s\) with non-restrictive permissions/);
    });

    it("HOST-KEY-PERMS: fails with mode 777", () => {
      const output = base
        .replace("600 /etc/ssh/ssh_host_rsa_key", "777 /etc/ssh/ssh_host_rsa_key")
        .replace("600 /etc/ssh/ssh_host_ecdsa_key", "777 /etc/ssh/ssh_host_ecdsa_key");
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_HOST_KEY_PERMS);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toMatch(/2 key\(s\) with non-restrictive permissions/);
    });

    it("HOST-KEY-PERMS: fails when no stat output and N/A present in non-empty output", () => {
      const output = "OpenSSL 3.0.2\nN/A\nsome other data";
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_HOST_KEY_PERMS);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine SSH host key permissions");
    });

    it("HOST-KEY-PERMS: fails when no stat output and no N/A", () => {
      const output = "some random output without stat lines";
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_HOST_KEY_PERMS);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("No SSH host key stat output found");
    });

    // ── CRYPTO-NO-WEAK-OPENSSL-CIPHERS ──────────────────────────────────
    it("WEAK-OPENSSL-CIPHERS: passes with count 4 (boundary < 5)", () => {
      const output = base.replace("\n2\n", "\n4\n");
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_NO_WEAK_OPENSSL_CIPHERS);
      expect(c.passed).toBe(true);
      expect(c.currentValue).toMatch(/4 weak cipher references \(acceptable\)/);
    });

    it("WEAK-OPENSSL-CIPHERS: fails with count 5 (boundary >= 5)", () => {
      const output = base.replace("\n2\n", "\n5\n");
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_NO_WEAK_OPENSSL_CIPHERS);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toMatch(/5 weak cipher references \(review recommended\)/);
    });

    it("WEAK-OPENSSL-CIPHERS: fails with count 10", () => {
      const output = base.replace("\n2\n", "\n10\n");
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_NO_WEAK_OPENSSL_CIPHERS);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toMatch(/10 weak cipher references/);
    });

    it("WEAK-OPENSSL-CIPHERS: passes with count 0", () => {
      const output = base.replace("\n2\n", "\n0\n");
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_NO_WEAK_OPENSSL_CIPHERS);
      expect(c.passed).toBe(true);
      expect(c.currentValue).toMatch(/0 weak cipher references \(acceptable\)/);
    });

    it("WEAK-OPENSSL-CIPHERS: fails when no standalone number found", () => {
      const output = "OpenSSL 3.0.2\nciphers aes256-ctr\nmacs hmac-sha2-256\nkexalgorithms curve25519-sha256\nNO_LUKS\nNO_DH_PARAMS\nNONE\nNO_NGINX\nno numbers here";
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_NO_WEAK_OPENSSL_CIPHERS);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Weak cipher count not determinable");
    });

    // ── CRYPTO-MIN-PROTOCOL ─────────────────────────────────────────────
    it("MIN-PROTOCOL: passes with TLSv1.3", () => {
      const output = base.replace("MinProtocol = TLSv1.2", "MinProtocol = TLSv1.3");
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_MIN_PROTOCOL);
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("MinProtocol = TLSv1.3");
    });

    it("MIN-PROTOCOL: passes with TLSv1.2", () => {
      const c = find(parseCryptoChecks(base, "bare"), CHECK_IDS.CRYPTO.CRYPTO_MIN_PROTOCOL);
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("MinProtocol = TLSv1.2");
    });

    it("MIN-PROTOCOL: fails with TLSv1.0", () => {
      const output = base.replace("MinProtocol = TLSv1.2", "MinProtocol = TLSv1.0");
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_MIN_PROTOCOL);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toMatch(/below TLSv1\.2/);
    });

    it("MIN-PROTOCOL: fails when MinProtocol not configured", () => {
      const lines = base.split("\n").filter((l) => !l.startsWith("MinProtocol"));
      const c = find(parseCryptoChecks(lines.join("\n"), "bare"), CHECK_IDS.CRYPTO.CRYPTO_MIN_PROTOCOL);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("MinProtocol not configured in openssl.cnf");
    });

    // ── CRYPTO-LUKS-KEY-SIZE ────────────────────────────────────────────
    it("LUKS-KEY-SIZE: always passes regardless of LUKS presence", () => {
      const c = find(parseCryptoChecks(base, "bare"), CHECK_IDS.CRYPTO.CRYPTO_LUKS_KEY_SIZE);
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("LUKS disk encryption detected");
    });

    it("LUKS-KEY-SIZE: passes even when NO_LUKS (info only)", () => {
      const output = base.replace("sda2  crypto_LUKS", "NO_LUKS");
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_LUKS_KEY_SIZE);
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("No LUKS encrypted volumes (info only)");
    });

    it("LUKS-KEY-SIZE: passes when crypto_luks + NO_LUKS both present (NO_LUKS wins)", () => {
      const output = base.replace("sda2  crypto_LUKS", "sda2  crypto_LUKS\nNO_LUKS");
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_LUKS_KEY_SIZE);
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("No LUKS encrypted volumes (info only)");
    });

    // ── CRYPTO-DH-PARAMS-SIZE ───────────────────────────────────────────
    it("DH-PARAMS-SIZE: passes with exactly 2048 bits (boundary)", () => {
      const output = base.replace("NO_DH_PARAMS", "DH Parameters: (2048 bit)");
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_DH_PARAMS_SIZE);
      expect(c.passed).toBe(true);
      expect(c.currentValue).toMatch(/2048 bits \(acceptable\)/);
    });

    it("DH-PARAMS-SIZE: fails with 2047 bits (just below boundary)", () => {
      const output = base.replace("NO_DH_PARAMS", "DH Parameters: (2047 bit)");
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_DH_PARAMS_SIZE);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toMatch(/2047 bits \(too small\)/);
    });

    it("DH-PARAMS-SIZE: passes with 4096 bits", () => {
      const output = base.replace("NO_DH_PARAMS", "DH Parameters: (4096 bit)");
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_DH_PARAMS_SIZE);
      expect(c.passed).toBe(true);
      expect(c.currentValue).toMatch(/4096 bits \(acceptable\)/);
    });

    it("DH-PARAMS-SIZE: passes when DH params size not parseable (inconclusive)", () => {
      const output = base.replace("NO_DH_PARAMS", "DH something unparseable");
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_DH_PARAMS_SIZE);
      expect(c.passed).toBe(true);
      expect(c.currentValue).toMatch(/inconclusive/);
    });

    it("DH-PARAMS-SIZE: fails with 1024 bits", () => {
      const output = base.replace("NO_DH_PARAMS", "DH Parameters: (1024 bit)");
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_DH_PARAMS_SIZE);
      expect(c.passed).toBe(false);
    });

    // ── CRYPTO-NO-WORLD-READABLE-KEYS ───────────────────────────────────
    it("WORLD-READABLE-KEYS: passes when NONE sentinel present", () => {
      const c = find(parseCryptoChecks(base, "bare"), CHECK_IDS.CRYPTO.CRYPTO_NO_WORLD_READABLE_KEYS);
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("No world-readable keys found");
    });

    it("WORLD-READABLE-KEYS: fails with /etc/ssl/ path ending in .key", () => {
      const output = base.replace("NONE", "/etc/ssl/private/server.key");
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_NO_WORLD_READABLE_KEYS);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toMatch(/1 world-readable private key/);
    });

    it("WORLD-READABLE-KEYS: fails with /etc/pki/ path ending in .key", () => {
      const output = base.replace("NONE", "/etc/pki/tls/private/server.key");
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_NO_WORLD_READABLE_KEYS);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toMatch(/1 world-readable private key/);
    });

    it("WORLD-READABLE-KEYS: fails with multiple .key files", () => {
      const output = base.replace(
        "NONE",
        "/etc/ssl/private/server.key\n/etc/pki/tls/private/other.key"
      );
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_NO_WORLD_READABLE_KEYS);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toMatch(/2 world-readable private key/);
    });

    it("WORLD-READABLE-KEYS: passes when no NONE and no matching paths", () => {
      const output = base.replace("NONE", "no keys found");
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_NO_WORLD_READABLE_KEYS);
      expect(c.passed).toBe(true);
    });

    // ── CRYPTO-CERT-COUNT ───────────────────────────────────────────────
    it("CERT-COUNT: passes with high cert count", () => {
      const c = find(parseCryptoChecks(base, "bare"), CHECK_IDS.CRYPTO.CRYPTO_CERT_COUNT);
      expect(c.passed).toBe(true);
      expect(c.currentValue).toMatch(/128 CA certificate/);
    });

    it("CERT-COUNT: fails when last standalone number is 0", () => {
      const output = base.replace("\n128\n", "\n0\n");
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_CERT_COUNT);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toMatch(/No CA certificates found/);
    });

    it("CERT-COUNT: uses LAST standalone number (not first)", () => {
      // The output has "2" (weak cipher count) before "128" (cert count)
      // CERT-COUNT should use 128 (the last one), not 2
      const c = find(parseCryptoChecks(base, "bare"), CHECK_IDS.CRYPTO.CRYPTO_CERT_COUNT);
      expect(c.passed).toBe(true);
      expect(c.currentValue).toMatch(/128/);
    });

    it("CERT-COUNT: passes with count 1 (boundary > 0)", () => {
      const output = base.replace("\n128\n", "\n1\n");
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_CERT_COUNT);
      expect(c.passed).toBe(true);
      expect(c.currentValue).toMatch(/1 CA certificate/);
    });

    // ── CRYPTO-NGINX-TLS-MODERN ─────────────────────────────────────────
    it("NGINX-TLS-MODERN: passes when NO_NGINX", () => {
      const c = find(parseCryptoChecks(base, "bare"), CHECK_IDS.CRYPTO.CRYPTO_NGINX_TLS_MODERN);
      expect(c.passed).toBe(true);
      expect(c.currentValue).toMatch(/not installed/);
    });

    it("NGINX-TLS-MODERN: passes when no ssl_protocols directive found", () => {
      const output = base.replace("NO_NGINX", "nginx is installed but no ssl config");
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_NGINX_TLS_MODERN);
      expect(c.passed).toBe(true);
      expect(c.currentValue).toMatch(/No ssl_protocols directive/);
    });

    it("NGINX-TLS-MODERN: fails when TLSv1.1 present in ssl_protocols", () => {
      const output = base.replace("NO_NGINX", "ssl_protocols TLSv1.1 TLSv1.2;");
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_NGINX_TLS_MODERN);
      expect(c.passed).toBe(false);
      expect(c.currentValue).toMatch(/legacy/);
    });

    it("NGINX-TLS-MODERN: fails when TLSv1.0 present (tls1.0 regex variant)", () => {
      const output = base.replace("NO_NGINX", "ssl_protocols TLSv1.0 TLSv1.2;");
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_NGINX_TLS_MODERN);
      expect(c.passed).toBe(false);
    });

    it("NGINX-TLS-MODERN: passes with only TLSv1.2 and TLSv1.3", () => {
      const output = base.replace("NO_NGINX", "ssl_protocols TLSv1.2 TLSv1.3;");
      const c = find(parseCryptoChecks(output, "bare"), CHECK_IDS.CRYPTO.CRYPTO_NGINX_TLS_MODERN);
      expect(c.passed).toBe(true);
      expect(c.currentValue).toMatch(/modern/);
    });

    // ── parseCryptoChecks wrapper ────────────────────────────────────────
    it("parseCryptoChecks: returns all required fields for each check", () => {
      const checks = parseCryptoChecks(base, "bare");
      for (const c of checks) {
        expect(c.id).toBeDefined();
        expect(c.category).toBe("Crypto");
        expect(c.name).toBeDefined();
        expect(c.severity).toBeDefined();
        expect(typeof c.passed).toBe("boolean");
        expect(c.currentValue).toBeDefined();
        expect(c.expectedValue).toBeDefined();
        expect(c.fixCommand).toBeDefined();
        expect(c.explain).toBeDefined();
      }
    });

    it("parseCryptoChecks: whitespace-only input treated as N/A", () => {
      const checks = parseCryptoChecks("   \n  \n  ", "bare");
      expect(checks).toHaveLength(19);
      checks.forEach((c) => {
        expect(c.passed).toBe(false);
        expect(c.currentValue).toBe("Unable to determine");
      });
    });

    it("parseCryptoChecks: platform parameter does not affect check count", () => {
      const bareChecks = parseCryptoChecks(base, "bare");
      const coolifyChecks = parseCryptoChecks(base, "coolify");
      expect(bareChecks).toHaveLength(coolifyChecks.length);
    });

    it("parseCryptoChecks: each check has safeToAutoFix defined", () => {
      const checks = parseCryptoChecks(base, "bare");
      for (const c of checks) {
        expect(c.safeToAutoFix).toBeDefined();
        expect(["SAFE", "GUARDED", "MANUAL"]).toContain(c.safeToAutoFix);
      }
    });
  });
});
