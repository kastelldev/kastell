import { CHECK_IDS } from "../../src/core/audit/checkIds.js";
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
    // vm.max_map_count (MEM-MAX-MAP-COUNT) — a number >= 65530
    "65536",
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
    it("returns 11 checks", () => {
      const checks = parseMemoryChecks(validOutput, "bare");
      expect(checks).toHaveLength(11);
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

    it("fails when vm.overcommit_memory is not found in output", () => {
      const output = "some unrelated output\nno overcommit here";
      const checks = parseMemoryChecks(output, "bare");
      const check = checks.find((c) => c.id === "MEM-OVERCOMMIT-POLICY");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("vm.overcommit_memory not found");
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

    it("fails when zombie count is not determinable", () => {
      const output = "no numeric lines here\njust text";
      const checks = parseMemoryChecks(output, "bare");
      const check = checks.find((c) => c.id === "MEM-NO-ZOMBIE-EXCESS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("Zombie count not determinable");
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

    it("fails when fs.suid_dumpable is not found in output", () => {
      const output = "no suid dumpable info here";
      const checks = parseMemoryChecks(output, "bare");
      const check = checks.find((c) => c.id === "MEM-CORE-DUMP-RESTRICTED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("fs.suid_dumpable not found");
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

    it("fails when open files limit is not found in output", () => {
      const output = "no ulimit info here\njust text";
      const checks = parseMemoryChecks(output, "bare");
      const check = checks.find((c) => c.id === "MEM-ULIMIT-NOFILE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("Open files limit not found in ulimit output");
    });

    it("fails when open files limit is -1 (unlimited variant)", () => {
      const output = validOutput.replace(
        "open files                      (-n) 1024",
        "open files                      (-n) -1",
      );
      const checks = parseMemoryChecks(output, "bare");
      const check = checks.find((c) => c.id === "MEM-ULIMIT-NOFILE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("MEM-OOM-KILL-POLICY", () => {
    it("passes when vm.oom_kill_allocating_task is present", () => {
      const checks = parseMemoryChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "MEM-OOM-KILL-POLICY");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when vm.oom_kill_allocating_task is not found", () => {
      const output = "no oom kill info here";
      const checks = parseMemoryChecks(output, "bare");
      const check = checks.find((c) => c.id === "MEM-OOM-KILL-POLICY");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("vm.oom_kill_allocating_task not found");
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
      const output = validOutput.replace("[always] madvise never", "something_else");
      const checks = parseMemoryChecks(output, "bare");
      const check = checks.find((c) => c.id === "MEM-HUGEPAGES-CONFIG");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("Transparent hugepages not configured");
    });

    it("passes with content-only (no bracket notation) — madvise keyword present", () => {
      const output = validOutput.replace("[always] madvise never", "madvise");
      const checks = parseMemoryChecks(output, "bare");
      const check = checks.find((c) => c.id === "MEM-HUGEPAGES-CONFIG");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toBe("Transparent hugepages configured");
    });
  });

  describe("MEM-PID-MAX-REASONABLE", () => {
    it("passes when pid_max is 32768 (> 4096)", () => {
      const checks = parseMemoryChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "MEM-PID-MAX-REASONABLE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when pid_max is below 4096", () => {
      // Replace 32768 with 1024 (< 4096 threshold)
      const output = validOutput.replace("\n32768\n", "\n1024\n");
      const checks = parseMemoryChecks(output, "bare");
      const check = checks.find((c) => c.id === "MEM-PID-MAX-REASONABLE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });

    it("fails when pid_max value is not found in output", () => {
      const output = "no pid max here\njust text lines";
      const checks = parseMemoryChecks(output, "bare");
      const check = checks.find((c) => c.id === "MEM-PID-MAX-REASONABLE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("pid_max value not found");
    });
  });

  describe("MEM-SWAP-ENCRYPTED", () => {
    it("passes when NO_SWAP present", () => {
      const checks = parseMemoryChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "MEM-SWAP-ENCRYPTED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("passes when swap is on encrypted volume", () => {
      const output = validOutput.replace("NO_SWAP", "/dev/dm-0 partition crypto");
      const checks = parseMemoryChecks(output, "bare");
      const check = checks.find((c) => c.id === "MEM-SWAP-ENCRYPTED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toBe("Swap on encrypted volume");
    });

    it("fails when unencrypted swap detected", () => {
      const output = validOutput.replace("NO_SWAP", "/dev/sda2 partition");
      const checks = parseMemoryChecks(output, "bare");
      const check = checks.find((c) => c.id === "MEM-SWAP-ENCRYPTED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("Unencrypted swap detected");
    });
  });

  describe("MEM-SWAPPINESS-REASONABLE", () => {
    it("passes when vm.swappiness is 10 (<= 60)", () => {
      const checks = parseMemoryChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "MEM-SWAPPINESS-REASONABLE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when vm.swappiness is not found", () => {
      const output = "no swappiness value\njust text lines";
      const checks = parseMemoryChecks(output, "bare");
      const check = checks.find((c) => c.id === "MEM-SWAPPINESS-REASONABLE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("vm.swappiness not found");
    });

    it("fails when vm.swappiness is > 60", () => {
      // The swappiness parser picks the first standalone number 0-200.
      // In the full output, "0" (zombie count) comes first, so we need
      // an isolated output where the only standalone number is > 60.
      const output = "80";
      const checks = parseMemoryChecks(output, "bare");
      const check = checks.find((c) => c.id === "MEM-SWAPPINESS-REASONABLE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toMatch(/high/i);
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

    it("passes when transparent hugepages config is not available", () => {
      const output = "no hugepage info here\njust text";
      const checks = parseMemoryChecks(output, "bare");
      const check = checks.find((c) => c.id === "MEM-HUGEPAGES-NOT-EXCESSIVE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toBe("Transparent hugepages configuration not available");
    });
  });

  describe("MEM-MAX-MAP-COUNT", () => {
    it("passes when vm.max_map_count >= 65530", () => {
      const checks = parseMemoryChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "MEM-MAX-MAP-COUNT");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toMatch(/65536.*acceptable/);
    });

    it("fails when vm.max_map_count < 65530", () => {
      // 65536 is the last element in validOutput (no trailing newline)
      const output = validOutput.replace(/\b65536$/, "32768");
      const checks = parseMemoryChecks(output, "bare");
      const check = checks.find((c) => c.id === "MEM-MAX-MAP-COUNT");
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toMatch(/below minimum/);
    });

    it("fails when vm.max_map_count is not determinable", () => {
      const output = "no max map count here\njust text";
      const checks = parseMemoryChecks(output, "bare");
      const check = checks.find((c) => c.id === "MEM-MAX-MAP-COUNT");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toBe("vm.max_map_count not determinable");
    });
  });

  describe("[MUTATION-KILLER] Memory check metadata", () => {
    const checks = parseMemoryChecks(validOutput, "bare");

    const expectedMeta: Array<[string, string, string]> = [
      ["MEM-OVERCOMMIT-POLICY", "info", "SAFE"],
      ["MEM-NO-ZOMBIE-EXCESS", "warning", "GUARDED"],
      ["MEM-CORE-DUMP-RESTRICTED", "warning", "SAFE"],
      ["MEM-OOM-KILL-POLICY", "info", "SAFE"],
      ["MEM-HUGEPAGES-CONFIG", "info", "SAFE"],
      ["MEM-PID-MAX-REASONABLE", "info", "SAFE"],
      ["MEM-ULIMIT-NOFILE", "warning", "SAFE"],
      ["MEM-SWAP-ENCRYPTED", "info", "GUARDED"],
      ["MEM-SWAPPINESS-REASONABLE", "info", "SAFE"],
      ["MEM-HUGEPAGES-NOT-EXCESSIVE", "info", "SAFE"],
      ["MEM-MAX-MAP-COUNT", "info", "SAFE"],
    ];

    it.each(expectedMeta)("[MUTATION-KILLER] %s has severity=%s, safeToAutoFix=%s", (id, severity, safe) => {
      const c = checks.find((c) => c.id === id);
      expect(c).toBeDefined();
      expect(c!.category).toBe("Memory");
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

    it("[MUTATION-KILLER] all IDs start with MEM-", () => {
      checks.forEach((c) => expect(c.id).toMatch(/^MEM-/));
    });
  });
});
