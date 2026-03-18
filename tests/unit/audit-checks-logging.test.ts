import { parseLoggingChecks } from "../../src/core/audit/checks/logging.js";

describe("parseLoggingChecks", () => {
  // Secure output mirrors loggingSection() SSH command order.
  // auditctl -l | head -50 provides all rule data (time/network/module/watch).
  const secureOutput = [
    // rsyslog status
    "active",
    // journald status
    "active",
    // logrotate config
    "weekly\nrotate 4\ncreate\ncompress",
    // auth log
    "EXISTS",
    // auditctl rules (includes login, sudo, file rules, time-change, network-change, kernel-module)
    "-w /var/log/lastlog -p wa -k logins\n-w /etc/sudoers -p wa -k privilege\n-w /etc/passwd -p wa -k identity\n-w /etc/shadow -p wa -k identity\n-a always,exit -F arch=b64 -S adjtimex -S settimeofday -k time-change\n-a always,exit -F arch=b64 -S sethostname -S setdomainname -k network-change\n-a always,exit -F arch=b64 -S init_module -S delete_module -k kernel-module",
    // auditd service active
    "active",
    // /var/log permissions (750 = not world-readable)
    "750",
    // journald persistent storage
    "Storage=persistent",
    // centralized logging tool installed
    "/usr/bin/vector",
    // world-readable log file count (LOG-NO-WORLD-READABLE-LOGS) — a small number 0-4
    "1",
    // remote syslog forwarding (LOG-SYSLOG-REMOTE) — line must start with @@ to match regex
    "@@logserver.example.com:514",
    // logrotate cron job active (LOG-LOGROTATE-ACTIVE)
    "/etc/cron.daily/logrotate",
    // file watch rule count (LOG-AUDIT-WATCH-COUNT) — a standalone number >= 5
    "7",
    // auditd space/file action (LOG-AUDITD-SPACE-ACTION)
    "space_left_action = email",
    "max_log_file_action = keep_logs",
  ].join("\n");

  const insecureOutput = [
    // rsyslog not running
    "N/A",
    // journald not running
    "inactive",
    // logrotate
    "N/A",
    // auth log missing
    "MISSING",
    // no auditctl rules
    "NO_RULES",
    // auditd not running
    "inactive",
    // /var/log permissions (755 = world-readable)
    "755",
    // journald volatile
    "N/A",
    // no centralized logging
    "NONE",
  ].join("\n");

  it("should return 20 checks", () => {
    const checks = parseLoggingChecks(secureOutput, "bare");
    expect(checks).toHaveLength(20);
    checks.forEach((check) => {
      expect(check.category).toBe("Logging");
      expect(check.id).toMatch(/^LOG-[A-Z][A-Z0-9]*(-[A-Z][A-Z0-9]*)+$/);
    });
  });

  it("should return LOG-SYSLOG-ACTIVE passed when journald is active", () => {
    const checks = parseLoggingChecks(secureOutput, "bare");
    const log01 = checks.find((c: { id: string }) => c.id === "LOG-SYSLOG-ACTIVE");
    expect(log01!.passed).toBe(true);
  });

  it("should return LOG-SYSLOG-ACTIVE failed when neither syslog nor journald active", () => {
    const checks = parseLoggingChecks(insecureOutput, "bare");
    const log01 = checks.find((c: { id: string }) => c.id === "LOG-SYSLOG-ACTIVE");
    expect(log01!.passed).toBe(false);
  });

  it("should return LOG-AUTH-LOG-PRESENT passed when auth log exists", () => {
    const checks = parseLoggingChecks(secureOutput, "bare");
    const log02 = checks.find((c: { id: string }) => c.id === "LOG-AUTH-LOG-PRESENT");
    expect(log02!.passed).toBe(true);
  });

  it("should return LOG-AUTH-LOG-PRESENT failed when auth log missing", () => {
    const checks = parseLoggingChecks(insecureOutput, "bare");
    const log02 = checks.find((c: { id: string }) => c.id === "LOG-AUTH-LOG-PRESENT");
    expect(log02!.passed).toBe(false);
  });

  it("should return LOG-AUDIT-LOGIN-RULES passed when auditctl output contains /var/log/lastlog", () => {
    const checks = parseLoggingChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-LOGIN-RULES");
    expect(check!.passed).toBe(true);
  });

  it("should return LOG-AUDIT-LOGIN-RULES failed when no login audit rules", () => {
    const checks = parseLoggingChecks(insecureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-LOGIN-RULES");
    expect(check!.passed).toBe(false);
  });

  it("should return LOG-VARLOG-PERMISSIONS passed when /var/log is mode 750", () => {
    const checks = parseLoggingChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "LOG-VARLOG-PERMISSIONS");
    expect(check!.passed).toBe(true);
  });

  it("should return LOG-VARLOG-PERMISSIONS failed when /var/log is mode 755 (world-readable)", () => {
    const checks = parseLoggingChecks(insecureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "LOG-VARLOG-PERMISSIONS");
    expect(check!.passed).toBe(false);
  });

  it("should return LOG-CENTRAL-LOGGING passed when centralized logging tool installed", () => {
    const checks = parseLoggingChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "LOG-CENTRAL-LOGGING");
    expect(check!.passed).toBe(true);
  });

  it("should return LOG-CENTRAL-LOGGING failed when no centralized logging tool", () => {
    const checks = parseLoggingChecks(insecureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "LOG-CENTRAL-LOGGING");
    expect(check!.passed).toBe(false);
  });

  it("LOG-SYSLOG-REMOTE passes when @@ forwarding found", () => {
    const checks = parseLoggingChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "LOG-SYSLOG-REMOTE");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("LOG-LOGROTATE-ACTIVE passes when /etc/cron.daily/logrotate present", () => {
    const checks = parseLoggingChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "LOG-LOGROTATE-ACTIVE");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("LOG-NO-WORLD-READABLE-LOGS passes when count < 5", () => {
    const checks = parseLoggingChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "LOG-NO-WORLD-READABLE-LOGS");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("should handle N/A output gracefully", () => {
    const checks = parseLoggingChecks("N/A", "bare");
    expect(checks).toHaveLength(20);
  });

  it("LOG-AUDIT-WATCH-COUNT passes when file watch count >= 5", () => {
    const checks = parseLoggingChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-WATCH-COUNT");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.currentValue).toMatch(/7 file watch audit rule/);
  });

  it("LOG-AUDIT-WATCH-COUNT fails when file watch count < 5", () => {
    const output = secureOutput.replace("\n7\n", "\n2\n");
    const checks = parseLoggingChecks(output, "bare");
    const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-WATCH-COUNT");
    expect(check!.passed).toBe(false);
  });

  it("LOG-AUDITD-SPACE-ACTION passes when space_left_action=email and max_log_file_action=keep_logs", () => {
    const checks = parseLoggingChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "LOG-AUDITD-SPACE-ACTION");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("LOG-AUDITD-SPACE-ACTION fails when space_left_action=ignore", () => {
    const output = secureOutput.replace("space_left_action = email", "space_left_action = ignore");
    const checks = parseLoggingChecks(output, "bare");
    const check = checks.find((c: { id: string }) => c.id === "LOG-AUDITD-SPACE-ACTION");
    expect(check!.passed).toBe(false);
  });

  it("LOG-AUDIT-TIME-RULES passes when output contains -k time-change", () => {
    const checks = parseLoggingChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-TIME-RULES");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("LOG-AUDIT-TIME-RULES passes when output contains adjtimex", () => {
    const output = "adjtimex syscall monitoring active";
    const checks = parseLoggingChecks(output, "bare");
    const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-TIME-RULES");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("LOG-AUDIT-TIME-RULES fails when no time-change rules present", () => {
    const checks = parseLoggingChecks(insecureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-TIME-RULES");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("LOG-AUDIT-NETWORK-RULES passes when output contains -k network-change", () => {
    const checks = parseLoggingChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-NETWORK-RULES");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("LOG-AUDIT-NETWORK-RULES passes when output contains sethostname", () => {
    const output = "sethostname syscall monitoring active";
    const checks = parseLoggingChecks(output, "bare");
    const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-NETWORK-RULES");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("LOG-AUDIT-NETWORK-RULES fails when no network-change rules present", () => {
    const checks = parseLoggingChecks(insecureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-NETWORK-RULES");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("LOG-AUDIT-MODULE-RULES passes when output contains -k kernel-module", () => {
    const checks = parseLoggingChecks(secureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-MODULE-RULES");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("LOG-AUDIT-MODULE-RULES passes when output contains init_module", () => {
    const output = "init_module syscall monitoring active";
    const checks = parseLoggingChecks(output, "bare");
    const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-MODULE-RULES");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("LOG-AUDIT-MODULE-RULES fails when no kernel-module rules present", () => {
    const checks = parseLoggingChecks(insecureOutput, "bare");
    const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-MODULE-RULES");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });
});
