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

  it("should handle N/A output gracefully", () => {
    const checks = parseLoggingChecks("N/A", "bare");
    expect(checks).toHaveLength(5);
  });
});
