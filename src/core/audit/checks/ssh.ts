/**
 * SSH hardening check parser.
 * Parses sshd -T output into 6 security checks with semantic IDs.
 */

import type { AuditCheck, CheckParser } from "../types.js";

interface SshCheckDef {
  id: string;
  name: string;
  severity: "critical" | "warning" | "info";
  key: string;
  expectedValue: string;
  comparator: (found: string, expected: string) => boolean;
  fixCommand: string;
  explain: string;
}

const SSH_CHECKS: SshCheckDef[] = [
  {
    id: "SSH-PASSWORD-AUTH",
    name: "Password Authentication Disabled",
    severity: "critical",
    key: "passwordauthentication",
    expectedValue: "no",
    comparator: (found, expected) => found.toLowerCase() === expected,
    fixCommand: "sed -i 's/^#\\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "Password authentication allows brute-force attacks. Key-based auth is significantly more secure.",
  },
  {
    id: "SSH-ROOT-LOGIN",
    name: "Root Login Restricted",
    severity: "critical",
    key: "permitrootlogin",
    expectedValue: "no or prohibit-password",
    comparator: (found) => {
      const v = found.toLowerCase();
      return v === "no" || v === "prohibit-password" || v === "without-password";
    },
    fixCommand: "sed -i 's/^#\\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "Direct root login increases attack surface. Use a regular user with sudo instead.",
  },
  {
    id: "SSH-EMPTY-PASSWORDS",
    name: "Empty Passwords Denied",
    severity: "critical",
    key: "permitemptypasswords",
    expectedValue: "no",
    comparator: (found, expected) => found.toLowerCase() === expected,
    fixCommand: "sed -i 's/^#\\?PermitEmptyPasswords.*/PermitEmptyPasswords no/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "Allowing empty passwords lets anyone log in without credentials.",
  },
  {
    id: "SSH-PUBKEY-AUTH",
    name: "Public Key Authentication Enabled",
    severity: "warning",
    key: "pubkeyauthentication",
    expectedValue: "yes",
    comparator: (found, expected) => found.toLowerCase() === expected,
    fixCommand: "sed -i 's/^#\\?PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "Public key authentication provides strong cryptographic identity verification.",
  },
  {
    id: "SSH-MAX-AUTH-TRIES",
    name: "Max Auth Tries Limited",
    severity: "warning",
    key: "maxauthtries",
    expectedValue: "5 or less",
    comparator: (found) => {
      const num = parseInt(found, 10);
      return !isNaN(num) && num <= 5;
    },
    fixCommand: "sed -i 's/^#\\?MaxAuthTries.*/MaxAuthTries 3/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "Limiting authentication attempts slows down brute-force attacks.",
  },
  {
    id: "SSH-X11-FORWARDING",
    name: "X11 Forwarding Disabled",
    severity: "info",
    key: "x11forwarding",
    expectedValue: "no",
    comparator: (found, expected) => found.toLowerCase() === expected,
    fixCommand: "sed -i 's/^#\\?X11Forwarding.*/X11Forwarding no/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "X11 forwarding can be exploited for display hijacking on servers that don't need GUI access.",
  },
  {
    id: "SSH-CLIENT-ALIVE-INTERVAL",
    name: "Client Alive Interval Configured",
    severity: "warning",
    key: "clientaliveinterval",
    expectedValue: "300 or less (non-zero)",
    comparator: (found) => {
      const num = parseInt(found, 10);
      return !isNaN(num) && num > 0 && num <= 300;
    },
    fixCommand: "sed -i 's/^#\\?ClientAliveInterval.*/ClientAliveInterval 300/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "Setting a client alive interval disconnects idle sessions, reducing the risk of session hijacking.",
  },
  {
    id: "SSH-CLIENT-ALIVE-COUNT",
    name: "Client Alive Count Max Limited",
    severity: "warning",
    key: "clientalivecountmax",
    expectedValue: "3 or less",
    comparator: (found) => {
      const num = parseInt(found, 10);
      return !isNaN(num) && num > 0 && num <= 3;
    },
    fixCommand: "sed -i 's/^#\\?ClientAliveCountMax.*/ClientAliveCountMax 3/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "Limiting alive count ensures unresponsive sessions are terminated after a short time.",
  },
  {
    id: "SSH-LOGIN-GRACE-TIME",
    name: "Login Grace Time Restricted",
    severity: "warning",
    key: "logingracetime",
    expectedValue: "60 or less",
    comparator: (found) => {
      const num = parseInt(found, 10);
      return !isNaN(num) && num > 0 && num <= 60;
    },
    fixCommand: "sed -i 's/^#\\?LoginGraceTime.*/LoginGraceTime 60/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "Restricting login grace time limits how long an unauthenticated connection is held open.",
  },
  {
    id: "SSH-IGNORE-RHOSTS",
    name: "Ignore Rhosts Files",
    severity: "critical",
    key: "ignorerhosts",
    expectedValue: "yes",
    comparator: (found) => found.toLowerCase() === "yes",
    fixCommand: "sed -i 's/^#\\?IgnoreRhosts.*/IgnoreRhosts yes/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "Rhosts-based authentication is insecure and allows host-based trust without cryptographic verification.",
  },
  {
    id: "SSH-HOSTBASED-AUTH",
    name: "Host-Based Authentication Disabled",
    severity: "critical",
    key: "hostbasedauthentication",
    expectedValue: "no",
    comparator: (found) => found.toLowerCase() === "no",
    fixCommand: "sed -i 's/^#\\?HostbasedAuthentication.*/HostbasedAuthentication no/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "Host-based authentication trusts remote hosts without user credentials, enabling lateral movement.",
  },
  {
    id: "SSH-MAX-SESSIONS",
    name: "Max Sessions Limited",
    severity: "warning",
    key: "maxsessions",
    expectedValue: "10 or less",
    comparator: (found) => {
      const num = parseInt(found, 10);
      return !isNaN(num) && num >= 1 && num <= 10;
    },
    fixCommand: "sed -i 's/^#\\?MaxSessions.*/MaxSessions 10/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "Limiting max sessions per connection prevents resource exhaustion and reduces attack surface.",
  },
  {
    id: "SSH-USE-DNS",
    name: "DNS Lookup Disabled",
    severity: "info",
    key: "usedns",
    expectedValue: "no",
    comparator: (found) => found.toLowerCase() === "no",
    fixCommand: "sed -i 's/^#\\?UseDNS.*/UseDNS no/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "Disabling DNS lookups speeds up SSH connections and avoids DNS-based information disclosure.",
  },
  {
    id: "SSH-PERMIT-USER-ENV",
    name: "User Environment Passthrough Disabled",
    severity: "warning",
    key: "permituserenvironment",
    expectedValue: "no",
    comparator: (found) => found.toLowerCase() === "no",
    fixCommand: "sed -i 's/^#\\?PermitUserEnvironment.*/PermitUserEnvironment no/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "Allowing user environment passthrough can be used to bypass security restrictions via environment variables.",
  },
  {
    id: "SSH-LOG-LEVEL",
    name: "SSH Logging Level Adequate",
    severity: "info",
    key: "loglevel",
    expectedValue: "VERBOSE or INFO",
    comparator: (found) => ["verbose", "info"].includes(found.toLowerCase()),
    fixCommand: "sed -i 's/^#\\?LogLevel.*/LogLevel VERBOSE/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "Verbose or INFO logging ensures sufficient detail is captured for security audit and incident response.",
  },
  {
    id: "SSH-STRONG-CIPHERS",
    name: "No Weak SSH Ciphers",
    severity: "warning",
    key: "ciphers",
    expectedValue: "No weak ciphers (3des, arcfour, blowfish, cast)",
    comparator: (found) => !/3des|arcfour|blowfish|cast/i.test(found),
    fixCommand: "sed -i 's/^#\\?Ciphers.*/Ciphers aes256-ctr,aes192-ctr,aes128-ctr,aes256-gcm@openssh.com,aes128-gcm@openssh.com/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "Weak ciphers like 3DES and Blowfish are vulnerable to known cryptographic attacks.",
  },
  {
    id: "SSH-STRONG-MACS",
    name: "No Weak SSH MACs",
    severity: "warning",
    key: "macs",
    expectedValue: "No weak MACs (md5, umac-64)",
    comparator: (found) => !/md5|umac-64[^-]/i.test(found),
    fixCommand: "sed -i 's/^#\\?MACs.*/MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com,hmac-sha2-512,hmac-sha2-256/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "Weak MACs like MD5-based algorithms do not provide sufficient integrity protection for SSH sessions.",
  },
  {
    id: "SSH-STRONG-KEX",
    name: "No Weak KEX Algorithms",
    severity: "warning",
    key: "kexalgorithms",
    expectedValue: "No weak KEX (sha1, diffie-hellman-group1, diffie-hellman-group-exchange-sha1)",
    comparator: (found) => !/diffie-hellman-group1-sha1|diffie-hellman-group-exchange-sha1/i.test(found),
    fixCommand: "sed -i 's/^#\\?KexAlgorithms.*/KexAlgorithms curve25519-sha256,curve25519-sha256@libssh.org,diffie-hellman-group16-sha512,diffie-hellman-group18-sha512/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "Weak key exchange algorithms based on SHA-1 are vulnerable to collision attacks.",
  },
];

function extractValue(output: string, key: string): string | null {
  const regex = new RegExp(`^\\s*${key}\\s+(.+)`, "im");
  const match = output.match(regex);
  return match ? match[1].trim() : null;
}

export const parseSSHChecks: CheckParser = (sectionOutput: string, _platform: string): AuditCheck[] => {
  const isNA = !sectionOutput || sectionOutput.trim() === "N/A" || sectionOutput.trim() === "";

  return SSH_CHECKS.map((def) => {
    const found = isNA ? null : extractValue(sectionOutput, def.key);

    if (found === null) {
      return {
        id: def.id,
        category: "SSH",
        name: def.name,
        severity: def.severity,
        passed: false,
        currentValue: "Unable to determine",
        expectedValue: def.expectedValue,
        fixCommand: def.fixCommand,
        explain: def.explain,
      };
    }

    const passed = def.comparator(found, def.expectedValue);
    return {
      id: def.id,
      category: "SSH",
      name: def.name,
      severity: def.severity,
      passed,
      currentValue: found,
      expectedValue: def.expectedValue,
      fixCommand: def.fixCommand,
      explain: def.explain,
    };
  });
};
