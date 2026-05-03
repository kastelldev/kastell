/**
 * Logging check parser.
 * Parses systemctl/log status output into 5 security checks with semantic IDs.
 */

import type { AuditCheck, CheckParser } from "../types.js";
import { CHECK_IDS } from "../checkIds.js";

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
    id: CHECK_IDS.LOGGING.LOG_SYSLOG_ACTIVE,
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
    safeToAutoFix: "GUARDED",
    explain: "System logging is essential for security monitoring and incident investigation.",
  };

  // LOG-02: Auth log exists
  const authLogExists = output.includes("EXISTS");
  const authLogMissing = output.includes("MISSING");
  const log02: AuditCheck = {
    id: CHECK_IDS.LOGGING.LOG_AUTH_LOG_PRESENT,
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
    safeToAutoFix: "GUARDED",
    explain: "Authentication logs record login attempts and are critical for detecting brute-force attacks.",
  };

  // LOG-03: Logrotate configured
  const hasLogrotate = output.includes("weekly") || output.includes("daily") ||
    output.includes("monthly") || output.includes("rotate");
  const log03: AuditCheck = {
    id: CHECK_IDS.LOGGING.LOG_ROTATION_CONFIGURED,
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
    safeToAutoFix: "SAFE",
    explain: "Log rotation prevents disk exhaustion from growing log files.",
  };

  // LOG-04: Remote logging (rsyslog remote config)
  // This is a nice-to-have, info severity
  const hasRemoteLogging = /@\S+:\d+/i.test(output) || /@@\S+:\d+/i.test(output);
  const log04: AuditCheck = {
    id: CHECK_IDS.LOGGING.LOG_REMOTE_LOGGING,
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
    safeToAutoFix: "GUARDED",
    explain: "Remote logging preserves evidence even if the server is compromised.",
  };

  // LOG-05: Auditd status
  const hasAuditd = /auditd.*active|active.*auditd/i.test(output);
  const log05: AuditCheck = {
    id: CHECK_IDS.LOGGING.LOG_AUDIT_DAEMON,
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
    safeToAutoFix: "GUARDED",
    explain: "The audit daemon provides detailed system call auditing for compliance and forensics.",
  };

  // NEW CHECKS: expanded logging hardening from loggingSection() new commands

  // LOG-AUDITD-ACTIVE: auditd service running
  // New loggingSection() adds: systemctl is-active auditd output
  const auditdActive = /^active$/m.test(output);
  const log06: AuditCheck = {
    id: CHECK_IDS.LOGGING.LOG_AUDITD_ACTIVE,
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
    safeToAutoFix: "GUARDED",
    explain: "The audit daemon must be running to capture system call and file access events for compliance.",
  };

  // LOG-AUDIT-LOGIN-RULES: auditctl has login event rules
  const hasLoginRules = /\/var\/log\/lastlog|-k logins|\/var\/run\/utmp/i.test(output);
  const log07: AuditCheck = {
    id: CHECK_IDS.LOGGING.LOG_AUDIT_LOGIN_RULES,
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
    safeToAutoFix: "SAFE",
    explain: "Auditing login events enables detection of unauthorized access and session manipulation.",
  };

  // LOG-AUDIT-SUDO-RULES: auditctl has privilege escalation rules
  const hasSudoRules = /\/etc\/sudoers|-k privilege|\/usr\/bin\/sudo/i.test(output);
  const log08: AuditCheck = {
    id: CHECK_IDS.LOGGING.LOG_AUDIT_SUDO_RULES,
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
    safeToAutoFix: "SAFE",
    explain: "Auditing sudo usage tracks privilege escalation attempts and detects sudoers tampering.",
  };

  // LOG-AUDIT-FILE-RULES: auditctl has file change monitoring
  const hasFileRules = /\/etc\/passwd|-k identity|\/etc\/shadow/i.test(output);
  const log09: AuditCheck = {
    id: CHECK_IDS.LOGGING.LOG_AUDIT_FILE_RULES,
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
    safeToAutoFix: "SAFE",
    explain: "Monitoring critical authentication files detects unauthorized modifications to user accounts.",
  };

  // LOG-VARLOG-PERMISSIONS: /var/log not world-readable
  // stat -c '%a' /var/log output: "750" or "755" etc.
  const varlogStatMatch = output.match(/^(\d{3,4})$/m);
  const varlogPerms = varlogStatMatch ? varlogStatMatch[1] : null;
  const varlogLastDigit = varlogPerms ? parseInt(varlogPerms[varlogPerms.length - 1], 10) : null;
  const varlogSecure = varlogLastDigit !== null && varlogLastDigit === 0;
  const log10: AuditCheck = {
    id: CHECK_IDS.LOGGING.LOG_VARLOG_PERMISSIONS,
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
    safeToAutoFix: "SAFE",
    explain: "Restricting /var/log access prevents unprivileged users from reading system and application logs.",
  };

  // LOG-CENTRAL-LOGGING: Centralized logging tool installed
  const hasCentralized = /vector|promtail|fluent-bit/i.test(output) && !output.includes("NONE");
  const log11: AuditCheck = {
    id: CHECK_IDS.LOGGING.LOG_CENTRAL_LOGGING,
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
    fixCommand: "apt install -y rsyslog  # or install promtail/fluent-bit per vendor instructions",
    safeToAutoFix: "SAFE",
    explain: "Centralized logging ensures log aggregation off the server, preserving evidence if the server is compromised.",
  };

  // LOG-SECURE-JOURNAL: journald persistent storage
  const hasPersistentJournal = /Storage\s*=\s*persistent/i.test(output);
  const log12: AuditCheck = {
    id: CHECK_IDS.LOGGING.LOG_SECURE_JOURNAL,
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
    safeToAutoFix: "GUARDED",
    explain: "Persistent journald storage retains logs across reboots, critical for post-incident forensics.",
  };

  // LOG-NO-WORLD-READABLE-LOGS: No excessive world-readable log files
  // find /var/log -maxdepth 1 -perm -o+r -type f | wc -l — a standalone number
  // This command appears BEFORE the watch rule count command in loggingSection(),
  // so we use the FIRST standalone small number (0-200) found in output.
  const worldReadableLogLines = output.split("\n");
  let worldReadableCount: number | null = null;
  for (const line of worldReadableLogLines) {
    const trimmed = line.trim();
    if (/^\d+$/.test(trimmed)) {
      const val = parseInt(trimmed, 10);
      if (val >= 0 && val < 200) {
        worldReadableCount = val;
        break;
      }
    }
  }
  const log13: AuditCheck = {
    id: CHECK_IDS.LOGGING.LOG_NO_WORLD_READABLE_LOGS,
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
    safeToAutoFix: "SAFE",
    explain:
      "World-readable log files may expose sensitive authentication attempts, IP addresses, and system information.",
  };

  // LOG-SYSLOG-REMOTE: Remote syslog forwarding configured
  const hasRemoteSyslog = /^\s*@@?\S/m.test(output);
  const log14: AuditCheck = {
    id: CHECK_IDS.LOGGING.LOG_SYSLOG_REMOTE,
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
    safeToAutoFix: "GUARDED",
    explain:
      "Remote syslog forwarding ensures logs survive even if the host is compromised or destroyed.",
  };

  // LOG-LOGROTATE-ACTIVE: logrotate timer or cron job active
  const hasLogrotateActive = /^active$/m.test(output) ||
    /\/etc\/cron\.daily\/logrotate/.test(output);
  const log15: AuditCheck = {
    id: CHECK_IDS.LOGGING.LOG_LOGROTATE_ACTIVE,
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
    safeToAutoFix: "SAFE",
    explain:
      "Without logrotate, log files grow unbounded causing disk exhaustion and potential denial of service.",
  };

  // LOG-AUDIT-WATCH-COUNT: auditctl watch rule count
  // auditctl -l | grep -c 'watch' — standalone number
  let watchRuleCount: number | null = null;
  for (const line of worldReadableLogLines) {
    const trimmed = line.trim();
    if (/^\d+$/.test(trimmed)) {
      const val = parseInt(trimmed, 10);
      // Watch rule count is typically 0-50
      if (val >= 0 && val < 500) {
        watchRuleCount = val;
      }
    }
  }
  const log16: AuditCheck = {
    id: CHECK_IDS.LOGGING.LOG_AUDIT_WATCH_COUNT,
    category: "Logging",
    name: "Audit File Watch Rules Configured",
    severity: "info",
    passed: isNA ? false : watchRuleCount !== null ? watchRuleCount >= 5 : false,
    currentValue: isNA
      ? "Unable to determine"
      : watchRuleCount !== null
        ? `${watchRuleCount} file watch audit rule(s) configured`
        : "Watch rule count not determinable",
    expectedValue: "At least 5 auditctl file watch rules configured",
    fixCommand: "auditctl -w /etc/passwd -p wa -k identity && auditctl -w /etc/shadow -p wa -k identity",
    safeToAutoFix: "SAFE",
    explain: "Audit file watches detect unauthorized modifications to critical system files, providing tamper evidence.",
  };

  // LOG-AUDITD-SPACE-ACTION: auditd space and file rotation actions
  // grep for space_left_action and max_log_file_action in auditd.conf
  const hasSpaceAction = /space_left_action\s*=\s*(email|exec|halt|syslog)/i.test(output);
  const hasFileAction = /max_log_file_action\s*=\s*(keep_logs|rotate)/i.test(output);
  const spaceIgnored = /space_left_action\s*=\s*ignore/i.test(output);
  const fileIgnored = /max_log_file_action\s*=\s*ignore/i.test(output);
  const log17: AuditCheck = {
    id: CHECK_IDS.LOGGING.LOG_AUDITD_SPACE_ACTION,
    category: "Logging",
    name: "Auditd Space and Rotation Actions Configured",
    severity: "warning",
    passed: isNA ? false : hasSpaceAction && hasFileAction,
    currentValue: isNA
      ? "Unable to determine"
      : hasSpaceAction && hasFileAction
        ? "auditd space_left_action and max_log_file_action are configured"
        : spaceIgnored || fileIgnored
          ? "auditd action(s) set to ignore — logs may be silently discarded"
          : "auditd space or file rotation actions not configured",
    expectedValue: "space_left_action and max_log_file_action set to non-ignore values",
    fixCommand: "sed -i 's/^space_left_action.*/space_left_action = syslog/' /etc/audit/auditd.conf",
    safeToAutoFix: "SAFE",
    explain: "Configuring auditd space and rotation actions ensures audit logs are not silently discarded when disk fills, preventing evidence destruction.",
  };

  // LOG-AUDIT-TIME-RULES: auditctl has time change event rules
  const hasTimeRules = /adjtimex|settimeofday|clock_settime|-k time-change/i.test(output);
  const log18: AuditCheck = {
    id: CHECK_IDS.LOGGING.LOG_AUDIT_TIME_RULES,
    category: "Logging",
    name: "Audit Time Change Rules",
    severity: "warning",
    passed: isNA ? false : hasTimeRules,
    currentValue: isNA
      ? "Unable to determine"
      : hasTimeRules
        ? "Time change audit rules configured"
        : "No time change audit rules found",
    expectedValue: "auditctl rules monitoring time change events (adjtimex, settimeofday)",
    fixCommand:
      "auditctl -a always,exit -F arch=b64 -S adjtimex -S settimeofday -S clock_settime -k time-change",
    safeToAutoFix: "SAFE",
    explain:
      "Auditing time changes detects tampering with system clocks that could be used to falsify log timestamps.",
  };

  // LOG-AUDIT-NETWORK-RULES: auditctl has network change event rules
  const hasNetworkRules = /sethostname|setdomainname|-k network-change/i.test(output);
  const log19: AuditCheck = {
    id: CHECK_IDS.LOGGING.LOG_AUDIT_NETWORK_RULES,
    category: "Logging",
    name: "Audit Network Change Rules",
    severity: "warning",
    passed: isNA ? false : hasNetworkRules,
    currentValue: isNA
      ? "Unable to determine"
      : hasNetworkRules
        ? "Network change audit rules configured"
        : "No network change audit rules found",
    expectedValue: "auditctl rules monitoring hostname and domain name changes",
    fixCommand:
      "auditctl -a always,exit -F arch=b64 -S sethostname -S setdomainname -k network-change",
    safeToAutoFix: "SAFE",
    explain:
      "Auditing network configuration changes detects unauthorized hostname or domain modifications that could indicate compromise.",
  };

  // LOG-AUDIT-MODULE-RULES: auditctl has kernel module event rules
  const hasModuleRules = /init_module|delete_module|finit_module|-k kernel-module/i.test(output);
  const log20: AuditCheck = {
    id: CHECK_IDS.LOGGING.LOG_AUDIT_MODULE_RULES,
    category: "Logging",
    name: "Audit Kernel Module Rules",
    severity: "warning",
    passed: isNA ? false : hasModuleRules,
    currentValue: isNA
      ? "Unable to determine"
      : hasModuleRules
        ? "Kernel module audit rules configured"
        : "No kernel module audit rules found",
    expectedValue: "auditctl rules monitoring kernel module loading and unloading",
    fixCommand:
      "auditctl -a always,exit -F arch=b64 -S init_module -S delete_module -S finit_module -k kernel-module",
    safeToAutoFix: "SAFE",
    explain:
      "Auditing kernel module events detects loading of potentially malicious kernel modules like rootkits.",
  };

  return [
    log01, log02, log03, log04, log05, log06, log07, log08, log09, log10,
    log11, log12, log13, log14, log15, log16, log17, log18, log19, log20,
  ];
};
