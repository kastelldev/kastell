import { parseTimeChecks } from "../../src/core/audit/checks/time.js";

describe("parseTimeChecks", () => {
  const syncedOutput = [
    "Local time: Sun 2026-03-15 12:00:00 UTC",
    "Universal time: Sun 2026-03-15 12:00:00 UTC",
    "RTC time: Sun 2026-03-15 12:00:00",
    "Time zone: UTC (UTC, +0000)",
    "NTP synchronized: yes",
    "NTP service: active",
    "active",
    "Reference ID    : A29FC801",
    "System time     : 0.000123456 seconds slow of NTP time",
    "UTC",
    "2026-03-15 12:00:00.000000+00:00",
    "NTPSynchronized=yes",
    "Timezone=UTC",
  ].join("\n");

  const unsyncedOutput = [
    "Local time: Sun 2026-03-15 12:00:00 UTC",
    "NTP synchronized: no",
    "NTP service: inactive",
    "inactive",
    "N/A",
    "N/A",
    "N/A",
  ].join("\n");

  it("should return 9 checks for the Time category", () => {
    const checks = parseTimeChecks(syncedOutput, "bare");
    expect(checks.length).toBeGreaterThanOrEqual(9);
    checks.forEach((c) => expect(c.category).toBe("Time"));
  });

  it("all check IDs should start with TIME-", () => {
    const checks = parseTimeChecks(syncedOutput, "bare");
    checks.forEach((c) => expect(c.id).toMatch(/^TIME-/));
  });

  it("all checks should have explain > 20 chars and fixCommand defined", () => {
    const checks = parseTimeChecks(syncedOutput, "bare");
    checks.forEach((c) => {
      expect(c.explain!.length).toBeGreaterThan(20);
      expect(c.fixCommand).toBeDefined();
    });
  });

  it("TIME-NTP-ACTIVE passes when NTP service is active", () => {
    const checks = parseTimeChecks(syncedOutput, "bare");
    const check = checks.find((c) => c.id === "TIME-NTP-ACTIVE");
    expect(check!.passed).toBe(true);
  });

  it("TIME-SYNCHRONIZED passes when NTP synchronized: yes", () => {
    const checks = parseTimeChecks(syncedOutput, "bare");
    const check = checks.find((c) => c.id === "TIME-SYNCHRONIZED");
    expect(check!.passed).toBe(true);
  });

  it("TIME-SYNCHRONIZED fails when NTP synchronized: no", () => {
    const checks = parseTimeChecks(unsyncedOutput, "bare");
    const check = checks.find((c) => c.id === "TIME-SYNCHRONIZED");
    expect(check!.passed).toBe(false);
  });

  it("TIME-TIMEZONE-SET passes when timezone is configured", () => {
    const checks = parseTimeChecks(syncedOutput, "bare");
    const check = checks.find((c) => c.id === "TIME-TIMEZONE-SET");
    expect(check!.passed).toBe(true);
  });

  it("TIME-DRIFT-CHECK passes with small drift", () => {
    const checks = parseTimeChecks(syncedOutput, "bare");
    const check = checks.find((c) => c.id === "TIME-DRIFT-CHECK");
    expect(check!.passed).toBe(true);
  });

  it("TIME-NTP-PEERS-CONFIGURED passes when chrony Reference ID detected", () => {
    const checks = parseTimeChecks(syncedOutput, "bare");
    const check = checks.find((c) => c.id === "TIME-NTP-PEERS-CONFIGURED");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("TIME-NTP-PEERS-CONFIGURED passes when ntpq peer lines present", () => {
    const ntpOutput = syncedOutput + "\n* ntp1.example.com  0.0.0.0  2  u  1  64  377  0.000  0.000  0.000\n+ ntp2.example.com  0.0.0.0  2  u  2  64  377  0.001  0.001  0.001";
    const checks = parseTimeChecks(ntpOutput, "bare");
    const check = checks.find((c) => c.id === "TIME-NTP-PEERS-CONFIGURED");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("TIME-NO-DRIFT passes when NTP synchronized: yes", () => {
    const checks = parseTimeChecks(syncedOutput, "bare");
    const check = checks.find((c) => c.id === "TIME-NO-DRIFT");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("TIME-NO-DRIFT fails when NTP not synchronized", () => {
    const checks = parseTimeChecks(unsyncedOutput, "bare");
    const check = checks.find((c) => c.id === "TIME-NO-DRIFT");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("TIME-NTP-SYNCHRONIZED passes when NTPSynchronized=yes in output", () => {
    const checks = parseTimeChecks(syncedOutput, "bare");
    const check = checks.find((c) => c.id === "TIME-NTP-SYNCHRONIZED");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("TIME-NTP-SYNCHRONIZED fails when NTPSynchronized=yes absent", () => {
    const checks = parseTimeChecks(unsyncedOutput, "bare");
    const check = checks.find((c) => c.id === "TIME-NTP-SYNCHRONIZED");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("should handle N/A output gracefully", () => {
    const checks = parseTimeChecks("N/A", "bare");
    expect(checks.length).toBeGreaterThanOrEqual(9);
    checks.forEach((c) => {
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });
  });

  describe("TIME-NTP-ACTIVE — chrony active branch", () => {
    it("passes when 'active' and 'chrony' are both present", () => {
      const output = "chrony is active\nsome other text";
      const checks = parseTimeChecks(output, "bare");
      const check = checks.find((c) => c.id === "TIME-NTP-ACTIVE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when 'active' is present but no NTP service name", () => {
      const output = "some active process running\nno time service here";
      const checks = parseTimeChecks(output, "bare");
      const check = checks.find((c) => c.id === "TIME-NTP-ACTIVE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("TIME-TIMEZONE-SET — no timezone branch", () => {
    it("fails when no timezone indicators are present", () => {
      const output = "NTP synchronized: no\nsome info";
      const checks = parseTimeChecks(output, "bare");
      const check = checks.find((c) => c.id === "TIME-TIMEZONE-SET");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("not configured");
    });
  });

  describe("TIME-HWCLOCK-SYNC — no timestamp branch", () => {
    it("fails when no timestamp pattern is found in output", () => {
      const output = "N/A\nno timestamp available";
      const checks = parseTimeChecks(output, "bare");
      const check = checks.find((c) => c.id === "TIME-HWCLOCK-SYNC");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("not accessible");
    });
  });

  describe("TIME-DRIFT-CHECK — high drift branch", () => {
    it("fails when clock drift exceeds 1 second", () => {
      const output = "System time     : 2.500000000 seconds slow of NTP time";
      const checks = parseTimeChecks(output, "bare");
      const check = checks.find((c) => c.id === "TIME-DRIFT-CHECK");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("2.500");
    });

    it("falls back to NTP sync check when chronyc data absent, fails when not synced", () => {
      const output = "NTP synchronized: no\nsome text";
      const checks = parseTimeChecks(output, "bare");
      const check = checks.find((c) => c.id === "TIME-DRIFT-CHECK");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("drift unknown");
    });

    it("falls back to NTP sync check when chronyc data absent, passes when synced", () => {
      const output = "NTP synchronized: yes\nsome text without system time drift";
      const checks = parseTimeChecks(output, "bare");
      const check = checks.find((c) => c.id === "TIME-DRIFT-CHECK");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toContain("drift not measurable");
    });
  });

  describe("TIME-NTP-PEERS-CONFIGURED — insufficient peers branch", () => {
    it("fails when fewer than 2 NTP peers and no chrony reference", () => {
      const output = "no peers or reference here";
      const checks = parseTimeChecks(output, "bare");
      const check = checks.find((c) => c.id === "TIME-NTP-PEERS-CONFIGURED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("Fewer than 2");
    });
  });

  describe("TIME-CHRONY-SOURCES — no source branch", () => {
    it("fails when no NTP source indicators are present", () => {
      const output = "no chrony or ntp info here";
      const checks = parseTimeChecks(output, "bare");
      const check = checks.find((c) => c.id === "TIME-CHRONY-SOURCES");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("No NTP source");
    });
  });

  describe("TIME-SYNCHRONIZED — System clock synchronized variant", () => {
    it("passes with 'System clock synchronized: yes' instead of 'NTP synchronized'", () => {
      const output = "System clock synchronized: yes\nother text";
      const checks = parseTimeChecks(output, "bare");
      const check = checks.find((c) => c.id === "TIME-SYNCHRONIZED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });
  });

  describe("[MUTATION-KILLER] Time check metadata", () => {
    const checks = parseTimeChecks(syncedOutput, "bare");

    const expectedMeta: Array<[string, string, string]> = [
      ["TIME-NTP-ACTIVE", "warning", "GUARDED"],
      ["TIME-SYNCHRONIZED", "warning", "GUARDED"],
      ["TIME-TIMEZONE-SET", "info", "SAFE"],
      ["TIME-HWCLOCK-SYNC", "info", "SAFE"],
      ["TIME-CHRONY-SOURCES", "info", "GUARDED"],
      ["TIME-DRIFT-CHECK", "warning", "SAFE"],
      ["TIME-NTP-PEERS-CONFIGURED", "info", "GUARDED"],
      ["TIME-NO-DRIFT", "warning", "GUARDED"],
      ["TIME-NTP-SYNCHRONIZED", "warning", "SAFE"],
    ];

    it.each(expectedMeta)("[MUTATION-KILLER] %s has severity=%s, safeToAutoFix=%s", (id, severity, safe) => {
      const c = checks.find((c) => c.id === id);
      expect(c).toBeDefined();
      expect(c!.category).toBe("Time");
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

    it("[MUTATION-KILLER] all IDs start with TIME-", () => {
      checks.forEach((c) => expect(c.id).toMatch(/^TIME-/));
    });
  });
});
