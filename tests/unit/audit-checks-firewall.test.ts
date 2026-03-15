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
    // nft output
    "table inet filter {",
    "  chain input {",
    "    type filter hook input priority 0; policy drop;",
    "  }",
    "}",
    // iptables INPUT chain with DROP policy
    "Chain INPUT (policy DROP 0 packets, 0 bytes)",
    "num  target     prot opt source               destination",
    "1    ACCEPT     all  --  0.0.0.0/0            0.0.0.0/0            state RELATED,ESTABLISHED",
    "2    ACCEPT     tcp  --  0.0.0.0/0            0.0.0.0/0            tcp dpt:22",
    "Chain OUTPUT (policy ACCEPT 0 packets, 0 bytes)",
    // iptables rule count line
    "15",
    // fail2ban status
    "Status",
    "|- Number of jail: 2",
    "|  `- Jail list: sshd, apache",
    "|- Number of peers: 0",
    // rate limiting
    "ACCEPT     tcp  --  0.0.0.0/0  0.0.0.0/0  limit: avg 3/min burst 3",
  ].join("\n");

  const inactiveOutput = "Status: inactive";

  it("should return 12 checks for active firewall with deny default", () => {
    const checks = parseFirewallChecks(activeSecureOutput, "bare");
    expect(checks).toHaveLength(12);
    checks.forEach((check) => {
      expect(check.category).toBe("Firewall");
      expect(check.id).toMatch(/^FW-[A-Z][A-Z0-9]*(-[A-Z][A-Z0-9]*)+$/);
    });
  });

  it("should return FW-UFW-ACTIVE and FW-DEFAULT-DENY passed for active deny-incoming firewall", () => {
    const checks = parseFirewallChecks(activeSecureOutput, "bare");
    const fw01 = checks.find((c) => c.id === "FW-UFW-ACTIVE");
    const fw02 = checks.find((c) => c.id === "FW-DEFAULT-DENY");
    expect(fw01!.passed).toBe(true);
    expect(fw02!.passed).toBe(true);
  });

  it("should return FW-UFW-ACTIVE failed when firewall is inactive", () => {
    const checks = parseFirewallChecks(inactiveOutput, "bare");
    const fw01 = checks.find((c) => c.id === "FW-UFW-ACTIVE");
    expect(fw01!.passed).toBe(false);
    expect(fw01!.severity).toBe("critical");
  });

  it("should return FW-SSH-ALLOWED passed when SSH port is in rules", () => {
    const checks = parseFirewallChecks(activeSecureOutput, "bare");
    const fw03 = checks.find((c) => c.id === "FW-SSH-ALLOWED");
    expect(fw03!.passed).toBe(true);
  });

  it("should return FW-NO-WIDE-OPEN passed when no wide-open 0.0.0.0/0 on non-SSH ports", () => {
    const checks = parseFirewallChecks(activeSecureOutput, "bare");
    const fw04 = checks.find((c) => c.id === "FW-NO-WIDE-OPEN");
    expect(fw04!.passed).toBe(true);
  });

  it("should return FW-NO-WIDE-OPEN failed when 0.0.0.0/0 rule on non-SSH port exists", () => {
    const wideOpen = [
      "Status: active",
      "Default: deny (incoming), allow (outgoing), disabled (routed)",
      "To                         Action      From",
      "--                         ------      ----",
      "3306/tcp                   ALLOW IN    0.0.0.0/0",
    ].join("\n");
    const checks = parseFirewallChecks(wideOpen, "bare");
    const fw04 = checks.find((c) => c.id === "FW-NO-WIDE-OPEN");
    expect(fw04!.passed).toBe(false);
  });

  it("should return FW-INPUT-CHAIN-DENY passed when iptables INPUT policy is DROP", () => {
    const checks = parseFirewallChecks(activeSecureOutput, "bare");
    const fw09 = checks.find((c) => c.id === "FW-INPUT-CHAIN-DENY");
    expect(fw09!.passed).toBe(true);
    expect(fw09!.severity).toBe("critical");
  });

  it("should return FW-INPUT-CHAIN-DENY failed when iptables INPUT policy is ACCEPT", () => {
    const acceptPolicy = [
      "Status: active",
      "Chain INPUT (policy ACCEPT 0 packets, 0 bytes)",
    ].join("\n");
    const checks = parseFirewallChecks(acceptPolicy, "bare");
    const fw09 = checks.find((c) => c.id === "FW-INPUT-CHAIN-DENY");
    expect(fw09!.passed).toBe(false);
  });

  it("should return FW-FAIL2BAN-ACTIVE passed when fail2ban reports jails", () => {
    const checks = parseFirewallChecks(activeSecureOutput, "bare");
    const fw07 = checks.find((c) => c.id === "FW-FAIL2BAN-ACTIVE");
    expect(fw07!.passed).toBe(true);
    expect(fw07!.severity).toBe("warning");
  });

  it("should return FW-RATE-LIMIT passed when rate limiting rules present", () => {
    const checks = parseFirewallChecks(activeSecureOutput, "bare");
    const fw12 = checks.find((c) => c.id === "FW-RATE-LIMIT");
    expect(fw12!.passed).toBe(true);
  });

  it("should handle N/A output gracefully", () => {
    const checks = parseFirewallChecks("N/A", "bare");
    expect(checks).toHaveLength(12);
    const fw01 = checks.find((c) => c.id === "FW-UFW-ACTIVE");
    expect(fw01!.passed).toBe(false);
  });
});
