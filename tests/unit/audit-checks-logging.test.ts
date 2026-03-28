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

  describe("mutation-killer tests", () => {
    // --- LOG-SYSLOG-ACTIVE: ConditionalExpression / LogicalOperator ---
    it("[LOG-SYSLOG-ACTIVE] passes when only rsyslog is active (not journald)", () => {
      const output = "active\ninactive\nweekly\nEXISTS";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-SYSLOG-ACTIVE");
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toBe("System logging active");
    });

    it("[LOG-SYSLOG-ACTIVE] passes when only journald is active (not rsyslog)", () => {
      const output = "inactive\nactive\nweekly\nEXISTS";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-SYSLOG-ACTIVE");
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toBe("System logging active");
    });

    it("[LOG-SYSLOG-ACTIVE] fails when both are inactive", () => {
      const output = "inactive\ninactive\nweekly\nEXISTS";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-SYSLOG-ACTIVE");
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("No active logging service found");
    });

    it("[LOG-SYSLOG-ACTIVE] rsyslogActive requires exact 'active' on line[0]", () => {
      const output = "active (running)\nactive\nweekly";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-SYSLOG-ACTIVE");
      // line[0] is "active (running)" which !== "active", but line[1] is "active"
      expect(check!.passed).toBe(true); // journald passes
    });

    it("[LOG-SYSLOG-ACTIVE] isNA forces false", () => {
      const output = "";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-SYSLOG-ACTIVE");
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("Unable to determine");
    });

    // --- LOG-AUTH-LOG-PRESENT: includes("EXISTS") vs includes("MISSING") ---
    it("[LOG-AUTH-LOG-PRESENT] currentValue shows 'Auth log missing' when MISSING present", () => {
      const output = "inactive\ninactive\nN/A\nMISSING";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUTH-LOG-PRESENT");
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("Auth log missing");
    });

    it("[LOG-AUTH-LOG-PRESENT] currentValue shows 'Unable to determine' when neither EXISTS nor MISSING", () => {
      const output = "inactive\ninactive\nN/A\nUNKNOWN";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUTH-LOG-PRESENT");
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("Unable to determine");
    });

    it("[LOG-AUTH-LOG-PRESENT] currentValue shows 'Auth log exists' on pass", () => {
      const output = "inactive\ninactive\nN/A\nEXISTS";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUTH-LOG-PRESENT");
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toBe("Auth log exists");
    });

    // --- LOG-ROTATION-CONFIGURED: multiple keyword branches ---
    it("[LOG-ROTATION-CONFIGURED] passes with 'daily' keyword", () => {
      const output = "inactive\ninactive\ndaily";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-ROTATION-CONFIGURED");
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toBe("Log rotation configured");
    });

    it("[LOG-ROTATION-CONFIGURED] passes with 'monthly' keyword", () => {
      const output = "inactive\ninactive\nmonthly";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-ROTATION-CONFIGURED");
      expect(check!.passed).toBe(true);
    });

    it("[LOG-ROTATION-CONFIGURED] passes with 'rotate' keyword alone", () => {
      const output = "inactive\ninactive\nrotate 7";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-ROTATION-CONFIGURED");
      expect(check!.passed).toBe(true);
    });

    it("[LOG-ROTATION-CONFIGURED] fails when none of the keywords present", () => {
      const output = "inactive\ninactive\nsomething else";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-ROTATION-CONFIGURED");
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("Log rotation not detected");
    });

    // --- LOG-REMOTE-LOGGING: regex /@\S+:\d+/ and /@@\S+:\d+/ ---
    it("[LOG-REMOTE-LOGGING] passes with single @ remote config", () => {
      const output = "inactive\ninactive\n@loghost:514";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-REMOTE-LOGGING");
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toBe("Remote logging configured");
    });

    it("[LOG-REMOTE-LOGGING] passes with @@ remote config", () => {
      const output = "inactive\ninactive\n@@loghost:514";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-REMOTE-LOGGING");
      expect(check!.passed).toBe(true);
    });

    it("[LOG-REMOTE-LOGGING] fails when no remote logging pattern", () => {
      const output = "inactive\ninactive\nno remote here";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-REMOTE-LOGGING");
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("No remote logging detected");
    });

    // --- LOG-AUDIT-DAEMON: regex /auditd.*active|active.*auditd/i ---
    it("[LOG-AUDIT-DAEMON] passes with 'auditd is active'", () => {
      const output = "auditd is active";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-DAEMON");
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toBe("auditd active");
    });

    it("[LOG-AUDIT-DAEMON] passes with 'active auditd'", () => {
      const output = "active auditd running";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-DAEMON");
      expect(check!.passed).toBe(true);
    });

    it("[LOG-AUDIT-DAEMON] fails when auditd not mentioned", () => {
      const output = "nothing here";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-DAEMON");
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("auditd not detected");
    });

    // --- LOG-AUDITD-ACTIVE: /^active$/m ---
    it("[LOG-AUDITD-ACTIVE] passes when 'active' appears on its own line", () => {
      const output = "some data\nactive\nmore data";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDITD-ACTIVE");
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toBe("auditd service active");
    });

    it("[LOG-AUDITD-ACTIVE] fails when 'active' is not on its own line", () => {
      const output = "auditd is active running\nnothing standalone";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDITD-ACTIVE");
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("auditd service not active");
    });

    // --- LOG-AUDIT-LOGIN-RULES: regex /\/var\/log\/lastlog|-k logins|\/var\/run\/utmp/i ---
    it("[LOG-AUDIT-LOGIN-RULES] passes with -k logins keyword", () => {
      const output = "-w /some/path -p wa -k logins";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-LOGIN-RULES");
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toBe("Login event audit rules configured");
    });

    it("[LOG-AUDIT-LOGIN-RULES] passes with /var/run/utmp path", () => {
      const output = "-w /var/run/utmp -p wa -k session";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-LOGIN-RULES");
      expect(check!.passed).toBe(true);
    });

    it("[LOG-AUDIT-LOGIN-RULES] fails when no login-related patterns", () => {
      const output = "some random audit rules";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-LOGIN-RULES");
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("No login event audit rules found");
    });

    // --- LOG-AUDIT-SUDO-RULES: regex /\/etc\/sudoers|-k privilege|\/usr\/bin\/sudo/i ---
    it("[LOG-AUDIT-SUDO-RULES] passes with /etc/sudoers", () => {
      const output = "-w /etc/sudoers -p wa -k privilege";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-SUDO-RULES");
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toBe("Sudo/privilege escalation audit rules configured");
    });

    it("[LOG-AUDIT-SUDO-RULES] passes with /usr/bin/sudo", () => {
      const output = "-w /usr/bin/sudo -p x -k priv";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-SUDO-RULES");
      expect(check!.passed).toBe(true);
    });

    it("[LOG-AUDIT-SUDO-RULES] passes with -k privilege alone", () => {
      const output = "-a always,exit -k privilege";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-SUDO-RULES");
      expect(check!.passed).toBe(true);
    });

    it("[LOG-AUDIT-SUDO-RULES] fails when no sudo-related patterns", () => {
      const output = "random stuff here";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-SUDO-RULES");
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("No sudo audit rules found");
    });

    // --- LOG-AUDIT-FILE-RULES: regex /\/etc\/passwd|-k identity|\/etc\/shadow/i ---
    it("[LOG-AUDIT-FILE-RULES] passes with /etc/passwd", () => {
      const output = "-w /etc/passwd -p wa -k identity";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-FILE-RULES");
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toBe("File integrity audit rules configured");
    });

    it("[LOG-AUDIT-FILE-RULES] passes with /etc/shadow alone", () => {
      const output = "-w /etc/shadow -p wa";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-FILE-RULES");
      expect(check!.passed).toBe(true);
    });

    it("[LOG-AUDIT-FILE-RULES] passes with -k identity alone", () => {
      const output = "-w /some/file -k identity";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-FILE-RULES");
      expect(check!.passed).toBe(true);
    });

    it("[LOG-AUDIT-FILE-RULES] fails when no file integrity patterns", () => {
      const output = "nothing relevant";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-FILE-RULES");
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("No file integrity audit rules found");
    });

    // --- LOG-VARLOG-PERMISSIONS: last digit check ---
    it("[LOG-VARLOG-PERMISSIONS] passes with mode 700 (last digit 0)", () => {
      const output = "inactive\ninactive\n700";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-VARLOG-PERMISSIONS");
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toBe("Mode: 700");
    });

    it("[LOG-VARLOG-PERMISSIONS] fails with mode 751 (last digit 1)", () => {
      const output = "inactive\ninactive\n751";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-VARLOG-PERMISSIONS");
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("Mode: 751");
    });

    it("[LOG-VARLOG-PERMISSIONS] handles 4-digit mode (1750)", () => {
      const output = "inactive\ninactive\n1750";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-VARLOG-PERMISSIONS");
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toBe("Mode: 1750");
    });

    it("[LOG-VARLOG-PERMISSIONS] fails when no permission line found", () => {
      const output = "inactive\ninactive\nno perms";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-VARLOG-PERMISSIONS");
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("Unable to determine /var/log permissions");
    });

    // --- LOG-CENTRAL-LOGGING: regex + !NONE ---
    it("[LOG-CENTRAL-LOGGING] passes with promtail", () => {
      const output = "promtail installed";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-CENTRAL-LOGGING");
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toBe("Centralized logging tool installed");
    });

    it("[LOG-CENTRAL-LOGGING] passes with fluent-bit", () => {
      const output = "fluent-bit running";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-CENTRAL-LOGGING");
      expect(check!.passed).toBe(true);
    });

    it("[LOG-CENTRAL-LOGGING] fails when match exists but NONE also present", () => {
      const output = "vector\nNONE";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-CENTRAL-LOGGING");
      expect(check!.passed).toBe(false);
    });

    it("[LOG-CENTRAL-LOGGING] currentValue lists tools when not detected", () => {
      const output = "nothing here";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-CENTRAL-LOGGING");
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toMatch(/No centralized logging tool/);
    });

    // --- LOG-SECURE-JOURNAL: /Storage\s*=\s*persistent/i ---
    it("[LOG-SECURE-JOURNAL] passes with Storage = persistent (spaces)", () => {
      const output = "Storage = persistent";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-SECURE-JOURNAL");
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toBe("journald persistent storage configured");
    });

    it("[LOG-SECURE-JOURNAL] passes with Storage=persistent (no spaces)", () => {
      const output = "Storage=persistent";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-SECURE-JOURNAL");
      expect(check!.passed).toBe(true);
    });

    it("[LOG-SECURE-JOURNAL] fails with Storage=volatile", () => {
      const output = "Storage=volatile";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-SECURE-JOURNAL");
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("journald persistent storage not configured");
    });

    // --- LOG-NO-WORLD-READABLE-LOGS: boundary testing ---
    it("[LOG-NO-WORLD-READABLE-LOGS] passes when count is exactly 4", () => {
      const output = "inactive\ninactive\n4";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-NO-WORLD-READABLE-LOGS");
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toMatch(/4 world-readable/);
    });

    it("[LOG-NO-WORLD-READABLE-LOGS] fails when count is exactly 5", () => {
      const output = "inactive\ninactive\n5";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-NO-WORLD-READABLE-LOGS");
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toMatch(/5 world-readable/);
    });

    it("[LOG-NO-WORLD-READABLE-LOGS] passes when count is 0", () => {
      const output = "inactive\ninactive\n0";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-NO-WORLD-READABLE-LOGS");
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toMatch(/0 world-readable/);
    });

    it("[LOG-NO-WORLD-READABLE-LOGS] passes when no standalone number (null)", () => {
      const output = "inactive\ninactive\nno numbers here";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-NO-WORLD-READABLE-LOGS");
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toBe("World-readable log count not determinable");
    });

    it("[LOG-NO-WORLD-READABLE-LOGS] ignores standalone numbers >= 200", () => {
      const output = "inactive\ninactive\n250\nno valid count";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-NO-WORLD-READABLE-LOGS");
      // 250 >= 200 so it's skipped, worldReadableCount = null
      expect(check!.passed).toBe(true);
    });

    // --- LOG-SYSLOG-REMOTE: /^\s*@@?\S/m ---
    it("[LOG-SYSLOG-REMOTE] passes with single @ forwarding", () => {
      const output = "@logserver:514";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-SYSLOG-REMOTE");
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toBe("Remote syslog forwarding configured");
    });

    it("[LOG-SYSLOG-REMOTE] passes with leading spaces before @", () => {
      const output = "  @@logserver:514";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-SYSLOG-REMOTE");
      expect(check!.passed).toBe(true);
    });

    it("[LOG-SYSLOG-REMOTE] fails when no @ line", () => {
      const output = "nothing remote here";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-SYSLOG-REMOTE");
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("No remote syslog forwarding found");
    });

    // --- LOG-LOGROTATE-ACTIVE: /^active$/m || /\/etc\/cron\.daily\/logrotate/ ---
    it("[LOG-LOGROTATE-ACTIVE] passes with standalone 'active' line (not just substring)", () => {
      const output = "something\nactive\nmore";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-LOGROTATE-ACTIVE");
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toBe("logrotate timer or cron job active");
    });

    it("[LOG-LOGROTATE-ACTIVE] fails when only 'activating' (not exact match)", () => {
      const output = "activating\nno cron";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-LOGROTATE-ACTIVE");
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("logrotate not active");
    });

    // --- LOG-AUDIT-WATCH-COUNT: boundary at 5 ---
    it("[LOG-AUDIT-WATCH-COUNT] passes when exactly 5", () => {
      const output = "inactive\ninactive\n5";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-WATCH-COUNT");
      expect(check!.passed).toBe(true);
    });

    it("[LOG-AUDIT-WATCH-COUNT] fails when exactly 4", () => {
      const output = "inactive\ninactive\n4";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-WATCH-COUNT");
      expect(check!.passed).toBe(false);
    });

    it("[LOG-AUDIT-WATCH-COUNT] fails when count is 0", () => {
      const output = "inactive\ninactive\n0";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-WATCH-COUNT");
      expect(check!.passed).toBe(false);
    });

    it("[LOG-AUDIT-WATCH-COUNT] uses last standalone number as watch count", () => {
      // First small number is world-readable count, last is watch count
      const output = "inactive\ninactive\n3\n10";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-WATCH-COUNT");
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toMatch(/10 file watch/);
    });

    it("[LOG-AUDIT-WATCH-COUNT] fails when no standalone number present", () => {
      const output = "inactive\ninactive\nno numbers";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-WATCH-COUNT");
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("Watch rule count not determinable");
    });

    // --- LOG-AUDITD-SPACE-ACTION: hasSpaceAction && hasFileAction + ignore branches ---
    it("[LOG-AUDITD-SPACE-ACTION] fails when only space_left_action set (no file action)", () => {
      const output = "space_left_action = syslog";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDITD-SPACE-ACTION");
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("auditd space or file rotation actions not configured");
    });

    it("[LOG-AUDITD-SPACE-ACTION] fails when only max_log_file_action set (no space action)", () => {
      const output = "max_log_file_action = rotate";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDITD-SPACE-ACTION");
      expect(check!.passed).toBe(false);
    });

    it("[LOG-AUDITD-SPACE-ACTION] passes with space_left_action=halt and max_log_file_action=rotate", () => {
      const output = "space_left_action = halt\nmax_log_file_action = rotate";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDITD-SPACE-ACTION");
      expect(check!.passed).toBe(true);
    });

    it("[LOG-AUDITD-SPACE-ACTION] passes with space_left_action=exec", () => {
      const output = "space_left_action = exec\nmax_log_file_action = keep_logs";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDITD-SPACE-ACTION");
      expect(check!.passed).toBe(true);
    });

    it("[LOG-AUDITD-SPACE-ACTION] currentValue mentions 'ignore' when max_log_file_action=ignore", () => {
      const output = "space_left_action = syslog\nmax_log_file_action = ignore";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDITD-SPACE-ACTION");
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toMatch(/silently discarded/);
    });

    it("[LOG-AUDITD-SPACE-ACTION] currentValue mentions 'ignore' when space_left_action=ignore", () => {
      const output = "space_left_action = ignore\nmax_log_file_action = keep_logs";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDITD-SPACE-ACTION");
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toMatch(/silently discarded/);
    });

    // --- LOG-AUDIT-TIME-RULES: multiple regex alternates ---
    it("[LOG-AUDIT-TIME-RULES] passes with settimeofday", () => {
      const output = "-S settimeofday -k time";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-TIME-RULES");
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toBe("Time change audit rules configured");
    });

    it("[LOG-AUDIT-TIME-RULES] passes with clock_settime", () => {
      const output = "-S clock_settime -k time-change";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-TIME-RULES");
      expect(check!.passed).toBe(true);
    });

    it("[LOG-AUDIT-TIME-RULES] fails with unrelated content", () => {
      const output = "some random audit output";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-TIME-RULES");
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("No time change audit rules found");
    });

    // --- LOG-AUDIT-NETWORK-RULES: multiple regex alternates ---
    it("[LOG-AUDIT-NETWORK-RULES] passes with setdomainname", () => {
      const output = "-S setdomainname -k network";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-NETWORK-RULES");
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toBe("Network change audit rules configured");
    });

    it("[LOG-AUDIT-NETWORK-RULES] passes with -k network-change alone", () => {
      const output = "-a exit -k network-change";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-NETWORK-RULES");
      expect(check!.passed).toBe(true);
    });

    it("[LOG-AUDIT-NETWORK-RULES] fails when no network patterns", () => {
      const output = "unrelated content";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-NETWORK-RULES");
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("No network change audit rules found");
    });

    // --- LOG-AUDIT-MODULE-RULES: multiple regex alternates ---
    it("[LOG-AUDIT-MODULE-RULES] passes with delete_module", () => {
      const output = "-S delete_module -k modules";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-MODULE-RULES");
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toBe("Kernel module audit rules configured");
    });

    it("[LOG-AUDIT-MODULE-RULES] passes with finit_module", () => {
      const output = "-S finit_module -k modules";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-MODULE-RULES");
      expect(check!.passed).toBe(true);
    });

    it("[LOG-AUDIT-MODULE-RULES] passes with -k kernel-module alone", () => {
      const output = "-a exit -k kernel-module";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-MODULE-RULES");
      expect(check!.passed).toBe(true);
    });

    it("[LOG-AUDIT-MODULE-RULES] fails with unrelated content", () => {
      const output = "random text no modules";
      const checks = parseLoggingChecks(output, "bare");
      const check = checks.find((c: { id: string }) => c.id === "LOG-AUDIT-MODULE-RULES");
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("No kernel module audit rules found");
    });

    // --- N/A edge cases for all checks ---
    it("[ALL] all checks return false and 'Unable to determine' for empty string", () => {
      const checks = parseLoggingChecks("", "bare");
      expect(checks).toHaveLength(20);
      checks.forEach((c) => {
        expect(c.passed).toBe(false);
        expect(c.currentValue).toBe("Unable to determine");
      });
    });

    it("[ALL] all checks return false for whitespace-only input", () => {
      const checks = parseLoggingChecks("   \n  \n  ", "bare");
      expect(checks).toHaveLength(20);
      checks.forEach((c) => {
        expect(c.passed).toBe(false);
      });
    });
  });

  describe("[MUTATION-KILLER] Logging check metadata completeness", () => {
    const checks = parseLoggingChecks(secureOutput, "bare");

    const expectedMeta: Array<[string, string, string]> = [
      ["LOG-SYSLOG-ACTIVE", "critical", "GUARDED"],
      ["LOG-AUTH-LOG-PRESENT", "warning", "GUARDED"],
      ["LOG-ROTATION-CONFIGURED", "info", "SAFE"],
      ["LOG-REMOTE-LOGGING", "info", "GUARDED"],
      ["LOG-AUDIT-DAEMON", "info", "GUARDED"],
      ["LOG-AUDITD-ACTIVE", "warning", "GUARDED"],
      ["LOG-AUDIT-LOGIN-RULES", "warning", "SAFE"],
      ["LOG-AUDIT-SUDO-RULES", "warning", "SAFE"],
      ["LOG-AUDIT-FILE-RULES", "warning", "SAFE"],
      ["LOG-VARLOG-PERMISSIONS", "info", "SAFE"],
      ["LOG-CENTRAL-LOGGING", "info", "SAFE"],
      ["LOG-SECURE-JOURNAL", "info", "GUARDED"],
      ["LOG-NO-WORLD-READABLE-LOGS", "info", "SAFE"],
      ["LOG-SYSLOG-REMOTE", "info", "GUARDED"],
      ["LOG-LOGROTATE-ACTIVE", "warning", "SAFE"],
    ];

    it.each(expectedMeta)("[MUTATION-KILLER] %s has severity=%s, safeToAutoFix=%s", (id, severity, safe) => {
      const c = checks.find((c) => c.id === id);
      expect(c).toBeDefined();
      expect(c!.category).toBe("Logging");
      expect(c!.severity).toBe(severity);
      expect(c!.safeToAutoFix).toBe(safe);
    });

    it("[MUTATION-KILLER] every check has non-empty fixCommand and explain", () => {
      checks.forEach((c) => {
        expect(c.fixCommand).toBeDefined();
        expect(c.fixCommand!.length).toBeGreaterThan(0);
        expect(c.explain).toBeDefined();
        expect(c.explain!.length).toBeGreaterThan(10);
      });
    });

    it("[MUTATION-KILLER] all IDs start with LOG-", () => {
      checks.forEach((c) => expect(c.id).toMatch(/^LOG-/));
    });

    it("[MUTATION-KILLER] N/A output preserves all metadata", () => {
      const naChecks = parseLoggingChecks("N/A", "bare");
      naChecks.forEach((c) => {
        expect(c.category).toBe("Logging");
        expect(c.currentValue).toBe("Unable to determine");
        expect(c.fixCommand).toBeDefined();
        expect(c.explain).toBeDefined();
        expect(c.safeToAutoFix).toBeDefined();
      });
    });
  });
});
