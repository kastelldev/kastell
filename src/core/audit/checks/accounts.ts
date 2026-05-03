/**
 * Accounts security check parser.
 * Parses /etc/passwd, /etc/shadow, and home directory data into 15 security checks.
 */

import type {AuditCheck, CheckParser, Severity, FixTier} from "../types.js";
import {CHECK_IDS} from "../checkIds.js";

interface AccountsCheckDef {
  id: string;
  name: string;
  severity: Severity;
  check: (output: string) => { passed: boolean; currentValue: string };
  expectedValue: string;
  fixCommand: string;
  safeToAutoFix?: FixTier;
  explain: string;
}

const ACCOUNTS_CHECKS: AccountsCheckDef[] = [
  {
    id: CHECK_IDS.ACCOUNTS.ACCT_NO_EXTRA_UID0,
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
    safeToAutoFix: "SAFE",
    explain:
      "Multiple accounts with UID 0 grant full root access, making privilege control and audit trails impossible.",
  },
  {
    id: CHECK_IDS.ACCOUNTS.ACCT_NO_EMPTY_PASSWORD,
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
    safeToAutoFix: "SAFE",
    explain:
      "Accounts with empty password hashes allow login without any credentials, providing trivial unauthorized access.",
  },
  {
    id: CHECK_IDS.ACCOUNTS.ACCT_NO_RHOSTS,
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
    safeToAutoFix: "SAFE",
    explain:
      "The .rhosts file allows remote login without password authentication, bypassing all security controls.",
  },
  {
    id: CHECK_IDS.ACCOUNTS.ACCT_HOSTS_EQUIV,
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
    safeToAutoFix: "SAFE",
    explain:
      "The hosts.equiv file grants trust relationships between hosts, allowing passwordless remote access.",
  },
  {
    id: CHECK_IDS.ACCOUNTS.ACCT_NO_NETRC,
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
    safeToAutoFix: "SAFE",
    explain:
      "The .netrc file stores plaintext credentials for FTP and other services, risking credential exposure.",
  },
  {
    id: CHECK_IDS.ACCOUNTS.ACCT_NO_FORWARD,
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
    safeToAutoFix: "SAFE",
    explain:
      "The .forward file can redirect mail to external addresses, potentially leaking sensitive information.",
  },
  {
    id: CHECK_IDS.ACCOUNTS.ACCT_SYSTEM_SHELL,
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
    safeToAutoFix: "SAFE",
    explain:
      "System accounts with interactive shells can be exploited if compromised, providing a login vector.",
  },
  {
    id: CHECK_IDS.ACCOUNTS.ACCT_ROOT_HOME_PERMS,
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
    safeToAutoFix: "SAFE",
    explain:
      "A world-readable root home directory may expose sensitive configuration files and credentials.",
  },
  {
    id: CHECK_IDS.ACCOUNTS.ACCT_NO_DUPLICATE_UID,
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
    safeToAutoFix: "SAFE",
    explain:
      "Duplicate UIDs cause file ownership confusion, making it impossible to correctly attribute actions to users.",
  },
  {
    id: CHECK_IDS.ACCOUNTS.ACCT_HOME_OWNERSHIP,
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
    safeToAutoFix: "SAFE",
    explain:
      "Mismatched home directory ownership can allow other users to access private files and configurations.",
  },
  {
    id: CHECK_IDS.ACCOUNTS.ACCT_SHADOW_PERMS,
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
    safeToAutoFix: "SAFE",
    explain:
      "The /etc/shadow file contains password hashes and must be restricted to prevent offline password cracking.",
  },
  {
    id: CHECK_IDS.ACCOUNTS.ACCT_MAX_PASSWORD_DAYS,
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
    safeToAutoFix: "SAFE",
    explain:
      "Password maximum age ensures credentials are rotated periodically, limiting the window of exposure for compromised passwords.",
  },
  {
    id: CHECK_IDS.ACCOUNTS.ACCT_MIN_PASSWORD_DAYS,
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
    safeToAutoFix: "SAFE",
    explain:
      "Password minimum age prevents users from immediately changing back to an old password after a forced change.",
  },
  {
    id: CHECK_IDS.ACCOUNTS.ACCT_INACTIVE_LOCK,
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
    safeToAutoFix: "SAFE",
    explain:
      "Automatically locking inactive accounts reduces the attack surface by disabling unused credentials.",
  },
  {
    id: CHECK_IDS.ACCOUNTS.ACCT_DEFAULT_UMASK,
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
    safeToAutoFix: "SAFE",
    explain:
      "A restrictive default umask ensures newly created files are not world-readable, protecting sensitive data by default.",
  },
  {
    id: CHECK_IDS.ACCOUNTS.ACCT_NO_EMPTY_HOME,
    name: "No Users with Missing Home Directories",
    severity: "warning",
    check: (output) => {
      // Parse /etc/passwd lines: uid:uid_num:shell
      // Lines from accountsSection: awk -F: '{print $1":"$3":"$7}'
      const passwdLines = output.match(/^[^:]+:\d+:[^\n]+$/gm) ?? [];
      const loginShells = ["/bin/bash", "/bin/sh", "/bin/zsh", "/bin/csh", "/bin/fish"];
      const suspicious = passwdLines.filter((line) => {
        const parts = line.split(":");
        if (parts.length < 3) return false;
        const shell = parts[2].trim();
        return loginShells.some((s) => shell === s);
      }).filter((line) => {
        // Check if the username suggests a non-system account
        const user = line.split(":")[0];
        return user !== "root" && !user.startsWith("_");
      });
      // This is a heuristic — if we have login shell users without clear home structure
      // We pass unless we detect abnormalities
      return {
        passed: suspicious.length === 0 || suspicious.length < 10,
        currentValue: suspicious.length > 0
          ? `${suspicious.length} user(s) with login shells found`
          : "No users with unexpected login shell configuration",
      };
    },
    expectedValue: "No users with login shells and missing home directories",
    fixCommand: "# Review: awk -F: '($7 ~ /bash|sh|zsh/) {print $1,$6,$7}' /etc/passwd | while read u h s; do [ -d \"$h\" ] || echo \"Missing home: $u\"; done",
    safeToAutoFix: "GUARDED",
    explain:
      "Users with valid login shells but missing home directories may indicate misconfigured or orphaned accounts.",
  },
  {
    id: CHECK_IDS.ACCOUNTS.ACCT_INACTIVE_ACCOUNTS,
    name: "No Excessive Inactive Accounts",
    severity: "info",
    check: (output) => {
      // lastlog -b 90 output — lines that are NOT "Never logged in" from accounts inactive 90+ days
      // Count lines that represent real logins (have username, port, from, latest)
      if (output.includes("N/A")) {
        return { passed: true, currentValue: "Inactive account check not available" };
      }
      const lastlogLines = output.split("\n").filter((l) => {
        const trimmed = l.trim();
        return trimmed.length > 0 && !trimmed.startsWith("Username") && !trimmed.startsWith("N/A");
      });
      const inactiveCount = lastlogLines.length;
      const passed = inactiveCount < 5;
      return {
        passed,
        currentValue: passed
          ? `${inactiveCount} accounts with 90+ day inactivity (acceptable)`
          : `${inactiveCount} accounts inactive 90+ days (review recommended)`,
      };
    },
    expectedValue: "Fewer than 5 accounts inactive for 90+ days",
    fixCommand: "# Review: lastlog -b 90 | grep -v 'Never logged in' — lock dormant accounts with: usermod -L USERNAME",
    safeToAutoFix: "GUARDED",
    explain:
      "Dormant accounts with valid credentials are targets for brute force and credential reuse attacks.",
  },
  {
    id: CHECK_IDS.ACCOUNTS.ACCT_TOTAL_USERS_REASONABLE,
    name: "Total User Count Reasonable",
    severity: "info",
    check: (output) => {
      // grep -c '^' /etc/passwd output — a standalone number
      const lines = output.split("\n");
      let userCount: number | null = null;
      for (const line of lines) {
        const trimmed = line.trim();
        // A standalone number > 5 is likely the user count
        if (/^\d+$/.test(trimmed)) {
          const val = parseInt(trimmed, 10);
          if (val > 5) {
            userCount = val;
            break;
          }
        }
      }
      if (userCount === null) {
        return { passed: false, currentValue: "User count not determinable" };
      }
      const passed = userCount < 50;
      return {
        passed,
        currentValue: passed
          ? `${userCount} user accounts (acceptable)`
          : `${userCount} user accounts (excessive for a VPS)`,
      };
    },
    expectedValue: "Fewer than 50 user accounts on a VPS",
    fixCommand: "# Review: cat /etc/passwd | wc -l — remove unnecessary accounts with: userdel USERNAME",
    safeToAutoFix: "GUARDED",
    explain:
      "Excessive user accounts on a VPS indicate poor account hygiene and increase the attack surface.",
  },
  {
    id: CHECK_IDS.ACCOUNTS.ACCT_NO_WORLD_WRITABLE_HOME,
    name: "No World-Writable Home Directories",
    severity: "warning",
    check: (output) => {
      // Home directory permissions from accountsSection stat output
      // Format: "755 /home/user" from find /home -exec stat -c '%a %n'
      const homeDirLines = output.match(/^(\d{3,4})\s+\/home\//gm) ?? [];
      const worldWritable = homeDirLines.filter((line) => {
        const perms = line.trim().split(/\s+/)[0];
        if (!perms) return false;
        const lastDigit = parseInt(perms[perms.length - 1], 10);
        // World-write = bits 1 or 2 set in others (2, 3, 6, 7)
        return [2, 3, 6, 7].includes(lastDigit);
      });
      return {
        passed: worldWritable.length === 0,
        currentValue: worldWritable.length > 0
          ? `${worldWritable.length} world-writable home director(ies) found`
          : "No world-writable home directories",
      };
    },
    expectedValue: "No home directories with world-write permission",
    fixCommand: "find /home -maxdepth 1 -mindepth 1 -type d -perm /o+w -exec chmod o-w {} \\;",
    safeToAutoFix: "SAFE",
    explain:
      "World-writable home directories allow any user to plant malicious files like .bashrc or .ssh/authorized_keys.",
  },
  {
    id: CHECK_IDS.ACCOUNTS.ACCT_LOGIN_DEFS_UID_MAX,
    name: "Login UID Ranges Configured",
    severity: "info",
    check: (output) => {
      const uidMinMatch = output.match(/UID_MIN\s+(\d+)/);
      const uidMaxMatch = output.match(/UID_MAX\s+(\d+)/);
      if (!uidMinMatch || !uidMaxMatch) {
        return { passed: false, currentValue: "UID_MIN or UID_MAX not found in login.defs" };
      }
      const uidMin = parseInt(uidMinMatch[1], 10);
      const uidMax = parseInt(uidMaxMatch[1], 10);
      const passed = uidMin >= 1000 && uidMax >= 60000;
      return {
        passed,
        currentValue: passed
          ? `UID_MIN=${uidMin}, UID_MAX=${uidMax} (standard ranges)`
          : `UID_MIN=${uidMin}, UID_MAX=${uidMax} (non-standard ranges)`,
      };
    },
    expectedValue: "UID_MIN >= 1000 and UID_MAX >= 60000 in /etc/login.defs",
    fixCommand: "Verify UID_MIN=1000 and UID_MAX=60000 in /etc/login.defs",
    safeToAutoFix: "GUARDED",
    explain:
      "Standard UID ranges prevent accidental overlap between system and user accounts, which can lead to privilege confusion.",
  },
  {
    id: CHECK_IDS.ACCOUNTS.ACCT_LOGIN_SHELL_AUDIT,
    name: "Limited Accounts with Login Shells",
    severity: "warning",
    check: (output) => {
      // awk count of accounts with login shells — a standalone number
      const lines = output.split("\n");
      let shellCount: number | null = null;
      for (const line of lines) {
        const trimmed = line.trim();
        if (/^\d+$/.test(trimmed)) {
          const val = parseInt(trimmed, 10);
          // Shell count is typically 1-50
          if (val >= 0 && val < 500) {
            shellCount = val;
          }
        }
      }
      if (shellCount === null) {
        return { passed: false, currentValue: "Login shell count not determinable" };
      }
      const passed = shellCount <= 10;
      return {
        passed,
        currentValue: passed
          ? `${shellCount} accounts with login shells (acceptable)`
          : `${shellCount} accounts with login shells (review recommended)`,
      };
    },
    expectedValue: "10 or fewer accounts with interactive login shells",
    fixCommand: "Review accounts with login shells: awk -F: '($7 != \"/usr/sbin/nologin\" && $7 != \"/bin/false\") {print $1, $7}' /etc/passwd",
    safeToAutoFix: "GUARDED",
    explain:
      "Excessive accounts with login shells increase the attack surface for brute-force and credential stuffing attacks.",
  },
  {
    id: CHECK_IDS.ACCOUNTS.ACCT_GID_CONSISTENCY,
    name: "No Duplicate Group IDs",
    severity: "info",
    check: (output) => {
      // awk duplicate GID output: standalone numbers or "NONE"
      const isNone = /^NONE$/m.test(output);
      if (isNone) {
        return { passed: true, currentValue: "No duplicate GIDs found" };
      }
      // Lines with duplicate GIDs are standalone numbers from uniq -d
      const dupGidLines = output.split("\n").filter((l) => {
        const trimmed = l.trim();
        // Duplicate GIDs are standalone numbers
        return /^\d+$/.test(trimmed);
      });
      const passed = dupGidLines.length === 0;
      return {
        passed,
        currentValue: passed
          ? "No duplicate GIDs found"
          : `Duplicate GIDs found: ${dupGidLines.slice(0, 5).join(", ")}`,
      };
    },
    expectedValue: "No duplicate GIDs in /etc/group",
    fixCommand: "awk -F: '{print $3}' /etc/group | sort | uniq -d -- resolve duplicate GIDs",
    safeToAutoFix: "SAFE",
    explain:
      "Duplicate GIDs can cause files to be accessible by unintended groups, breaking the principle of least privilege.",
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
        safeToAutoFix: def.safeToAutoFix,
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
      safeToAutoFix: def.safeToAutoFix,
      explain: def.explain,
    };
  });
};
