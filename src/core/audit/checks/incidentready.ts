/**
 * Incident Readiness security check parser.
 * Parses auditd installation/status, audit rules, log forwarding,
 * wtmp/btmp accessibility, and logrotate configuration into 8 security checks.
 */

import type { AuditCheck, CheckParser, Severity } from "../types.js";

interface IncidentReadyCheckDef {
  id: string;
  name: string;
  severity: Severity;
  check: (output: string) => { passed: boolean; currentValue: string };
  expectedValue: string;
  fixCommand: string;
  explain: string;
}

const INCIDENT_CHECKS: IncidentReadyCheckDef[] = [
  {
    id: "INCIDENT-AUDITD-INSTALLED",
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
    explain:
      "auditd is the Linux Audit daemon that records security-relevant events such as file access, system calls, and authentication attempts. Without it, forensic investigation after an incident has no kernel-level audit trail.",
  },
  {
    id: "INCIDENT-AUDITD-RUNNING",
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
    explain:
      "Installing auditd without running it provides no protection. The auditd service must be active to collect audit events in real time, enabling detection of unauthorized access or configuration changes.",
  },
  {
    id: "INCIDENT-AUDITD-PASSWD-RULE",
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
    explain:
      "An audit rule watching /etc/passwd detects unauthorized user account modifications. Without this rule, an attacker can add backdoor accounts or modify existing ones without leaving any kernel-level audit evidence.",
  },
  {
    id: "INCIDENT-AUDITD-SUDO-RULE",
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
    explain:
      "Auditing sudoers configuration changes ensures any privilege escalation modifications are recorded. Combined with /etc/passwd monitoring, this forms a baseline identity and access audit trail.",
  },
  {
    id: "INCIDENT-LOG-FORWARDING",
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
    explain:
      "Log forwarding to a remote SIEM or log aggregator ensures that audit logs survive a system compromise. An attacker with root access can delete local logs; remote forwarding preserves the evidence.",
  },
  {
    id: "INCIDENT-LAST-ACCESSIBLE",
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
    explain:
      "The wtmp file records all login and logout events. During incident response, last command output is the first step to understanding who has accessed the system and when. An inaccessible wtmp impedes forensics.",
  },
  {
    id: "INCIDENT-LASTB-ACCESSIBLE",
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
    explain:
      "The btmp file records failed login attempts, which is critical evidence of brute force or credential stuffing attacks. Without it, failed authentication attempts leave no persistent record on the system.",
  },
  {
    id: "INCIDENT-WTMP-ROTATION",
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
    explain:
      "Log rotation for wtmp and btmp prevents unbounded growth that could fill the filesystem. Properly rotated and compressed logs also make historical login analysis feasible during incident investigation.",
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
      explain: def.explain,
    };
  });
};
