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
    });

    it("fails when Seccomp value is 0", () => {
      const checks = parseMACChecks(emptyOutput, "bare");
      const check = checks.find((c) => c.id === "MAC-SECCOMP-STRICT");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });
});
