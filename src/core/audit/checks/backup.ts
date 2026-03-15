/**
 * Backup Hygiene security check parser.
 * Parses Kastell backup presence, file permissions, script safety,
 * tool installation, cron job existence, and /var/backups into 6 security checks.
 */

import type { AuditCheck, CheckParser, Severity } from "../types.js";

interface BackupCheckDef {
  id: string;
  name: string;
  severity: Severity;
  check: (output: string) => { passed: boolean; currentValue: string };
  expectedValue: string;
  fixCommand: string;
  explain: string;
}

const BACKUP_CHECKS: BackupCheckDef[] = [
  {
    id: "BACKUP-RECENT-BACKUP",
    name: "Recent Kastell Backup Exists",
    severity: "warning",
    check: (output) => {
      if (output.includes("KASTELL_BACKUP_FOUND")) {
        return { passed: true, currentValue: "Kastell backup found in /root/.kastell/backups/" };
      }
      if (output.includes("KASTELL_BACKUP_MISSING")) {
        return { passed: false, currentValue: "No recent backup found in /root/.kastell/backups/" };
      }
      return { passed: false, currentValue: "Unable to determine backup presence" };
    },
    expectedValue: "Kastell backup exists in /root/.kastell/backups/ and is < 30 days old",
    fixCommand: "kastell backup create",
    explain:
      "A recent backup in /root/.kastell/backups/ confirms that server configuration and data are being backed up regularly. Without a recent backup, data loss after a failure or compromise cannot be recovered.",
  },
  {
    id: "BACKUP-ENCRYPTION-PRESENT",
    name: "Backup Files Have Restricted Permissions",
    severity: "warning",
    check: (output) => {
      // BACKUP_FILE_PERMS:<mode>:<owner>:<group>
      const match = output.match(/BACKUP_FILE_PERMS:(\d+):(\w+):(\w+)/);
      if (!match) {
        return { passed: false, currentValue: "Backup file permission info not available" };
      }
      const [, mode, owner] = match;
      // Accept 600 or 640, owned by root
      const modeOk = mode === "600" || mode === "640";
      const ownerOk = owner === "root";
      const passed = modeOk && ownerOk;
      return {
        passed,
        currentValue: passed
          ? `Backup files: ${mode} owned by ${owner} (restricted)`
          : `Backup files: ${mode} owned by ${owner} (too permissive or wrong owner)`,
      };
    },
    expectedValue: "Backup files have 600 or 640 permissions owned by root",
    fixCommand: "chmod 600 /root/.kastell/backups/* && chown root:root /root/.kastell/backups/*",
    explain:
      "Backup files may contain sensitive configuration, credentials, or database dumps. Restricting permissions to 600/640 owned by root prevents other users from reading or modifying backup data.",
  },
  {
    id: "BACKUP-SCRIPT-PERMS",
    name: "Backup Scripts Not World-Writable",
    severity: "warning",
    check: (output) => {
      if (output.includes("BACKUP_SCRIPT_PERMS_OK")) {
        return { passed: true, currentValue: "Backup scripts are not world-writable" };
      }
      if (output.includes("BACKUP_SCRIPT_PERMS_WRITABLE")) {
        return { passed: false, currentValue: "World-writable backup scripts found" };
      }
      return { passed: false, currentValue: "Backup script permissions could not be verified" };
    },
    expectedValue: "Backup scripts are not world-writable (no o+w permission)",
    fixCommand: "chmod o-w /etc/cron.daily/backup* /usr/local/bin/backup* 2>/dev/null || true",
    explain:
      "World-writable backup scripts allow any local user to inject arbitrary code that runs as root during scheduled backups, providing an easy privilege escalation vector.",
  },
  {
    id: "BACKUP-TOOL-INSTALLED",
    name: "Backup Tool Installed",
    severity: "info",
    check: (output) => {
      const match = output.match(/BACKUP_TOOL_INSTALLED:(\w+)/);
      if (match) {
        return { passed: true, currentValue: `Backup tool installed: ${match[1]}` };
      }
      if (output.includes("BACKUP_TOOL_NOT_INSTALLED")) {
        return { passed: false, currentValue: "No backup tool (rsync/borg/restic) installed" };
      }
      return { passed: false, currentValue: "Backup tool presence could not be determined" };
    },
    expectedValue: "At least one of rsync, borg, or restic is installed",
    fixCommand: "apt-get install -y rsync || yum install -y rsync",
    explain:
      "A dedicated backup tool (rsync, borg, or restic) enables reliable, incremental, and verifiable backups. Its absence suggests backups may not be performed or rely on ad-hoc scripts with limited reliability.",
  },
  {
    id: "BACKUP-CRON-JOB",
    name: "Scheduled Backup Job Configured",
    severity: "info",
    check: (output) => {
      if (output.includes("BACKUP_CRON_JOB_FOUND")) {
        return { passed: true, currentValue: "Cron backup job found" };
      }
      if (output.includes("BACKUP_CRON_JOB_NOT_FOUND")) {
        return { passed: false, currentValue: "No cron backup job configured" };
      }
      return { passed: false, currentValue: "Cron backup job presence could not be determined" };
    },
    expectedValue: "A cron job for periodic backups exists in crontab or cron.daily",
    fixCommand: "echo '0 2 * * * root /usr/bin/rsync -a /etc /root/.kastell/backups/' >> /etc/crontab",
    explain:
      "A scheduled cron backup job ensures backups run automatically without manual intervention. Without it, backups depend on manual execution and are likely to be missed.",
  },
  {
    id: "BACKUP-VAR-BACKUPS",
    name: "/var/backups Exists and Has Content",
    severity: "info",
    check: (output) => {
      if (output.includes("VAR_BACKUPS_EXISTS")) {
        return { passed: true, currentValue: "/var/backups exists" };
      }
      if (output.includes("VAR_BACKUPS_MISSING")) {
        return { passed: false, currentValue: "/var/backups is missing or empty" };
      }
      return { passed: false, currentValue: "/var/backups status could not be determined" };
    },
    expectedValue: "/var/backups exists and contains files",
    fixCommand: "mkdir -p /var/backups && dpkg --get-selections > /var/backups/packages.list",
    explain:
      "/var/backups is the standard system backup location on Debian/Ubuntu systems. Its presence with content indicates system configuration and package state are being preserved for recovery purposes.",
  },
];

export const parseBackupChecks: CheckParser = (
  sectionOutput: string,
  _platform: string,
): AuditCheck[] => {
  const isNA =
    !sectionOutput ||
    sectionOutput.trim() === "N/A" ||
    sectionOutput.trim() === "";
  const output = isNA ? "" : sectionOutput;

  return BACKUP_CHECKS.map((def) => {
    if (isNA) {
      return {
        id: def.id,
        category: "Backup Hygiene",
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
      category: "Backup Hygiene",
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
