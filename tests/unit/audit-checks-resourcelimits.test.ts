import { parseResourceLimitsChecks } from "../../src/core/audit/checks/resourcelimits.js";

describe("parseResourceLimitsChecks", () => {
  const validOutput = [
    "CGROUPS_V2_ACTIVE",
    "NPROC_SOFT:1024",
    "NPROC_HARD:2048",
    "THREADS_MAX:kernel.threads-max = 32768",
    "LIMITS_CONF_NPROC_SET",
    "LIMITS_CONF_MAXLOGINS_SET",
    "* soft nproc 4096",
    "* hard nproc 8192",
    "* hard maxlogins 10",
  ].join("\n");

  const badOutput = [
    "CGROUPS_V2_ABSENT",
    "NPROC_SOFT:unlimited",
    "NPROC_HARD:NOT_SET",
    "THREADS_MAX_NOT_FOUND",
    "LIMITS_CONF_NPROC_NOT_SET",
    "LIMITS_CONF_MAXLOGINS_NOT_SET",
  ].join("\n");

  describe("N/A handling", () => {
    it("returns checks with passed=false and currentValue='Unable to determine' for N/A input", () => {
      const checks = parseResourceLimitsChecks("N/A", "bare");
      checks.forEach((c) => {
        expect(c.passed).toBe(false);
        expect(c.currentValue).toBe("Unable to determine");
      });
    });

    it("returns checks with passed=false for empty string input", () => {
      const checks = parseResourceLimitsChecks("", "bare");
      checks.forEach((c) => {
        expect(c.passed).toBe(false);
      });
    });
  });

  describe("check count and shape", () => {
    it("returns at least 8 checks", () => {
      const checks = parseResourceLimitsChecks(validOutput, "bare");
      expect(checks.length).toBeGreaterThanOrEqual(8);
    });

    it("all check IDs start with RLIMIT-", () => {
      const checks = parseResourceLimitsChecks("", "bare");
      checks.forEach((c) => expect(c.id).toMatch(/^RLIMIT-/));
    });

    it("has no MEM-* IDs (no overlap with memory.ts)", () => {
      const checks = parseResourceLimitsChecks("", "bare");
      checks.forEach((c) => expect(c.id).not.toMatch(/^MEM-/));
    });

    it("all checks have explain.length > 20", () => {
      const checks = parseResourceLimitsChecks("", "bare");
      checks.forEach((c) => expect((c.explain ?? "").length).toBeGreaterThan(20));
    });

    it("all checks have fixCommand defined", () => {
      const checks = parseResourceLimitsChecks("", "bare");
      checks.forEach((c) => expect(c.fixCommand).toBeDefined());
    });

    it("category is 'Resource Limits' on all checks", () => {
      const checks = parseResourceLimitsChecks(validOutput, "bare");
      checks.forEach((c) => expect(c.category).toBe("Resource Limits"));
    });
  });

  describe("severity budget", () => {
    it("has at most 40% critical severity checks", () => {
      const checks = parseResourceLimitsChecks(validOutput, "bare");
      const criticalCount = checks.filter((c) => c.severity === "critical").length;
      expect(criticalCount / checks.length).toBeLessThanOrEqual(0.4);
    });
  });

  describe("RLIMIT-CGROUPS-V2", () => {
    it("passes when CGROUPS_V2_ACTIVE is present", () => {
      const checks = parseResourceLimitsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "RLIMIT-CGROUPS-V2");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when CGROUPS_V2_ABSENT is present", () => {
      const checks = parseResourceLimitsChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "RLIMIT-CGROUPS-V2");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("RLIMIT-NPROC-SOFT", () => {
    it("passes when nproc soft limit is a reasonable numeric value", () => {
      const checks = parseResourceLimitsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "RLIMIT-NPROC-SOFT");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when nproc soft limit is unlimited", () => {
      const checks = parseResourceLimitsChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "RLIMIT-NPROC-SOFT");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("RLIMIT-NPROC-HARD", () => {
    it("passes when hard nproc limit is set", () => {
      const checks = parseResourceLimitsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "RLIMIT-NPROC-HARD");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when hard nproc limit is not set", () => {
      const checks = parseResourceLimitsChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "RLIMIT-NPROC-HARD");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("RLIMIT-THREADS-MAX", () => {
    it("passes when kernel.threads-max is found", () => {
      const checks = parseResourceLimitsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "RLIMIT-THREADS-MAX");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when threads-max is not found", () => {
      const checks = parseResourceLimitsChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "RLIMIT-THREADS-MAX");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("RLIMIT-LIMITS-CONF-NPROC", () => {
    it("passes when nproc entries exist in limits.conf", () => {
      const checks = parseResourceLimitsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "RLIMIT-LIMITS-CONF-NPROC");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when no nproc entries in limits.conf", () => {
      const checks = parseResourceLimitsChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "RLIMIT-LIMITS-CONF-NPROC");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("RLIMIT-MAXLOGINS", () => {
    it("passes when maxlogins is set in limits.conf", () => {
      const checks = parseResourceLimitsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "RLIMIT-MAXLOGINS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when maxlogins is not set", () => {
      const checks = parseResourceLimitsChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "RLIMIT-MAXLOGINS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("RLIMIT-LIMITS-CONF-CONFIGURED", () => {
    it("passes when active entries in limits.conf", () => {
      const checks = parseResourceLimitsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "RLIMIT-LIMITS-CONF-CONFIGURED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when limits.conf has only comments and no active entries", () => {
      // Simulate output that has no non-comment, non-empty lines for limits.conf
      const emptyLimitsOutput = "# This file is empty\n# No active limits configured";
      const checks = parseResourceLimitsChecks(emptyLimitsOutput, "bare");
      const check = checks.find((c) => c.id === "RLIMIT-LIMITS-CONF-CONFIGURED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("RLIMIT-NPROC-LIMITED", () => {
    it("passes when nproc limit is within safe range", () => {
      const checks = parseResourceLimitsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "RLIMIT-NPROC-LIMITED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when nproc limit is excessively high", () => {
      const output = validOutput.replace("* soft nproc 4096", "* soft nproc 99999");
      const checks = parseResourceLimitsChecks(output, "bare");
      const check = checks.find((c) => c.id === "RLIMIT-NPROC-LIMITED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("[MUTATION-KILLER] ResourceLimits check metadata", () => {
    const checks = parseResourceLimitsChecks(validOutput, "bare");

    const expectedMeta: Array<[string, string, string]> = [
      ["RLIMIT-CGROUPS-V2", "warning", "GUARDED"],
      ["RLIMIT-NPROC-SOFT", "warning", "SAFE"],
      ["RLIMIT-NPROC-HARD", "info", "SAFE"],
      ["RLIMIT-THREADS-MAX", "info", "SAFE"],
      ["RLIMIT-LIMITS-CONF-NPROC", "info", "SAFE"],
      ["RLIMIT-MAXLOGINS", "info", "SAFE"],
      ["RLIMIT-LIMITS-CONF-CONFIGURED", "info", "SAFE"],
      ["RLIMIT-NPROC-LIMITED", "warning", "SAFE"],
    ];

    it.each(expectedMeta)("[MUTATION-KILLER] %s has severity=%s, safeToAutoFix=%s", (id, severity, safe) => {
      const c = checks.find((c) => c.id === id);
      expect(c).toBeDefined();
      expect(c!.category).toBe("Resource Limits");
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

    it("[MUTATION-KILLER] all IDs start with RLIMIT-", () => {
      checks.forEach((c) => expect(c.id).toMatch(/^RLIMIT-/));
    });
  });
});
