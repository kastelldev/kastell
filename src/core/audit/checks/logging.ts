/**
 * Logging check parser.
 * Parses systemctl/log status output into 5 security checks with semantic IDs.
 */

import type { AuditCheck, CheckParser } from "../types.js";

export const parseLoggingChecks: CheckParser = (sectionOutput: string, _platform: string): AuditCheck[] => {
  const isNA = !sectionOutput || sectionOutput.trim() === "N/A" || sectionOutput.trim() === "";
  const output = isNA ? "" : sectionOutput;

  // Output sections from commands.ts loggingSection():
  // - rsyslog status ("active" or "N/A")
  // - journald status ("active" or "inactive" or "N/A")
  // - logrotate config (first 10 lines)
  // - auth log exists ("EXISTS" or "MISSING")

  const lines = output.split("\n").map((l) => l.trim());

  // LOG-01: Syslog or journald running
  // First 2 lines from loggingSection: rsyslog status, journald status
  // "active" means running, "inactive" means stopped, "N/A" means not installed
  const rsyslogActive = lines[0] === "active";
  const journaldActive = lines[1] === "active";
  const anyLogActive = rsyslogActive || journaldActive;
  const log01: AuditCheck = {
    id: "LOG-SYSLOG-ACTIVE",
    category: "Logging",
    name: "System Logging Active",
    severity: "critical",
    passed: isNA ? false : anyLogActive,
    currentValue: isNA
      ? "Unable to determine"
      : anyLogActive
        ? "System logging active"
        : "No active logging service found",
    expectedValue: "rsyslog or journald active",
    fixCommand: "systemctl enable --now rsyslog || systemctl enable --now systemd-journald",
    explain: "System logging is essential for security monitoring and incident investigation.",
  };

  // LOG-02: Auth log exists
  const authLogExists = output.includes("EXISTS");
  const authLogMissing = output.includes("MISSING");
  const log02: AuditCheck = {
    id: "LOG-AUTH-LOG-PRESENT",
    category: "Logging",
    name: "Authentication Log Present",
    severity: "warning",
    passed: isNA ? false : authLogExists,
    currentValue: isNA
      ? "Unable to determine"
      : authLogExists
        ? "Auth log exists"
        : authLogMissing
          ? "Auth log missing"
          : "Unable to determine",
    expectedValue: "/var/log/auth.log or /var/log/secure exists",
    fixCommand: "systemctl restart rsyslog",
    explain: "Authentication logs record login attempts and are critical for detecting brute-force attacks.",
  };

  // LOG-03: Logrotate configured
  const hasLogrotate = output.includes("weekly") || output.includes("daily") ||
    output.includes("monthly") || output.includes("rotate");
  const log03: AuditCheck = {
    id: "LOG-ROTATION-CONFIGURED",
    category: "Logging",
    name: "Log Rotation Configured",
    severity: "info",
    passed: isNA ? false : hasLogrotate,
    currentValue: isNA
      ? "Unable to determine"
      : hasLogrotate
        ? "Log rotation configured"
        : "Log rotation not detected",
    expectedValue: "logrotate configured",
    fixCommand: "apt install -y logrotate && logrotate -d /etc/logrotate.conf",
    explain: "Log rotation prevents disk exhaustion from growing log files.",
  };

  // LOG-04: Remote logging (rsyslog remote config)
  // This is a nice-to-have, info severity
  const hasRemoteLogging = /@\S+:\d+/i.test(output) || /@@\S+:\d+/i.test(output);
  const log04: AuditCheck = {
    id: "LOG-REMOTE-LOGGING",
    category: "Logging",
    name: "Remote Logging",
    severity: "info",
    passed: isNA ? false : hasRemoteLogging,
    currentValue: isNA
      ? "Unable to determine"
      : hasRemoteLogging
        ? "Remote logging configured"
        : "No remote logging detected",
    expectedValue: "Remote log forwarding configured",
    fixCommand: "echo '*.* @@logserver:514' >> /etc/rsyslog.conf && systemctl restart rsyslog",
    explain: "Remote logging preserves evidence even if the server is compromised.",
  };

  // LOG-05: Auditd status
  const hasAuditd = /auditd.*active|active.*auditd/i.test(output);
  const log05: AuditCheck = {
    id: "LOG-AUDIT-DAEMON",
    category: "Logging",
    name: "Audit Daemon",
    severity: "info",
    passed: isNA ? false : hasAuditd,
    currentValue: isNA
      ? "Unable to determine"
      : hasAuditd
        ? "auditd active"
        : "auditd not detected",
    expectedValue: "auditd running for detailed system auditing",
    fixCommand: "apt install -y auditd && systemctl enable --now auditd",
    explain: "The audit daemon provides detailed system call auditing for compliance and forensics.",
  };

  return [log01, log02, log03, log04, log05];
};
