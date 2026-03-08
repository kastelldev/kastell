/**
 * SSH hardening check parser.
 * Parses sshd -T output into 6 security checks (SSH-01 through SSH-06).
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
    id: "SSH-01",
    name: "Password Authentication Disabled",
    severity: "critical",
    key: "passwordauthentication",
    expectedValue: "no",
    comparator: (found, expected) => found.toLowerCase() === expected,
    fixCommand: "sed -i 's/^#\\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "Password authentication allows brute-force attacks. Key-based auth is significantly more secure.",
  },
  {
    id: "SSH-02",
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
    id: "SSH-03",
    name: "Empty Passwords Denied",
    severity: "critical",
    key: "permitemptypasswords",
    expectedValue: "no",
    comparator: (found, expected) => found.toLowerCase() === expected,
    fixCommand: "sed -i 's/^#\\?PermitEmptyPasswords.*/PermitEmptyPasswords no/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "Allowing empty passwords lets anyone log in without credentials.",
  },
  {
    id: "SSH-04",
    name: "Public Key Authentication Enabled",
    severity: "warning",
    key: "pubkeyauthentication",
    expectedValue: "yes",
    comparator: (found, expected) => found.toLowerCase() === expected,
    fixCommand: "sed -i 's/^#\\?PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "Public key authentication provides strong cryptographic identity verification.",
  },
  {
    id: "SSH-05",
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
    id: "SSH-06",
    name: "X11 Forwarding Disabled",
    severity: "info",
    key: "x11forwarding",
    expectedValue: "no",
    comparator: (found, expected) => found.toLowerCase() === expected,
    fixCommand: "sed -i 's/^#\\?X11Forwarding.*/X11Forwarding no/' /etc/ssh/sshd_config && systemctl restart sshd",
    explain: "X11 forwarding can be exploited for display hijacking on servers that don't need GUI access.",
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
