import { parseSSHChecks } from "../../src/core/audit/checks/ssh.js";
import { CHECK_IDS } from "../../src/core/audit/checkIds.js";
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
    // New SSH checks (SSH-MAX-STARTUPS, SSH-STRICT-MODES, SSH-NO-AGENT-FORWARDING, SSH-PRINT-MOTD)
    "maxstartups 10:30:60",
    "strictmodes yes",
    "allowagentforwarding no",
    "printmotd no",
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

  it("should return 22 checks for secure sshd output, all passed", () => {
    const checks = parseSSHChecks(secureOutput, "bare");
    expect(checks).toHaveLength(22);
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
    const ssh01 = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_PASSWORD_AUTH);
    expect(ssh01).toBeDefined();
    expect(ssh01!.passed).toBe(false);
    expect(ssh01!.severity).toBe("critical");
    expect(ssh01!.currentValue).toContain("yes");
    expect(ssh01!.expectedValue).toContain("no");
  });

  it("should return SSH-ROOT-LOGIN failed when PermitRootLogin is yes", () => {
    const checks = parseSSHChecks(insecureOutput, "bare");
    const ssh02 = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_ROOT_LOGIN);
    expect(ssh02).toBeDefined();
    expect(ssh02!.passed).toBe(false);
    expect(ssh02!.severity).toBe("critical");
  });

  it("should return SSH-EMPTY-PASSWORDS failed when PermitEmptyPasswords is yes", () => {
    const checks = parseSSHChecks(insecureOutput, "bare");
    const ssh03 = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_EMPTY_PASSWORDS);
    expect(ssh03).toBeDefined();
    expect(ssh03!.passed).toBe(false);
    expect(ssh03!.severity).toBe("critical");
  });

  it("should return SSH-PUBKEY-AUTH failed when PubkeyAuthentication is no", () => {
    const checks = parseSSHChecks(insecureOutput, "bare");
    const ssh04 = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_PUBKEY_AUTH);
    expect(ssh04).toBeDefined();
    expect(ssh04!.passed).toBe(false);
  });

  it("should return SSH-MAX-AUTH-TRIES failed when MaxAuthTries > 5", () => {
    const checks = parseSSHChecks(insecureOutput, "bare");
    const ssh05 = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_MAX_AUTH_TRIES);
    expect(ssh05).toBeDefined();
    expect(ssh05!.passed).toBe(false);
    expect(ssh05!.severity).toBe("warning");
  });

  it("should return SSH-X11-FORWARDING failed when X11Forwarding is yes", () => {
    const checks = parseSSHChecks(insecureOutput, "bare");
    const ssh06 = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_X11_FORWARDING);
    expect(ssh06).toBeDefined();
    expect(ssh06!.passed).toBe(false);
  });

  it("should return SSH-CLIENT-ALIVE-INTERVAL passed with 300, failed with 0", () => {
    const passChecks = parseSSHChecks("clientaliveinterval 300", "bare");
    const pass = passChecks.find((c) => c.id === CHECK_IDS.SSH.SSH_CLIENT_ALIVE_INTERVAL);
    expect(pass!.passed).toBe(true);

    const failChecks = parseSSHChecks("clientaliveinterval 0", "bare");
    const fail = failChecks.find((c) => c.id === CHECK_IDS.SSH.SSH_CLIENT_ALIVE_INTERVAL);
    expect(fail!.passed).toBe(false);
  });

  it("should return SSH-IGNORE-RHOSTS passed with yes, failed with no", () => {
    const passChecks = parseSSHChecks("ignorerhosts yes", "bare");
    const pass = passChecks.find((c) => c.id === CHECK_IDS.SSH.SSH_IGNORE_RHOSTS);
    expect(pass!.passed).toBe(true);
    expect(pass!.severity).toBe("critical");

    const failChecks = parseSSHChecks("ignorerhosts no", "bare");
    const fail = failChecks.find((c) => c.id === CHECK_IDS.SSH.SSH_IGNORE_RHOSTS);
    expect(fail!.passed).toBe(false);
  });

  it("should return SSH-STRONG-CIPHERS failed when output contains 3des-cbc", () => {
    const failChecks = parseSSHChecks("ciphers 3des-cbc,aes256-ctr", "bare");
    const fail = failChecks.find((c) => c.id === CHECK_IDS.SSH.SSH_STRONG_CIPHERS);
    expect(fail!.passed).toBe(false);

    const passChecks = parseSSHChecks("ciphers aes256-ctr,aes192-ctr,aes128-ctr", "bare");
    const pass = passChecks.find((c) => c.id === CHECK_IDS.SSH.SSH_STRONG_CIPHERS);
    expect(pass!.passed).toBe(true);
  });

  it("should return SSH-STRONG-MACS failed when output contains hmac-md5", () => {
    const failChecks = parseSSHChecks("macs hmac-md5,hmac-sha2-256", "bare");
    const fail = failChecks.find((c) => c.id === CHECK_IDS.SSH.SSH_STRONG_MACS);
    expect(fail!.passed).toBe(false);

    const passChecks = parseSSHChecks("macs hmac-sha2-256,hmac-sha2-512", "bare");
    const pass = passChecks.find((c) => c.id === CHECK_IDS.SSH.SSH_STRONG_MACS);
    expect(pass!.passed).toBe(true);
  });

  it("should return SSH-STRONG-KEX failed when output contains diffie-hellman-group1-sha1", () => {
    const failChecks = parseSSHChecks("kexalgorithms diffie-hellman-group1-sha1,curve25519-sha256", "bare");
    const fail = failChecks.find((c) => c.id === CHECK_IDS.SSH.SSH_STRONG_KEX);
    expect(fail!.passed).toBe(false);

    const passChecks = parseSSHChecks("kexalgorithms curve25519-sha256,diffie-hellman-group16-sha512", "bare");
    const pass = passChecks.find((c) => c.id === CHECK_IDS.SSH.SSH_STRONG_KEX);
    expect(pass!.passed).toBe(true);
  });

  it("should not count umac-64-etm as a weak MAC", () => {
    const checks = parseSSHChecks("macs umac-64-etm@openssh.com,hmac-sha2-256", "bare");
    const mac = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_STRONG_MACS);
    expect(mac!.passed).toBe(true);
  });

  it("severity budget: no more than 55% critical checks in SSH category", () => {
    const checks = parseSSHChecks(secureOutput, "bare");
    expect(checks).toHaveLength(22);
    const criticalCount = checks.filter((c: AuditCheck) => c.severity === "critical").length;
    const maxAllowed = Math.ceil(22 * 0.55);
    expect(criticalCount).toBeLessThanOrEqual(maxAllowed);
  });

  it("should handle empty/N/A output with all checks failed", () => {
    const checks = parseSSHChecks("N/A", "bare");
    expect(checks).toHaveLength(22);
    checks.forEach((check) => {
      expect(check.passed).toBe(false);
      expect(check.currentValue).toContain("Unable to determine");
    });
  });

  it("should handle empty string output", () => {
    const checks = parseSSHChecks("", "bare");
    expect(checks).toHaveLength(22);
    checks.forEach((check) => {
      expect(check.passed).toBe(false);
    });
  });

  it("SSH-MAX-STARTUPS passes with maxstartups 10:30:60", () => {
    const checks = parseSSHChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_MAX_STARTUPS);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("warning");
    expect(check!.currentValue).toContain("10:30:60");
  });

  it("SSH-MAX-STARTUPS fails with maxstartups 100", () => {
    const checks = parseSSHChecks("maxstartups 100", "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_MAX_STARTUPS);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toBe("100");
  });

  it("SSH-STRICT-MODES passes with strictmodes yes", () => {
    const checks = parseSSHChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_STRICT_MODES);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("warning");
  });

  it("SSH-STRICT-MODES fails with strictmodes no", () => {
    const checks = parseSSHChecks("strictmodes no", "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_STRICT_MODES);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("SSH-NO-AGENT-FORWARDING passes with allowagentforwarding no", () => {
    const checks = parseSSHChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_NO_AGENT_FORWARDING);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("warning");
  });

  it("SSH-NO-AGENT-FORWARDING fails with allowagentforwarding yes", () => {
    const checks = parseSSHChecks("allowagentforwarding yes", "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_NO_AGENT_FORWARDING);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("SSH-PRINT-MOTD passes with printmotd no", () => {
    const checks = parseSSHChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_PRINT_MOTD);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("info");
  });

  it("SSH-PRINT-MOTD fails with printmotd yes", () => {
    const checks = parseSSHChecks("printmotd yes", "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_PRINT_MOTD);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });
});

describe("[MUTATION-KILLER] SSH check string assertions", () => {
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
    "maxstartups 10:30:60",
    "strictmodes yes",
    "allowagentforwarding no",
    "printmotd no",
  ].join("\n");

  const checks = parseSSHChecks(secureOutput, "bare");

  const expectedChecks = [
    {
      id: CHECK_IDS.SSH.SSH_PASSWORD_AUTH,
      name: "Password Authentication Disabled",
      severity: "critical",
      expectedValue: "no",
      fixCommand: "sed -i 's/^#\\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config && systemctl restart sshd",
      explain: "Password authentication allows brute-force attacks. Key-based auth is significantly more secure.",
    },
    {
      id: CHECK_IDS.SSH.SSH_ROOT_LOGIN,
      name: "Root Login Restricted",
      severity: "critical",
      expectedValue: "no or prohibit-password",
      fixCommand: "sed -i 's/^#\\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config && systemctl restart sshd",
      explain: "Direct root login increases attack surface. Use a regular user with sudo instead.",
    },
    {
      id: CHECK_IDS.SSH.SSH_EMPTY_PASSWORDS,
      name: "Empty Passwords Denied",
      severity: "critical",
      expectedValue: "no",
      fixCommand: "sed -i 's/^#\\?PermitEmptyPasswords.*/PermitEmptyPasswords no/' /etc/ssh/sshd_config && systemctl restart sshd",
      explain: "Allowing empty passwords lets anyone log in without credentials.",
    },
    {
      id: CHECK_IDS.SSH.SSH_PUBKEY_AUTH,
      name: "Public Key Authentication Enabled",
      severity: "warning",
      expectedValue: "yes",
      fixCommand: "sed -i 's/^#\\?PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config && systemctl restart sshd",
      explain: "Public key authentication provides strong cryptographic identity verification.",
    },
    {
      id: CHECK_IDS.SSH.SSH_MAX_AUTH_TRIES,
      name: "Max Auth Tries Limited",
      severity: "warning",
      expectedValue: "5 or less",
      fixCommand: "sed -i 's/^#\\?MaxAuthTries.*/MaxAuthTries 3/' /etc/ssh/sshd_config && systemctl restart sshd",
      explain: "Limiting authentication attempts slows down brute-force attacks.",
    },
    {
      id: CHECK_IDS.SSH.SSH_X11_FORWARDING,
      name: "X11 Forwarding Disabled",
      severity: "info",
      expectedValue: "no",
      fixCommand: "sed -i 's/^#\\?X11Forwarding.*/X11Forwarding no/' /etc/ssh/sshd_config && systemctl restart sshd",
      explain: "X11 forwarding can be exploited for display hijacking on servers that don't need GUI access.",
    },
    {
      id: CHECK_IDS.SSH.SSH_CLIENT_ALIVE_INTERVAL,
      name: "Client Alive Interval Configured",
      severity: "warning",
      expectedValue: "300 or less (non-zero)",
      fixCommand: "sed -i 's/^#\\?ClientAliveInterval.*/ClientAliveInterval 300/' /etc/ssh/sshd_config && systemctl restart sshd",
      explain: "Setting a client alive interval disconnects idle sessions, reducing the risk of session hijacking.",
    },
    {
      id: CHECK_IDS.SSH.SSH_CLIENT_ALIVE_COUNT,
      name: "Client Alive Count Max Limited",
      severity: "warning",
      expectedValue: "3 or less",
      fixCommand: "sed -i 's/^#\\?ClientAliveCountMax.*/ClientAliveCountMax 3/' /etc/ssh/sshd_config && systemctl restart sshd",
      explain: "Limiting alive count ensures unresponsive sessions are terminated after a short time.",
    },
    {
      id: CHECK_IDS.SSH.SSH_LOGIN_GRACE_TIME,
      name: "Login Grace Time Restricted",
      severity: "warning",
      expectedValue: "60 or less",
      fixCommand: "sed -i 's/^#\\?LoginGraceTime.*/LoginGraceTime 60/' /etc/ssh/sshd_config && systemctl restart sshd",
      explain: "Restricting login grace time limits how long an unauthenticated connection is held open.",
    },
    {
      id: CHECK_IDS.SSH.SSH_IGNORE_RHOSTS,
      name: "Ignore Rhosts Files",
      severity: "critical",
      expectedValue: "yes",
      fixCommand: "sed -i 's/^#\\?IgnoreRhosts.*/IgnoreRhosts yes/' /etc/ssh/sshd_config && systemctl restart sshd",
      explain: "Rhosts-based authentication is insecure and allows host-based trust without cryptographic verification.",
    },
    {
      id: CHECK_IDS.SSH.SSH_HOSTBASED_AUTH,
      name: "Host-Based Authentication Disabled",
      severity: "critical",
      expectedValue: "no",
      fixCommand: "sed -i 's/^#\\?HostbasedAuthentication.*/HostbasedAuthentication no/' /etc/ssh/sshd_config && systemctl restart sshd",
      explain: "Host-based authentication trusts remote hosts without user credentials, enabling lateral movement.",
    },
    {
      id: CHECK_IDS.SSH.SSH_MAX_SESSIONS,
      name: "Max Sessions Limited",
      severity: "warning",
      expectedValue: "10 or less",
      fixCommand: "sed -i 's/^#\\?MaxSessions.*/MaxSessions 10/' /etc/ssh/sshd_config && systemctl restart sshd",
      explain: "Limiting max sessions per connection prevents resource exhaustion and reduces attack surface.",
    },
    {
      id: CHECK_IDS.SSH.SSH_USE_DNS,
      name: "DNS Lookup Disabled",
      severity: "info",
      expectedValue: "no",
      fixCommand: "sed -i 's/^#\\?UseDNS.*/UseDNS no/' /etc/ssh/sshd_config && systemctl restart sshd",
      explain: "Disabling DNS lookups speeds up SSH connections and avoids DNS-based information disclosure.",
    },
    {
      id: CHECK_IDS.SSH.SSH_PERMIT_USER_ENV,
      name: "User Environment Passthrough Disabled",
      severity: "warning",
      expectedValue: "no",
      fixCommand: "sed -i 's/^#\\?PermitUserEnvironment.*/PermitUserEnvironment no/' /etc/ssh/sshd_config && systemctl restart sshd",
      explain: "Allowing user environment passthrough can be used to bypass security restrictions via environment variables.",
    },
    {
      id: CHECK_IDS.SSH.SSH_LOG_LEVEL,
      name: "SSH Logging Level Adequate",
      severity: "info",
      expectedValue: "VERBOSE or INFO",
      fixCommand: "sed -i 's/^#\\?LogLevel.*/LogLevel VERBOSE/' /etc/ssh/sshd_config && systemctl restart sshd",
      explain: "Verbose or INFO logging ensures sufficient detail is captured for security audit and incident response.",
    },
    {
      id: CHECK_IDS.SSH.SSH_STRONG_CIPHERS,
      name: "No Weak SSH Ciphers",
      severity: "warning",
      expectedValue: "No weak ciphers (3des, arcfour, blowfish, cast)",
      fixCommand: "sed -i 's/^#\\?Ciphers.*/Ciphers aes256-ctr,aes192-ctr,aes128-ctr,aes256-gcm@openssh.com,aes128-gcm@openssh.com/' /etc/ssh/sshd_config && systemctl restart sshd",
      explain: "Weak ciphers like 3DES and Blowfish are vulnerable to known cryptographic attacks.",
    },
    {
      id: CHECK_IDS.SSH.SSH_STRONG_MACS,
      name: "No Weak SSH MACs",
      severity: "warning",
      expectedValue: "No weak MACs (md5, umac-64)",
      fixCommand: "sed -i 's/^#\\?MACs.*/MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com,hmac-sha2-512,hmac-sha2-256/' /etc/ssh/sshd_config && systemctl restart sshd",
      explain: "Weak MACs like MD5-based algorithms do not provide sufficient integrity protection for SSH sessions.",
    },
    {
      id: CHECK_IDS.SSH.SSH_STRONG_KEX,
      name: "No Weak KEX Algorithms",
      severity: "warning",
      expectedValue: "No weak KEX (sha1, diffie-hellman-group1, diffie-hellman-group-exchange-sha1)",
      fixCommand: "sed -i 's/^#\\?KexAlgorithms.*/KexAlgorithms curve25519-sha256,curve25519-sha256@libssh.org,diffie-hellman-group16-sha512,diffie-hellman-group18-sha512/' /etc/ssh/sshd_config && systemctl restart sshd",
      explain: "Weak key exchange algorithms based on SHA-1 are vulnerable to collision attacks.",
    },
    {
      id: CHECK_IDS.SSH.SSH_MAX_STARTUPS,
      name: "MaxStartups Limits Concurrent Unauthenticated Connections",
      severity: "warning",
      expectedValue: "10:30:60 or stricter (start <= 10)",
      fixCommand: "sed -i 's/^#\\?MaxStartups.*/MaxStartups 10:30:60/' /etc/ssh/sshd_config && systemctl restart sshd",
      explain: "MaxStartups limits concurrent unauthenticated SSH connections, mitigating brute-force and resource exhaustion attacks.",
    },
    {
      id: CHECK_IDS.SSH.SSH_STRICT_MODES,
      name: "StrictModes Enabled",
      severity: "warning",
      expectedValue: "yes",
      fixCommand: "sed -i 's/^#\\?StrictModes.*/StrictModes yes/' /etc/ssh/sshd_config && systemctl restart sshd",
      explain: "StrictModes checks file permissions on user SSH files before accepting login, preventing exploitation of misconfigured authorized_keys.",
    },
    {
      id: CHECK_IDS.SSH.SSH_NO_AGENT_FORWARDING,
      name: "SSH Agent Forwarding Disabled",
      severity: "warning",
      expectedValue: "no",
      fixCommand: "sed -i 's/^#\\?AllowAgentForwarding.*/AllowAgentForwarding no/' /etc/ssh/sshd_config && systemctl restart sshd",
      explain: "SSH agent forwarding exposes the authentication agent to the remote server, enabling key theft if the server is compromised.",
    },
    {
      id: CHECK_IDS.SSH.SSH_PRINT_MOTD,
      name: "PrintMotd Handled by PAM",
      severity: "info",
      expectedValue: "no",
      fixCommand: "sed -i 's/^#\\?PrintMotd.*/PrintMotd no/' /etc/ssh/sshd_config && systemctl restart sshd",
      explain: "PrintMotd should be handled by PAM, not sshd directly, to prevent information leakage from static message-of-the-day files.",
    },
  ];

  it("[MUTATION-KILLER] returns exactly 22 checks", () => {
    expect(checks).toHaveLength(22);
    expect(expectedChecks).toHaveLength(22);
  });

  expectedChecks.forEach((expected) => {
    describe(`${expected.id}`, () => {
      it("[MUTATION-KILLER] has correct id", () => {
        const check = checks.find((c) => c.id === expected.id);
        expect(check).toBeDefined();
        expect(check!.id).toBe(expected.id);
      });

      it("[MUTATION-KILLER] has correct name", () => {
        const check = checks.find((c) => c.id === expected.id);
        expect(check!.name).toBe(expected.name);
      });

      it("[MUTATION-KILLER] has correct severity", () => {
        const check = checks.find((c) => c.id === expected.id);
        expect(check!.severity).toBe(expected.severity);
      });

      it("[MUTATION-KILLER] has correct category", () => {
        const check = checks.find((c) => c.id === expected.id);
        expect(check!.category).toBe("SSH");
      });

      it("[MUTATION-KILLER] has correct expectedValue", () => {
        const check = checks.find((c) => c.id === expected.id);
        expect(check!.expectedValue).toBe(expected.expectedValue);
      });

      it("[MUTATION-KILLER] has correct fixCommand", () => {
        const check = checks.find((c) => c.id === expected.id);
        expect(check!.fixCommand).toBe(expected.fixCommand);
      });

      it("[MUTATION-KILLER] has correct explain", () => {
        const check = checks.find((c) => c.id === expected.id);
        expect(check!.explain).toBe(expected.explain);
      });

      it("[MUTATION-KILLER] has safeToAutoFix set to FORBIDDEN", () => {
        const check = checks.find((c) => c.id === expected.id);
        expect(check!.safeToAutoFix).toBe("FORBIDDEN");
      });
    });
  });

  it("[MUTATION-KILLER] every check has non-empty fixCommand", () => {
    checks.forEach((c) => {
      expect(c.fixCommand).toBeDefined();
      expect(c.fixCommand!.length).toBeGreaterThan(0);
    });
  });

  it("[MUTATION-KILLER] every check has non-empty explain (> 10 chars)", () => {
    checks.forEach((c) => {
      expect(c.explain).toBeDefined();
      expect(c.explain!.length).toBeGreaterThan(10);
    });
  });

  it("[MUTATION-KILLER] every check has non-empty name", () => {
    checks.forEach((c) => {
      expect(c.name.length).toBeGreaterThan(0);
    });
  });

  it("[MUTATION-KILLER] every check has non-empty id", () => {
    checks.forEach((c) => {
      expect(c.id.length).toBeGreaterThan(0);
    });
  });

  it("[MUTATION-KILLER] every check has non-empty expectedValue", () => {
    checks.forEach((c) => {
      expect(c.expectedValue.length).toBeGreaterThan(0);
    });
  });
});

describe("[MUTATION-KILLER] SSH N/A output string assertions", () => {
  const naChecks = parseSSHChecks("N/A", "bare");

  it("[MUTATION-KILLER] every N/A check has currentValue 'Unable to determine'", () => {
    naChecks.forEach((c) => {
      expect(c.currentValue).toBe("Unable to determine");
    });
  });

  it("[MUTATION-KILLER] every N/A check has safeToAutoFix FORBIDDEN", () => {
    naChecks.forEach((c) => {
      expect(c.safeToAutoFix).toBe("FORBIDDEN");
    });
  });

  it("[MUTATION-KILLER] every N/A check retains correct category", () => {
    naChecks.forEach((c) => {
      expect(c.category).toBe("SSH");
    });
  });
});

describe("[MUTATION-KILLER] SSH comparator edge cases", () => {
  it("[MUTATION-KILLER] SSH-ROOT-LOGIN passes with 'without-password'", () => {
    const checks = parseSSHChecks("permitrootlogin without-password", "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_ROOT_LOGIN);
    expect(check!.passed).toBe(true);
  });

  it("[MUTATION-KILLER] SSH-ROOT-LOGIN passes with 'no'", () => {
    const checks = parseSSHChecks("permitrootlogin no", "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_ROOT_LOGIN);
    expect(check!.passed).toBe(true);
  });

  it("[MUTATION-KILLER] SSH-MAX-AUTH-TRIES passes with exactly 5", () => {
    const checks = parseSSHChecks("maxauthtries 5", "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_MAX_AUTH_TRIES);
    expect(check!.passed).toBe(true);
  });

  it("[MUTATION-KILLER] SSH-MAX-AUTH-TRIES passes with 1", () => {
    const checks = parseSSHChecks("maxauthtries 1", "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_MAX_AUTH_TRIES);
    expect(check!.passed).toBe(true);
  });

  it("[MUTATION-KILLER] SSH-CLIENT-ALIVE-INTERVAL passes with exactly 1", () => {
    const checks = parseSSHChecks("clientaliveinterval 1", "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_CLIENT_ALIVE_INTERVAL);
    expect(check!.passed).toBe(true);
  });

  it("[MUTATION-KILLER] SSH-CLIENT-ALIVE-COUNT passes with exactly 1", () => {
    const checks = parseSSHChecks("clientalivecountmax 1", "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_CLIENT_ALIVE_COUNT);
    expect(check!.passed).toBe(true);
  });

  it("[MUTATION-KILLER] SSH-CLIENT-ALIVE-COUNT fails with 0", () => {
    const checks = parseSSHChecks("clientalivecountmax 0", "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_CLIENT_ALIVE_COUNT);
    expect(check!.passed).toBe(false);
  });

  it("[MUTATION-KILLER] SSH-LOGIN-GRACE-TIME passes with exactly 1", () => {
    const checks = parseSSHChecks("logingracetime 1", "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_LOGIN_GRACE_TIME);
    expect(check!.passed).toBe(true);
  });

  it("[MUTATION-KILLER] SSH-LOGIN-GRACE-TIME fails with 0", () => {
    const checks = parseSSHChecks("logingracetime 0", "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_LOGIN_GRACE_TIME);
    expect(check!.passed).toBe(false);
  });

  it("[MUTATION-KILLER] SSH-MAX-SESSIONS passes with exactly 1", () => {
    const checks = parseSSHChecks("maxsessions 1", "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_MAX_SESSIONS);
    expect(check!.passed).toBe(true);
  });

  it("[MUTATION-KILLER] SSH-MAX-SESSIONS fails with 0", () => {
    const checks = parseSSHChecks("maxsessions 0", "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_MAX_SESSIONS);
    expect(check!.passed).toBe(false);
  });

  it("[MUTATION-KILLER] SSH-MAX-SESSIONS fails with 11", () => {
    const checks = parseSSHChecks("maxsessions 11", "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_MAX_SESSIONS);
    expect(check!.passed).toBe(false);
  });

  it("[MUTATION-KILLER] SSH-LOG-LEVEL passes with INFO", () => {
    const checks = parseSSHChecks("loglevel INFO", "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_LOG_LEVEL);
    expect(check!.passed).toBe(true);
  });

  it("[MUTATION-KILLER] SSH-LOG-LEVEL fails with QUIET", () => {
    const checks = parseSSHChecks("loglevel QUIET", "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_LOG_LEVEL);
    expect(check!.passed).toBe(false);
  });

  it("[MUTATION-KILLER] SSH-STRONG-CIPHERS fails with arcfour", () => {
    const checks = parseSSHChecks("ciphers arcfour128,aes256-ctr", "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_STRONG_CIPHERS);
    expect(check!.passed).toBe(false);
  });

  it("[MUTATION-KILLER] SSH-STRONG-CIPHERS fails with blowfish", () => {
    const checks = parseSSHChecks("ciphers blowfish-cbc,aes256-ctr", "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_STRONG_CIPHERS);
    expect(check!.passed).toBe(false);
  });

  it("[MUTATION-KILLER] SSH-STRONG-CIPHERS fails with cast", () => {
    const checks = parseSSHChecks("ciphers cast128-cbc,aes256-ctr", "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_STRONG_CIPHERS);
    expect(check!.passed).toBe(false);
  });

  it("[MUTATION-KILLER] SSH-STRONG-KEX fails with diffie-hellman-group-exchange-sha1", () => {
    const checks = parseSSHChecks("kexalgorithms diffie-hellman-group-exchange-sha1,curve25519-sha256", "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_STRONG_KEX);
    expect(check!.passed).toBe(false);
  });

  it("[MUTATION-KILLER] SSH-MAX-STARTUPS passes with start=5 (stricter)", () => {
    const checks = parseSSHChecks("maxstartups 5:30:60", "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_MAX_STARTUPS);
    expect(check!.passed).toBe(true);
  });

  it("[MUTATION-KILLER] SSH-MAX-STARTUPS fails with start=11", () => {
    const checks = parseSSHChecks("maxstartups 11:30:60", "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.SSH.SSH_MAX_STARTUPS);
    expect(check!.passed).toBe(false);
  });
});
