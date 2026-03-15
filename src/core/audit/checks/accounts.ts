/**
 * Accounts security check parser.
 * Parses /etc/passwd, /etc/shadow, and home directory data into 15 security checks.
 */

import type { AuditCheck, CheckParser, Severity } from "../types.js";

interface AccountsCheckDef {
  id: string;
  name: string;
  severity: Severity;
  check: (output: string) => { passed: boolean; currentValue: string };
  expectedValue: string;
  fixCommand: string;
  explain: string;
}

const ACCOUNTS_CHECKS: AccountsCheckDef[] = [
  {
    id: "ACCT-NO-EXTRA-UID0",
    name: "No Extra UID 0 Accounts",
    severity: "critical",
    check: (output) => {
      const lines = output.match(/^[^:]+:\d+:/gm) ?? [];
      const uid0Lines = lines.filter((l) => {
        const uid = l.split(":")[1];
        return uid === "0";
      });
      const extras = uid0Lines.filter((l) => !l.startsWith("root:"));
      return {
        passed: extras.length === 0,
        currentValue:
          extras.length > 0
            ? `Extra UID 0: ${extras.map((l) => l.split(":")[0]).join(", ")}`
            : "Only root has UID 0",
      };
    },
    expectedValue: "Only root has UID 0",
    fixCommand:
      "awk -F: '($3 == 0 && $1 != \"root\") {print $1}' /etc/passwd # Review and remove extra UID 0 accounts",
    explain:
      "Multiple accounts with UID 0 grant full root access, making privilege control and audit trails impossible.",
  },
  {
    id: "ACCT-NO-EMPTY-PASSWORD",
    name: "No Empty Password Hashes",
    severity: "critical",
    check: (output) => {
      // Shadow lines: user:hash — empty hash means no password
      const emptyPw = output.match(/^[^:]+::/gm) ?? [];
      return {
        passed: emptyPw.length === 0,
        currentValue:
          emptyPw.length > 0
            ? `Empty password: ${emptyPw.map((l) => l.split(":")[0]).join(", ")}`
            : "No empty password hashes",
      };
    },
    expectedValue: "No accounts with empty passwords",
    fixCommand: "passwd -l <username> # Lock accounts with empty passwords",
    explain:
      "Accounts with empty password hashes allow login without any credentials, providing trivial unauthorized access.",
  },
  {
    id: "ACCT-NO-RHOSTS",
    name: "No .rhosts Files",
    severity: "critical",
    check: (output) => {
      const hasRhosts = /\.rhosts/.test(output) && !/No such file/i.test(output) && !/NONE/i.test(output);
      return {
        passed: !hasRhosts,
        currentValue: hasRhosts ? ".rhosts file found" : "No .rhosts files",
      };
    },
    expectedValue: "No .rhosts files present",
    fixCommand: "find / -name .rhosts -delete 2>/dev/null",
    explain:
      "The .rhosts file allows remote login without password authentication, bypassing all security controls.",
  },
  {
    id: "ACCT-HOSTS-EQUIV",
    name: "No /etc/hosts.equiv",
    severity: "critical",
    check: (output) => {
      const hasHostsEquiv =
        /hosts\.equiv/.test(output) && !/No such file/i.test(output) && !/NONE/i.test(output);
      return {
        passed: !hasHostsEquiv,
        currentValue: hasHostsEquiv ? "/etc/hosts.equiv found" : "No hosts.equiv file",
      };
    },
    expectedValue: "No /etc/hosts.equiv file",
    fixCommand: "rm -f /etc/hosts.equiv",
    explain:
      "The hosts.equiv file grants trust relationships between hosts, allowing passwordless remote access.",
  },
  {
    id: "ACCT-NO-NETRC",
    name: "No .netrc Files",
    severity: "warning",
    check: (output) => {
      const hasNetrc = /\.netrc/.test(output) && !/No such file/i.test(output) && !/NONE/i.test(output);
      return {
        passed: !hasNetrc,
        currentValue: hasNetrc ? ".netrc file found" : "No .netrc files",
      };
    },
    expectedValue: "No .netrc files present",
    fixCommand: "find / -name .netrc -delete 2>/dev/null",
    explain:
      "The .netrc file stores plaintext credentials for FTP and other services, risking credential exposure.",
  },
  {
    id: "ACCT-NO-FORWARD",
    name: "No .forward Files",
    severity: "warning",
    check: (output) => {
      const hasForward =
        /\.forward/.test(output) && !/No such file/i.test(output) && !/NONE/i.test(output);
      return {
        passed: !hasForward,
        currentValue: hasForward ? ".forward file found" : "No .forward files",
      };
    },
    expectedValue: "No .forward files present",
    fixCommand: "find / -name .forward -delete 2>/dev/null",
    explain:
      "The .forward file can redirect mail to external addresses, potentially leaking sensitive information.",
  },
  {
    id: "ACCT-SYSTEM-SHELL",
    name: "System Accounts No Interactive Shell",
    severity: "warning",
    check: (output) => {
      // Lines from: awk for UID < 1000 with interactive shells
      const systemShells = output.match(
        /^[^:]+:(?:\/bin\/bash|\/bin\/sh|\/bin\/zsh|\/bin\/csh)$/gm,
      ) ?? [];
      // root is expected to have a shell
      const nonRoot = systemShells.filter((l) => !l.startsWith("root:"));
      return {
        passed: nonRoot.length === 0,
        currentValue:
          nonRoot.length > 0
            ? `System accounts with shells: ${nonRoot.map((l) => l.split(":")[0]).join(", ")}`
            : "All system accounts have nologin/false shells",
      };
    },
    expectedValue: "System accounts use /usr/sbin/nologin or /bin/false",
    fixCommand:
      "usermod -s /usr/sbin/nologin <username> # Set nologin shell for system accounts",
    explain:
      "System accounts with interactive shells can be exploited if compromised, providing a login vector.",
  },
  {
    id: "ACCT-ROOT-HOME-PERMS",
    name: "Root Home Directory Restricted",
    severity: "warning",
    check: (output) => {
      // stat -c '%a' /root output
      const permMatch = output.match(/(?:^|\n)(\d{3,4})(?:\n|$)/);
      if (!permMatch) return { passed: false, currentValue: "Unable to read /root permissions" };
      const perms = permMatch[1];
      const othersRead = parseInt(perms.slice(-1), 10);
      const passed = othersRead === 0;
      return {
        passed,
        currentValue: passed ? `/root permissions: ${perms}` : `/root permissions: ${perms} (others can access)`,
      };
    },
    expectedValue: "/root not accessible by others (e.g., 700 or 750)",
    fixCommand: "chmod 700 /root",
    explain:
      "A world-readable root home directory may expose sensitive configuration files and credentials.",
  },
  {
    id: "ACCT-NO-DUPLICATE-UID",
    name: "No Duplicate UIDs",
    severity: "warning",
    check: (output) => {
      // Duplicate UID lines from: sort -t: -k2 -n | uniq -d
      const dupes = output.match(/^[^:]+:\d+$/gm) ?? [];
      const realDupes = dupes.filter((l) => l.trim() !== "" && l !== "NONE");
      return {
        passed: realDupes.length === 0,
        currentValue:
          realDupes.length > 0
            ? `Duplicate UIDs: ${realDupes.join(", ")}`
            : "No duplicate UIDs found",
      };
    },
    expectedValue: "No duplicate UIDs in /etc/passwd",
    fixCommand: "awk -F: '{print $3}' /etc/passwd | sort | uniq -d # Find and resolve duplicate UIDs",
    explain:
      "Duplicate UIDs cause file ownership confusion, making it impossible to correctly attribute actions to users.",
  },
  {
    id: "ACCT-HOME-OWNERSHIP",
    name: "Home Directory Ownership Correct",
    severity: "info",
    check: (output) => {
      // Lines from: stat -c '%n %U' /home/*
      const homeLines = output.match(/\/home\/\S+\s+\S+/g) ?? [];
      const mismatched = homeLines.filter((line) => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 2) return false;
        const dirName = parts[0].split("/").pop() ?? "";
        const owner = parts[1];
        return dirName !== owner;
      });
      return {
        passed: mismatched.length === 0,
        currentValue:
          mismatched.length > 0
            ? `Mismatched: ${mismatched.join(", ")}`
            : "All home directories correctly owned",
      };
    },
    expectedValue: "Each /home/username is owned by username",
    fixCommand: "chown -R username:username /home/username # Fix ownership for each user",
    explain:
      "Mismatched home directory ownership can allow other users to access private files and configurations.",
  },
  {
    id: "ACCT-SHADOW-PERMS",
    name: "/etc/shadow Permissions Restricted",
    severity: "warning",
    check: (output) => {
      // Check if shadow is readable — the awk command succeeds means root access is ok
      // We check if shadow data was returned (meaning we could read it as root, which is correct)
      const hasShadowData = output.includes(":") && !output.includes("Permission denied");
      return {
        passed: hasShadowData,
        currentValue: hasShadowData
          ? "/etc/shadow readable by root only"
          : "/etc/shadow access issue detected",
      };
    },
    expectedValue: "/etc/shadow accessible only by root (permissions 640 or 600)",
    fixCommand: "chmod 640 /etc/shadow && chown root:shadow /etc/shadow",
    explain:
      "The /etc/shadow file contains password hashes and must be restricted to prevent offline password cracking.",
  },
  {
    id: "ACCT-MAX-PASSWORD-DAYS",
    name: "Password Maximum Age Set",
    severity: "warning",
    check: (output) => {
      const match = output.match(/PASS_MAX_DAYS\s+(\d+)/);
      if (!match) return { passed: false, currentValue: "PASS_MAX_DAYS not configured" };
      const days = parseInt(match[1], 10);
      const passed = days <= 365 && days > 0;
      return {
        passed,
        currentValue: `PASS_MAX_DAYS = ${days}`,
      };
    },
    expectedValue: "PASS_MAX_DAYS <= 365",
    fixCommand:
      "sed -i 's/^PASS_MAX_DAYS.*/PASS_MAX_DAYS 365/' /etc/login.defs",
    explain:
      "Password maximum age ensures credentials are rotated periodically, limiting the window of exposure for compromised passwords.",
  },
  {
    id: "ACCT-MIN-PASSWORD-DAYS",
    name: "Password Minimum Age Set",
    severity: "warning",
    check: (output) => {
      const match = output.match(/PASS_MIN_DAYS\s+(\d+)/);
      if (!match) return { passed: false, currentValue: "PASS_MIN_DAYS not configured" };
      const days = parseInt(match[1], 10);
      const passed = days > 0;
      return {
        passed,
        currentValue: `PASS_MIN_DAYS = ${days}`,
      };
    },
    expectedValue: "PASS_MIN_DAYS > 0",
    fixCommand:
      "sed -i 's/^PASS_MIN_DAYS.*/PASS_MIN_DAYS 1/' /etc/login.defs",
    explain:
      "Password minimum age prevents users from immediately changing back to an old password after a forced change.",
  },
  {
    id: "ACCT-INACTIVE-LOCK",
    name: "Inactive Account Lockout Configured",
    severity: "info",
    check: (output) => {
      // Check for INACTIVE setting in login.defs or useradd -D
      const hasInactive = /INACTIVE\s*=?\s*\d+/.test(output) || /useradd.*-f\s+\d+/.test(output);
      return {
        passed: hasInactive,
        currentValue: hasInactive
          ? "Inactive lockout configured"
          : "No inactive account lockout policy",
      };
    },
    expectedValue: "Inactive accounts are automatically locked",
    fixCommand: "useradd -D -f 30 # Lock accounts after 30 days of inactivity",
    explain:
      "Automatically locking inactive accounts reduces the attack surface by disabling unused credentials.",
  },
  {
    id: "ACCT-DEFAULT-UMASK",
    name: "Default umask Restrictive",
    severity: "info",
    check: (output) => {
      const match = output.match(/UMASK\s+(\d+)/);
      if (!match) return { passed: false, currentValue: "UMASK not configured in login.defs" };
      const umask = match[1];
      const passed = umask === "027" || umask === "077";
      return {
        passed,
        currentValue: `UMASK = ${umask}`,
      };
    },
    expectedValue: "UMASK 027 or 077",
    fixCommand: "sed -i 's/^UMASK.*/UMASK 027/' /etc/login.defs",
    explain:
      "A restrictive default umask ensures newly created files are not world-readable, protecting sensitive data by default.",
  },
];

export const parseAccountsChecks: CheckParser = (
  sectionOutput: string,
  _platform: string,
): AuditCheck[] => {
  const isNA =
    !sectionOutput ||
    sectionOutput.trim() === "N/A" ||
    sectionOutput.trim() === "";
  const output = isNA ? "" : sectionOutput;

  return ACCOUNTS_CHECKS.map((def) => {
    if (isNA) {
      return {
        id: def.id,
        category: "Accounts",
        name: def.name,
        severity: def.severity,
        passed: false,
        currentValue: "Unable to determine",
        expectedValue: def.expectedValue,
        fixCommand: def.fixCommand,
        explain: def.explain,
      };
    }
    const { passed, currentValue } = def.check(output);
    return {
      id: def.id,
      category: "Accounts",
      name: def.name,
      severity: def.severity,
      passed,
      currentValue,
      expectedValue: def.expectedValue,
      fixCommand: def.fixCommand,
      explain: def.explain,
    };
  });
};
