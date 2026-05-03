import { CHECK_IDS } from "../../src/core/audit/checkIds.js";
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
    "3",
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

  it("should return 12 checks for the Scheduling category", () => {
    const checks = parseSchedulingChecks(secureOutput, "bare");
    expect(checks.length).toBeGreaterThanOrEqual(12);
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

  it("SCHED-CRONTAB-OWNER passes when /etc/crontab is 600 root root", () => {
    const checks = parseSchedulingChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "SCHED-CRONTAB-OWNER");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("SCHED-CRONTAB-OWNER fails when /etc/crontab is 644 nobody nogroup", () => {
    const checks = parseSchedulingChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === "SCHED-CRONTAB-OWNER");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("SCHED-NO-USER-CRONTABS passes when no world-writable cron entries", () => {
    const checks = parseSchedulingChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "SCHED-NO-USER-CRONTABS");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("SCHED-NO-USER-CRONTABS fails when world-writable cron directories found", () => {
    const checks = parseSchedulingChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === "SCHED-NO-USER-CRONTABS");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("SCHED-CRON-D-FILE-COUNT passes when count <= 15", () => {
    const checks = parseSchedulingChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "SCHED-CRON-D-FILE-COUNT");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("SCHED-CRON-D-FILE-COUNT fails when count > 15", () => {
    // Replace the "3" count with "20" to simulate too many cron.d files
    const highCountOutput = secureOutput.replace("\n3\n", "\n20\n");
    const checks = parseSchedulingChecks(highCountOutput, "bare");
    const check = checks.find((c) => c.id === "SCHED-CRON-D-FILE-COUNT");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("SCHED-NO-WORLD-READABLE-CRONTABS passes when NONE sentinel present", () => {
    const checks = parseSchedulingChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "SCHED-NO-WORLD-READABLE-CRONTABS");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("SCHED-NO-WORLD-READABLE-CRONTABS fails when world-readable crontab path found", () => {
    const worldReadableOutput = secureOutput + "\n/var/spool/cron/crontabs/alice";
    const checks = parseSchedulingChecks(worldReadableOutput, "bare");
    const check = checks.find((c) => c.id === "SCHED-NO-WORLD-READABLE-CRONTABS");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("should handle N/A output gracefully", () => {
    const checks = parseSchedulingChecks("N/A", "bare");
    expect(checks.length).toBeGreaterThanOrEqual(12);
    checks.forEach((c) => {
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });
  });

  describe("SCHED-CRON-DENY — missing branch", () => {
    it("fails when MISSING appears before cron.deny", () => {
      const output = "MISSING cron.deny";
      const checks = parseSchedulingChecks(output, "bare");
      const check = checks.find((c) => c.id === "SCHED-CRON-DENY");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });

    it("fails when cron.deny is not mentioned at all", () => {
      const output = "some unrelated output";
      const checks = parseSchedulingChecks(output, "bare");
      const check = checks.find((c) => c.id === "SCHED-CRON-DENY");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("SCHED-AT-ACCESS-CONTROL — missing branch", () => {
    it("fails when at.allow MISSING", () => {
      const output = "at.allow MISSING";
      const checks = parseSchedulingChecks(output, "bare");
      const check = checks.find((c) => c.id === "SCHED-AT-ACCESS-CONTROL");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("SCHED-AT-DENY — missing branch", () => {
    it("fails when MISSING appears before at.deny", () => {
      const output = "MISSING at.deny";
      const checks = parseSchedulingChecks(output, "bare");
      const check = checks.find((c) => c.id === "SCHED-AT-DENY");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });

    it("fails when at.deny is not mentioned at all", () => {
      const output = "some unrelated output";
      const checks = parseSchedulingChecks(output, "bare");
      const check = checks.find((c) => c.id === "SCHED-AT-DENY");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("SCHED-CRONTAB-PERMS — 644 owner root branch", () => {
    it("passes with 644 root permissions", () => {
      const output = "644 root root /etc/crontab";
      const checks = parseSchedulingChecks(output, "bare");
      const check = checks.find((c) => c.id === "SCHED-CRONTAB-PERMS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails with 777 permissions", () => {
      const output = "777 root root /etc/crontab";
      const checks = parseSchedulingChecks(output, "bare");
      const check = checks.find((c) => c.id === "SCHED-CRONTAB-PERMS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });

    it("fails when unable to parse permissions", () => {
      const output = "no crontab permissions info";
      const checks = parseSchedulingChecks(output, "bare");
      const check = checks.find((c) => c.id === "SCHED-CRONTAB-PERMS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("Unable to read");
    });
  });

  describe("SCHED-CRON-D-PERMS — alternative permissions", () => {
    it("passes with 750 root permissions", () => {
      const output = "750 root root /etc/cron.d";
      const checks = parseSchedulingChecks(output, "bare");
      const check = checks.find((c) => c.id === "SCHED-CRON-D-PERMS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("passes with 755 root permissions", () => {
      const output = "755 root root /etc/cron.d";
      const checks = parseSchedulingChecks(output, "bare");
      const check = checks.find((c) => c.id === "SCHED-CRON-D-PERMS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when unable to parse permissions", () => {
      const output = "no cron.d permissions info";
      const checks = parseSchedulingChecks(output, "bare");
      const check = checks.find((c) => c.id === "SCHED-CRON-D-PERMS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("Unable to read");
    });
  });

  describe("SCHED-CRON-DAILY-PERMS — alternative permissions", () => {
    it("passes with 750 root permissions", () => {
      const output = "750 root root /etc/cron.daily";
      const checks = parseSchedulingChecks(output, "bare");
      const check = checks.find((c) => c.id === "SCHED-CRON-DAILY-PERMS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when unable to parse permissions", () => {
      const output = "no cron.daily permissions info";
      const checks = parseSchedulingChecks(output, "bare");
      const check = checks.find((c) => c.id === "SCHED-CRON-DAILY-PERMS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("Unable to read");
    });
  });

  describe("SCHED-CRON-D-FILE-COUNT — no standalone numbers branch", () => {
    it("fails when no standalone numbers are found in output", () => {
      const output = "cron.d contains various files but no count line";
      const checks = parseSchedulingChecks(output, "bare");
      const check = checks.find((c) => c.id === "SCHED-CRON-D-FILE-COUNT");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("Unable to determine");
    });
  });

  describe("SCHED-CRONTAB-OWNER — edge cases", () => {
    it("fails when permissions > 600 even with root owner", () => {
      const output = "644 root root /etc/crontab";
      const checks = parseSchedulingChecks(output, "bare");
      const check = checks.find((c) => c.id === "SCHED-CRONTAB-OWNER");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });

    it("fails when owner is not root", () => {
      const output = "600 nobody root /etc/crontab";
      const checks = parseSchedulingChecks(output, "bare");
      const check = checks.find((c) => c.id === "SCHED-CRONTAB-OWNER");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });

    it("fails when unable to parse ownership", () => {
      const output = "no crontab ownership info";
      const checks = parseSchedulingChecks(output, "bare");
      const check = checks.find((c) => c.id === "SCHED-CRONTAB-OWNER");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("Unable to read");
    });
  });
});

describe("[MUTATION-KILLER] Scheduling check string assertions", () => {
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
    "3",
    "NONE",
  ].join("\n");

  let checks: ReturnType<typeof parseSchedulingChecks>;

  beforeAll(() => {
    checks = parseSchedulingChecks(secureOutput, "bare");
  });

  it("[MUTATION-KILLER] returns exactly 12 checks", () => {
    expect(checks).toHaveLength(12);
  });

  describe("[MUTATION-KILLER] Check IDs exact order", () => {
    it("returns all 12 check IDs in exact order", () => {
      const ids = checks.map((c) => c.id);
      expect(ids).toEqual([
        "SCHED-CRON-ACCESS-CONTROL",
        "SCHED-CRON-DENY",
        "SCHED-AT-ACCESS-CONTROL",
        "SCHED-AT-DENY",
        "SCHED-CRON-DIR-PERMS",
        "SCHED-CRONTAB-PERMS",
        "SCHED-CRON-D-PERMS",
        "SCHED-CRON-DAILY-PERMS",
        "SCHED-CRONTAB-OWNER",
        "SCHED-NO-USER-CRONTABS",
        "SCHED-CRON-D-FILE-COUNT",
        "SCHED-NO-WORLD-READABLE-CRONTABS",
      ]);
    });
  });

  describe("[MUTATION-KILLER] SCHED-CRON-ACCESS-CONTROL metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-ACCESS-CONTROL")!;
      expect(c.id).toBe("SCHED-CRON-ACCESS-CONTROL");
      expect(c.name).toBe("cron.allow Configured");
      expect(c.severity).toBe("warning");
      expect(c.category).toBe("Scheduling");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-ACCESS-CONTROL")!;
      expect(c.expectedValue).toBe("/etc/cron.allow exists (whitelist approach)");
    });

    it("fixCommand contains cron.allow and chmod 600", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-ACCESS-CONTROL")!;
      expect(c.fixCommand).toContain("cron.allow");
      expect(c.fixCommand).toContain("chmod 600");
    });

    it("explain mentions whitelist and least privilege", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-ACCESS-CONTROL")!;
      expect(c.explain).toContain("cron.allow");
      expect(c.explain).toContain("least privilege");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-ACCESS-CONTROL")!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] SCHED-CRON-DENY metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-DENY")!;
      expect(c.id).toBe("SCHED-CRON-DENY");
      expect(c.name).toBe("cron.deny Configured");
      expect(c.severity).toBe("info");
      expect(c.category).toBe("Scheduling");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-DENY")!;
      expect(c.expectedValue).toBe("/etc/cron.deny exists as fallback access control");
    });

    it("fixCommand contains cron.deny and chmod 600", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-DENY")!;
      expect(c.fixCommand).toContain("cron.deny");
      expect(c.fixCommand).toContain("chmod 600");
    });

    it("explain mentions secondary layer and blocking specific users", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-DENY")!;
      expect(c.explain).toContain("secondary layer");
      expect(c.explain).toContain("blocking specific users");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-DENY")!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] SCHED-AT-ACCESS-CONTROL metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "SCHED-AT-ACCESS-CONTROL")!;
      expect(c.id).toBe("SCHED-AT-ACCESS-CONTROL");
      expect(c.name).toBe("at.allow Configured");
      expect(c.severity).toBe("warning");
      expect(c.category).toBe("Scheduling");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "SCHED-AT-ACCESS-CONTROL")!;
      expect(c.expectedValue).toBe("/etc/at.allow exists (whitelist approach)");
    });

    it("fixCommand contains at.allow and chmod 600", () => {
      const c = checks.find((c) => c.id === "SCHED-AT-ACCESS-CONTROL")!;
      expect(c.fixCommand).toContain("at.allow");
      expect(c.fixCommand).toContain("chmod 600");
    });

    it("explain mentions at scheduler and unauthorized job scheduling", () => {
      const c = checks.find((c) => c.id === "SCHED-AT-ACCESS-CONTROL")!;
      expect(c.explain).toContain("at.allow");
      expect(c.explain).toContain("unauthorized job scheduling");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = checks.find((c) => c.id === "SCHED-AT-ACCESS-CONTROL")!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] SCHED-AT-DENY metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "SCHED-AT-DENY")!;
      expect(c.id).toBe("SCHED-AT-DENY");
      expect(c.name).toBe("at.deny Configured");
      expect(c.severity).toBe("info");
      expect(c.category).toBe("Scheduling");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "SCHED-AT-DENY")!;
      expect(c.expectedValue).toBe("/etc/at.deny exists as fallback access control");
    });

    it("fixCommand contains at.deny and chmod 600", () => {
      const c = checks.find((c) => c.id === "SCHED-AT-DENY")!;
      expect(c.fixCommand).toContain("at.deny");
      expect(c.fixCommand).toContain("chmod 600");
    });

    it("explain mentions one-time jobs and complementing at.allow", () => {
      const c = checks.find((c) => c.id === "SCHED-AT-DENY")!;
      expect(c.explain).toContain("one-time jobs");
      expect(c.explain).toContain("at.allow");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = checks.find((c) => c.id === "SCHED-AT-DENY")!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] SCHED-CRON-DIR-PERMS metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-DIR-PERMS")!;
      expect(c.id).toBe("SCHED-CRON-DIR-PERMS");
      expect(c.name).toBe("Cron Dirs Not World-Writable");
      expect(c.severity).toBe("warning");
      expect(c.category).toBe("Scheduling");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-DIR-PERMS")!;
      expect(c.expectedValue).toBe("No world-writable cron directories");
    });

    it("fixCommand contains chmod o-w and cron directories", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-DIR-PERMS")!;
      expect(c.fixCommand).toContain("chmod o-w");
      expect(c.fixCommand).toContain("cron.daily");
    });

    it("explain mentions privilege escalation and inject scheduled tasks", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-DIR-PERMS")!;
      expect(c.explain).toContain("privilege escalation");
      expect(c.explain).toContain("inject scheduled tasks");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-DIR-PERMS")!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] SCHED-CRONTAB-PERMS metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "SCHED-CRONTAB-PERMS")!;
      expect(c.id).toBe("SCHED-CRONTAB-PERMS");
      expect(c.name).toBe("/etc/crontab Restricted");
      expect(c.severity).toBe("warning");
      expect(c.category).toBe("Scheduling");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "SCHED-CRONTAB-PERMS")!;
      expect(c.expectedValue).toBe("/etc/crontab permissions 600 or 644, owned by root");
    });

    it("fixCommand contains chmod 600 and chown root:root and /etc/crontab", () => {
      const c = checks.find((c) => c.id === "SCHED-CRONTAB-PERMS")!;
      expect(c.fixCommand).toContain("chmod 600");
      expect(c.fixCommand).toContain("chown root:root /etc/crontab");
    });

    it("explain mentions system crontab and restricted to root", () => {
      const c = checks.find((c) => c.id === "SCHED-CRONTAB-PERMS")!;
      expect(c.explain).toContain("system crontab");
      expect(c.explain).toContain("restricted to root");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = checks.find((c) => c.id === "SCHED-CRONTAB-PERMS")!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] SCHED-CRON-D-PERMS metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-D-PERMS")!;
      expect(c.id).toBe("SCHED-CRON-D-PERMS");
      expect(c.name).toBe("/etc/cron.d Restricted");
      expect(c.severity).toBe("info");
      expect(c.category).toBe("Scheduling");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-D-PERMS")!;
      expect(c.expectedValue).toBe("/etc/cron.d permissions 700 or 750, owned by root");
    });

    it("fixCommand contains chmod 700 and chown root:root /etc/cron.d", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-D-PERMS")!;
      expect(c.fixCommand).toContain("chmod 700");
      expect(c.fixCommand).toContain("chown root:root /etc/cron.d");
    });

    it("explain mentions crontab files and unauthorized job additions", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-D-PERMS")!;
      expect(c.explain).toContain("crontab files");
      expect(c.explain).toContain("unauthorized job additions");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-D-PERMS")!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] SCHED-CRON-DAILY-PERMS metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-DAILY-PERMS")!;
      expect(c.id).toBe("SCHED-CRON-DAILY-PERMS");
      expect(c.name).toBe("/etc/cron.daily Restricted");
      expect(c.severity).toBe("info");
      expect(c.category).toBe("Scheduling");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-DAILY-PERMS")!;
      expect(c.expectedValue).toBe("/etc/cron.daily permissions 700 or 750, owned by root");
    });

    it("fixCommand contains chmod 700 and chown root:root /etc/cron.daily", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-DAILY-PERMS")!;
      expect(c.fixCommand).toContain("chmod 700");
      expect(c.fixCommand).toContain("chown root:root /etc/cron.daily");
    });

    it("explain mentions daily cron scripts and malicious scripts", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-DAILY-PERMS")!;
      expect(c.explain).toContain("Daily cron scripts");
      expect(c.explain).toContain("malicious scripts");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-DAILY-PERMS")!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] SCHED-CRONTAB-OWNER metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "SCHED-CRONTAB-OWNER")!;
      expect(c.id).toBe("SCHED-CRONTAB-OWNER");
      expect(c.name).toBe("/etc/crontab Owned by Root with Restricted Permissions");
      expect(c.severity).toBe("warning");
      expect(c.category).toBe("Scheduling");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "SCHED-CRONTAB-OWNER")!;
      expect(c.expectedValue).toBe("/etc/crontab owned by root with permissions <= 600");
    });

    it("fixCommand contains chown root:root and chmod 600 and /etc/crontab", () => {
      const c = checks.find((c) => c.id === "SCHED-CRONTAB-OWNER")!;
      expect(c.fixCommand).toContain("chown root:root /etc/crontab");
      expect(c.fixCommand).toContain("chmod 600 /etc/crontab");
    });

    it("explain mentions privilege escalation and scheduled job injection", () => {
      const c = checks.find((c) => c.id === "SCHED-CRONTAB-OWNER")!;
      expect(c.explain).toContain("privilege escalation");
      expect(c.explain).toContain("scheduled job injection");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = checks.find((c) => c.id === "SCHED-CRONTAB-OWNER")!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] SCHED-NO-USER-CRONTABS metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "SCHED-NO-USER-CRONTABS")!;
      expect(c.id).toBe("SCHED-NO-USER-CRONTABS");
      expect(c.name).toBe("No World-Writable Cron Directories");
      expect(c.severity).toBe("warning");
      expect(c.category).toBe("Scheduling");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "SCHED-NO-USER-CRONTABS")!;
      expect(c.expectedValue).toBe("No world-writable entries in /etc/cron.d, /etc/cron.daily, etc.");
    });

    it("fixCommand contains chmod -R o-w and cron directories", () => {
      const c = checks.find((c) => c.id === "SCHED-NO-USER-CRONTABS")!;
      expect(c.fixCommand).toContain("chmod -R o-w");
      expect(c.fixCommand).toContain("cron.daily");
    });

    it("explain mentions privilege escalation and inject scheduled tasks", () => {
      const c = checks.find((c) => c.id === "SCHED-NO-USER-CRONTABS")!;
      expect(c.explain).toContain("privilege escalation");
      expect(c.explain).toContain("inject scheduled tasks");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = checks.find((c) => c.id === "SCHED-NO-USER-CRONTABS")!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] SCHED-CRON-D-FILE-COUNT metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-D-FILE-COUNT")!;
      expect(c.id).toBe("SCHED-CRON-D-FILE-COUNT");
      expect(c.name).toBe("cron.d File Count Reasonable");
      expect(c.severity).toBe("info");
      expect(c.category).toBe("Scheduling");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-D-FILE-COUNT")!;
      expect(c.expectedValue).toBe("15 or fewer files in /etc/cron.d/");
    });

    it("fixCommand mentions cron.d and review", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-D-FILE-COUNT")!;
      expect(c.fixCommand).toContain("/etc/cron.d/");
      expect(c.fixCommand).toContain("review");
    });

    it("explain mentions unmanaged and elevated privileges", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-D-FILE-COUNT")!;
      expect(c.explain).toContain("unmanaged");
      expect(c.explain).toContain("elevated privileges");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-D-FILE-COUNT")!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] SCHED-NO-WORLD-READABLE-CRONTABS metadata", () => {
    it("has correct id, name, severity, category", () => {
      const c = checks.find((c) => c.id === "SCHED-NO-WORLD-READABLE-CRONTABS")!;
      expect(c.id).toBe("SCHED-NO-WORLD-READABLE-CRONTABS");
      expect(c.name).toBe("No World-Readable User Crontabs");
      expect(c.severity).toBe("warning");
      expect(c.category).toBe("Scheduling");
    });

    it("has correct expectedValue", () => {
      const c = checks.find((c) => c.id === "SCHED-NO-WORLD-READABLE-CRONTABS")!;
      expect(c.expectedValue).toBe("No world-readable files in /var/spool/cron/crontabs/");
    });

    it("fixCommand contains chmod 600 and /var/spool/cron/crontabs", () => {
      const c = checks.find((c) => c.id === "SCHED-NO-WORLD-READABLE-CRONTABS")!;
      expect(c.fixCommand).toContain("chmod 600");
      expect(c.fixCommand).toContain("/var/spool/cron/crontabs/");
    });

    it("explain mentions credentials and internal paths", () => {
      const c = checks.find((c) => c.id === "SCHED-NO-WORLD-READABLE-CRONTABS")!;
      expect(c.explain).toContain("credentials");
      expect(c.explain).toContain("internal paths");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = checks.find((c) => c.id === "SCHED-NO-WORLD-READABLE-CRONTABS")!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] N/A output preserves all metadata strings", () => {
    it("all 12 checks preserve id, name, severity, category, expectedValue, fixCommand, explain on N/A", () => {
      const naChecks = parseSchedulingChecks("N/A", "bare");
      const normalChecks = parseSchedulingChecks(secureOutput, "bare");
      expect(naChecks).toHaveLength(12);
      for (let i = 0; i < naChecks.length; i++) {
        expect(naChecks[i].id).toBe(normalChecks[i].id);
        expect(naChecks[i].name).toBe(normalChecks[i].name);
        expect(naChecks[i].severity).toBe(normalChecks[i].severity);
        expect(naChecks[i].category).toBe(normalChecks[i].category);
        expect(naChecks[i].expectedValue).toBe(normalChecks[i].expectedValue);
        expect(naChecks[i].fixCommand).toBe(normalChecks[i].fixCommand);
        expect(naChecks[i].explain).toBe(normalChecks[i].explain);
        expect(naChecks[i].safeToAutoFix).toBe(normalChecks[i].safeToAutoFix);
      }
    });
  });

  describe("[MUTATION-KILLER] currentValue strings on pass", () => {
    it("SCHED-CRON-ACCESS-CONTROL currentValue on pass", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-ACCESS-CONTROL")!;
      expect(c.currentValue).toBe("/etc/cron.allow exists");
    });

    it("SCHED-CRON-DENY currentValue on pass", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-DENY")!;
      expect(c.currentValue).toBe("/etc/cron.deny exists");
    });

    it("SCHED-AT-ACCESS-CONTROL currentValue on pass", () => {
      const c = checks.find((c) => c.id === "SCHED-AT-ACCESS-CONTROL")!;
      expect(c.currentValue).toBe("/etc/at.allow exists");
    });

    it("SCHED-AT-DENY currentValue on pass", () => {
      const c = checks.find((c) => c.id === "SCHED-AT-DENY")!;
      expect(c.currentValue).toBe("/etc/at.deny exists");
    });

    it("SCHED-CRON-DIR-PERMS currentValue on pass", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-DIR-PERMS")!;
      expect(c.currentValue).toBe("No world-writable cron directories");
    });

    it("SCHED-CRONTAB-PERMS currentValue on pass", () => {
      const c = checks.find((c) => c.id === "SCHED-CRONTAB-PERMS")!;
      expect(c.currentValue).toBe("/etc/crontab: 600 root");
    });

    it("SCHED-CRON-D-PERMS currentValue on pass", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-D-PERMS")!;
      expect(c.currentValue).toBe("/etc/cron.d: 700 root");
    });

    it("SCHED-CRON-DAILY-PERMS currentValue on pass", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-DAILY-PERMS")!;
      expect(c.currentValue).toBe("/etc/cron.daily: 700 root");
    });

    it("SCHED-CRONTAB-OWNER currentValue on pass", () => {
      const c = checks.find((c) => c.id === "SCHED-CRONTAB-OWNER")!;
      expect(c.currentValue).toBe("/etc/crontab: permissions 600, owner root");
    });

    it("SCHED-NO-USER-CRONTABS currentValue on pass", () => {
      const c = checks.find((c) => c.id === "SCHED-NO-USER-CRONTABS")!;
      expect(c.currentValue).toBe("No world-writable cron directories");
    });

    it("SCHED-CRON-D-FILE-COUNT currentValue on pass", () => {
      const c = checks.find((c) => c.id === "SCHED-CRON-D-FILE-COUNT")!;
      expect(c.currentValue).toBe("3 file(s) in /etc/cron.d/");
    });

    it("SCHED-NO-WORLD-READABLE-CRONTABS currentValue on pass", () => {
      const c = checks.find((c) => c.id === "SCHED-NO-WORLD-READABLE-CRONTABS")!;
      expect(c.currentValue).toBe("No world-readable crontabs found");
    });
  });

  describe("[MUTATION-KILLER] currentValue strings on fail", () => {
    const insecureOutput = [
      "cron.allow MISSING",
      "MISSING cron.deny",
      "at.allow MISSING",
      "MISSING at.deny",
      "/etc/cron.d/evil",
      "777 nobody nobody /etc/crontab",
      "777 nobody nobody /etc/cron.d",
      "777 nobody nobody /etc/cron.daily",
      "/var/spool/cron/crontabs/alice",
    ].join("\n");

    let failChecks: ReturnType<typeof parseSchedulingChecks>;

    beforeAll(() => {
      failChecks = parseSchedulingChecks(insecureOutput, "bare");
    });

    it("SCHED-CRON-ACCESS-CONTROL currentValue on fail", () => {
      const c = failChecks.find((c) => c.id === "SCHED-CRON-ACCESS-CONTROL")!;
      expect(c.currentValue).toBe("/etc/cron.allow not found");
    });

    it("SCHED-AT-ACCESS-CONTROL currentValue on fail", () => {
      const c = failChecks.find((c) => c.id === "SCHED-AT-ACCESS-CONTROL")!;
      expect(c.currentValue).toBe("/etc/at.allow not found");
    });

    it("SCHED-CRON-DIR-PERMS currentValue on fail", () => {
      const c = failChecks.find((c) => c.id === "SCHED-CRON-DIR-PERMS")!;
      expect(c.currentValue).toBe("World-writable cron directories found");
    });

    it("SCHED-NO-USER-CRONTABS currentValue on fail", () => {
      const c = failChecks.find((c) => c.id === "SCHED-NO-USER-CRONTABS")!;
      expect(c.currentValue).toBe("World-writable cron directories or files found");
    });

    it("SCHED-NO-WORLD-READABLE-CRONTABS currentValue on fail", () => {
      const c = failChecks.find((c) => c.id === "SCHED-NO-WORLD-READABLE-CRONTABS")!;
      expect(c.currentValue).toBe("World-readable crontab file(s) found in /var/spool/cron/crontabs/");
    });

    it("SCHED-CRONTAB-OWNER currentValue on fail", () => {
      const c = failChecks.find((c) => c.id === "SCHED-CRONTAB-OWNER")!;
      expect(c.currentValue).toBe("/etc/crontab: permissions 777, owner nobody");
    });
  });
});
