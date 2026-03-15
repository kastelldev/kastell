import { parseMemoryChecks } from "../../src/core/audit/checks/memory.js";

describe("parseMemoryChecks", () => {
  const validOutput = [
    "vm.overcommit_memory = 0",
    "vm.overcommit_ratio = 50",
    "vm.oom_kill_allocating_task = 0",
    "[always] madvise never",
    "0",
    "32768",
    "core file size          (blocks, -c) 0\ndata seg size           (kbytes, -d) unlimited\nopen files                      (-n) 1024\nmax user processes              (-u) 63382",
    "fs.suid_dumpable = 0",
    // /proc/sys/vm/swappiness (MEM-SWAPPINESS-REASONABLE) — standalone small number
    "10",
    // swapon --show output (MEM-SWAP-ENCRYPTED) — no swap
    "NO_SWAP",
  ].join("\n");

  const badOutput = [
    "vm.overcommit_memory = 1",
    "vm.overcommit_ratio = 50",
    "vm.oom_kill_allocating_task = 0",
    "N/A",
    "15",
    "32768",
    "open files                      (-n) unlimited",
    "fs.suid_dumpable = 2",
  ].join("\n");

  describe("N/A handling", () => {
    it("returns checks with passed=false and currentValue='Unable to determine' for N/A input", () => {
      const checks = parseMemoryChecks("N/A", "bare");
      checks.forEach((c) => {
        expect(c.passed).toBe(false);
        expect(c.currentValue).toBe("Unable to determine");
      });
    });

    it("returns checks with passed=false for empty string input", () => {
      const checks = parseMemoryChecks("", "bare");
      checks.forEach((c) => {
        expect(c.passed).toBe(false);
      });
    });
  });

  describe("check count and shape", () => {
    it("returns 10 checks", () => {
      const checks = parseMemoryChecks(validOutput, "bare");
      expect(checks).toHaveLength(10);
    });

    it("all check IDs start with MEM-", () => {
      const checks = parseMemoryChecks("", "bare");
      checks.forEach((c) => expect(c.id).toMatch(/^MEM-/));
    });

    it("all checks have explain.length > 20", () => {
      const checks = parseMemoryChecks("", "bare");
      checks.forEach((c) => expect((c.explain ?? "").length).toBeGreaterThan(20));
    });

    it("all checks have fixCommand defined", () => {
      const checks = parseMemoryChecks("", "bare");
      checks.forEach((c) => expect(c.fixCommand).toBeDefined());
    });

    it("category is 'Memory' on all checks", () => {
      const checks = parseMemoryChecks(validOutput, "bare");
      checks.forEach((c) => expect(c.category).toBe("Memory"));
    });
  });

  describe("severity budget", () => {
    it("has 0% critical severity (no critical checks)", () => {
      const checks = parseMemoryChecks(validOutput, "bare");
      const criticalCount = checks.filter((c) => c.severity === "critical").length;
      expect(criticalCount).toBe(0);
    });
  });

  describe("MEM-OVERCOMMIT-POLICY", () => {
    it("passes when vm.overcommit_memory = 0", () => {
      const checks = parseMemoryChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "MEM-OVERCOMMIT-POLICY");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("passes when vm.overcommit_memory = 2", () => {
      const output = validOutput.replace("vm.overcommit_memory = 0", "vm.overcommit_memory = 2");
      const checks = parseMemoryChecks(output, "bare");
      const check = checks.find((c) => c.id === "MEM-OVERCOMMIT-POLICY");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when vm.overcommit_memory = 1", () => {
      const checks = parseMemoryChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "MEM-OVERCOMMIT-POLICY");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("MEM-NO-ZOMBIE-EXCESS", () => {
    it("passes when zombie count is 0", () => {
      const checks = parseMemoryChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "MEM-NO-ZOMBIE-EXCESS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when zombie count is 15", () => {
      const checks = parseMemoryChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "MEM-NO-ZOMBIE-EXCESS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("MEM-CORE-DUMP-RESTRICTED", () => {
    it("passes when fs.suid_dumpable = 0", () => {
      const checks = parseMemoryChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "MEM-CORE-DUMP-RESTRICTED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when fs.suid_dumpable = 2", () => {
      const checks = parseMemoryChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "MEM-CORE-DUMP-RESTRICTED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("MEM-ULIMIT-NOFILE", () => {
    it("passes when open files limit is a numeric value", () => {
      const checks = parseMemoryChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "MEM-ULIMIT-NOFILE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when open files limit is 'unlimited'", () => {
      const checks = parseMemoryChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "MEM-ULIMIT-NOFILE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });

    it("handles nofile format variant", () => {
      const output = validOutput.replace(
        "open files                      (-n) 1024",
        "nofile                          (-n) 1024",
      );
      const checks = parseMemoryChecks(output, "bare");
      const check = checks.find((c) => c.id === "MEM-ULIMIT-NOFILE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });
  });

  describe("MEM-HUGEPAGES-CONFIG", () => {
    it("passes when transparent_hugepage/enabled exists", () => {
      const checks = parseMemoryChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "MEM-HUGEPAGES-CONFIG");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when transparent_hugepage not found", () => {
      const output = validOutput.replace("[always] madvise never", "N/A");
      const checks = parseMemoryChecks(output, "bare");
      const check = checks.find((c) => c.id === "MEM-HUGEPAGES-CONFIG");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("MEM-PID-MAX-REASONABLE", () => {
    it("passes when pid_max is 32768 (> 4096)", () => {
      const checks = parseMemoryChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "MEM-PID-MAX-REASONABLE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when pid_max is not parseable", () => {
      const output = validOutput.replace("\n32768\n", "\nN/A\n");
      const checks = parseMemoryChecks(output, "bare");
      const check = checks.find((c) => c.id === "MEM-PID-MAX-REASONABLE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("MEM-SWAP-ENCRYPTED", () => {
    it("passes when NO_SWAP present", () => {
      const checks = parseMemoryChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "MEM-SWAP-ENCRYPTED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });
  });

  describe("MEM-SWAPPINESS-REASONABLE", () => {
    it("passes when vm.swappiness is 10 (<= 60)", () => {
      const checks = parseMemoryChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "MEM-SWAPPINESS-REASONABLE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });
  });

  describe("MEM-HUGEPAGES-NOT-EXCESSIVE", () => {
    it("passes when transparent hugepages is 'always' mode (checks against always)", () => {
      const checks = parseMemoryChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "MEM-HUGEPAGES-NOT-EXCESSIVE");
      expect(check).toBeDefined();
      // validOutput has [always] which should fail this check
      expect(check!.passed).toBe(false);
    });

    it("passes when transparent hugepages is madvise mode", () => {
      const output = validOutput.replace("[always] madvise never", "always [madvise] never");
      const checks = parseMemoryChecks(output, "bare");
      const check = checks.find((c) => c.id === "MEM-HUGEPAGES-NOT-EXCESSIVE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });
  });
});
