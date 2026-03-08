import { parseLoggingChecks } from "../../src/core/audit/checks/logging.js";

describe("parseLoggingChecks", () => {
  const secureOutput = [
    // rsyslog status
    "active",
    // journald status
    "active",
    // logrotate config
    "weekly\nrotate 4\ncreate\ncompress",
    // auth log
    "EXISTS",
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
  ].join("\n");

  it("should return 5 checks", () => {
    const checks = parseLoggingChecks(secureOutput, "bare");
    expect(checks).toHaveLength(5);
    checks.forEach((check) => {
      expect(check.category).toBe("Logging");
      expect(check.id).toMatch(/^LOG-0[1-5]$/);
    });
  });

  it("should return LOG-01 passed when journald is active", () => {
    const checks = parseLoggingChecks(secureOutput, "bare");
    const log01 = checks.find((c: { id: string }) => c.id === "LOG-01");
    expect(log01!.passed).toBe(true);
  });

  it("should return LOG-01 failed when neither syslog nor journald active", () => {
    const checks = parseLoggingChecks(insecureOutput, "bare");
    const log01 = checks.find((c: { id: string }) => c.id === "LOG-01");
    expect(log01!.passed).toBe(false);
  });

  it("should return LOG-02 passed when auth log exists", () => {
    const checks = parseLoggingChecks(secureOutput, "bare");
    const log02 = checks.find((c: { id: string }) => c.id === "LOG-02");
    expect(log02!.passed).toBe(true);
  });

  it("should return LOG-02 failed when auth log missing", () => {
    const checks = parseLoggingChecks(insecureOutput, "bare");
    const log02 = checks.find((c: { id: string }) => c.id === "LOG-02");
    expect(log02!.passed).toBe(false);
  });

  it("should handle N/A output gracefully", () => {
    const checks = parseLoggingChecks("N/A", "bare");
    expect(checks).toHaveLength(5);
  });
});
