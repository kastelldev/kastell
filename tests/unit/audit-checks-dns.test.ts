import { parseDnsChecks } from "../../src/core/audit/checks/dns.js";

describe("parseDnsChecks", () => {
  const validOutput = [
    "DNSSEC_ENABLED",
    "DOH_DOT_TOOL_INSTALLED:stubby",
    "RESOLV_CONF_IMMUTABLE",
    "NAMESERVER_CONFIGURED:8.8.8.8",
  ].join("\n");

  const badOutput = [
    "DNSSEC_DISABLED",
    "DOH_DOT_TOOL_NOT_INSTALLED",
    "RESOLV_CONF_MUTABLE",
    "NAMESERVER_NOT_CONFIGURED",
  ].join("\n");

  describe("N/A handling", () => {
    it("returns checks with passed=false and currentValue='Unable to determine' for N/A input", () => {
      const checks = parseDnsChecks("N/A", "bare");
      checks.forEach((c) => {
        expect(c.passed).toBe(false);
        expect(c.currentValue).toBe("Unable to determine");
      });
    });

    it("returns checks with passed=false for empty string input", () => {
      const checks = parseDnsChecks("", "bare");
      checks.forEach((c) => {
        expect(c.passed).toBe(false);
      });
    });
  });

  describe("check count and shape", () => {
    it("returns at least 4 checks", () => {
      const checks = parseDnsChecks(validOutput, "bare");
      expect(checks.length).toBeGreaterThanOrEqual(4);
    });

    it("all check IDs start with DNS-", () => {
      const checks = parseDnsChecks("", "bare");
      checks.forEach((c) => expect(c.id).toMatch(/^DNS-/));
    });

    it("all checks have explain.length > 20", () => {
      const checks = parseDnsChecks("", "bare");
      checks.forEach((c) => expect((c.explain ?? "").length).toBeGreaterThan(20));
    });

    it("all checks have fixCommand defined", () => {
      const checks = parseDnsChecks("", "bare");
      checks.forEach((c) => expect(c.fixCommand).toBeDefined());
    });

    it("category is 'DNS Security' on all checks", () => {
      const checks = parseDnsChecks(validOutput, "bare");
      checks.forEach((c) => expect(c.category).toBe("DNS Security"));
    });
  });

  describe("severity budget", () => {
    it("has at most 40% critical severity checks", () => {
      const checks = parseDnsChecks(validOutput, "bare");
      const criticalCount = checks.filter((c) => c.severity === "critical").length;
      expect(criticalCount / checks.length).toBeLessThanOrEqual(0.4);
    });
  });

  describe("DNS-DNSSEC-ENABLED", () => {
    it("passes when DNSSEC_ENABLED is present", () => {
      const checks = parseDnsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "DNS-DNSSEC-ENABLED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when DNSSEC_DISABLED is present", () => {
      const checks = parseDnsChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "DNS-DNSSEC-ENABLED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("DNS-DOH-DOT-AVAILABLE", () => {
    it("passes when a DoH/DoT tool is installed", () => {
      const checks = parseDnsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "DNS-DOH-DOT-AVAILABLE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when no DoH/DoT tool is installed", () => {
      const checks = parseDnsChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "DNS-DOH-DOT-AVAILABLE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });

    it("includes the tool name in currentValue when installed", () => {
      const checks = parseDnsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "DNS-DOH-DOT-AVAILABLE");
      expect(check).toBeDefined();
      expect(check!.currentValue).toContain("stubby");
    });
  });

  describe("DNS-RESOLV-IMMUTABLE", () => {
    it("passes when /etc/resolv.conf is immutable or systemd symlink", () => {
      const checks = parseDnsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "DNS-RESOLV-IMMUTABLE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when /etc/resolv.conf is mutable", () => {
      const checks = parseDnsChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "DNS-RESOLV-IMMUTABLE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("DNS-NAMESERVER-CONFIGURED", () => {
    it("passes when a nameserver is configured", () => {
      const checks = parseDnsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "DNS-NAMESERVER-CONFIGURED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when no nameserver is configured", () => {
      const checks = parseDnsChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "DNS-NAMESERVER-CONFIGURED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });

    it("includes the nameserver address in currentValue when configured", () => {
      const checks = parseDnsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "DNS-NAMESERVER-CONFIGURED");
      expect(check).toBeDefined();
      expect(check!.currentValue).toContain("8.8.8.8");
    });
  });
});
