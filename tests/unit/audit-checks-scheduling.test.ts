import { parseSchedulingChecks } from "../../src/core/audit/checks/scheduling.js";

describe("parseSchedulingChecks", () => {
  const secureOutput = [
    "cron.allow EXISTS",
    "cron.deny EXISTS",
    "at.allow EXISTS",
    "at.deny EXISTS",
    "700 root root /etc/cron.d",
    "700 root root /etc/cron.daily",
    "700 root root /etc/cron.weekly",
    "700 root root /etc/cron.monthly",
    "700 root root /etc/cron.hourly",
    "600 root root /etc/crontab",
    "NONE",
  ].join("\n");

  const insecureOutput = [
    "cron.allow MISSING",
    "cron.deny MISSING",
    "at.allow MISSING",
    "at.deny MISSING",
    "777 root root /etc/cron.d",
    "755 root root /etc/cron.daily",
    "644 nobody nogroup /etc/crontab",
    "/etc/cron.d/somefile",
  ].join("\n");

  it("should return 8 checks for the Scheduling category", () => {
    const checks = parseSchedulingChecks(secureOutput, "bare");
    expect(checks.length).toBeGreaterThanOrEqual(8);
    checks.forEach((c) => expect(c.category).toBe("Scheduling"));
  });

  it("all check IDs should start with SCHED-", () => {
    const checks = parseSchedulingChecks(secureOutput, "bare");
    checks.forEach((c) => expect(c.id).toMatch(/^SCHED-/));
  });

  it("all checks should have explain > 20 chars and fixCommand defined", () => {
    const checks = parseSchedulingChecks(secureOutput, "bare");
    checks.forEach((c) => {
      expect(c.explain!.length).toBeGreaterThan(20);
      expect(c.fixCommand).toBeDefined();
    });
  });

  it("SCHED-CRON-ACCESS-CONTROL passes when cron.allow exists", () => {
    const checks = parseSchedulingChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "SCHED-CRON-ACCESS-CONTROL");
    expect(check!.passed).toBe(true);
  });

  it("SCHED-CRON-ACCESS-CONTROL fails when cron.allow missing", () => {
    const checks = parseSchedulingChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === "SCHED-CRON-ACCESS-CONTROL");
    expect(check!.passed).toBe(false);
  });

  it("SCHED-CRON-DIR-PERMS passes with no world-writable dirs", () => {
    const checks = parseSchedulingChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "SCHED-CRON-DIR-PERMS");
    expect(check!.passed).toBe(true);
  });

  it("SCHED-CRON-DIR-PERMS fails with world-writable dirs", () => {
    const checks = parseSchedulingChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === "SCHED-CRON-DIR-PERMS");
    expect(check!.passed).toBe(false);
  });

  it("SCHED-CRONTAB-PERMS passes with 600 root", () => {
    const checks = parseSchedulingChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "SCHED-CRONTAB-PERMS");
    expect(check!.passed).toBe(true);
  });

  it("should handle N/A output gracefully", () => {
    const checks = parseSchedulingChecks("N/A", "bare");
    expect(checks.length).toBeGreaterThanOrEqual(8);
    checks.forEach((c) => {
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });
  });
});
