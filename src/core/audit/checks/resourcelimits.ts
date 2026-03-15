/**
 * Resource Limits security check parser.
 * Parses cgroups v2 status, nproc limits, kernel.threads-max,
 * and /etc/security/limits.conf settings into 6 security checks.
 *
 * NOTE: This module focuses on cgroups v2, nproc, threads-max, and limits.conf.
 * It does NOT duplicate MEM-ULIMIT-NOFILE, MEM-PID-MAX-REASONABLE, or MEM-OOM-KILL-POLICY
 * which are covered in memory.ts.
 */

import type { AuditCheck, CheckParser, Severity } from "../types.js";

interface ResourceLimitsCheckDef {
  id: string;
  name: string;
  severity: Severity;
  check: (output: string) => { passed: boolean; currentValue: string };
  expectedValue: string;
  fixCommand: string;
  explain: string;
}

const RLIMIT_CHECKS: ResourceLimitsCheckDef[] = [
  {
    id: "RLIMIT-CGROUPS-V2",
    name: "cgroups v2 Active",
    severity: "warning",
    check: (output) => {
      if (output.includes("CGROUPS_V2_ACTIVE")) {
        return { passed: true, currentValue: "cgroups v2 is active (/sys/fs/cgroup/cgroup.controllers found)" };
      }
      if (output.includes("CGROUPS_V2_ABSENT")) {
        return { passed: false, currentValue: "cgroups v2 not active — /sys/fs/cgroup/cgroup.controllers absent" };
      }
      return { passed: false, currentValue: "cgroups v2 status could not be determined" };
    },
    expectedValue: "/sys/fs/cgroup/cgroup.controllers exists (cgroups v2 unified hierarchy)",
    fixCommand: "# Ensure cgroup_no_v1=all in kernel cmdline or use systemd-cgroupsv2 migration",
    explain:
      "cgroups v2 (unified hierarchy) provides superior resource isolation and control compared to cgroups v1. Its absence means container runtimes and systemd cannot enforce per-process CPU/memory limits reliably.",
  },
  {
    id: "RLIMIT-NPROC-SOFT",
    name: "nproc Soft Limit Configured",
    severity: "warning",
    check: (output) => {
      // NPROC_SOFT:<value>
      const match = output.match(/NPROC_SOFT:(\S+)/);
      if (!match) {
        return { passed: false, currentValue: "nproc soft limit not found" };
      }
      const value = match[1];
      const isUnlimited = value === "unlimited" || value === "-1";
      if (isUnlimited) {
        return { passed: false, currentValue: "nproc soft limit: unlimited (not configured)" };
      }
      const numVal = parseInt(value, 10);
      const reasonable = !isNaN(numVal) && numVal < 65536;
      return {
        passed: reasonable,
        currentValue: reasonable
          ? `nproc soft limit: ${numVal} (configured)`
          : `nproc soft limit: ${numVal} (excessively high)`,
      };
    },
    expectedValue: "nproc soft limit is a finite numeric value < 65536",
    fixCommand: "echo '* soft nproc 4096' >> /etc/security/limits.conf",
    explain:
      "An unlimited nproc soft limit allows a single user to fork unlimited processes, enabling fork bomb attacks that exhaust the process table and cause system-wide denial of service.",
  },
  {
    id: "RLIMIT-NPROC-HARD",
    name: "nproc Hard Limit Configured",
    severity: "info",
    check: (output) => {
      // NPROC_HARD:<value>
      const match = output.match(/NPROC_HARD:(\S+)/);
      if (!match) {
        return { passed: false, currentValue: "nproc hard limit not found" };
      }
      const value = match[1];
      const notSet = value === "NOT_SET" || value === "unlimited" || value === "-1";
      if (notSet) {
        return { passed: false, currentValue: `nproc hard limit: ${value} (not enforced)` };
      }
      const numVal = parseInt(value, 10);
      const valid = !isNaN(numVal) && numVal > 0;
      return {
        passed: valid,
        currentValue: valid
          ? `nproc hard limit: ${numVal} (configured)`
          : `nproc hard limit: ${value} (not parseable)`,
      };
    },
    expectedValue: "nproc hard limit is explicitly set to a numeric value",
    fixCommand: "echo '* hard nproc 8192' >> /etc/security/limits.conf",
    explain:
      "A hard nproc limit provides an upper bound that even privileged users cannot exceed without root intervention. Without it, soft limits can be trivially bypassed by any user process.",
  },
  {
    id: "RLIMIT-THREADS-MAX",
    name: "kernel.threads-max Configured",
    severity: "info",
    check: (output) => {
      // THREADS_MAX:kernel.threads-max = <value>
      const match = output.match(/THREADS_MAX:kernel\.threads-max\s*=\s*(\d+)/);
      if (!match) {
        if (output.includes("THREADS_MAX_NOT_FOUND")) {
          return { passed: false, currentValue: "kernel.threads-max not found" };
        }
        return { passed: false, currentValue: "kernel.threads-max not found" };
      }
      const value = parseInt(match[1], 10);
      return {
        passed: true,
        currentValue: `kernel.threads-max = ${value} (configured)`,
      };
    },
    expectedValue: "kernel.threads-max is set in sysctl configuration",
    fixCommand: "sysctl -w kernel.threads-max=32768 && echo 'kernel.threads-max=32768' >> /etc/sysctl.conf",
    explain:
      "kernel.threads-max sets the system-wide maximum number of threads. Having it explicitly configured prevents an unbounded thread count that could exhaust kernel resources.",
  },
  {
    id: "RLIMIT-LIMITS-CONF-NPROC",
    name: "nproc Entries in /etc/security/limits.conf",
    severity: "info",
    check: (output) => {
      if (output.includes("LIMITS_CONF_NPROC_SET")) {
        return { passed: true, currentValue: "nproc entries found in /etc/security/limits.conf" };
      }
      if (output.includes("LIMITS_CONF_NPROC_NOT_SET")) {
        return { passed: false, currentValue: "No nproc entries in /etc/security/limits.conf" };
      }
      return { passed: false, currentValue: "limits.conf nproc status could not be determined" };
    },
    expectedValue: "nproc entries present in /etc/security/limits.conf or limits.d/",
    fixCommand: "echo '* soft nproc 4096\n* hard nproc 8192' >> /etc/security/limits.conf",
    explain:
      "Explicit nproc entries in /etc/security/limits.conf enforce process limits for PAM-authenticated sessions. Without them, default system limits apply which may be unlimited depending on the OS version.",
  },
  {
    id: "RLIMIT-MAXLOGINS",
    name: "maxlogins Configured in limits.conf",
    severity: "info",
    check: (output) => {
      if (output.includes("LIMITS_CONF_MAXLOGINS_SET")) {
        return { passed: true, currentValue: "maxlogins configured in /etc/security/limits.conf" };
      }
      if (output.includes("LIMITS_CONF_MAXLOGINS_NOT_SET")) {
        return { passed: false, currentValue: "maxlogins not configured in /etc/security/limits.conf" };
      }
      return { passed: false, currentValue: "maxlogins status could not be determined" };
    },
    expectedValue: "maxlogins entry present in /etc/security/limits.conf",
    fixCommand: "echo '* hard maxlogins 10' >> /etc/security/limits.conf",
    explain:
      "Setting maxlogins in /etc/security/limits.conf limits concurrent login sessions per user. This prevents a single compromised account from holding many simultaneous sessions for parallel attack operations.",
  },
];

export const parseResourceLimitsChecks: CheckParser = (
  sectionOutput: string,
  _platform: string,
): AuditCheck[] => {
  const isNA =
    !sectionOutput ||
    sectionOutput.trim() === "N/A" ||
    sectionOutput.trim() === "";
  const output = isNA ? "" : sectionOutput;

  return RLIMIT_CHECKS.map((def) => {
    if (isNA) {
      return {
        id: def.id,
        category: "Resource Limits",
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
      category: "Resource Limits",
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
