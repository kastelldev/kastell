import { parseFirewallChecks } from "../../src/core/audit/checks/firewall.js";

describe("parseFirewallChecks", () => {
  const activeSecureOutput = [
    "Status: active",
    "Logging: on (low)",
    "Default: deny (incoming), allow (outgoing), disabled (routed)",
    "",
    "To                         Action      From",
    "--                         ------      ----",
    "22/tcp                     ALLOW IN    Anywhere",
    "80/tcp                     ALLOW IN    Anywhere",
    "443/tcp                    ALLOW IN    Anywhere",
  ].join("\n");

  const inactiveOutput = "Status: inactive";

  it("should return 5 checks for active firewall with deny default", () => {
    const checks = parseFirewallChecks(activeSecureOutput, "bare");
    expect(checks).toHaveLength(5);
    checks.forEach((check) => {
      expect(check.category).toBe("Firewall");
      expect(check.id).toMatch(/^FW-0[1-5]$/);
    });
  });

  it("should return FW-01 and FW-02 passed for active deny-incoming firewall", () => {
    const checks = parseFirewallChecks(activeSecureOutput, "bare");
    const fw01 = checks.find((c) => c.id === "FW-01");
    const fw02 = checks.find((c) => c.id === "FW-02");
    expect(fw01!.passed).toBe(true);
    expect(fw02!.passed).toBe(true);
  });

  it("should return FW-01 failed when firewall is inactive", () => {
    const checks = parseFirewallChecks(inactiveOutput, "bare");
    const fw01 = checks.find((c) => c.id === "FW-01");
    expect(fw01!.passed).toBe(false);
    expect(fw01!.severity).toBe("critical");
  });

  it("should return FW-03 passed when SSH port is in rules", () => {
    const checks = parseFirewallChecks(activeSecureOutput, "bare");
    const fw03 = checks.find((c) => c.id === "FW-03");
    expect(fw03!.passed).toBe(true);
  });

  it("should return FW-04 passed when no wide-open 0.0.0.0/0 on non-SSH ports", () => {
    const checks = parseFirewallChecks(activeSecureOutput, "bare");
    const fw04 = checks.find((c) => c.id === "FW-04");
    expect(fw04!.passed).toBe(true);
  });

  it("should return FW-04 failed when 0.0.0.0/0 rule on non-SSH port exists", () => {
    const wideOpen = [
      "Status: active",
      "Default: deny (incoming), allow (outgoing), disabled (routed)",
      "To                         Action      From",
      "--                         ------      ----",
      "3306/tcp                   ALLOW IN    0.0.0.0/0",
    ].join("\n");
    const checks = parseFirewallChecks(wideOpen, "bare");
    const fw04 = checks.find((c) => c.id === "FW-04");
    expect(fw04!.passed).toBe(false);
  });

  it("should handle N/A output gracefully", () => {
    const checks = parseFirewallChecks("N/A", "bare");
    expect(checks).toHaveLength(5);
    const fw01 = checks.find((c) => c.id === "FW-01");
    expect(fw01!.passed).toBe(false);
  });
});
