/**
 * Incident Readiness security check parser.
 * Parses auditd installation/status, audit rules, log forwarding,
 * wtmp/btmp accessibility, and logrotate configuration into 8 security checks.
 */

import type {AuditCheck, CheckParser, Severity, FixTier} from "../types.js";
import { CHECK_IDS } from "../checkIds.js";

interface IncidentReadyCheckDef {
  id: string;
  name: string;
  severity: Severity;
  check: (output: string) => { passed: boolean; currentValue: string };
  expectedValue: string;
  fixCommand: string;
  safeToAutoFix?: FixTier;
  explain: string;
}

const INCIDENT_CHECKS: IncidentReadyCheckDef[] = [
  {
    id: CHECK_IDS.INCIDENTREADY.INCIDENT_AUDITD_INSTALLED,
    name: "auditd Package Installed",
    severity: "warning",
    check: (output) => {
      if (output.includes("AUDITD_INSTALLED")) {
        return { passed: true, currentValue: "auditd is installed" };
      }
      if (output.includes("AUDITD_NOT_INSTALLED")) {
        return { passed: false, currentValue: "auditd is not installed" };
      }
      return { passed: false, currentValue: "auditd installation status could not be determined" };
    },
    expectedValue: "auditd package is installed on the system",
    fixCommand: "apt-get install -y auditd || yum install -y audit",
    safeToAutoFix: "SAFE",
    explain:
      "auditd is the Linux Audit daemon that records security-relevant events such as file access, system calls, and authentication attempts. Without it, forensic investigation after an incident has no kernel-level audit trail.",
  },
  {
    id: CHECK_IDS.INCIDENTREADY.INCIDENT_AUDITD_RUNNING,
    name: "auditd Service Running",
    severity: "warning",
    check: (output) => {
      if (output.includes("AUDITD_RUNNING")) {
        return { passed: true, currentValue: "auditd service is active and running" };
      }
      if (output.includes("AUDITD_NOT_RUNNING")) {
        return { passed: false, currentValue: "auditd service is not running" };
      }
      return { passed: false, currentValue: "auditd service status could not be determined" };
    },
    expectedValue: "auditd service is active (running)",
    fixCommand: "systemctl enable --now auditd",
    safeToAutoFix: "GUARDED",
    explain:
      "Installing auditd without running it provides no protection. The auditd service must be active to collect audit events in real time, enabling detection of unauthorized access or configuration changes.",
  },
  {
    id: CHECK_IDS.INCIDENTREADY.INCIDENT_AUDITD_PASSWD_RULE,
    name: "Audit Rule for /etc/passwd",
    severity: "warning",
    check: (output) => {
      // AUDITCTL_UNAVAIL — auditctl not accessible, treat as false
      if (output.includes("AUDITCTL_UNAVAIL")) {
        return { passed: false, currentValue: "auditctl not available — cannot verify audit rules" };
      }
      // AUDITCTL_RULES:<rule-line> repeated for each rule
      const rulesMatch = output.match(/AUDITCTL_RULES:(.+)/gm);
      if (!rulesMatch) {
        return { passed: false, currentValue: "No audit rules found or auditctl not accessible" };
      }
      const rulesText = rulesMatch.map((r) => r.replace("AUDITCTL_RULES:", "")).join("\n");
      const hasPasswdRule = rulesText.includes("/etc/passwd");
      return {
        passed: hasPasswdRule,
        currentValue: hasPasswdRule
          ? "Audit rule for /etc/passwd exists"
          : "No audit rule for /etc/passwd found",
      };
    },
    expectedValue: "auditctl -l shows -w /etc/passwd rule",
    fixCommand: "auditctl -w /etc/passwd -p wa -k identity && echo '-w /etc/passwd -p wa -k identity' >> /etc/audit/rules.d/kastell.rules",
    safeToAutoFix: "SAFE",
    explain:
      "An audit rule watching /etc/passwd detects unauthorized user account modifications. Without this rule, an attacker can add backdoor accounts or modify existing ones without leaving any kernel-level audit evidence.",
  },
  {
    id: CHECK_IDS.INCIDENTREADY.INCIDENT_AUDITD_SUDO_RULE,
    name: "Audit Rule for sudo/sudoers",
    severity: "info",
    check: (output) => {
      if (output.includes("AUDITCTL_UNAVAIL")) {
        return { passed: false, currentValue: "auditctl not available — cannot verify audit rules" };
      }
      const rulesMatch = output.match(/AUDITCTL_RULES:(.+)/gm);
      if (!rulesMatch) {
        return { passed: false, currentValue: "No audit rules found or auditctl not accessible" };
      }
      const rulesText = rulesMatch.map((r) => r.replace("AUDITCTL_RULES:", "")).join("\n");
      const hasSudoRule =
        rulesText.includes("/etc/sudoers") ||
        rulesText.includes("/var/log/sudo.log") ||
        rulesText.includes("sudo");
      return {
        passed: hasSudoRule,
        currentValue: hasSudoRule
          ? "Audit rule for sudo/sudoers exists"
          : "No audit rule for sudo/sudoers found",
      };
    },
    expectedValue: "auditctl -l shows rule for /etc/sudoers or /var/log/sudo.log",
    fixCommand: "auditctl -w /etc/sudoers -p wa -k sudoers && echo '-w /etc/sudoers -p wa -k sudoers' >> /etc/audit/rules.d/kastell.rules",
    safeToAutoFix: "SAFE",
    explain:
      "Auditing sudoers configuration changes ensures any privilege escalation modifications are recorded. Combined with /etc/passwd monitoring, this forms a baseline identity and access audit trail.",
  },
  {
    id: CHECK_IDS.INCIDENTREADY.INCIDENT_LOG_FORWARDING,
    name: "Log Forwarding Service Active",
    severity: "info",
    check: (output) => {
      // LOG_FORWARDING_ACTIVE:<service>
      const match = output.match(/LOG_FORWARDING_ACTIVE:(\S+)/);
      if (match) {
        return { passed: true, currentValue: `Log forwarding active: ${match[1]}` };
      }
      if (output.includes("LOG_FORWARDING_INACTIVE")) {
        return { passed: false, currentValue: "No log forwarding service is active" };
      }
      return { passed: false, currentValue: "Log forwarding status could not be determined" };
    },
    expectedValue: "At least one of rsyslog, vector, fluent-bit, or promtail is active",
    fixCommand: "apt-get install -y rsyslog && systemctl enable --now rsyslog",
    safeToAutoFix: "GUARDED",
    explain:
      "Log forwarding to a remote SIEM or log aggregator ensures that audit logs survive a system compromise. An attacker with root access can delete local logs; remote forwarding preserves the evidence.",
  },
  {
    id: CHECK_IDS.INCIDENTREADY.INCIDENT_LAST_ACCESSIBLE,
    name: "Login History Accessible (last/wtmp)",
    severity: "info",
    check: (output) => {
      if (output.includes("LAST_AVAILABLE")) {
        return { passed: true, currentValue: "last command works — wtmp is accessible" };
      }
      if (output.includes("LAST_NOT_AVAILABLE")) {
        return { passed: false, currentValue: "last command failed — wtmp not accessible or corrupted" };
      }
      return { passed: false, currentValue: "wtmp accessibility could not be determined" };
    },
    expectedValue: "last command returns login history (wtmp is readable and intact)",
    fixCommand: "touch /var/log/wtmp && chmod 664 /var/log/wtmp && chown root:utmp /var/log/wtmp",
    safeToAutoFix: "SAFE",
    explain:
      "The wtmp file records all login and logout events. During incident response, last command output is the first step to understanding who has accessed the system and when. An inaccessible wtmp impedes forensics.",
  },
  {
    id: CHECK_IDS.INCIDENTREADY.INCIDENT_LASTB_ACCESSIBLE,
    name: "Failed Login History Accessible (lastb/btmp)",
    severity: "info",
    check: (output) => {
      if (output.includes("LASTB_AVAILABLE")) {
        return { passed: true, currentValue: "lastb output available — btmp is accessible" };
      }
      if (output.includes("LASTB_NOT_AVAILABLE")) {
        return { passed: false, currentValue: "lastb output not available — btmp missing or permission denied" };
      }
      return { passed: false, currentValue: "btmp accessibility could not be determined" };
    },
    expectedValue: "lastb command returns failed login history (btmp is readable)",
    fixCommand: "touch /var/log/btmp && chmod 600 /var/log/btmp && chown root:utmp /var/log/btmp",
    safeToAutoFix: "SAFE",
    explain:
      "The btmp file records failed login attempts, which is critical evidence of brute force or credential stuffing attacks. Without it, failed authentication attempts leave no persistent record on the system.",
  },
  {
    id: CHECK_IDS.INCIDENTREADY.INCIDENT_WTMP_ROTATION,
    name: "wtmp/btmp Log Rotation Configured",
    severity: "info",
    check: (output) => {
      if (output.includes("WTMP_ROTATION_CONFIGURED")) {
        return { passed: true, currentValue: "wtmp/btmp rotation is configured via logrotate" };
      }
      if (output.includes("WTMP_ROTATION_NOT_CONFIGURED")) {
        return { passed: false, currentValue: "wtmp/btmp rotation not configured in logrotate" };
      }
      return { passed: false, currentValue: "wtmp rotation configuration could not be determined" };
    },
    expectedValue: "logrotate configuration for wtmp and btmp exists",
    fixCommand: "# Ensure /etc/logrotate.d/wtmp exists with monthly rotation and compress",
    safeToAutoFix: "GUARDED",
    explain:
      "Log rotation for wtmp and btmp prevents unbounded growth that could fill the filesystem. Properly rotated and compressed logs also make historical login analysis feasible during incident investigation.",
  },
  {
    id: CHECK_IDS.INCIDENTREADY.INCID_WTMP_EXISTS,
    name: "wtmp Login Record File Exists",
    severity: "warning",
    check: (output) => {
      // ls -la /var/log/wtmp /var/log/btmp output
      const wtmpExists = /\/var\/log\/wtmp/.test(output) && !output.includes("N/A");
      return {
        passed: wtmpExists,
        currentValue: wtmpExists
          ? "/var/log/wtmp exists (login records available)"
          : "/var/log/wtmp not found",
      };
    },
    expectedValue: "/var/log/wtmp file exists",
    fixCommand: "touch /var/log/wtmp && chmod 664 /var/log/wtmp && chown root:utmp /var/log/wtmp",
    safeToAutoFix: "SAFE",
    explain:
      "wtmp records all login/logout events; its absence prevents forensic analysis of unauthorized access.",
  },
  {
    id: CHECK_IDS.INCIDENTREADY.INCID_BTMP_EXISTS,
    name: "btmp Failed Login Record File Exists",
    severity: "warning",
    check: (output) => {
      // ls -la /var/log/wtmp /var/log/btmp output
      const btmpExists = /\/var\/log\/btmp/.test(output) && !output.includes("N/A");
      return {
        passed: btmpExists,
        currentValue: btmpExists
          ? "/var/log/btmp exists (failed login records available)"
          : "/var/log/btmp not found",
      };
    },
    expectedValue: "/var/log/btmp file exists",
    fixCommand: "touch /var/log/btmp && chmod 600 /var/log/btmp && chown root:utmp /var/log/btmp",
    safeToAutoFix: "SAFE",
    explain:
      "btmp records failed login attempts; its absence prevents detection of brute-force attack patterns.",
  },
  {
    id: CHECK_IDS.INCIDENTREADY.INCID_FORENSIC_TOOLS,
    name: "Forensic Tools Pre-installed",
    severity: "info",
    check: (output) => {
      // which volatility3 volatility dc3dd output — each tool path on its own line or NONE
      const tools: string[] = [];
      if (/volatility/.test(output)) tools.push("volatility");
      if (/dc3dd/.test(output)) tools.push("dc3dd");
      const hasTool = tools.length > 0 && !output.includes("NONE");
      return {
        passed: hasTool,
        currentValue: hasTool ? `Forensic tools found: ${tools.join(", ")}` : "None installed",
      };
    },
    expectedValue: "At least one forensic tool (volatility3, dc3dd) is installed",
    fixCommand: "apt install -y sleuthkit # forensic imaging and analysis toolkit",
    safeToAutoFix: "SAFE",
    explain:
      "Having forensic tools pre-installed enables rapid incident response without contaminating the compromised system with new package installations.",
  },
  {
    id: CHECK_IDS.INCIDENTREADY.INCID_LOG_ARCHIVE_EXISTS,
    name: "Recent Archived Log Files Present",
    severity: "info",
    check: (output) => {
      // find /var/log -name '*.gz' -mtime -30 | wc -l — last standalone integer line
      const standaloneNumbers = output.split("\n").filter((l) => /^\s*\d+\s*$/.test(l));
      if (standaloneNumbers.length === 0) {
        return { passed: false, currentValue: "Unable to determine archived log count" };
      }
      // Use the last standalone number (wc -l is last command in incidentReadySection)
      const count = parseInt(standaloneNumbers[standaloneNumbers.length - 1].trim(), 10);
      return {
        passed: count > 0,
        currentValue: count > 0 ? `${count} recent archived log file(s) found` : "0 archived log files found",
      };
    },
    expectedValue: "At least 1 recently archived log file in /var/log",
    fixCommand: "logrotate -f /etc/logrotate.conf — verify log rotation is working",
    safeToAutoFix: "SAFE",
    explain:
      "Archived logs provide forensic evidence for incident investigation; absence indicates log rotation failure or evidence tampering.",
  },
];

export const parseIncidentReadyChecks: CheckParser = (
  sectionOutput: string,
  _platform: string,
): AuditCheck[] => {
  const isNA =
    !sectionOutput ||
    sectionOutput.trim() === "N/A" ||
    sectionOutput.trim() === "";
  const output = isNA ? "" : sectionOutput;

  return INCIDENT_CHECKS.map((def) => {
    if (isNA) {
      return {
        id: def.id,
        category: "Incident Readiness",
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
      category: "Incident Readiness",
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
