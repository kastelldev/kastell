import { CHECK_IDS } from "../../src/core/audit/checkIds.js";
import { parseDnsChecks } from "../../src/core/audit/checks/dns.js";

describe("parseDnsChecks", () => {
  const validOutput = [
    "DNSSEC_ENABLED",
    "DOH_DOT_TOOL_INSTALLED:stubby",
    "RESOLV_CONF_IMMUTABLE",
    "NAMESERVER_CONFIGURED:8.8.8.8",
    "2",
    "nameserver 8.8.8.8\nnameserver 8.8.4.4",
    "active",
    "search example.com",
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
    it("returns at least 8 checks", () => {
      const checks = parseDnsChecks(validOutput, "bare");
      expect(checks.length).toBeGreaterThanOrEqual(8);
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

  describe("DNS-MULTIPLE-NAMESERVERS", () => {
    it("passes when count is 2 or more", () => {
      const checks = parseDnsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "DNS-MULTIPLE-NAMESERVERS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when no digits found in output (cannot determine nameserver count)", () => {
      // Use badOutput which has no numeric counts in it
      const output = "DNSSEC_DISABLED\nDOH_DOT_TOOL_NOT_INSTALLED\nRESOLV_CONF_MUTABLE\nNAMESERVER_NOT_CONFIGURED";
      const checks = parseDnsChecks(output, "bare");
      const check = checks.find((c) => c.id === "DNS-MULTIPLE-NAMESERVERS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("DNS-RESOLV-NOT-LOCALHOST-ONLY", () => {
    it("passes when nameserver lines include external IP", () => {
      const checks = parseDnsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "DNS-RESOLV-NOT-LOCALHOST-ONLY");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("passes when systemd-resolved (127.0.0.53) is the nameserver", () => {
      const output = validOutput.replace("nameserver 8.8.8.8\nnameserver 8.8.4.4", "nameserver 127.0.0.53");
      const checks = parseDnsChecks(output, "bare");
      const check = checks.find((c) => c.id === "DNS-RESOLV-NOT-LOCALHOST-ONLY");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });
  });

  describe("DNS-LOCAL-RESOLVER-ACTIVE", () => {
    it("passes when systemd-resolved is active", () => {
      const checks = parseDnsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "DNS-LOCAL-RESOLVER-ACTIVE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when systemd-resolved is inactive", () => {
      const inactiveOutput = validOutput.replace("active", "inactive");
      const checks = parseDnsChecks(inactiveOutput, "bare");
      const check = checks.find((c) => c.id === "DNS-LOCAL-RESOLVER-ACTIVE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("DNS-SEARCH-DOMAIN-SET", () => {
    it("passes when search domain is configured", () => {
      const checks = parseDnsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "DNS-SEARCH-DOMAIN-SET");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when NONE sentinel is present", () => {
      const checks = parseDnsChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "DNS-SEARCH-DOMAIN-SET");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });

    it("fails when no search line exists", () => {
      const output = "nameserver 8.8.8.8\nsome other stuff";
      const checks = parseDnsChecks(output, "bare");
      const check = checks.find((c) => c.id === "DNS-SEARCH-DOMAIN-SET");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("DNS-DNSSEC-ENABLED — fallthrough branch", () => {
    it("fails with indeterminate message when neither ENABLED nor DISABLED present", () => {
      const output = "some random output without dnssec markers";
      const checks = parseDnsChecks(output, "bare");
      const check = checks.find((c) => c.id === "DNS-DNSSEC-ENABLED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("could not be determined");
    });
  });

  describe("DNS-DOH-DOT-AVAILABLE — fallthrough branch", () => {
    it("fails with indeterminate message when neither installed nor not_installed", () => {
      const output = "some random output";
      const checks = parseDnsChecks(output, "bare");
      const check = checks.find((c) => c.id === "DNS-DOH-DOT-AVAILABLE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("could not be determined");
    });
  });

  describe("DNS-RESOLV-IMMUTABLE — fallthrough branch", () => {
    it("fails with indeterminate message when neither immutable nor mutable", () => {
      const output = "some random output";
      const checks = parseDnsChecks(output, "bare");
      const check = checks.find((c) => c.id === "DNS-RESOLV-IMMUTABLE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("could not be determined");
    });
  });

  describe("DNS-NAMESERVER-CONFIGURED — fallthrough branch", () => {
    it("fails with indeterminate message when neither configured nor not_configured", () => {
      const output = "some random output";
      const checks = parseDnsChecks(output, "bare");
      const check = checks.find((c) => c.id === "DNS-NAMESERVER-CONFIGURED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("could not be determined");
    });
  });

  describe("DNS-MULTIPLE-NAMESERVERS — single nameserver branch", () => {
    it("fails when only 1 nameserver is configured", () => {
      const output = "1";
      const checks = parseDnsChecks(output, "bare");
      const check = checks.find((c) => c.id === "DNS-MULTIPLE-NAMESERVERS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("single point of failure");
    });
  });

  describe("DNS-RESOLV-NOT-LOCALHOST-ONLY — localhost only branch", () => {
    it("fails when only raw localhost nameservers are present (no managed resolver)", () => {
      const output = "nameserver 127.0.0.1\nnameserver ::1";
      const checks = parseDnsChecks(output, "bare");
      const check = checks.find((c) => c.id === "DNS-RESOLV-NOT-LOCALHOST-ONLY");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("raw localhost");
    });

    it("fails when no nameserver entries found", () => {
      const output = "some output without nameserver lines";
      const checks = parseDnsChecks(output, "bare");
      const check = checks.find((c) => c.id === "DNS-RESOLV-NOT-LOCALHOST-ONLY");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("No nameserver entries");
    });
  });

  describe("DNS-LOCAL-RESOLVER-ACTIVE — inactive fallthrough", () => {
    it("fails when output does not contain 'active' as standalone word", () => {
      const output = "some output without active keyword";
      const checks = parseDnsChecks(output, "bare");
      const check = checks.find((c) => c.id === "DNS-LOCAL-RESOLVER-ACTIVE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.currentValue).toContain("inactive");
    });
  });

  describe("[MUTATION-KILLER] DNS check metadata", () => {
    const checks = parseDnsChecks(validOutput, "bare");

    const expectedMeta: Array<[string, string, string]> = [
      ["DNS-DNSSEC-ENABLED", "warning", "GUARDED"],
      ["DNS-DOH-DOT-AVAILABLE", "info", "SAFE"],
      ["DNS-RESOLV-IMMUTABLE", "warning", "GUARDED"],
      ["DNS-NAMESERVER-CONFIGURED", "warning", "SAFE"],
      ["DNS-MULTIPLE-NAMESERVERS", "info", "SAFE"],
      ["DNS-RESOLV-NOT-LOCALHOST-ONLY", "info", "SAFE"],
      ["DNS-LOCAL-RESOLVER-ACTIVE", "info", "GUARDED"],
      ["DNS-SEARCH-DOMAIN-SET", "info", "SAFE"],
    ];

    it.each(expectedMeta)("[MUTATION-KILLER] %s has severity=%s, safeToAutoFix=%s", (id, severity, safe) => {
      const c = checks.find((c) => c.id === id);
      expect(c).toBeDefined();
      expect(c!.category).toBe("DNS Security");
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

    it("[MUTATION-KILLER] all IDs start with DNS-", () => {
      checks.forEach((c) => expect(c.id).toMatch(/^DNS-/));
    });
  });
});
