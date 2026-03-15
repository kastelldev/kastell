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

  // NEW CHECKS: expanded logging hardening from loggingSection() new commands

  // LOG-AUDITD-ACTIVE: auditd service running
  // New loggingSection() adds: systemctl is-active auditd output
  const auditdActive = /^active$/m.test(output);
  const log06: AuditCheck = {
    id: "LOG-AUDITD-ACTIVE",
    category: "Logging",
    name: "Auditd Service Active",
    severity: "warning",
    passed: isNA ? false : auditdActive,
    currentValue: isNA
      ? "Unable to determine"
      : auditdActive
        ? "auditd service active"
        : "auditd service not active",
    expectedValue: "auditd service running",
    fixCommand: "systemctl enable --now auditd",
    explain: "The audit daemon must be running to capture system call and file access events for compliance.",
  };

  // LOG-AUDIT-LOGIN-RULES: auditctl has login event rules
  const hasLoginRules = /\/var\/log\/lastlog|-k logins|\/var\/run\/utmp/i.test(output);
  const log07: AuditCheck = {
    id: "LOG-AUDIT-LOGIN-RULES",
    category: "Logging",
    name: "Audit Login Event Rules",
    severity: "warning",
    passed: isNA ? false : hasLoginRules,
    currentValue: isNA
      ? "Unable to determine"
      : hasLoginRules
        ? "Login event audit rules configured"
        : "No login event audit rules found",
    expectedValue: "auditctl rules monitoring login events",
    fixCommand: "auditctl -w /var/log/lastlog -p wa -k logins && auditctl -w /var/run/utmp -p wa -k session",
    explain: "Auditing login events enables detection of unauthorized access and session manipulation.",
  };

  // LOG-AUDIT-SUDO-RULES: auditctl has privilege escalation rules
  const hasSudoRules = /\/etc\/sudoers|-k privilege|\/usr\/bin\/sudo/i.test(output);
  const log08: AuditCheck = {
    id: "LOG-AUDIT-SUDO-RULES",
    category: "Logging",
    name: "Audit Privilege Escalation Rules",
    severity: "warning",
    passed: isNA ? false : hasSudoRules,
    currentValue: isNA
      ? "Unable to determine"
      : hasSudoRules
        ? "Sudo/privilege escalation audit rules configured"
        : "No sudo audit rules found",
    expectedValue: "auditctl rules monitoring sudoers and sudo binary",
    fixCommand: "auditctl -w /etc/sudoers -p wa -k privilege && auditctl -w /usr/bin/sudo -p x -k privilege",
    explain: "Auditing sudo usage tracks privilege escalation attempts and detects sudoers tampering.",
  };

  // LOG-AUDIT-FILE-RULES: auditctl has file change monitoring
  const hasFileRules = /\/etc\/passwd|-k identity|\/etc\/shadow/i.test(output);
  const log09: AuditCheck = {
    id: "LOG-AUDIT-FILE-RULES",
    category: "Logging",
    name: "Audit File Integrity Rules",
    severity: "warning",
    passed: isNA ? false : hasFileRules,
    currentValue: isNA
      ? "Unable to determine"
      : hasFileRules
        ? "File integrity audit rules configured"
        : "No file integrity audit rules found",
    expectedValue: "auditctl rules monitoring /etc/passwd and /etc/shadow",
    fixCommand: "auditctl -w /etc/passwd -p wa -k identity && auditctl -w /etc/shadow -p wa -k identity",
    explain: "Monitoring critical authentication files detects unauthorized modifications to user accounts.",
  };

  // LOG-VARLOG-PERMISSIONS: /var/log not world-readable
  // stat -c '%a' /var/log output: "750" or "755" etc.
  const varlogStatMatch = output.match(/^(\d{3,4})$/m);
  const varlogPerms = varlogStatMatch ? varlogStatMatch[1] : null;
  const varlogLastDigit = varlogPerms ? parseInt(varlogPerms[varlogPerms.length - 1], 10) : null;
  const varlogSecure = varlogLastDigit !== null && varlogLastDigit === 0;
  const log10: AuditCheck = {
    id: "LOG-VARLOG-PERMISSIONS",
    category: "Logging",
    name: "/var/log Not World-Readable",
    severity: "info",
    passed: isNA ? false : varlogSecure,
    currentValue: isNA
      ? "Unable to determine"
      : varlogPerms !== null
        ? `Mode: ${varlogPerms}`
        : "Unable to determine /var/log permissions",
    expectedValue: "/var/log mode 750 or 700 (last digit 0)",
    fixCommand: "chmod 750 /var/log",
    explain: "Restricting /var/log access prevents unprivileged users from reading system and application logs.",
  };

  // LOG-CENTRAL-LOGGING: Centralized logging tool installed
  const hasCentralized = /vector|promtail|fluent-bit/i.test(output) && !output.includes("NONE");
  const log11: AuditCheck = {
    id: "LOG-CENTRAL-LOGGING",
    category: "Logging",
    name: "Centralized Logging Tool",
    severity: "info",
    passed: isNA ? false : hasCentralized,
    currentValue: isNA
      ? "Unable to determine"
      : hasCentralized
        ? "Centralized logging tool installed"
        : "No centralized logging tool (vector, promtail, fluent-bit) detected",
    expectedValue: "vector, promtail, or fluent-bit installed",
    fixCommand: "apt install -y vector  # or install promtail/fluent-bit per vendor instructions",
    explain: "Centralized logging ensures log aggregation off the server, preserving evidence if the server is compromised.",
  };

  // LOG-SECURE-JOURNAL: journald persistent storage
  const hasPersistentJournal = /Storage\s*=\s*persistent/i.test(output);
  const log12: AuditCheck = {
    id: "LOG-SECURE-JOURNAL",
    category: "Logging",
    name: "Journald Persistent Storage",
    severity: "info",
    passed: isNA ? false : hasPersistentJournal,
    currentValue: isNA
      ? "Unable to determine"
      : hasPersistentJournal
        ? "journald persistent storage configured"
        : "journald persistent storage not configured",
    expectedValue: "Storage=persistent in /etc/systemd/journald.conf",
    fixCommand: "sed -i 's/#\\?Storage=.*/Storage=persistent/' /etc/systemd/journald.conf && systemctl restart systemd-journald",
    explain: "Persistent journald storage retains logs across reboots, critical for post-incident forensics.",
  };

  // LOG-NO-WORLD-READABLE-LOGS: No excessive world-readable log files
  // find /var/log -maxdepth 1 -perm -o+r -type f | wc -l — a standalone number
  const worldReadableLogLines = output.split("\n");
  let worldReadableCount: number | null = null;
  for (const line of worldReadableLogLines) {
    const trimmed = line.trim();
    // Look for a standalone number that could be the count (0-200)
    if (/^\d+$/.test(trimmed)) {
      const val = parseInt(trimmed, 10);
      if (val >= 0 && val < 200) {
        // Skip if it's "0" from inactive (ambiguous) — use the last occurrence
        worldReadableCount = val;
      }
    }
  }
  const log13: AuditCheck = {
    id: "LOG-NO-WORLD-READABLE-LOGS",
    category: "Logging",
    name: "No Excessive World-Readable Logs",
    severity: "info",
    passed: isNA ? false : worldReadableCount === null ? true : worldReadableCount < 5,
    currentValue: isNA
      ? "Unable to determine"
      : worldReadableCount !== null
        ? `${worldReadableCount} world-readable log files in /var/log`
        : "World-readable log count not determinable",
    expectedValue: "Fewer than 5 world-readable log files in /var/log",
    fixCommand: "find /var/log -maxdepth 1 -perm -o+r -type f -exec chmod o-r {} \\;",
    explain:
      "World-readable log files may expose sensitive authentication attempts, IP addresses, and system information.",
  };

  // LOG-SYSLOG-REMOTE: Remote syslog forwarding configured
  const hasRemoteSyslog = /^\s*@@?\S/m.test(output);
  const log14: AuditCheck = {
    id: "LOG-SYSLOG-REMOTE",
    category: "Logging",
    name: "Remote Syslog Forwarding Configured",
    severity: "info",
    passed: isNA ? false : hasRemoteSyslog,
    currentValue: isNA
      ? "Unable to determine"
      : hasRemoteSyslog
        ? "Remote syslog forwarding configured"
        : "No remote syslog forwarding found",
    expectedValue: "At least one @host or @@host forwarding line in rsyslog config",
    fixCommand: "echo '*.* @@logserver:514' >> /etc/rsyslog.conf && systemctl restart rsyslog",
    explain:
      "Remote syslog forwarding ensures logs survive even if the host is compromised or destroyed.",
  };

  // LOG-LOGROTATE-ACTIVE: logrotate timer or cron job active
  const hasLogrotateActive = /^active$/m.test(output) ||
    /\/etc\/cron\.daily\/logrotate/.test(output);
  const log15: AuditCheck = {
    id: "LOG-LOGROTATE-ACTIVE",
    category: "Logging",
    name: "Logrotate Active",
    severity: "warning",
    passed: isNA ? false : hasLogrotateActive,
    currentValue: isNA
      ? "Unable to determine"
      : hasLogrotateActive
        ? "logrotate timer or cron job active"
        : "logrotate not active",
    expectedValue: "logrotate.timer active or /etc/cron.daily/logrotate exists",
    fixCommand: "apt install -y logrotate && systemctl enable logrotate.timer",
    explain:
      "Without logrotate, log files grow unbounded causing disk exhaustion and potential denial of service.",
  };

  return [log01, log02, log03, log04, log05, log06, log07, log08, log09, log10, log11, log12, log13, log14, log15];
};
