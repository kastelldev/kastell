import { parseNetworkChecks } from "../../src/core/audit/checks/network.js";

describe("parseNetworkChecks", () => {
  const secureOutput = [
    // ss -tlnp output (listening ports)
    [
      "State   Recv-Q  Send-Q  Local Address:Port  Peer Address:Port  Process",
      "LISTEN  0       128     0.0.0.0:22           0.0.0.0:*          users:((\"sshd\",pid=1234))",
      "LISTEN  0       128     0.0.0.0:80           0.0.0.0:*          users:((\"nginx\",pid=5678))",
      "LISTEN  0       128     0.0.0.0:443          0.0.0.0:*          users:((\"nginx\",pid=5678))",
    ].join("\n"),
    // ss -ulnp output (UDP)
    "State   Recv-Q  Send-Q  Local Address:Port  Peer Address:Port  Process",
    // IP forwarding
    "net.ipv4.ip_forward = 0",
    // DNS resolver
    "nameserver 1.1.1.1",
    // NTP
    "NTP synchronized: yes",
    // hosts.allow content
    "sshd: ALL",
    // hosts.deny content
    "ALL : ALL",
    // Additional sysctl values
    "net.ipv6.conf.all.disable_ipv6 = 1",
    "net.ipv4.conf.all.send_redirects = 0",
    "net.ipv4.conf.all.secure_redirects = 0",
    "net.ipv6.conf.all.accept_source_route = 0",
    "net.ipv4.conf.all.rp_filter = 1",
    "net.ipv4.tcp_syn_retries = 3",
    "net.ipv4.conf.all.log_martians = 1",
    // No exposed mgmt ports
    "NONE",
    // No mail ports open (NET-NO-MAIL-PORTS) — NONE means no mail ports
    "NONE",
    // No promiscuous interfaces (NET-NO-PROMISCUOUS-INTERFACES) — empty output
    "NONE",
  ].join("\n");

  const insecureOutput = [
    // Many unnecessary ports open
    [
      "State   Recv-Q  Send-Q  Local Address:Port  Peer Address:Port  Process",
      "LISTEN  0       128     0.0.0.0:22           0.0.0.0:*          users:((\"sshd\"))",
      "LISTEN  0       128     0.0.0.0:3306         0.0.0.0:*          users:((\"mysql\"))",
      "LISTEN  0       128     0.0.0.0:6379         0.0.0.0:*          users:((\"redis\"))",
      "LISTEN  0       128     0.0.0.0:27017        0.0.0.0:*          users:((\"mongod\"))",
    ].join("\n"),
    "N/A",
    "net.ipv4.ip_forward = 1",
    "nameserver 1.1.1.1",
    "NO_HOSTS_ALLOW",
    "NO_HOSTS_DENY",
    "net.ipv4.conf.all.send_redirects = 1",
    "net.ipv4.conf.all.secure_redirects = 1",
  ].join("\n");

  it("should return 18 checks", () => {
    const checks = parseNetworkChecks(secureOutput, "bare");
    expect(checks).toHaveLength(18);
    checks.forEach((check) => {
      expect(check.category).toBe("Network");
      expect(check.id).toMatch(/^NET-[A-Z][A-Z0-9]*(-[A-Z][A-Z0-9]*)+$/);
    });
  });

  it("should return NET-NO-DANGEROUS-PORTS passed for reasonable listening ports", () => {
    const checks = parseNetworkChecks(secureOutput, "bare");
    const net01 = checks.find((c) => c.id === "NET-NO-DANGEROUS-PORTS");
    expect(net01!.passed).toBe(true);
  });

  it("should return NET-NO-DANGEROUS-PORTS failed for database ports exposed", () => {
    const checks = parseNetworkChecks(insecureOutput, "bare");
    const net01 = checks.find((c) => c.id === "NET-NO-DANGEROUS-PORTS");
    expect(net01!.passed).toBe(false);
    expect(net01!.severity).toBe("warning");
  });

  it("should return NET-IP-FORWARDING passed when IP forwarding is disabled", () => {
    const checks = parseNetworkChecks(secureOutput, "bare");
    const net04 = checks.find((c) => c.id === "NET-IP-FORWARDING");
    expect(net04!.passed).toBe(true);
  });

  it("should return NET-IP-FORWARDING failed when IP forwarding is enabled on bare", () => {
    const checks = parseNetworkChecks(insecureOutput, "bare");
    const net04 = checks.find((c) => c.id === "NET-IP-FORWARDING");
    expect(net04!.passed).toBe(false);
  });

  it("should allow IP forwarding on docker platforms", () => {
    const checks = parseNetworkChecks(insecureOutput, "coolify");
    const net04 = checks.find((c) => c.id === "NET-IP-FORWARDING");
    expect(net04!.passed).toBe(true);
  });

  it("should return NET-SYN-COOKIES passed when tcp_syncookies=1", () => {
    const outputWithSyncookies = secureOutput + "\nnet.ipv4.tcp_syncookies = 1";
    const checks = parseNetworkChecks(outputWithSyncookies, "bare");
    const net05 = checks.find((c) => c.id === "NET-SYN-COOKIES");
    expect(net05!.passed).toBe(true);
  });

  it("should return NET-HOSTS-DENY passed when ALL:ALL present, failed when NO_HOSTS_DENY", () => {
    const passChecks = parseNetworkChecks("ALL : ALL", "bare");
    const pass = passChecks.find((c) => c.id === "NET-HOSTS-DENY");
    expect(pass!.passed).toBe(true);

    const failChecks = parseNetworkChecks("NO_HOSTS_DENY", "bare");
    const fail = failChecks.find((c) => c.id === "NET-HOSTS-DENY");
    expect(fail!.passed).toBe(false);
  });

  it("should return NET-NO-EXPOSED-MGMT-PORTS passed with NONE, failed with port listing", () => {
    const passChecks = parseNetworkChecks("NONE", "bare");
    const pass = passChecks.find((c) => c.id === "NET-NO-EXPOSED-MGMT-PORTS");
    expect(pass!.passed).toBe(true);

    const failChecks = parseNetworkChecks("LISTEN 0.0.0.0:8080", "bare");
    const fail = failChecks.find((c) => c.id === "NET-NO-EXPOSED-MGMT-PORTS");
    expect(fail).toBeDefined();
  });

  it("NET-NO-MAIL-PORTS passes when NONE (no mail ports open)", () => {
    const checks = parseNetworkChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "NET-NO-MAIL-PORTS");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("NET-NO-PROMISCUOUS-INTERFACES passes when no PROMISC interfaces", () => {
    const checks = parseNetworkChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "NET-NO-PROMISCUOUS-INTERFACES");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("should handle N/A output gracefully", () => {
    const checks = parseNetworkChecks("N/A", "bare");
    expect(checks).toHaveLength(18);
  });
});
