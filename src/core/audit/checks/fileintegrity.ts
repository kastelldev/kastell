/**
 * File Integrity security check parser.
 * Parses AIDE/Tripwire installation, AIDE database init, cron scheduling,
 * auditd installation/status, and audit rules into 8 security checks.
 */

import type {AuditCheck, CheckParser, Severity, FixTier} from "../types.js";
import { CHECK_IDS } from "../checkIds.js";

interface FileIntegrityCheckDef {
  id: string;
  name: string;
  severity: Severity;
  check: (output: string) => { passed: boolean; currentValue: string };
  expectedValue: string;
  fixCommand: string;
  safeToAutoFix?: FixTier;
  explain: string;
}

const FILEINTEGRITY_CHECKS: FileIntegrityCheckDef[] = [
  {
    id: CHECK_IDS.FILEINTEGRITY.FINT_AIDE_INSTALLED,
    name: "AIDE Installed",
    severity: "warning",
    check: (output) => {
      const installed = /^ii\s+aide\b/m.test(output);
      return {
        passed: installed,
        currentValue: installed ? "AIDE is installed" : "AIDE not installed",
      };
    },
    expectedValue: "AIDE (Advanced Intrusion Detection Environment) installed",
    fixCommand: "apt install aide -y && aideinit && mv /var/lib/aide/aide.db.new /var/lib/aide/aide.db",
    safeToAutoFix: "SAFE",
    explain: "AIDE monitors file integrity by comparing file hashes against a known-good baseline, detecting unauthorized changes to critical system files.",
  },
  {
    id: CHECK_IDS.FILEINTEGRITY.FINT_TRIPWIRE_INSTALLED,
    name: "Tripwire Installed",
    severity: "info",
    check: (output) => {
      const installed = /^ii\s+tripwire\b/m.test(output);
      return {
        passed: installed,
        currentValue: installed ? "Tripwire is installed" : "Tripwire not installed",
      };
    },
    expectedValue: "Tripwire installed (alternative file integrity monitor)",
    fixCommand: "apt install tripwire -y && tripwire --init",
    safeToAutoFix: "SAFE",
    explain: "Tripwire is an alternative file integrity monitoring tool. Either AIDE or Tripwire provides file integrity monitoring capability.",
  },
  {
    id: CHECK_IDS.FILEINTEGRITY.FINT_AIDE_DB_EXISTS,
    name: "AIDE Database Initialized",
    severity: "warning",
    check: (output) => {
      const exists = /AIDE_DB_EXISTS/.test(output);
      return {
        passed: exists,
        currentValue: exists ? "AIDE database exists and initialized" : "AIDE database not initialized",
      };
    },
    expectedValue: "AIDE database file exists at /var/lib/aide/aide.db or aide.db.gz",
    fixCommand: "aideinit && mv /var/lib/aide/aide.db.new /var/lib/aide/aide.db",
    safeToAutoFix: "SAFE",
    explain: "The AIDE database stores file integrity baselines. Without it, AIDE cannot detect unauthorized changes even if installed.",
  },
  {
    id: CHECK_IDS.FILEINTEGRITY.FINT_AIDE_CRON,
    name: "AIDE Scheduled Check",
    severity: "warning",
    check: (output) => {
      const noAideCron = /NO_AIDE_CRON/.test(output);
      const hasAideCron = !noAideCron && /aide/i.test(output);
      return {
        passed: hasAideCron,
        currentValue: hasAideCron ? "AIDE cron schedule found" : "No AIDE cron job configured",
      };
    },
    expectedValue: "Cron job for AIDE scheduled check exists",
    fixCommand: "echo '0 3 * * * root /usr/sbin/aide --check' > /etc/cron.d/aide && chmod 644 /etc/cron.d/aide",
    safeToAutoFix: "SAFE",
    explain: "AIDE must run on a schedule to continuously detect unauthorized changes. A missing cron job means integrity violations may go undetected.",
  },
  {
    id: CHECK_IDS.FILEINTEGRITY.FINT_AUDITD_INSTALLED,
    name: "auditd Installed",
    severity: "warning",
    check: (output) => {
      const installed = /^ii\s+auditd\b/m.test(output);
      return {
        passed: installed,
        currentValue: installed ? "auditd is installed" : "auditd not installed",
      };
    },
    expectedValue: "auditd (Linux Audit daemon) installed",
    fixCommand: "apt install auditd audispd-plugins -y && systemctl enable auditd && systemctl start auditd",
    safeToAutoFix: "SAFE",
    explain: "auditd provides comprehensive audit logging for system calls and file access, essential for detecting and investigating security incidents.",
  },
  {
    id: CHECK_IDS.FILEINTEGRITY.FINT_AUDITD_RUNNING,
    name: "auditd Running",
    severity: "warning",
    check: (output) => {
      const active = /\bactive\b/.test(output) && !/\binactive\b/.test(output);
      return {
        passed: active,
        currentValue: active ? "auditd is active" : "auditd is not running",
      };
    },
    expectedValue: "auditd service is active and running",
    fixCommand: "systemctl enable auditd && systemctl start auditd",
    safeToAutoFix: "SAFE",
    explain: "An installed but inactive auditd provides no security monitoring. auditd must be running to capture audit events.",
  },
  {
    id: CHECK_IDS.FILEINTEGRITY.FINT_AUDIT_PASSWD_RULE,
    name: "/etc/passwd Changes Audited",
    severity: "warning",
    check: (output) => {
      const hasRule = /\/etc\/passwd/.test(output) && !/NO_RULES/.test(output);
      return {
        passed: hasRule,
        currentValue: hasRule ? "Audit rule for /etc/passwd exists" : "No audit rule for /etc/passwd",
      };
    },
    expectedValue: "auditctl rule watching /etc/passwd for changes",
    fixCommand: "echo '-w /etc/passwd -p wa -k identity' >> /etc/audit/rules.d/kastell.rules && augenrules --load",
    safeToAutoFix: "SAFE",
    explain: "Auditing changes to /etc/passwd detects unauthorized account creation, modification, or deletion events.",
  },
  {
    id: CHECK_IDS.FILEINTEGRITY.FINT_AUDIT_SHADOW_RULE,
    name: "/etc/shadow Changes Audited",
    severity: "warning",
    check: (output) => {
      const hasRule = /\/etc\/shadow/.test(output) && !/NO_RULES/.test(output);
      return {
        passed: hasRule,
        currentValue: hasRule ? "Audit rule for /etc/shadow exists" : "No audit rule for /etc/shadow",
      };
    },
    expectedValue: "auditctl rule watching /etc/shadow for changes",
    fixCommand: "echo '-w /etc/shadow -p wa -k identity' >> /etc/audit/rules.d/kastell.rules && augenrules --load",
    safeToAutoFix: "SAFE",
    explain: "Auditing /etc/shadow detects unauthorized password changes or credential manipulation that could indicate a compromise.",
  },
  {
    id: CHECK_IDS.FILEINTEGRITY.FINT_AIDE_DB_RECENT,
    name: "AIDE Database Updated Within Last 30 Days",
    severity: "warning",
    check: (output) => {
      // stat -c '%Y' /var/lib/aide/aide.db returns epoch timestamp or N/A
      const epochMatch = output.match(/\b(\d{10})\b/);
      if (!epochMatch) {
        // AIDE not installed or DB missing — treat as pass (not a failure without AIDE)
        return { passed: true, currentValue: "AIDE not installed or database not present (not applicable)" };
      }
      const dbEpoch = parseInt(epochMatch[1], 10);
      const nowEpoch = Math.floor(Date.now() / 1000);
      const ageSeconds = nowEpoch - dbEpoch;
      const thirtyDaysSeconds = 30 * 24 * 3600;
      const isRecent = ageSeconds < thirtyDaysSeconds;
      const ageDays = Math.floor(ageSeconds / 86400);
      return {
        passed: isRecent,
        currentValue: isRecent
          ? `AIDE database updated ${ageDays} day(s) ago (within 30 days)`
          : `AIDE database is ${ageDays} day(s) old (stale — exceeds 30 days)`,
      };
    },
    expectedValue: "AIDE database updated within the last 30 days",
    fixCommand: "aide --update && mv /var/lib/aide/aide.db.new /var/lib/aide/aide.db",
    safeToAutoFix: "SAFE",
    explain: "A stale AIDE database fails to detect recent unauthorized file modifications.",
  },
  {
    id: CHECK_IDS.FILEINTEGRITY.FINT_CRITICAL_FILE_MONITORING,
    name: "Critical System Files Monitored by auditd",
    severity: "warning",
    check: (output) => {
      // auditctl -l output with /etc/passwd, /etc/shadow, /etc/sudoers rules
      const hasPasswd = /\/etc\/passwd/.test(output) && !/NO_RULES/.test(output);
      const hasShadow = /\/etc\/shadow/.test(output) && !/NO_RULES/.test(output);
      const hasSudoers = /\/etc\/sudoers/.test(output) && !/NO_RULES/.test(output);
      const passed = hasPasswd || hasShadow || hasSudoers;
      return {
        passed,
        currentValue: passed
          ? "At least one critical file (/etc/passwd, /etc/shadow, /etc/sudoers) has an audit rule"
          : "No audit rules for critical files (/etc/passwd, /etc/shadow, /etc/sudoers)",
      };
    },
    expectedValue: "auditctl rules exist for /etc/passwd, /etc/shadow, or /etc/sudoers",
    fixCommand: "auditctl -w /etc/passwd -p wa -k identity && auditctl -w /etc/shadow -p wa -k identity && auditctl -w /etc/sudoers -p wa -k sudoers",
    safeToAutoFix: "SAFE",
    explain: "Monitoring changes to /etc/passwd, /etc/shadow, and /etc/sudoers detects unauthorized privilege modifications.",
  },
];

export const parseFileIntegrityChecks: CheckParser = (
  sectionOutput: string,
  _platform: string,
): AuditCheck[] => {
  const isNA =
    !sectionOutput ||
    sectionOutput.trim() === "N/A" ||
    sectionOutput.trim() === "";
  const output = isNA ? "" : sectionOutput;

  return FILEINTEGRITY_CHECKS.map((def) => {
    if (isNA) {
      return {
        id: def.id,
        category: "File Integrity",
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
      category: "File Integrity",
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
