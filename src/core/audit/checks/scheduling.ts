/**
 * Scheduling security check parser.
 * Checks cron/at access control and directory permissions.
 */

import type { AuditCheck, CheckParser, Severity } from "../types.js";

interface SchedulingCheckDef {
  id: string;
  name: string;
  severity: Severity;
  check: (output: string) => { passed: boolean; currentValue: string };
  expectedValue: string;
  fixCommand: string;
  explain: string;
}

const SCHEDULING_CHECKS: SchedulingCheckDef[] = [
  {
    id: "SCHED-CRON-ACCESS-CONTROL",
    name: "cron.allow Configured",
    severity: "warning",
    check: (output) => {
      // test -f /etc/cron.allow returns content or "MISSING"
      const exists = !output.includes("MISSING") && /cron\.allow/i.test(output);
      return {
        passed: exists,
        currentValue: exists ? "/etc/cron.allow exists" : "/etc/cron.allow not found",
      };
    },
    expectedValue: "/etc/cron.allow exists (whitelist approach)",
    fixCommand: "echo root > /etc/cron.allow && chmod 600 /etc/cron.allow",
    explain:
      "Using cron.allow restricts cron access to explicitly listed users, following the principle of least privilege.",
  },
  {
    id: "SCHED-CRON-DENY",
    name: "cron.deny Configured",
    severity: "info",
    check: (output) => {
      const exists = /cron\.deny/i.test(output) && !/MISSING.*cron\.deny/i.test(output);
      return {
        passed: exists,
        currentValue: exists ? "/etc/cron.deny exists" : "/etc/cron.deny not found",
      };
    },
    expectedValue: "/etc/cron.deny exists as fallback access control",
    fixCommand: "touch /etc/cron.deny && chmod 600 /etc/cron.deny",
    explain:
      "The cron.deny file provides a secondary layer of access control by explicitly blocking specific users from cron.",
  },
  {
    id: "SCHED-AT-ACCESS-CONTROL",
    name: "at.allow Configured",
    severity: "warning",
    check: (output) => {
      const exists = !output.includes("MISSING") && /at\.allow/i.test(output);
      return {
        passed: exists,
        currentValue: exists ? "/etc/at.allow exists" : "/etc/at.allow not found",
      };
    },
    expectedValue: "/etc/at.allow exists (whitelist approach)",
    fixCommand: "echo root > /etc/at.allow && chmod 600 /etc/at.allow",
    explain:
      "Using at.allow restricts the 'at' scheduler to explicitly listed users, preventing unauthorized job scheduling.",
  },
  {
    id: "SCHED-AT-DENY",
    name: "at.deny Configured",
    severity: "info",
    check: (output) => {
      const exists = /at\.deny/i.test(output) && !/MISSING.*at\.deny/i.test(output);
      return {
        passed: exists,
        currentValue: exists ? "/etc/at.deny exists" : "/etc/at.deny not found",
      };
    },
    expectedValue: "/etc/at.deny exists as fallback access control",
    fixCommand: "touch /etc/at.deny && chmod 600 /etc/at.deny",
    explain:
      "The at.deny file blocks specific users from scheduling one-time jobs, complementing at.allow.",
  },
  {
    id: "SCHED-CRON-DIR-PERMS",
    name: "Cron Dirs Not World-Writable",
    severity: "warning",
    check: (output) => {
      // find /etc/cron* -perm -o+w returns paths or "NONE"
      const hasWorldWritable = !output.includes("NONE") && /\/etc\/cron/i.test(output);
      return {
        passed: !hasWorldWritable,
        currentValue: hasWorldWritable
          ? "World-writable cron directories found"
          : "No world-writable cron directories",
      };
    },
    expectedValue: "No world-writable cron directories",
    fixCommand: "chmod o-w /etc/cron.d /etc/cron.daily /etc/cron.weekly /etc/cron.monthly /etc/cron.hourly",
    explain:
      "World-writable cron directories allow any user to inject scheduled tasks, enabling privilege escalation.",
  },
  {
    id: "SCHED-CRONTAB-PERMS",
    name: "/etc/crontab Restricted",
    severity: "warning",
    check: (output) => {
      // stat -c '%a %U %G %n' /etc/crontab
      const match = output.match(/(\d{3,4})\s+(\w+)\s+(\w+)\s+.*crontab/);
      if (!match) return { passed: false, currentValue: "Unable to read /etc/crontab permissions" };
      const perms = match[1];
      const owner = match[2];
      const passed = (perms === "600" || perms === "644") && owner === "root";
      return {
        passed,
        currentValue: `/etc/crontab: ${perms} ${owner}`,
      };
    },
    expectedValue: "/etc/crontab permissions 600 or 644, owned by root",
    fixCommand: "chmod 600 /etc/crontab && chown root:root /etc/crontab",
    explain:
      "The system crontab must be restricted to root to prevent unauthorized modification of scheduled tasks.",
  },
  {
    id: "SCHED-CRON-D-PERMS",
    name: "/etc/cron.d Restricted",
    severity: "info",
    check: (output) => {
      const match = output.match(/(\d{3,4})\s+(\w+)\s+(\w+)\s+.*cron\.d\b/);
      if (!match) return { passed: false, currentValue: "Unable to read /etc/cron.d permissions" };
      const perms = match[1];
      const owner = match[2];
      const passed = (perms === "700" || perms === "750" || perms === "755") && owner === "root";
      return {
        passed,
        currentValue: `/etc/cron.d: ${perms} ${owner}`,
      };
    },
    expectedValue: "/etc/cron.d permissions 700 or 750, owned by root",
    fixCommand: "chmod 700 /etc/cron.d && chown root:root /etc/cron.d",
    explain:
      "The cron.d directory holds additional crontab files and should be restricted to prevent unauthorized job additions.",
  },
  {
    id: "SCHED-CRON-DAILY-PERMS",
    name: "/etc/cron.daily Restricted",
    severity: "info",
    check: (output) => {
      const match = output.match(/(\d{3,4})\s+(\w+)\s+(\w+)\s+.*cron\.daily/);
      if (!match) return { passed: false, currentValue: "Unable to read /etc/cron.daily permissions" };
      const perms = match[1];
      const owner = match[2];
      const passed = (perms === "700" || perms === "750" || perms === "755") && owner === "root";
      return {
        passed,
        currentValue: `/etc/cron.daily: ${perms} ${owner}`,
      };
    },
    expectedValue: "/etc/cron.daily permissions 700 or 750, owned by root",
    fixCommand: "chmod 700 /etc/cron.daily && chown root:root /etc/cron.daily",
    explain:
      "Daily cron scripts directory should be restricted to prevent injection of persistent malicious scripts.",
  },
  {
    id: "SCHED-CRONTAB-OWNER",
    name: "/etc/crontab Owned by Root with Restricted Permissions",
    severity: "warning",
    check: (output) => {
      // stat -c '%a %U %G %n' /etc/crontab output: "600 root root /etc/crontab"
      const match = output.match(/(\d{3,4})\s+(\w+)\s+\w+\s+.*\/etc\/crontab/);
      if (!match) return { passed: false, currentValue: "Unable to read /etc/crontab ownership" };
      const perms = match[1];
      const owner = match[2];
      const permNum = parseInt(perms, 10);
      const isOwnerRoot = owner === "root";
      const isRestrictedPerms = permNum <= 600;
      const passed = isOwnerRoot && isRestrictedPerms;
      return {
        passed,
        currentValue: `/etc/crontab: permissions ${perms}, owner ${owner}`,
      };
    },
    expectedValue: "/etc/crontab owned by root with permissions <= 600",
    fixCommand: "chown root:root /etc/crontab && chmod 600 /etc/crontab",
    explain:
      "Non-root owned or world-writable crontab files allow privilege escalation through scheduled job injection.",
  },
  {
    id: "SCHED-NO-USER-CRONTABS",
    name: "No World-Writable Cron Directories",
    severity: "warning",
    check: (output) => {
      // find /etc/cron* -perm -o+w returns paths or "NONE"
      const hasWorldWritable = !output.includes("NONE") && /\/etc\/cron/i.test(output);
      return {
        passed: !hasWorldWritable,
        currentValue: hasWorldWritable
          ? "World-writable cron directories or files found"
          : "No world-writable cron directories",
      };
    },
    expectedValue: "No world-writable entries in /etc/cron.d, /etc/cron.daily, etc.",
    fixCommand: "chmod -R o-w /etc/cron.d /etc/cron.daily /etc/cron.weekly /etc/cron.monthly",
    explain:
      "World-writable cron directories allow any user to inject scheduled tasks for privilege escalation.",
  },
  {
    id: "SCHED-CRON-D-FILE-COUNT",
    name: "cron.d File Count Reasonable",
    severity: "info",
    check: (output) => {
      // find /etc/cron.d/ -type f | wc -l output — a number
      const match = output.match(/\b(\d+)\b/);
      if (!match) return { passed: false, currentValue: "Unable to determine cron.d file count" };
      const count = parseInt(match[1], 10);
      return {
        passed: count <= 15,
        currentValue: `${count} file(s) in /etc/cron.d/`,
      };
    },
    expectedValue: "15 or fewer files in /etc/cron.d/",
    fixCommand: "ls /etc/cron.d/ — review and remove unnecessary scheduled tasks",
    explain:
      "Excessive cron.d files indicate unmanaged scheduled tasks that may run with elevated privileges.",
  },
  {
    id: "SCHED-NO-WORLD-READABLE-CRONTABS",
    name: "No World-Readable User Crontabs",
    severity: "warning",
    check: (output) => {
      // find /var/spool/cron/crontabs/ -type f -perm -o+r output — paths or NONE
      const hasWorldReadable = !output.includes("NONE") && /\/var\/spool\/cron\/crontabs/i.test(output);
      return {
        passed: !hasWorldReadable,
        currentValue: hasWorldReadable
          ? "World-readable crontab file(s) found in /var/spool/cron/crontabs/"
          : "No world-readable crontabs found",
      };
    },
    expectedValue: "No world-readable files in /var/spool/cron/crontabs/",
    fixCommand: "chmod 600 /var/spool/cron/crontabs/*",
    explain:
      "World-readable crontab files expose scheduled task details including credentials and internal paths to all local users.",
  },
];

export const parseSchedulingChecks: CheckParser = (
  sectionOutput: string,
  _platform: string,
): AuditCheck[] => {
  const isNA =
    !sectionOutput ||
    sectionOutput.trim() === "N/A" ||
    sectionOutput.trim() === "";
  const output = isNA ? "" : sectionOutput;

  return SCHEDULING_CHECKS.map((def) => {
    if (isNA) {
      return {
        id: def.id,
        category: "Scheduling",
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
      category: "Scheduling",
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
