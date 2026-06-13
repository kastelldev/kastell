/**
 * SSH hardening check parser.
 * Parses sshd -T output into 6 security checks with semantic IDs.
 */

import type { AuditCheck, CheckParser } from "../types.js";
import { CHECK_IDS } from "../checkIds.js";

interface SshCheckDef {
  id: string;
  name: string;
  severity: "critical" | "warning" | "info";
  key: string;
  expectedValue: string;
  comparator: (found: string, expected: string) => boolean;
  fixCommand: string;
  explain: string;
  forbiddenReason: string;
}

const SSH_CHECKS: SshCheckDef[] = [
  {
    id: CHECK_IDS.SSH.SSH_PASSWORD_AUTH,
    name: "Password Authentication Disabled",
    severity: "critical",
    key: "passwordauthentication",
    expectedValue: "no",
    comparator: (found, expected) => found.toLowerCase() === expected,
    fixCommand: "sed -i 's/^#\\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "Password authentication allows brute-force attacks. Key-based auth is significantly more secure.",
    forbiddenReason: "Disabling password authentication may lock out operators who have not yet deployed an SSH public key; require manual review of authorized_keys before applying.",
  },
  {
    id: CHECK_IDS.SSH.SSH_ROOT_LOGIN,
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
    forbiddenReason: "Changing PermitRootLogin may lock out the only sudo-capable or console-accessible account on the server; require manual review of fallback login paths before applying.",
  },
  {
    id: CHECK_IDS.SSH.SSH_EMPTY_PASSWORDS,
    name: "Empty Passwords Denied",
    severity: "critical",
    key: "permitemptypasswords",
    expectedValue: "no",
    comparator: (found, expected) => found.toLowerCase() === expected,
    fixCommand: "sed -i 's/^#\\?PermitEmptyPasswords.*/PermitEmptyPasswords no/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "Allowing empty passwords lets anyone log in without credentials.",
    forbiddenReason: "PermitEmptyPasswords is enforced via sshd_config reload; misconfig could re-enable passwordless accounts, requires manual review of system accounts.",
  },
  {
    id: CHECK_IDS.SSH.SSH_PUBKEY_AUTH,
    name: "Public Key Authentication Enabled",
    severity: "warning",
    key: "pubkeyauthentication",
    expectedValue: "yes",
    comparator: (found, expected) => found.toLowerCase() === expected,
    fixCommand: "sed -i 's/^#\\?PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "Public key authentication provides strong cryptographic identity verification.",
    forbiddenReason: "Enabling pubkey auth restricts entry paths; if no authorized_keys exist, password-only users get locked out — requires manual key distribution review.",
  },
  {
    id: CHECK_IDS.SSH.SSH_MAX_AUTH_TRIES,
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
    forbiddenReason: "MaxAuthTries reduces brute-force tolerance but may lock out legitimate users with flaky keys; sshd_config reload is required — manual review needed.",
  },
  {
    id: CHECK_IDS.SSH.SSH_X11_FORWARDING,
    name: "X11 Forwarding Disabled",
    severity: "info",
    key: "x11forwarding",
    expectedValue: "no",
    comparator: (found, expected) => found.toLowerCase() === expected,
    fixCommand: "sed -i 's/^#\\?X11Forwarding.*/X11Forwarding no/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "X11 forwarding can be exploited for display hijacking on servers that don't need GUI access.",
    forbiddenReason: "X11Forwarding is a daemon-level directive; disabling it via sshd_config reload may break remote GUI workflows on developer workstations — manual review required.",
  },
  {
    id: CHECK_IDS.SSH.SSH_CLIENT_ALIVE_INTERVAL,
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
    forbiddenReason: "ClientAliveInterval is a daemon-level timeout; reducing it may disrupt long-running SSH sessions (CI, file transfers) — manual review of session timeouts needed.",
  },
  {
    id: CHECK_IDS.SSH.SSH_CLIENT_ALIVE_COUNT,
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
    forbiddenReason: "ClientAliveCountMax sets session-kill multiplier; tightening may drop legitimate long-running sessions on slow links — manual review needed.",
  },
  {
    id: CHECK_IDS.SSH.SSH_LOGIN_GRACE_TIME,
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
    forbiddenReason: "LoginGraceTime controls auth-handshake timeout; lowering may reject valid logins on high-latency links — manual review required.",
  },
  {
    id: CHECK_IDS.SSH.SSH_IGNORE_RHOSTS,
    name: "Ignore Rhosts Files",
    severity: "critical",
    key: "ignorerhosts",
    expectedValue: "yes",
    comparator: (found) => found.toLowerCase() === "yes",
    fixCommand: "sed -i 's/^#\\?IgnoreRhosts.*/IgnoreRhosts yes/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "Rhosts-based authentication is insecure and allows host-based trust without cryptographic verification.",
    forbiddenReason: "IgnoreRhosts disables legacy rhosts protocol; while insecure, it is a daemon-level directive requiring sshd_config reload — manual review of legacy automation needed.",
  },
  {
    id: CHECK_IDS.SSH.SSH_HOSTBASED_AUTH,
    name: "Host-Based Authentication Disabled",
    severity: "critical",
    key: "hostbasedauthentication",
    expectedValue: "no",
    comparator: (found) => found.toLowerCase() === "no",
    fixCommand: "sed -i 's/^#\\?HostbasedAuthentication.*/HostbasedAuthentication no/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "Host-based authentication trusts remote hosts without user credentials, enabling lateral movement.",
    forbiddenReason: "HostbasedAuthentication is a daemon-level directive; disabling it may break legacy automation chains used in CI/provisioning — manual review required.",
  },
  {
    id: CHECK_IDS.SSH.SSH_MAX_SESSIONS,
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
    forbiddenReason: "MaxSessions caps concurrent sessions per network connection; lowering may break multiplexing tools (tmux, mosh) — manual review needed.",
  },
  {
    id: CHECK_IDS.SSH.SSH_USE_DNS,
    name: "DNS Lookup Disabled",
    severity: "info",
    key: "usedns",
    expectedValue: "no",
    comparator: (found) => found.toLowerCase() === "no",
    fixCommand: "sed -i 's/^#\\?UseDNS.*/UseDNS no/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "Disabling DNS lookups speeds up SSH connections and avoids DNS-based information disclosure.",
    forbiddenReason: "UseDNS disables reverse-DNS authentication checks; while faster, it weakens anti-spoofing for user-source IP matching — manual review of host-based ACLs needed.",
  },
  {
    id: CHECK_IDS.SSH.SSH_PERMIT_USER_ENV,
    name: "User Environment Passthrough Disabled",
    severity: "warning",
    key: "permituserenvironment",
    expectedValue: "no",
    comparator: (found) => found.toLowerCase() === "no",
    fixCommand: "sed -i 's/^#\\?PermitUserEnvironment.*/PermitUserEnvironment no/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "Allowing user environment passthrough can be used to bypass security restrictions via environment variables.",
    forbiddenReason: "PermitUserEnvironment allows env-var injection attacks; disabling is critical but requires sshd_config reload — manual review of legitimate env-var usage needed.",
  },
  {
    id: CHECK_IDS.SSH.SSH_LOG_LEVEL,
    name: "SSH Logging Level Adequate",
    severity: "info",
    key: "loglevel",
    expectedValue: "VERBOSE or INFO",
    comparator: (found) => ["verbose", "info"].includes(found.toLowerCase()),
    fixCommand: "sed -i 's/^#\\?LogLevel.*/LogLevel VERBOSE/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "Verbose or INFO logging ensures sufficient detail is captured for security audit and incident response.",
    forbiddenReason: "LogLevel change requires sshd_config reload; VERBOSE increases log volume significantly and may fill disk on busy hosts — manual review of log rotation needed.",
  },
  {
    id: CHECK_IDS.SSH.SSH_STRONG_CIPHERS,
    name: "No Weak SSH Ciphers",
    severity: "warning",
    key: "ciphers",
    expectedValue: "No weak ciphers (3des, arcfour, blowfish, cast)",
    comparator: (found) => !/3des|arcfour|blowfish|cast/i.test(found),
    fixCommand: "sed -i 's/^#\\?Ciphers.*/Ciphers aes256-ctr,aes192-ctr,aes128-ctr,aes256-gcm@openssh.com,aes128-gcm@openssh.com/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "Weak ciphers like 3DES and Blowfish are vulnerable to known cryptographic attacks.",
    forbiddenReason: "Ciphers list is a daemon-level crypto policy; replacing it disconnects legacy clients that lack modern ciphers — manual review of client compatibility needed.",
  },
  {
    id: CHECK_IDS.SSH.SSH_STRONG_MACS,
    name: "No Weak SSH MACs",
    severity: "warning",
    key: "macs",
    expectedValue: "No weak MACs (md5, umac-64)",
    comparator: (found) => !/md5|umac-64[^-]/i.test(found),
    fixCommand: "sed -i 's/^#\\?MACs.*/MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com,hmac-sha2-512,hmac-sha2-256/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "Weak MACs like MD5-based algorithms do not provide sufficient integrity protection for SSH sessions.",
    forbiddenReason: "MACs list is a daemon-level integrity policy; tightening it disconnects clients with older OpenSSH — manual review of client fleet needed.",
  },
  {
    id: CHECK_IDS.SSH.SSH_STRONG_KEX,
    name: "No Weak KEX Algorithms",
    severity: "warning",
    key: "kexalgorithms",
    expectedValue: "No weak KEX (sha1, diffie-hellman-group1, diffie-hellman-group-exchange-sha1)",
    comparator: (found) => !/diffie-hellman-group1-sha1|diffie-hellman-group-exchange-sha1/i.test(found),
    fixCommand: "sed -i 's/^#\\?KexAlgorithms.*/KexAlgorithms curve25519-sha256,curve25519-sha256@libssh.org,diffie-hellman-group16-sha512,diffie-hellman-group18-sha512/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "Weak key exchange algorithms based on SHA-1 are vulnerable to collision attacks.",
    forbiddenReason: "KexAlgorithms list is a daemon-level key-exchange policy; tightening disconnects old clients and may break legacy SCP/automation — manual review required.",
  },
  {
    id: CHECK_IDS.SSH.SSH_MAX_STARTUPS,
    name: "MaxStartups Limits Concurrent Unauthenticated Connections",
    severity: "warning",
    key: "maxstartups",
    expectedValue: "10:30:60 or stricter (start <= 10)",
    comparator: (found) => {
      const parts = found.split(":");
      const start = parseInt(parts[0], 10);
      return !isNaN(start) && start <= 10;
    },
    fixCommand: "sed -i 's/^#\\?MaxStartups.*/MaxStartups 10:30:60/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "MaxStartups limits concurrent unauthenticated SSH connections, mitigating brute-force and resource exhaustion attacks.",
    forbiddenReason: "MaxStartups caps unauthenticated connection rate; lowering may block legitimate connection floods (CI, deploy bursts) — manual review of automation timing needed.",
  },
  {
    id: CHECK_IDS.SSH.SSH_STRICT_MODES,
    name: "StrictModes Enabled",
    severity: "warning",
    key: "strictmodes",
    expectedValue: "yes",
    comparator: (found) => found.toLowerCase() === "yes",
    fixCommand: "sed -i 's/^#\\?StrictModes.*/StrictModes yes/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "StrictModes checks file permissions on user SSH files before accepting login, preventing exploitation of misconfigured authorized_keys.",
    forbiddenReason: "StrictModes enforces permission checks; if any user has misconfigured authorized_keys, enabling this denies them login — manual review of home-dir perms needed.",
  },
  {
    id: CHECK_IDS.SSH.SSH_NO_AGENT_FORWARDING,
    name: "SSH Agent Forwarding Disabled",
    severity: "warning",
    key: "allowagentforwarding",
    expectedValue: "no",
    comparator: (found) => found.toLowerCase() === "no",
    fixCommand: "sed -i 's/^#\\?AllowAgentForwarding.*/AllowAgentForwarding no/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "SSH agent forwarding exposes the authentication agent to the remote server, enabling key theft if the server is compromised.",
    forbiddenReason: "AllowAgentForwarding is a daemon-level directive; disabling it breaks multi-hop SSH workflows (jump hosts) — manual review of bastion topology needed.",
  },
  {
    id: CHECK_IDS.SSH.SSH_PRINT_MOTD,
    name: "PrintMotd Handled by PAM",
    severity: "info",
    key: "printmotd",
    expectedValue: "no",
    comparator: (found) => found.toLowerCase() === "no",
    fixCommand: "sed -i 's/^#\\?PrintMotd.*/PrintMotd no/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "PrintMotd should be handled by PAM, not sshd directly, to prevent information leakage from static message-of-the-day files.",
    forbiddenReason: "PrintMotd is a daemon-level directive; disabling it bypasses pam_motd which may intentionally surface legal/policy banners — manual review of compliance banners needed.",
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
        safeToAutoFix: "FORBIDDEN" as const,
        forbiddenReason: def.forbiddenReason,
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
      safeToAutoFix: "FORBIDDEN" as const,
      forbiddenReason: def.forbiddenReason,
      explain: def.explain,
    };
  });
};
