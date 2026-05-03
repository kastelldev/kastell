/**
 * MAC (Mandatory Access Control) security check parser.
 * Parses AppArmor status, SELinux enforcement mode, and seccomp
 * kernel support into 7 security checks.
 */

import type {AuditCheck, CheckParser, Severity, FixTier} from "../types.js";
import { CHECK_IDS } from "../checkIds.js";

interface MACCheckDef {
  id: string;
  name: string;
  severity: Severity;
  check: (output: string) => { passed: boolean; currentValue: string };
  expectedValue: string;
  fixCommand: string;
  safeToAutoFix?: FixTier;
  explain: string;
}

const MAC_CHECKS: MACCheckDef[] = [
  {
    id: CHECK_IDS.MAC.MAC_LSM_ACTIVE,
    name: "LSM Active (AppArmor or SELinux)",
    severity: "warning",
    check: (output) => {
      const hasAppArmor = /apparmor/i.test(output);
      const hasSelinux = /selinux/i.test(output);
      const passed = hasAppArmor || hasSelinux;
      const active = hasAppArmor ? "AppArmor" : hasSelinux ? "SELinux" : "none";
      return {
        passed,
        currentValue: passed ? `LSM active: ${active}` : "No LSM (AppArmor/SELinux) detected",
      };
    },
    expectedValue: "apparmor or selinux present in /sys/kernel/security/lsm",
    fixCommand: "apt install apparmor apparmor-utils -y && systemctl enable apparmor && systemctl start apparmor",
    safeToAutoFix: "SAFE",
    explain:
      "A mandatory access control system (AppArmor or SELinux) enforces security policies that restrict what programs can do, limiting the impact of exploited vulnerabilities.",
  },
  {
    id: CHECK_IDS.MAC.MAC_APPARMOR_ACTIVE,
    name: "AppArmor Service Active",
    severity: "warning",
    check: (output) => {
      const isActive = /\bactive\b/.test(output);
      const hasProfiles = /profiles are loaded/i.test(output);
      const passed = isActive || hasProfiles;
      return {
        passed,
        currentValue: passed ? "AppArmor service is active" : "AppArmor service is not active",
      };
    },
    expectedValue: "systemctl is-active apparmor == active",
    fixCommand: "systemctl enable apparmor && systemctl start apparmor",
    safeToAutoFix: "SAFE",
    explain:
      "AppArmor must be running to enforce security profiles. A stopped AppArmor service provides no MAC protection even if profiles are defined.",
  },
  {
    id: CHECK_IDS.MAC.MAC_APPARMOR_PROFILES,
    name: "AppArmor Enforce Mode Profiles",
    severity: "info",
    check: (output) => {
      const match = output.match(/(\d+)\s+profiles?\s+are\s+in\s+enforce\s+mode/i);
      if (!match) {
        return { passed: false, currentValue: "No enforce mode profile count found" };
      }
      const count = parseInt(match[1], 10);
      return {
        passed: count > 0,
        currentValue: count > 0 ? `${count} profiles in enforce mode` : "0 profiles in enforce mode",
      };
    },
    expectedValue: "At least 1 profile in AppArmor enforce mode",
    fixCommand: "aa-enforce /etc/apparmor.d/* # Enable enforce mode for all AppArmor profiles",
    safeToAutoFix: "SAFE",
    explain:
      "AppArmor profiles in enforce mode actively block policy violations. Profiles only in complain mode log violations without blocking them, providing weaker protection.",
  },
  {
    id: CHECK_IDS.MAC.MAC_APPARMOR_NO_UNCONFINED,
    name: "Minimal Unconfined Processes",
    severity: "info",
    check: (output) => {
      const match = output.match(/(\d+)\s+processes?\s+are\s+unconfined/i);
      if (!match) {
        return { passed: true, currentValue: "Unconfined process count not available" };
      }
      const count = parseInt(match[1], 10);
      const passed = count < 50;
      return {
        passed,
        currentValue: passed
          ? `${count} unconfined processes (acceptable)`
          : `${count} unconfined processes (high)`,
      };
    },
    expectedValue: "Unconfined process count is low (< 50)",
    fixCommand: "aa-genprof <process> # Generate an AppArmor profile for unconfined processes",
    safeToAutoFix: "SAFE",
    explain:
      "Processes running without an AppArmor profile (unconfined) have unrestricted access. A high count of unconfined processes indicates incomplete MAC coverage.",
  },
  {
    id: CHECK_IDS.MAC.MAC_SELINUX_ENFORCING,
    name: "SELinux Enforcing (if present)",
    severity: "warning",
    check: (output) => {
      const notInstalled = /NOT_INSTALLED/i.test(output);
      if (notInstalled) {
        return { passed: true, currentValue: "SELinux not present (AppArmor system)" };
      }
      const enforcing = /^Enforcing$/mi.test(output);
      const mode = output.match(/^(Enforcing|Permissive|Disabled)$/mi)?.[1] ?? "unknown";
      return {
        passed: enforcing,
        currentValue: enforcing ? "SELinux: Enforcing" : `SELinux: ${mode}`,
      };
    },
    expectedValue: "SELinux Enforcing or not installed (AppArmor system)",
    fixCommand: "setenforce 1 && sed -i 's/SELINUX=.*/SELINUX=enforcing/' /etc/selinux/config",
    safeToAutoFix: "SAFE",
    explain:
      "SELinux in Enforcing mode actively blocks policy violations. Permissive mode only logs violations without blocking them. On AppArmor systems (Ubuntu), SELinux absence is expected and not a finding.",
  },
  {
    id: CHECK_IDS.MAC.MAC_SELINUX_CONFIG,
    name: "SELinux Config Enforcing",
    severity: "info",
    check: (output) => {
      // If SELINUX= not found, config not present (AppArmor system) — pass
      if (!output.includes("SELINUX=")) {
        return { passed: true, currentValue: "SELinux config not present (AppArmor system)" };
      }
      const enforcing = /SELINUX=enforcing/i.test(output);
      const mode = output.match(/SELINUX=(\w+)/i)?.[1] ?? "unknown";
      return {
        passed: enforcing,
        currentValue: enforcing ? "SELINUX=enforcing in config" : `SELINUX=${mode} in config`,
      };
    },
    expectedValue: "SELINUX=enforcing in /etc/selinux/config, or config not present",
    fixCommand: "sed -i 's/SELINUX=.*/SELINUX=enforcing/' /etc/selinux/config && reboot",
    safeToAutoFix: "SAFE",
    explain:
      "The SELinux config file sets the mode that persists across reboots. Without SELINUX=enforcing in the config, a reboot can revert SELinux to permissive or disabled mode.",
  },
  {
    id: CHECK_IDS.MAC.MAC_SECCOMP_ENABLED,
    name: "Seccomp Kernel Support",
    severity: "info",
    check: (output) => {
      const match = output.match(/Seccomp:\s*(\d+)/i);
      if (!match) {
        return { passed: false, currentValue: "Seccomp status not found in /proc/self/status" };
      }
      const value = parseInt(match[1], 10);
      return {
        passed: value > 0,
        currentValue: value > 0 ? `Seccomp enabled (value: ${value})` : "Seccomp: 0 (disabled)",
      };
    },
    expectedValue: "Seccomp field in /proc/self/status > 0",
    fixCommand: "# Seccomp is a kernel feature — upgrade kernel or enable CONFIG_SECCOMP",
    safeToAutoFix: "GUARDED",
    explain:
      "Seccomp (secure computing mode) restricts the system calls available to processes, limiting the attack surface if a process is compromised.",
  },
  {
    id: CHECK_IDS.MAC.MAC_APPARMOR_ENFORCE_COUNT,
    name: "AppArmor Enforce Mode Count",
    severity: "warning",
    check: (output) => {
      // aa-status | grep -c 'enforce mode' output — a standalone count
      // This is separate from the profile count in MAC-APPARMOR-PROFILES
      // Look for the raw count from the grep -c command
      const lines = output.split("\n");
      let enforceCount: number | null = null;
      for (const line of lines) {
        const trimmed = line.trim();
        // Look for small standalone numbers (0-1000) that could be enforce mode count
        if (/^\d+$/.test(trimmed)) {
          const val = parseInt(trimmed, 10);
          if (val >= 0 && val < 1000) {
            enforceCount = val;
            break;
          }
        }
      }
      // Also check profiles in enforce mode from aa-status main output
      const enforceMatch = output.match(/(\d+)\s+profiles?\s+are\s+in\s+enforce\s+mode/i);
      if (enforceMatch) {
        enforceCount = parseInt(enforceMatch[1], 10);
      }
      if (enforceCount === null) {
        return { passed: false, currentValue: "AppArmor enforce count not determinable" };
      }
      return {
        passed: enforceCount > 0,
        currentValue: enforceCount > 0
          ? `${enforceCount} profile(s) in enforce mode`
          : "0 profiles in enforce mode",
      };
    },
    expectedValue: "At least 1 AppArmor profile in enforce mode",
    fixCommand: "aa-enforce /etc/apparmor.d/*  # Enable enforce mode for all AppArmor profiles",
    safeToAutoFix: "SAFE",
    explain:
      "AppArmor profiles in enforce mode actively restrict application behavior; complain mode only logs violations.",
  },
  {
    id: CHECK_IDS.MAC.MAC_NO_UNCONFINED_PROCS,
    name: "Minimal Unconfined Processes",
    severity: "info",
    check: (output) => {
      const match = output.match(/(\d+)\s+processes?\s+are\s+unconfined/i);
      if (!match) {
        return { passed: true, currentValue: "Unconfined process count not available (AppArmor may not be active)" };
      }
      const count = parseInt(match[1], 10);
      const passed = count < 10;
      return {
        passed,
        currentValue: passed
          ? `${count} unconfined processes (acceptable)`
          : `${count} unconfined processes (high)`,
      };
    },
    expectedValue: "Fewer than 10 unconfined processes",
    fixCommand: "aa-genprof <process>  # Generate AppArmor profile for unconfined processes",
    safeToAutoFix: "SAFE",
    explain:
      "Unconfined processes run without AppArmor restrictions; minimizing them reduces the attack surface.",
  },
  {
    id: CHECK_IDS.MAC.MAC_SECCOMP_STRICT,
    name: "Seccomp Filter Mode Active",
    severity: "info",
    check: (output) => {
      const match = output.match(/Seccomp:\s*(\d+)/i);
      if (!match) {
        return { passed: false, currentValue: "Seccomp value not found" };
      }
      const value = parseInt(match[1], 10);
      // 1 = strict, 2 = filter (both are good)
      const passed = value === 1 || value === 2;
      return {
        passed,
        currentValue: value === 1
          ? "Seccomp: strict mode"
          : value === 2
            ? "Seccomp: filter mode"
            : "Seccomp: disabled (0)",
      };
    },
    expectedValue: "Seccomp value 1 (strict) or 2 (filter), not 0",
    fixCommand: "# Seccomp is a kernel feature — ensure CONFIG_SECCOMP and CONFIG_SECCOMP_FILTER are enabled",
    safeToAutoFix: "GUARDED",
    explain:
      "Seccomp system call filtering restricts which syscalls processes can use, reducing kernel attack surface.",
  },
];

export const parseMACChecks: CheckParser = (
  sectionOutput: string,
  _platform: string,
): AuditCheck[] => {
  const isNA =
    !sectionOutput ||
    sectionOutput.trim() === "N/A" ||
    sectionOutput.trim() === "";
  const output = isNA ? "" : sectionOutput;

  return MAC_CHECKS.map((def) => {
    if (isNA) {
      return {
        id: def.id,
        category: "MAC",
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
      category: "MAC",
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
