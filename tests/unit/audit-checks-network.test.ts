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
    // NET-ARP-ANNOUNCE: arp_announce = 2
    "net.ipv4.conf.all.arp_announce = 2",
    // NET-ARP-IGNORE: arp_ignore = 1
    "net.ipv4.conf.all.arp_ignore = 1",
    // NET-BOGUS-ICMP-IGNORE: icmp_ignore_bogus_error_responses = 1
    "net.ipv4.icmp_ignore_bogus_error_responses = 1",
    // NET-TCP-WRAPPERS-CONFIGURED: hosts.allow has entry
    "sshd: 192.168.1.0/24",
    // NET-LISTENING-PORT-COUNT: 15 listening ports (<=20 = pass)
    "15",
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

  it("should return 21 checks", () => {
    const checks = parseNetworkChecks(secureOutput, "bare");
    expect(checks).toHaveLength(21);
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
    expect(checks).toHaveLength(21);
  });

  it("NET-ARP-ANNOUNCE passes when arp_announce = 2", () => {
    const checks = parseNetworkChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "NET-ARP-ANNOUNCE");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("warning");
    expect(check!.currentValue).toContain("2");
  });

  it("NET-ARP-ANNOUNCE fails when arp_announce = 0", () => {
    const checks = parseNetworkChecks("net.ipv4.conf.all.arp_announce = 0", "bare");
    const check = checks.find((c) => c.id === "NET-ARP-ANNOUNCE");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("NET-ARP-IGNORE passes when arp_ignore = 1", () => {
    const checks = parseNetworkChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "NET-ARP-IGNORE");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("warning");
  });

  it("NET-ARP-IGNORE fails when arp_ignore = 0", () => {
    const checks = parseNetworkChecks("net.ipv4.conf.all.arp_ignore = 0", "bare");
    const check = checks.find((c) => c.id === "NET-ARP-IGNORE");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("NET-TCP-WRAPPERS-CONFIGURED passes when hosts.allow has entry with colon", () => {
    const checks = parseNetworkChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "NET-TCP-WRAPPERS-CONFIGURED");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("info");
  });

  it("NET-TCP-WRAPPERS-CONFIGURED fails when hosts.allow is empty or missing", () => {
    const checks = parseNetworkChecks("NO_HOSTS_ALLOW", "bare");
    const check = checks.find((c) => c.id === "NET-TCP-WRAPPERS-CONFIGURED");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("NET-LISTENING-PORT-COUNT passes when count <= 20", () => {
    const checks = parseNetworkChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "NET-LISTENING-PORT-COUNT");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("info");
    expect(check!.currentValue).toContain("15");
  });

  it("NET-LISTENING-PORT-COUNT fails when count > 20", () => {
    const highPortOutput = [
      "State   Recv-Q  Send-Q  Local Address:Port  Peer Address:Port",
      "LISTEN  0       128     0.0.0.0:22           0.0.0.0:*",
      "N/A",
      "net.ipv4.ip_forward = 0",
      "nameserver 1.1.1.1",
      "NTP synchronized: yes",
      "sshd: ALL",
      "ALL : ALL",
      "net.ipv6.conf.all.disable_ipv6 = 1",
      "NONE",
      "NONE",
      "NONE",
      "net.ipv4.conf.all.arp_announce = 2",
      "net.ipv4.conf.all.arp_ignore = 1",
      "net.ipv4.icmp_ignore_bogus_error_responses = 1",
      "sshd: ALL",
      "35",
    ].join("\n");
    const checks = parseNetworkChecks(highPortOutput, "bare");
    const check = checks.find((c) => c.id === "NET-LISTENING-PORT-COUNT");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toContain("35");
  });

  // ──────────────────────────────────────────────────────────────
  // MUTATION-KILLER TESTS
  // ──────────────────────────────────────────────────────────────

  describe("ID array assertion — exact order from secure output", () => {
    it("should return all 21 check IDs in exact order", () => {
      const checks = parseNetworkChecks(secureOutput, "bare");
      const ids = checks.map((c) => c.id);
      expect(ids).toEqual([
        "NET-NO-DANGEROUS-PORTS",
        "NET-DNS-RESOLVER",
        "NET-TIME-SYNC",
        "NET-IP-FORWARDING",
        "NET-SYN-COOKIES",
        "NET-HOSTS-ACCESS",
        "NET-HOSTS-DENY",
        "NET-IPV6-DISABLED",
        "NET-ICMP-REDIRECT-SEND",
        "NET-ICMP-SECURE-REDIRECT",
        "NET-SOURCE-ROUTING-V6",
        "NET-MARTIAN-LOGGING",
        "NET-NO-EXPOSED-MGMT-PORTS",
        "NET-RP-FILTER",
        "NET-NO-MAIL-PORTS",
        "NET-LISTENING-SERVICES-AUDIT",
        "NET-NO-PROMISCUOUS-INTERFACES",
        "NET-ARP-ANNOUNCE",
        "NET-ARP-IGNORE",
        "NET-TCP-WRAPPERS-CONFIGURED",
        "NET-LISTENING-PORT-COUNT",
      ]);
    });
  });

  describe("N/A blanket assertion — all checks Unable to determine", () => {
    it("should set currentValue 'Unable to determine' and passed=false for ALL checks on N/A", () => {
      const checks = parseNetworkChecks("N/A", "bare");
      expect(checks).toHaveLength(21);
      for (const check of checks) {
        expect(check.passed).toBe(false);
        expect(check.currentValue).toBe("Unable to determine");
      }
    });

    it("should set currentValue 'Unable to determine' for empty string input", () => {
      const checks = parseNetworkChecks("", "bare");
      expect(checks).toHaveLength(21);
      for (const check of checks) {
        expect(check.passed).toBe(false);
        expect(check.currentValue).toBe("Unable to determine");
      }
    });

    it("should set currentValue 'Unable to determine' for whitespace-only input", () => {
      const checks = parseNetworkChecks("   \n  \n  ", "bare");
      expect(checks).toHaveLength(21);
      for (const check of checks) {
        expect(check.passed).toBe(false);
        expect(check.currentValue).toBe("Unable to determine");
      }
    });
  });

  describe("currentValue exact strings — sysctl values from secure output", () => {
    let checks: ReturnType<typeof parseNetworkChecks>;

    beforeAll(() => {
      // secureOutput already has syncookies missing, so add it explicitly
      const fullSecureOutput = secureOutput + "\nnet.ipv4.tcp_syncookies = 1";
      checks = parseNetworkChecks(fullSecureOutput, "bare");
    });

    it("NET-NO-DANGEROUS-PORTS currentValue states port count with no dangerous", () => {
      const c = checks.find((c) => c.id === "NET-NO-DANGEROUS-PORTS")!;
      expect(c.currentValue).toBe("3 port(s) listening, no dangerous ports exposed");
    });

    it("NET-DNS-RESOLVER currentValue is 'DNS resolver configured'", () => {
      const c = checks.find((c) => c.id === "NET-DNS-RESOLVER")!;
      expect(c.currentValue).toBe("DNS resolver configured");
    });

    it("NET-TIME-SYNC currentValue is 'NTP synchronized'", () => {
      const c = checks.find((c) => c.id === "NET-TIME-SYNC")!;
      expect(c.currentValue).toBe("NTP synchronized");
    });

    it("NET-IP-FORWARDING currentValue shows sysctl key=value", () => {
      const c = checks.find((c) => c.id === "NET-IP-FORWARDING")!;
      expect(c.currentValue).toBe("net.ipv4.ip_forward = 0");
    });

    it("NET-SYN-COOKIES currentValue shows sysctl key=value", () => {
      const c = checks.find((c) => c.id === "NET-SYN-COOKIES")!;
      expect(c.currentValue).toBe("net.ipv4.tcp_syncookies = 1");
    });

    it("NET-HOSTS-ACCESS currentValue is '/etc/hosts.allow exists'", () => {
      const c = checks.find((c) => c.id === "NET-HOSTS-ACCESS")!;
      expect(c.currentValue).toBe("/etc/hosts.allow exists");
    });

    it("NET-IPV6-DISABLED currentValue shows sysctl key=value", () => {
      const c = checks.find((c) => c.id === "NET-IPV6-DISABLED")!;
      expect(c.currentValue).toBe("net.ipv6.conf.all.disable_ipv6 = 1");
    });

    it("NET-ICMP-REDIRECT-SEND currentValue shows sysctl key=value", () => {
      const c = checks.find((c) => c.id === "NET-ICMP-REDIRECT-SEND")!;
      expect(c.currentValue).toBe("net.ipv4.conf.all.send_redirects = 0");
    });

    it("NET-ICMP-SECURE-REDIRECT currentValue shows sysctl key=value", () => {
      const c = checks.find((c) => c.id === "NET-ICMP-SECURE-REDIRECT")!;
      expect(c.currentValue).toBe("net.ipv4.conf.all.secure_redirects = 0");
    });

    it("NET-SOURCE-ROUTING-V6 currentValue shows sysctl key=value", () => {
      const c = checks.find((c) => c.id === "NET-SOURCE-ROUTING-V6")!;
      expect(c.currentValue).toBe("net.ipv6.conf.all.accept_source_route = 0");
    });

    it("NET-RP-FILTER currentValue shows sysctl key=value", () => {
      const c = checks.find((c) => c.id === "NET-RP-FILTER")!;
      expect(c.currentValue).toBe("net.ipv4.conf.all.rp_filter = 1");
    });

    it("NET-MARTIAN-LOGGING currentValue shows sysctl key=value", () => {
      const c = checks.find((c) => c.id === "NET-MARTIAN-LOGGING")!;
      expect(c.currentValue).toBe("net.ipv4.conf.all.log_martians = 1");
    });

    it("NET-ARP-ANNOUNCE currentValue shows sysctl key=value", () => {
      const c = checks.find((c) => c.id === "NET-ARP-ANNOUNCE")!;
      expect(c.currentValue).toBe("net.ipv4.conf.all.arp_announce = 2");
    });

    it("NET-ARP-IGNORE currentValue shows sysctl key=value", () => {
      const c = checks.find((c) => c.id === "NET-ARP-IGNORE")!;
      expect(c.currentValue).toBe("net.ipv4.conf.all.arp_ignore = 1");
    });
  });

  describe("Boundary tests — LISTENING_SERVICES_AUDIT threshold (<20)", () => {
    function makeListeningOutput(count: number): string {
      const lines: string[] = [];
      for (let i = 0; i < count; i++) {
        lines.push(`LISTEN  0  128  0.0.0.0:${8000 + i}  0.0.0.0:*`);
      }
      return lines.join("\n");
    }

    it("passes at 19 services (just below threshold)", () => {
      const checks = parseNetworkChecks(makeListeningOutput(19), "bare");
      const c = checks.find((c) => c.id === "NET-LISTENING-SERVICES-AUDIT")!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("19 listening TCP services detected");
    });

    it("fails at 20 services (at threshold — strict <20)", () => {
      const checks = parseNetworkChecks(makeListeningOutput(20), "bare");
      const c = checks.find((c) => c.id === "NET-LISTENING-SERVICES-AUDIT")!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("20 listening TCP services detected");
    });

    it("fails at 25 services (above threshold)", () => {
      const checks = parseNetworkChecks(makeListeningOutput(25), "bare");
      const c = checks.find((c) => c.id === "NET-LISTENING-SERVICES-AUDIT")!;
      expect(c.passed).toBe(false);
    });

    it("passes at 0 services", () => {
      const checks = parseNetworkChecks("some text with no listening output", "bare");
      const c = checks.find((c) => c.id === "NET-LISTENING-SERVICES-AUDIT")!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("0 listening TCP services detected");
    });
  });

  describe("Boundary tests — LISTENING_PORT_COUNT threshold (<=20)", () => {
    it("passes at exactly 20 (boundary — <=20)", () => {
      const checks = parseNetworkChecks("20", "bare");
      const c = checks.find((c) => c.id === "NET-LISTENING-PORT-COUNT")!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("20 listening TCP ports");
    });

    it("fails at 21 (one above threshold)", () => {
      const checks = parseNetworkChecks("21", "bare");
      const c = checks.find((c) => c.id === "NET-LISTENING-PORT-COUNT")!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("21 listening TCP ports");
    });

    it("passes when count is null (no numeric line found)", () => {
      const checks = parseNetworkChecks("no numbers here", "bare");
      const c = checks.find((c) => c.id === "NET-LISTENING-PORT-COUNT")!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("Port count not determinable");
    });

    it("ignores numbers >= 200 (not plausible port count)", () => {
      const checks = parseNetworkChecks("250", "bare");
      const c = checks.find((c) => c.id === "NET-LISTENING-PORT-COUNT")!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("Port count not determinable");
    });

    it("accepts 0 as valid port count", () => {
      const checks = parseNetworkChecks("0", "bare");
      const c = checks.find((c) => c.id === "NET-LISTENING-PORT-COUNT")!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("0 listening TCP ports");
    });
  });

  describe("Platform awareness — NET-IP-FORWARDING", () => {
    const forwardingEnabled = "net.ipv4.ip_forward = 1";

    it("passes on coolify even with forwarding enabled (Docker needs it)", () => {
      const checks = parseNetworkChecks(forwardingEnabled, "coolify");
      const c = checks.find((c) => c.id === "NET-IP-FORWARDING")!;
      expect(c.passed).toBe(true);
      expect(c.expectedValue).toBe("Enabled (required for Docker)");
      expect(c.explain).toContain("required for Docker");
    });

    it("passes on dokploy even with forwarding enabled (Docker needs it)", () => {
      const checks = parseNetworkChecks(forwardingEnabled, "dokploy");
      const c = checks.find((c) => c.id === "NET-IP-FORWARDING")!;
      expect(c.passed).toBe(true);
      expect(c.expectedValue).toBe("Enabled (required for Docker)");
      expect(c.explain).toContain("required for Docker");
    });

    it("fails on bare when forwarding is enabled", () => {
      const checks = parseNetworkChecks(forwardingEnabled, "bare");
      const c = checks.find((c) => c.id === "NET-IP-FORWARDING")!;
      expect(c.passed).toBe(false);
      expect(c.expectedValue).toBe("Disabled (net.ipv4.ip_forward = 0)");
      expect(c.explain).toContain("should be disabled");
    });

    it("passes on bare when forwarding is disabled", () => {
      const disabledOutput = "net.ipv4.ip_forward = 0";
      const checks = parseNetworkChecks(disabledOutput, "bare");
      const c = checks.find((c) => c.id === "NET-IP-FORWARDING")!;
      expect(c.passed).toBe(true);
    });

    it("coolify always passes even with ip_forward=0", () => {
      const disabledOutput = "net.ipv4.ip_forward = 0";
      const checks = parseNetworkChecks(disabledOutput, "coolify");
      const c = checks.find((c) => c.id === "NET-IP-FORWARDING")!;
      expect(c.passed).toBe(true);
    });

    it("N/A input fails on all platforms", () => {
      for (const platform of ["bare", "coolify", "dokploy"]) {
        const checks = parseNetworkChecks("N/A", platform);
        const c = checks.find((c) => c.id === "NET-IP-FORWARDING")!;
        expect(c.passed).toBe(false);
      }
    });
  });

  describe("Platform awareness — NET-RP-FILTER", () => {
    it("passes on coolify with rp_filter=2 (loose mode for Docker Swarm)", () => {
      const checks = parseNetworkChecks("net.ipv4.conf.all.rp_filter = 2", "coolify");
      const c = checks.find((c) => c.id === "NET-RP-FILTER")!;
      expect(c.passed).toBe(true);
      expect(c.expectedValue).toContain("loose mode ok for Docker");
      expect(c.explain).toContain("Docker Swarm");
    });

    it("passes on dokploy with rp_filter=2 (loose mode for Docker Swarm)", () => {
      const checks = parseNetworkChecks("net.ipv4.conf.all.rp_filter = 2", "dokploy");
      const c = checks.find((c) => c.id === "NET-RP-FILTER")!;
      expect(c.passed).toBe(true);
    });

    it("passes on coolify with rp_filter=1 (strict also valid)", () => {
      const checks = parseNetworkChecks("net.ipv4.conf.all.rp_filter = 1", "coolify");
      const c = checks.find((c) => c.id === "NET-RP-FILTER")!;
      expect(c.passed).toBe(true);
    });

    it("fails on bare with rp_filter=2 (strict required)", () => {
      const checks = parseNetworkChecks("net.ipv4.conf.all.rp_filter = 2", "bare");
      const c = checks.find((c) => c.id === "NET-RP-FILTER")!;
      expect(c.passed).toBe(false);
    });

    it("fails on bare with rp_filter=0 (disabled)", () => {
      const checks = parseNetworkChecks("net.ipv4.conf.all.rp_filter = 0", "bare");
      const c = checks.find((c) => c.id === "NET-RP-FILTER")!;
      expect(c.passed).toBe(false);
    });

    it("fails on coolify with rp_filter=0 (disabled not acceptable)", () => {
      const checks = parseNetworkChecks("net.ipv4.conf.all.rp_filter = 0", "coolify");
      const c = checks.find((c) => c.id === "NET-RP-FILTER")!;
      expect(c.passed).toBe(false);
    });
  });

  describe("Dangerous ports — currentValue and fixCommand mutation killers", () => {
    it("lists specific dangerous port names in currentValue", () => {
      const output = "LISTEN 0.0.0.0:3306 0.0.0.0:*\nLISTEN 0.0.0.0:6379 0.0.0.0:*";
      const checks = parseNetworkChecks(output, "bare");
      const c = checks.find((c) => c.id === "NET-NO-DANGEROUS-PORTS")!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Dangerous port(s) exposed: 3306, 6379");
    });

    it("fixCommand references first dangerous port", () => {
      const output = "LISTEN 0.0.0.0:5432 0.0.0.0:*";
      const checks = parseNetworkChecks(output, "bare");
      const c = checks.find((c) => c.id === "NET-NO-DANGEROUS-PORTS")!;
      expect(c.fixCommand).toBe("ufw deny 5432/tcp");
    });

    it("detects all 7 DANGEROUS_PORTS individually", () => {
      const ports = ["3306", "5432", "6379", "27017", "9200", "11211", "5984"];
      for (const port of ports) {
        const output = `LISTEN 0.0.0.0:${port} 0.0.0.0:*`;
        const checks = parseNetworkChecks(output, "bare");
        const c = checks.find((c) => c.id === "NET-NO-DANGEROUS-PORTS")!;
        expect(c.passed).toBe(false);
        expect(c.currentValue).toContain(port);
      }
    });

    it("does not flag non-dangerous ports as dangerous", () => {
      const output = "LISTEN 0.0.0.0:22 0.0.0.0:*\nLISTEN 0.0.0.0:80 0.0.0.0:*\nLISTEN 0.0.0.0:443 0.0.0.0:*";
      const checks = parseNetworkChecks(output, "bare");
      const c = checks.find((c) => c.id === "NET-NO-DANGEROUS-PORTS")!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("3 port(s) listening, no dangerous ports exposed");
    });
  });

  describe("NET-DNS-RESOLVER boundary cases", () => {
    it("passes with any nameserver line", () => {
      const checks = parseNetworkChecks("nameserver 8.8.8.8", "bare");
      const c = checks.find((c) => c.id === "NET-DNS-RESOLVER")!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("DNS resolver configured");
    });

    it("fails when no nameserver present", () => {
      const checks = parseNetworkChecks("some output without dns", "bare");
      const c = checks.find((c) => c.id === "NET-DNS-RESOLVER")!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("No DNS resolver found");
    });
  });

  describe("NET-TIME-SYNC — alternative timedatectl format", () => {
    it("passes with 'NTP synchronized: yes'", () => {
      const checks = parseNetworkChecks("NTP synchronized: yes", "bare");
      const c = checks.find((c) => c.id === "NET-TIME-SYNC")!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("NTP synchronized");
    });

    it("passes with 'System clock synchronized: yes'", () => {
      const checks = parseNetworkChecks("System clock synchronized: yes", "bare");
      const c = checks.find((c) => c.id === "NET-TIME-SYNC")!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("NTP synchronized");
    });

    it("fails when NTP status is 'no'", () => {
      const checks = parseNetworkChecks("NTP synchronized: no", "bare");
      const c = checks.find((c) => c.id === "NET-TIME-SYNC")!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("NTP status unknown");
    });
  });

  describe("NET-HOSTS-ACCESS — NO_HOSTS_ALLOW sentinel", () => {
    it("fails when output contains NO_HOSTS_ALLOW", () => {
      const checks = parseNetworkChecks("NO_HOSTS_ALLOW", "bare");
      const c = checks.find((c) => c.id === "NET-HOSTS-ACCESS")!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("/etc/hosts.allow not found");
    });

    it("passes when NO_HOSTS_ALLOW is absent", () => {
      const checks = parseNetworkChecks("sshd: ALL", "bare");
      const c = checks.find((c) => c.id === "NET-HOSTS-ACCESS")!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("/etc/hosts.allow exists");
    });
  });

  describe("NET-NO-EXPOSED-MGMT-PORTS — regex pattern mutation killers", () => {
    it("fails when output contains :8080 (with trailing space)", () => {
      const checks = parseNetworkChecks("LISTEN 0.0.0.0:8080 0.0.0.0:*", "bare");
      const c = checks.find((c) => c.id === "NET-NO-EXPOSED-MGMT-PORTS")!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Management port(s) exposed on 0.0.0.0");
    });

    it("fails when output contains :8443 (with trailing space)", () => {
      const checks = parseNetworkChecks("LISTEN 0.0.0.0:8443 0.0.0.0:*", "bare");
      const c = checks.find((c) => c.id === "NET-NO-EXPOSED-MGMT-PORTS")!;
      expect(c.passed).toBe(false);
    });

    it("fails when output contains :9000 (with trailing space)", () => {
      const checks = parseNetworkChecks("LISTEN 0.0.0.0:9000 0.0.0.0:*", "bare");
      const c = checks.find((c) => c.id === "NET-NO-EXPOSED-MGMT-PORTS")!;
      expect(c.passed).toBe(false);
    });

    it("fails when output contains :3000 (with trailing space)", () => {
      const checks = parseNetworkChecks("LISTEN 0.0.0.0:3000 0.0.0.0:*", "bare");
      const c = checks.find((c) => c.id === "NET-NO-EXPOSED-MGMT-PORTS")!;
      expect(c.passed).toBe(false);
    });

    it("passes when NONE is in output (takes priority)", () => {
      const checks = parseNetworkChecks("NONE", "bare");
      const c = checks.find((c) => c.id === "NET-NO-EXPOSED-MGMT-PORTS")!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("No management ports (8080, 8443, 9000, 3000) on 0.0.0.0");
    });
  });

  describe("NET-NO-MAIL-PORTS — mail port detection", () => {
    it("fails when port 25 is open (with trailing space)", () => {
      const checks = parseNetworkChecks("LISTEN 0.0.0.0:25 0.0.0.0:*", "bare");
      const c = checks.find((c) => c.id === "NET-NO-MAIL-PORTS")!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Mail service port(s) (25/110/143) detected");
    });

    it("fails when port 110 is open", () => {
      const checks = parseNetworkChecks("LISTEN 0.0.0.0:110 0.0.0.0:*", "bare");
      const c = checks.find((c) => c.id === "NET-NO-MAIL-PORTS")!;
      expect(c.passed).toBe(false);
    });

    it("fails when port 143 is open", () => {
      const checks = parseNetworkChecks("LISTEN 0.0.0.0:143 0.0.0.0:*", "bare");
      const c = checks.find((c) => c.id === "NET-NO-MAIL-PORTS")!;
      expect(c.passed).toBe(false);
    });

    it("passes when NONE sentinel is present (no mail ports)", () => {
      const checks = parseNetworkChecks("NONE", "bare");
      const c = checks.find((c) => c.id === "NET-NO-MAIL-PORTS")!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("No unexpected mail ports open");
    });
  });

  describe("NET-NO-PROMISCUOUS-INTERFACES — PROMISC detection", () => {
    it("fails when PROMISC is in output (no NONE sentinel)", () => {
      const output = "3: eth0: <BROADCAST,MULTICAST,PROMISC,UP> mtu 1500";
      const checks = parseNetworkChecks(output, "bare");
      const c = checks.find((c) => c.id === "NET-NO-PROMISCUOUS-INTERFACES")!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Promiscuous mode interface(s) detected");
    });

    it("passes when NONE sentinel is present", () => {
      const checks = parseNetworkChecks("NONE", "bare");
      const c = checks.find((c) => c.id === "NET-NO-PROMISCUOUS-INTERFACES")!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("No promiscuous mode interfaces");
    });

    it("passes when no PROMISC and no NONE (clean ip link output)", () => {
      const output = "3: eth0: <BROADCAST,MULTICAST,UP> mtu 1500";
      const checks = parseNetworkChecks(output, "bare");
      const c = checks.find((c) => c.id === "NET-NO-PROMISCUOUS-INTERFACES")!;
      expect(c.passed).toBe(true);
    });
  });

  describe("NET-HOSTS-DENY — ALL:ALL pattern matcher", () => {
    it("passes with 'ALL : ALL' (spaces around colon)", () => {
      const checks = parseNetworkChecks("ALL : ALL", "bare");
      const c = checks.find((c) => c.id === "NET-HOSTS-DENY")!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("/etc/hosts.deny has ALL:ALL deny rule");
    });

    it("passes with 'ALL:ALL' (no spaces)", () => {
      const checks = parseNetworkChecks("ALL:ALL", "bare");
      const c = checks.find((c) => c.id === "NET-HOSTS-DENY")!;
      expect(c.passed).toBe(true);
    });

    it("passes case-insensitively with 'all : all'", () => {
      const checks = parseNetworkChecks("all : all", "bare");
      const c = checks.find((c) => c.id === "NET-HOSTS-DENY")!;
      expect(c.passed).toBe(true);
    });

    it("fails when hosts.deny has no deny rule", () => {
      const checks = parseNetworkChecks("something else entirely", "bare");
      const c = checks.find((c) => c.id === "NET-HOSTS-DENY")!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("/etc/hosts.deny missing or no default deny");
    });
  });

  describe("NET-TCP-WRAPPERS-CONFIGURED — rule detection", () => {
    it("passes with 'sshd: 192.168.1.0/24' (colon-based rule)", () => {
      const checks = parseNetworkChecks("sshd: 192.168.1.0/24", "bare");
      const c = checks.find((c) => c.id === "NET-TCP-WRAPPERS-CONFIGURED")!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("Active rules found in /etc/hosts.allow");
    });

    it("fails when output is 'EMPTY' sentinel", () => {
      const checks = parseNetworkChecks("EMPTY", "bare");
      const c = checks.find((c) => c.id === "NET-TCP-WRAPPERS-CONFIGURED")!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("No active rules in /etc/hosts.allow");
    });

    it("ignores comment lines (starting with #)", () => {
      const checks = parseNetworkChecks("# this is a comment\nEMPTY", "bare");
      const c = checks.find((c) => c.id === "NET-TCP-WRAPPERS-CONFIGURED")!;
      expect(c.passed).toBe(false);
    });
  });

  describe("ARP checks — boundary values", () => {
    it("NET-ARP-ANNOUNCE fails at 1 (only 2 is secure)", () => {
      const checks = parseNetworkChecks("net.ipv4.conf.all.arp_announce = 1", "bare");
      const c = checks.find((c) => c.id === "NET-ARP-ANNOUNCE")!;
      expect(c.passed).toBe(false);
    });

    it("NET-ARP-IGNORE passes at 2 (>= 1)", () => {
      const checks = parseNetworkChecks("net.ipv4.conf.all.arp_ignore = 2", "bare");
      const c = checks.find((c) => c.id === "NET-ARP-IGNORE")!;
      expect(c.passed).toBe(true);
    });

    it("NET-ARP-IGNORE fails at 0 (not >= 1)", () => {
      const checks = parseNetworkChecks("net.ipv4.conf.all.arp_ignore = 0", "bare");
      const c = checks.find((c) => c.id === "NET-ARP-IGNORE")!;
      expect(c.passed).toBe(false);
    });
  });

  describe("Sysctl extractValue — missing key returns Unable to determine", () => {
    it("NET-SYN-COOKIES shows 'Unable to determine' when key missing from output", () => {
      const checks = parseNetworkChecks("some random text", "bare");
      const c = checks.find((c) => c.id === "NET-SYN-COOKIES")!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });

    it("NET-IPV6-DISABLED shows 'Unable to determine' when key missing", () => {
      const checks = parseNetworkChecks("no sysctl here", "bare");
      const c = checks.find((c) => c.id === "NET-IPV6-DISABLED")!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });

    it("NET-RP-FILTER shows 'Unable to determine' when key missing", () => {
      const checks = parseNetworkChecks("nothing relevant", "bare");
      const c = checks.find((c) => c.id === "NET-RP-FILTER")!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });
  });

  describe("Sysctl checks — wrong value fails (pass/fail inversion killers)", () => {
    const wrongValues: Array<[string, string, string]> = [
      ["NET-SYN-COOKIES", "net.ipv4.tcp_syncookies", "0"],
      ["NET-IPV6-DISABLED", "net.ipv6.conf.all.disable_ipv6", "0"],
      ["NET-ICMP-REDIRECT-SEND", "net.ipv4.conf.all.send_redirects", "1"],
      ["NET-ICMP-SECURE-REDIRECT", "net.ipv4.conf.all.secure_redirects", "1"],
      ["NET-SOURCE-ROUTING-V6", "net.ipv6.conf.all.accept_source_route", "1"],
      ["NET-MARTIAN-LOGGING", "net.ipv4.conf.all.log_martians", "0"],
      ["NET-RP-FILTER", "net.ipv4.conf.all.rp_filter", "0"],
    ];

    it.each(wrongValues)(
      "%s fails when %s = %s (wrong value)",
      (checkId, sysctlKey, wrongValue) => {
        const output = `${sysctlKey} = ${wrongValue}`;
        const checks = parseNetworkChecks(output, "bare");
        const c = checks.find((c) => c.id === checkId)!;
        expect(c.passed).toBe(false);
        expect(c.currentValue).toBe(`${sysctlKey} = ${wrongValue}`);
      },
    );
  });
});
