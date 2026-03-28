import { parseMACChecks } from "../../src/core/audit/checks/mac.js";

describe("parseMACChecks", () => {
  const appArmorOutput = [
    "apparmor",
    "apparmor module is loaded.\n33 profiles are loaded.\n33 profiles are in enforce mode.\n1 profiles are in complain mode.\n0 processes have profiles defined.",
    "active",
    "NOT_INSTALLED",
    "N/A",
    "Seccomp:\t2",
    // aa-status | grep -c 'enforce mode' — standalone count for MAC-APPARMOR-ENFORCE-COUNT
    "33",
  ].join("\n");

  const selinuxOutput = [
    "selinux",
    "N/A",
    "inactive",
    "Enforcing",
    "SELINUX=enforcing",
    "Seccomp:\t2",
  ].join("\n");

  const emptyOutput = [
    "",
    "",
    "inactive",
    "Disabled",
    "N/A",
    "Seccomp:\t0",
  ].join("\n");

  describe("N/A handling", () => {
    it("returns checks with passed=false and currentValue='Unable to determine' for N/A input", () => {
      const checks = parseMACChecks("N/A", "bare");
      checks.forEach((c) => {
        expect(c.passed).toBe(false);
        expect(c.currentValue).toBe("Unable to determine");
      });
    });

    it("returns checks with passed=false for empty string input", () => {
      const checks = parseMACChecks("", "bare");
      checks.forEach((c) => {
        expect(c.passed).toBe(false);
      });
    });
  });

  describe("check count and shape", () => {
    it("returns 10 checks", () => {
      const checks = parseMACChecks(appArmorOutput, "bare");
      expect(checks).toHaveLength(10);
    });

    it("all check IDs start with MAC-", () => {
      const checks = parseMACChecks("", "bare");
      checks.forEach((c) => expect(c.id).toMatch(/^MAC-/));
    });

    it("all checks have explain.length > 20", () => {
      const checks = parseMACChecks("", "bare");
      checks.forEach((c) => expect((c.explain ?? "").length).toBeGreaterThan(20));
    });

    it("all checks have fixCommand defined", () => {
      const checks = parseMACChecks("", "bare");
      checks.forEach((c) => expect(c.fixCommand).toBeDefined());
    });

    it("category is 'MAC' on all checks", () => {
      const checks = parseMACChecks(appArmorOutput, "bare");
      checks.forEach((c) => expect(c.category).toBe("MAC"));
    });
  });

  describe("severity budget", () => {
    it("has 0% critical severity (no critical checks)", () => {
      const checks = parseMACChecks(appArmorOutput, "bare");
      const criticalCount = checks.filter((c) => c.severity === "critical").length;
      expect(criticalCount).toBe(0);
    });
  });

  describe("MAC-LSM-ACTIVE", () => {
    it("passes when lsm contains 'apparmor'", () => {
      const checks = parseMACChecks(appArmorOutput, "bare");
      const check = checks.find((c) => c.id === "MAC-LSM-ACTIVE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("passes when lsm contains 'selinux'", () => {
      const checks = parseMACChecks(selinuxOutput, "bare");
      const check = checks.find((c) => c.id === "MAC-LSM-ACTIVE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when lsm has neither apparmor nor selinux", () => {
      const output = ["lockdown", "N/A", "inactive", "NOT_INSTALLED", "N/A", "Seccomp:\t0"].join("\n");
      const checks = parseMACChecks(output, "bare");
      const check = checks.find((c) => c.id === "MAC-LSM-ACTIVE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("MAC-APPARMOR-ACTIVE", () => {
    it("passes when systemctl is-active apparmor returns 'active'", () => {
      const checks = parseMACChecks(appArmorOutput, "bare");
      const check = checks.find((c) => c.id === "MAC-APPARMOR-ACTIVE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when apparmor is inactive", () => {
      const output = ["apparmor", "N/A", "inactive", "NOT_INSTALLED", "N/A", "Seccomp:\t0"].join("\n");
      const checks = parseMACChecks(output, "bare");
      const check = checks.find((c) => c.id === "MAC-APPARMOR-ACTIVE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("MAC-APPARMOR-PROFILES", () => {
    it("passes when enforce mode profiles > 0", () => {
      const checks = parseMACChecks(appArmorOutput, "bare");
      const check = checks.find((c) => c.id === "MAC-APPARMOR-PROFILES");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when no enforce mode profiles", () => {
      const output = [
        "apparmor",
        "0 profiles are in enforce mode.",
        "active",
        "NOT_INSTALLED",
        "N/A",
        "Seccomp:\t2",
      ].join("\n");
      const checks = parseMACChecks(output, "bare");
      const check = checks.find((c) => c.id === "MAC-APPARMOR-PROFILES");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("MAC-SELINUX-ENFORCING", () => {
    it("passes when getenforce returns NOT_INSTALLED (AppArmor system)", () => {
      const checks = parseMACChecks(appArmorOutput, "bare");
      const check = checks.find((c) => c.id === "MAC-SELINUX-ENFORCING");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toContain("AppArmor system");
    });

    it("passes when getenforce returns 'Enforcing'", () => {
      const checks = parseMACChecks(selinuxOutput, "bare");
      const check = checks.find((c) => c.id === "MAC-SELINUX-ENFORCING");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when getenforce returns 'Permissive'", () => {
      const output = [
        "selinux",
        "N/A",
        "inactive",
        "Permissive",
        "SELINUX=permissive",
        "Seccomp:\t2",
      ].join("\n");
      const checks = parseMACChecks(output, "bare");
      const check = checks.find((c) => c.id === "MAC-SELINUX-ENFORCING");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });

    it("fails when getenforce returns 'Disabled'", () => {
      const checks = parseMACChecks(emptyOutput, "bare");
      const check = checks.find((c) => c.id === "MAC-SELINUX-ENFORCING");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("MAC-SELINUX-CONFIG", () => {
    it("passes when /etc/selinux/config is not present (N/A)", () => {
      const checks = parseMACChecks(appArmorOutput, "bare");
      const check = checks.find((c) => c.id === "MAC-SELINUX-CONFIG");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("passes when SELINUX=enforcing in config", () => {
      const checks = parseMACChecks(selinuxOutput, "bare");
      const check = checks.find((c) => c.id === "MAC-SELINUX-CONFIG");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when SELINUX=permissive in config", () => {
      const output = [
        "selinux",
        "N/A",
        "inactive",
        "Permissive",
        "SELINUX=permissive",
        "Seccomp:\t2",
      ].join("\n");
      const checks = parseMACChecks(output, "bare");
      const check = checks.find((c) => c.id === "MAC-SELINUX-CONFIG");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("MAC-SECCOMP-ENABLED", () => {
    it("passes when Seccomp field > 0", () => {
      const checks = parseMACChecks(appArmorOutput, "bare");
      const check = checks.find((c) => c.id === "MAC-SECCOMP-ENABLED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when Seccomp is 0", () => {
      const checks = parseMACChecks(emptyOutput, "bare");
      const check = checks.find((c) => c.id === "MAC-SECCOMP-ENABLED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("MAC-APPARMOR-ENFORCE-COUNT", () => {
    it("passes when enforce mode profile count > 0", () => {
      const checks = parseMACChecks(appArmorOutput, "bare");
      const check = checks.find((c) => c.id === "MAC-APPARMOR-ENFORCE-COUNT");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });
  });

  describe("MAC-SECCOMP-STRICT", () => {
    it("passes when Seccomp value is 2 (filter mode)", () => {
      const checks = parseMACChecks(appArmorOutput, "bare");
      const check = checks.find((c) => c.id === "MAC-SECCOMP-STRICT");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toContain("filter mode");
    });

    it("passes when Seccomp value is 1 (strict mode)", () => {
      const output = "Seccomp:\t1";
      const checks = parseMACChecks(output, "bare");
      const check = checks.find((c) => c.id === "MAC-SECCOMP-STRICT");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toContain("strict mode");
    });

    it("fails when Seccomp value is 0", () => {
      const checks = parseMACChecks(emptyOutput, "bare");
      const check = checks.find((c) => c.id === "MAC-SECCOMP-STRICT");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("disabled");
    });

    it("fails when Seccomp field is not found", () => {
      const output = "no seccomp info here";
      const checks = parseMACChecks(output, "bare");
      const check = checks.find((c) => c.id === "MAC-SECCOMP-STRICT");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("not found");
    });
  });

  describe("MAC-LSM-ACTIVE — SELinux active branch", () => {
    it("reports 'SELinux' when only selinux is present (not apparmor)", () => {
      const output = "selinux\nSome other info";
      const checks = parseMACChecks(output, "bare");
      const check = checks.find((c) => c.id === "MAC-LSM-ACTIVE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toContain("SELinux");
    });

    it("reports 'none' when neither apparmor nor selinux is present", () => {
      const output = "lockdown\nother stuff";
      const checks = parseMACChecks(output, "bare");
      const check = checks.find((c) => c.id === "MAC-LSM-ACTIVE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("No LSM");
    });
  });

  describe("MAC-APPARMOR-ACTIVE — profiles loaded branch", () => {
    it("passes when 'profiles are loaded' is present without 'active' keyword", () => {
      const output = "33 profiles are loaded. something else";
      const checks = parseMACChecks(output, "bare");
      const check = checks.find((c) => c.id === "MAC-APPARMOR-ACTIVE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });
  });

  describe("MAC-APPARMOR-PROFILES — zero enforce count branch", () => {
    it("fails when enforce mode profile count is explicitly 0", () => {
      const output = "0 profiles are in enforce mode.";
      const checks = parseMACChecks(output, "bare");
      const check = checks.find((c) => c.id === "MAC-APPARMOR-PROFILES");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("0 profiles");
    });

    it("fails when no enforce mode pattern is found", () => {
      const output = "some unrelated output";
      const checks = parseMACChecks(output, "bare");
      const check = checks.find((c) => c.id === "MAC-APPARMOR-PROFILES");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("No enforce mode");
    });
  });

  describe("MAC-APPARMOR-NO-UNCONFINED — high count branch", () => {
    it("fails when unconfined process count >= 50", () => {
      const output = "55 processes are unconfined";
      const checks = parseMACChecks(output, "bare");
      const check = checks.find((c) => c.id === "MAC-APPARMOR-NO-UNCONFINED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("55 unconfined processes (high)");
    });

    it("passes when unconfined process count < 50", () => {
      const output = "5 processes are unconfined";
      const checks = parseMACChecks(output, "bare");
      const check = checks.find((c) => c.id === "MAC-APPARMOR-NO-UNCONFINED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toContain("acceptable");
    });
  });

  describe("MAC-SELINUX-ENFORCING — unknown mode branch", () => {
    it("reports unknown mode when getenforce output is unrecognized", () => {
      const output = "some random text without enforcing or permissive or disabled";
      const checks = parseMACChecks(output, "bare");
      const check = checks.find((c) => c.id === "MAC-SELINUX-ENFORCING");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("unknown");
    });
  });

  describe("MAC-SELINUX-CONFIG — unknown mode branch", () => {
    it("reports unknown mode when SELINUX= present but value unrecognized", () => {
      const output = "SELINUX=something_weird";
      const checks = parseMACChecks(output, "bare");
      const check = checks.find((c) => c.id === "MAC-SELINUX-CONFIG");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("something_weird");
    });

    it("reports unknown when SELINUX= has no word characters after equals", () => {
      const output = "SELINUX= \nother text";
      const checks = parseMACChecks(output, "bare");
      const check = checks.find((c) => c.id === "MAC-SELINUX-CONFIG");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("unknown");
    });
  });

  describe("MAC-APPARMOR-ENFORCE-COUNT — edge cases", () => {
    it("returns null/false when no standalone number and no enforce mode match", () => {
      const output = "some text without numbers or enforce patterns";
      const checks = parseMACChecks(output, "bare");
      const check = checks.find((c) => c.id === "MAC-APPARMOR-ENFORCE-COUNT");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("not determinable");
    });

    it("skips standalone numbers >= 1000 and uses enforce mode pattern", () => {
      const output = "1500\n10 profiles are in enforce mode";
      const checks = parseMACChecks(output, "bare");
      const check = checks.find((c) => c.id === "MAC-APPARMOR-ENFORCE-COUNT");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toContain("10 profile(s)");
    });

    it("fails when enforce count is 0 from standalone number", () => {
      const output = "0";
      const checks = parseMACChecks(output, "bare");
      const check = checks.find((c) => c.id === "MAC-APPARMOR-ENFORCE-COUNT");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("0 profiles");
    });
  });

  describe("MAC-NO-UNCONFINED-PROCS — high count branch", () => {
    it("fails when unconfined process count >= 10", () => {
      const output = "15 processes are unconfined";
      const checks = parseMACChecks(output, "bare");
      const check = checks.find((c) => c.id === "MAC-NO-UNCONFINED-PROCS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("15 unconfined processes (high)");
    });

    it("passes when unconfined process count < 10", () => {
      const output = "3 processes are unconfined";
      const checks = parseMACChecks(output, "bare");
      const check = checks.find((c) => c.id === "MAC-NO-UNCONFINED-PROCS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toContain("acceptable");
    });

    it("passes with currentValue noting unavailability when no unconfined match", () => {
      const output = "some unrelated text";
      const checks = parseMACChecks(output, "bare");
      const check = checks.find((c) => c.id === "MAC-NO-UNCONFINED-PROCS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
      expect(check!.currentValue).toContain("not available");
    });
  });

  describe("MAC-SECCOMP-ENABLED — edge cases", () => {
    it("fails when Seccomp field is not found in output", () => {
      const output = "no seccomp info";
      const checks = parseMACChecks(output, "bare");
      const check = checks.find((c) => c.id === "MAC-SECCOMP-ENABLED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("not found");
    });
  });

  describe("[MUTATION-KILLER] MAC check metadata", () => {
    const checks = parseMACChecks(appArmorOutput, "bare");

    const expectedMeta: Array<[string, string, string]> = [
      ["MAC-LSM-ACTIVE", "warning", "SAFE"],
      ["MAC-APPARMOR-ACTIVE", "warning", "SAFE"],
      ["MAC-APPARMOR-PROFILES", "info", "SAFE"],
      ["MAC-APPARMOR-NO-UNCONFINED", "info", "SAFE"],
      ["MAC-SELINUX-ENFORCING", "warning", "SAFE"],
      ["MAC-SELINUX-CONFIG", "info", "SAFE"],
      ["MAC-SECCOMP-ENABLED", "info", "GUARDED"],
      ["MAC-APPARMOR-ENFORCE-COUNT", "warning", "SAFE"],
      ["MAC-NO-UNCONFINED-PROCS", "info", "SAFE"],
      ["MAC-SECCOMP-STRICT", "info", "GUARDED"],
    ];

    it.each(expectedMeta)("[MUTATION-KILLER] %s has severity=%s, safeToAutoFix=%s", (id, severity, safe) => {
      const c = checks.find((c) => c.id === id);
      expect(c).toBeDefined();
      expect(c!.category).toBe("MAC");
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

    it("[MUTATION-KILLER] all IDs start with MAC-", () => {
      checks.forEach((c) => expect(c.id).toMatch(/^MAC-/));
    });
  });
});
