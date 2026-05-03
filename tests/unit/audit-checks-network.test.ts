import { CHECK_IDS } from "../../src/core/audit/checkIds.js";
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
    const net01 = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_DANGEROUS_PORTS);
    expect(net01!.passed).toBe(true);
  });

  it("should return NET-NO-DANGEROUS-PORTS failed for database ports exposed", () => {
    const checks = parseNetworkChecks(insecureOutput, "bare");
    const net01 = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_DANGEROUS_PORTS);
    expect(net01!.passed).toBe(false);
    expect(net01!.severity).toBe("warning");
  });

  it("should return NET-IP-FORWARDING passed when IP forwarding is disabled", () => {
    const checks = parseNetworkChecks(secureOutput, "bare");
    const net04 = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_IP_FORWARDING);
    expect(net04!.passed).toBe(true);
  });

  it("should return NET-IP-FORWARDING failed when IP forwarding is enabled on bare", () => {
    const checks = parseNetworkChecks(insecureOutput, "bare");
    const net04 = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_IP_FORWARDING);
    expect(net04!.passed).toBe(false);
  });

  it("should allow IP forwarding on docker platforms", () => {
    const checks = parseNetworkChecks(insecureOutput, "coolify");
    const net04 = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_IP_FORWARDING);
    expect(net04!.passed).toBe(true);
  });

  it("should return NET-SYN-COOKIES passed when tcp_syncookies=1", () => {
    const outputWithSyncookies = secureOutput + "\nnet.ipv4.tcp_syncookies = 1";
    const checks = parseNetworkChecks(outputWithSyncookies, "bare");
    const net05 = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_SYN_COOKIES);
    expect(net05!.passed).toBe(true);
  });

  it("should return NET-HOSTS-DENY passed when ALL:ALL present, failed when NO_HOSTS_DENY", () => {
    const passChecks = parseNetworkChecks("ALL : ALL", "bare");
    const pass = passChecks.find((c) => c.id === CHECK_IDS.NETWORK.NET_HOSTS_DENY);
    expect(pass!.passed).toBe(true);

    const failChecks = parseNetworkChecks("NO_HOSTS_DENY", "bare");
    const fail = failChecks.find((c) => c.id === CHECK_IDS.NETWORK.NET_HOSTS_DENY);
    expect(fail!.passed).toBe(false);
  });

  it("should return NET-NO-EXPOSED-MGMT-PORTS passed with NONE, failed with port listing", () => {
    const passChecks = parseNetworkChecks("NONE", "bare");
    const pass = passChecks.find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_EXPOSED_MGMT_PORTS);
    expect(pass!.passed).toBe(true);

    const failChecks = parseNetworkChecks("LISTEN 0.0.0.0:8080", "bare");
    const fail = failChecks.find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_EXPOSED_MGMT_PORTS);
    expect(fail).toBeDefined();
  });

  it("NET-NO-MAIL-PORTS passes when NONE (no mail ports open)", () => {
    const checks = parseNetworkChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_MAIL_PORTS);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("NET-NO-PROMISCUOUS-INTERFACES passes when no PROMISC interfaces", () => {
    const checks = parseNetworkChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_PROMISCUOUS_INTERFACES);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("should handle N/A output gracefully", () => {
    const checks = parseNetworkChecks("N/A", "bare");
    expect(checks).toHaveLength(21);
  });

  it("NET-ARP-ANNOUNCE passes when arp_announce = 2", () => {
    const checks = parseNetworkChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_ARP_ANNOUNCE);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("warning");
    expect(check!.currentValue).toContain("2");
  });

  it("NET-ARP-ANNOUNCE fails when arp_announce = 0", () => {
    const checks = parseNetworkChecks("net.ipv4.conf.all.arp_announce = 0", "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_ARP_ANNOUNCE);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("NET-ARP-IGNORE passes when arp_ignore = 1", () => {
    const checks = parseNetworkChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_ARP_IGNORE);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("warning");
  });

  it("NET-ARP-IGNORE fails when arp_ignore = 0", () => {
    const checks = parseNetworkChecks("net.ipv4.conf.all.arp_ignore = 0", "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_ARP_IGNORE);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("NET-TCP-WRAPPERS-CONFIGURED passes when hosts.allow has entry with colon", () => {
    const checks = parseNetworkChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_TCP_WRAPPERS_CONFIGURED);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("info");
  });

  it("NET-TCP-WRAPPERS-CONFIGURED fails when hosts.allow is empty or missing", () => {
    const checks = parseNetworkChecks("NO_HOSTS_ALLOW", "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_TCP_WRAPPERS_CONFIGURED);
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("NET-LISTENING-PORT-COUNT passes when count <= 20", () => {
    const checks = parseNetworkChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_LISTENING_PORT_COUNT);
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
    const check = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_LISTENING_PORT_COUNT);
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
        CHECK_IDS.NETWORK.NET_NO_DANGEROUS_PORTS,
        CHECK_IDS.NETWORK.NET_DNS_RESOLVER,
        CHECK_IDS.NETWORK.NET_TIME_SYNC,
        CHECK_IDS.NETWORK.NET_IP_FORWARDING,
        CHECK_IDS.NETWORK.NET_SYN_COOKIES,
        CHECK_IDS.NETWORK.NET_HOSTS_ACCESS,
        CHECK_IDS.NETWORK.NET_HOSTS_DENY,
        CHECK_IDS.NETWORK.NET_IPV6_DISABLED,
        CHECK_IDS.NETWORK.NET_ICMP_REDIRECT_SEND,
        CHECK_IDS.NETWORK.NET_ICMP_SECURE_REDIRECT,
        CHECK_IDS.NETWORK.NET_SOURCE_ROUTING_V6,
        CHECK_IDS.NETWORK.NET_MARTIAN_LOGGING,
        CHECK_IDS.NETWORK.NET_NO_EXPOSED_MGMT_PORTS,
        CHECK_IDS.NETWORK.NET_RP_FILTER,
        CHECK_IDS.NETWORK.NET_NO_MAIL_PORTS,
        CHECK_IDS.NETWORK.NET_LISTENING_SERVICES_AUDIT,
        CHECK_IDS.NETWORK.NET_NO_PROMISCUOUS_INTERFACES,
        CHECK_IDS.NETWORK.NET_ARP_ANNOUNCE,
        CHECK_IDS.NETWORK.NET_ARP_IGNORE,
        CHECK_IDS.NETWORK.NET_TCP_WRAPPERS_CONFIGURED,
        CHECK_IDS.NETWORK.NET_LISTENING_PORT_COUNT,
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
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_DANGEROUS_PORTS)!;
      expect(c.currentValue).toBe("3 port(s) listening, no dangerous ports exposed");
    });

    it("NET-DNS-RESOLVER currentValue is 'DNS resolver configured'", () => {
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_DNS_RESOLVER)!;
      expect(c.currentValue).toBe("DNS resolver configured");
    });

    it("NET-TIME-SYNC currentValue is 'NTP synchronized'", () => {
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_TIME_SYNC)!;
      expect(c.currentValue).toBe("NTP synchronized");
    });

    it("NET-IP-FORWARDING currentValue shows sysctl key=value", () => {
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_IP_FORWARDING)!;
      expect(c.currentValue).toBe("net.ipv4.ip_forward = 0");
    });

    it("NET-SYN-COOKIES currentValue shows sysctl key=value", () => {
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_SYN_COOKIES)!;
      expect(c.currentValue).toBe("net.ipv4.tcp_syncookies = 1");
    });

    it("NET-HOSTS-ACCESS currentValue is '/etc/hosts.allow exists'", () => {
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_HOSTS_ACCESS)!;
      expect(c.currentValue).toBe("/etc/hosts.allow exists");
    });

    it("NET-IPV6-DISABLED currentValue shows sysctl key=value", () => {
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_IPV6_DISABLED)!;
      expect(c.currentValue).toBe("net.ipv6.conf.all.disable_ipv6 = 1");
    });

    it("NET-ICMP-REDIRECT-SEND currentValue shows sysctl key=value", () => {
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_ICMP_REDIRECT_SEND)!;
      expect(c.currentValue).toBe("net.ipv4.conf.all.send_redirects = 0");
    });

    it("NET-ICMP-SECURE-REDIRECT currentValue shows sysctl key=value", () => {
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_ICMP_SECURE_REDIRECT)!;
      expect(c.currentValue).toBe("net.ipv4.conf.all.secure_redirects = 0");
    });

    it("NET-SOURCE-ROUTING-V6 currentValue shows sysctl key=value", () => {
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_SOURCE_ROUTING_V6)!;
      expect(c.currentValue).toBe("net.ipv6.conf.all.accept_source_route = 0");
    });

    it("NET-RP-FILTER currentValue shows sysctl key=value", () => {
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_RP_FILTER)!;
      expect(c.currentValue).toBe("net.ipv4.conf.all.rp_filter = 1");
    });

    it("NET-MARTIAN-LOGGING currentValue shows sysctl key=value", () => {
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_MARTIAN_LOGGING)!;
      expect(c.currentValue).toBe("net.ipv4.conf.all.log_martians = 1");
    });

    it("NET-ARP-ANNOUNCE currentValue shows sysctl key=value", () => {
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_ARP_ANNOUNCE)!;
      expect(c.currentValue).toBe("net.ipv4.conf.all.arp_announce = 2");
    });

    it("NET-ARP-IGNORE currentValue shows sysctl key=value", () => {
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_ARP_IGNORE)!;
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
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_LISTENING_SERVICES_AUDIT)!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("19 listening TCP services detected");
    });

    it("fails at 20 services (at threshold — strict <20)", () => {
      const checks = parseNetworkChecks(makeListeningOutput(20), "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_LISTENING_SERVICES_AUDIT)!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("20 listening TCP services detected");
    });

    it("fails at 25 services (above threshold)", () => {
      const checks = parseNetworkChecks(makeListeningOutput(25), "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_LISTENING_SERVICES_AUDIT)!;
      expect(c.passed).toBe(false);
    });

    it("passes at 0 services", () => {
      const checks = parseNetworkChecks("some text with no listening output", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_LISTENING_SERVICES_AUDIT)!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("0 listening TCP services detected");
    });
  });

  describe("Boundary tests — LISTENING_PORT_COUNT threshold (<=20)", () => {
    it("passes at exactly 20 (boundary — <=20)", () => {
      const checks = parseNetworkChecks("20", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_LISTENING_PORT_COUNT)!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("20 listening TCP ports");
    });

    it("fails at 21 (one above threshold)", () => {
      const checks = parseNetworkChecks("21", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_LISTENING_PORT_COUNT)!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("21 listening TCP ports");
    });

    it("passes when count is null (no numeric line found)", () => {
      const checks = parseNetworkChecks("no numbers here", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_LISTENING_PORT_COUNT)!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("Port count not determinable");
    });

    it("ignores numbers >= 200 (not plausible port count)", () => {
      const checks = parseNetworkChecks("250", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_LISTENING_PORT_COUNT)!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("Port count not determinable");
    });

    it("accepts 0 as valid port count", () => {
      const checks = parseNetworkChecks("0", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_LISTENING_PORT_COUNT)!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("0 listening TCP ports");
    });
  });

  describe("Platform awareness — NET-IP-FORWARDING", () => {
    const forwardingEnabled = "net.ipv4.ip_forward = 1";

    it("passes on coolify even with forwarding enabled (Docker needs it)", () => {
      const checks = parseNetworkChecks(forwardingEnabled, "coolify");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_IP_FORWARDING)!;
      expect(c.passed).toBe(true);
      expect(c.expectedValue).toBe("Enabled (required for Docker)");
      expect(c.explain).toContain("required for Docker");
    });

    it("passes on dokploy even with forwarding enabled (Docker needs it)", () => {
      const checks = parseNetworkChecks(forwardingEnabled, "dokploy");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_IP_FORWARDING)!;
      expect(c.passed).toBe(true);
      expect(c.expectedValue).toBe("Enabled (required for Docker)");
      expect(c.explain).toContain("required for Docker");
    });

    it("fails on bare when forwarding is enabled", () => {
      const checks = parseNetworkChecks(forwardingEnabled, "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_IP_FORWARDING)!;
      expect(c.passed).toBe(false);
      expect(c.expectedValue).toBe("Disabled (net.ipv4.ip_forward = 0)");
      expect(c.explain).toContain("should be disabled");
    });

    it("passes on bare when forwarding is disabled", () => {
      const disabledOutput = "net.ipv4.ip_forward = 0";
      const checks = parseNetworkChecks(disabledOutput, "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_IP_FORWARDING)!;
      expect(c.passed).toBe(true);
    });

    it("coolify always passes even with ip_forward=0", () => {
      const disabledOutput = "net.ipv4.ip_forward = 0";
      const checks = parseNetworkChecks(disabledOutput, "coolify");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_IP_FORWARDING)!;
      expect(c.passed).toBe(true);
    });

    it("N/A input fails on all platforms", () => {
      for (const platform of ["bare", "coolify", "dokploy"]) {
        const checks = parseNetworkChecks("N/A", platform);
        const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_IP_FORWARDING)!;
        expect(c.passed).toBe(false);
      }
    });
  });

  describe("Platform awareness — NET-RP-FILTER", () => {
    it("passes on coolify with rp_filter=2 (loose mode for Docker Swarm)", () => {
      const checks = parseNetworkChecks("net.ipv4.conf.all.rp_filter = 2", "coolify");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_RP_FILTER)!;
      expect(c.passed).toBe(true);
      expect(c.expectedValue).toContain("loose mode ok for Docker");
      expect(c.explain).toContain("Docker Swarm");
    });

    it("passes on dokploy with rp_filter=2 (loose mode for Docker Swarm)", () => {
      const checks = parseNetworkChecks("net.ipv4.conf.all.rp_filter = 2", "dokploy");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_RP_FILTER)!;
      expect(c.passed).toBe(true);
    });

    it("passes on coolify with rp_filter=1 (strict also valid)", () => {
      const checks = parseNetworkChecks("net.ipv4.conf.all.rp_filter = 1", "coolify");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_RP_FILTER)!;
      expect(c.passed).toBe(true);
    });

    it("fails on bare with rp_filter=2 (strict required)", () => {
      const checks = parseNetworkChecks("net.ipv4.conf.all.rp_filter = 2", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_RP_FILTER)!;
      expect(c.passed).toBe(false);
    });

    it("fails on bare with rp_filter=0 (disabled)", () => {
      const checks = parseNetworkChecks("net.ipv4.conf.all.rp_filter = 0", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_RP_FILTER)!;
      expect(c.passed).toBe(false);
    });

    it("fails on coolify with rp_filter=0 (disabled not acceptable)", () => {
      const checks = parseNetworkChecks("net.ipv4.conf.all.rp_filter = 0", "coolify");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_RP_FILTER)!;
      expect(c.passed).toBe(false);
    });
  });

  describe("Dangerous ports — currentValue and fixCommand mutation killers", () => {
    it("lists specific dangerous port names in currentValue", () => {
      const output = "LISTEN 0.0.0.0:3306 0.0.0.0:*\nLISTEN 0.0.0.0:6379 0.0.0.0:*";
      const checks = parseNetworkChecks(output, "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_DANGEROUS_PORTS)!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Dangerous port(s) exposed: 3306, 6379");
    });

    it("fixCommand references first dangerous port", () => {
      const output = "LISTEN 0.0.0.0:5432 0.0.0.0:*";
      const checks = parseNetworkChecks(output, "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_DANGEROUS_PORTS)!;
      expect(c.fixCommand).toBe("ufw deny 5432/tcp");
    });

    it("detects all 7 DANGEROUS_PORTS individually", () => {
      const ports = ["3306", "5432", "6379", "27017", "9200", "11211", "5984"];
      for (const port of ports) {
        const output = `LISTEN 0.0.0.0:${port} 0.0.0.0:*`;
        const checks = parseNetworkChecks(output, "bare");
        const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_DANGEROUS_PORTS)!;
        expect(c.passed).toBe(false);
        expect(c.currentValue).toContain(port);
      }
    });

    it("does not flag non-dangerous ports as dangerous", () => {
      const output = "LISTEN 0.0.0.0:22 0.0.0.0:*\nLISTEN 0.0.0.0:80 0.0.0.0:*\nLISTEN 0.0.0.0:443 0.0.0.0:*";
      const checks = parseNetworkChecks(output, "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_DANGEROUS_PORTS)!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("3 port(s) listening, no dangerous ports exposed");
    });
  });

  describe("NET-DNS-RESOLVER boundary cases", () => {
    it("passes with any nameserver line", () => {
      const checks = parseNetworkChecks("nameserver 8.8.8.8", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_DNS_RESOLVER)!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("DNS resolver configured");
    });

    it("fails when no nameserver present", () => {
      const checks = parseNetworkChecks("some output without dns", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_DNS_RESOLVER)!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("No DNS resolver found");
    });
  });

  describe("NET-TIME-SYNC — alternative timedatectl format", () => {
    it("passes with 'NTP synchronized: yes'", () => {
      const checks = parseNetworkChecks("NTP synchronized: yes", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_TIME_SYNC)!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("NTP synchronized");
    });

    it("passes with 'System clock synchronized: yes'", () => {
      const checks = parseNetworkChecks("System clock synchronized: yes", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_TIME_SYNC)!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("NTP synchronized");
    });

    it("fails when NTP status is 'no'", () => {
      const checks = parseNetworkChecks("NTP synchronized: no", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_TIME_SYNC)!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("NTP status unknown");
    });
  });

  describe("NET-HOSTS-ACCESS — NO_HOSTS_ALLOW sentinel", () => {
    it("fails when output contains NO_HOSTS_ALLOW", () => {
      const checks = parseNetworkChecks("NO_HOSTS_ALLOW", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_HOSTS_ACCESS)!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("/etc/hosts.allow not found");
    });

    it("passes when NO_HOSTS_ALLOW is absent", () => {
      const checks = parseNetworkChecks("sshd: ALL", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_HOSTS_ACCESS)!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("/etc/hosts.allow exists");
    });
  });

  describe("NET-NO-EXPOSED-MGMT-PORTS — regex pattern mutation killers", () => {
    it("fails when output contains :8080 (with trailing space)", () => {
      const checks = parseNetworkChecks("LISTEN 0.0.0.0:8080 0.0.0.0:*", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_EXPOSED_MGMT_PORTS)!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Management port(s) exposed on 0.0.0.0");
    });

    it("fails when output contains :8443 (with trailing space)", () => {
      const checks = parseNetworkChecks("LISTEN 0.0.0.0:8443 0.0.0.0:*", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_EXPOSED_MGMT_PORTS)!;
      expect(c.passed).toBe(false);
    });

    it("fails when output contains :9000 (with trailing space)", () => {
      const checks = parseNetworkChecks("LISTEN 0.0.0.0:9000 0.0.0.0:*", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_EXPOSED_MGMT_PORTS)!;
      expect(c.passed).toBe(false);
    });

    it("fails when output contains :3000 (with trailing space)", () => {
      const checks = parseNetworkChecks("LISTEN 0.0.0.0:3000 0.0.0.0:*", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_EXPOSED_MGMT_PORTS)!;
      expect(c.passed).toBe(false);
    });

    it("passes when NONE is in output (takes priority)", () => {
      const checks = parseNetworkChecks("NONE", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_EXPOSED_MGMT_PORTS)!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("No management ports (8080, 8443, 9000, 3000) on 0.0.0.0");
    });
  });

  describe("NET-NO-MAIL-PORTS — mail port detection", () => {
    it("fails when port 25 is open (with trailing space)", () => {
      const checks = parseNetworkChecks("LISTEN 0.0.0.0:25 0.0.0.0:*", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_MAIL_PORTS)!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Mail service port(s) (25/110/143) detected");
    });

    it("fails when port 110 is open", () => {
      const checks = parseNetworkChecks("LISTEN 0.0.0.0:110 0.0.0.0:*", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_MAIL_PORTS)!;
      expect(c.passed).toBe(false);
    });

    it("fails when port 143 is open", () => {
      const checks = parseNetworkChecks("LISTEN 0.0.0.0:143 0.0.0.0:*", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_MAIL_PORTS)!;
      expect(c.passed).toBe(false);
    });

    it("passes when NONE sentinel is present (no mail ports)", () => {
      const checks = parseNetworkChecks("NONE", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_MAIL_PORTS)!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("No unexpected mail ports open");
    });
  });

  describe("NET-NO-PROMISCUOUS-INTERFACES — PROMISC detection", () => {
    it("fails when PROMISC is in output (no NONE sentinel)", () => {
      const output = "3: eth0: <BROADCAST,MULTICAST,PROMISC,UP> mtu 1500";
      const checks = parseNetworkChecks(output, "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_PROMISCUOUS_INTERFACES)!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Promiscuous mode interface(s) detected");
    });

    it("passes when NONE sentinel is present", () => {
      const checks = parseNetworkChecks("NONE", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_PROMISCUOUS_INTERFACES)!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("No promiscuous mode interfaces");
    });

    it("passes when no PROMISC and no NONE (clean ip link output)", () => {
      const output = "3: eth0: <BROADCAST,MULTICAST,UP> mtu 1500";
      const checks = parseNetworkChecks(output, "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_PROMISCUOUS_INTERFACES)!;
      expect(c.passed).toBe(true);
    });
  });

  describe("NET-HOSTS-DENY — ALL:ALL pattern matcher", () => {
    it("passes with 'ALL : ALL' (spaces around colon)", () => {
      const checks = parseNetworkChecks("ALL : ALL", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_HOSTS_DENY)!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("/etc/hosts.deny has ALL:ALL deny rule");
    });

    it("passes with 'ALL:ALL' (no spaces)", () => {
      const checks = parseNetworkChecks("ALL:ALL", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_HOSTS_DENY)!;
      expect(c.passed).toBe(true);
    });

    it("passes case-insensitively with 'all : all'", () => {
      const checks = parseNetworkChecks("all : all", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_HOSTS_DENY)!;
      expect(c.passed).toBe(true);
    });

    it("fails when hosts.deny has no deny rule", () => {
      const checks = parseNetworkChecks("something else entirely", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_HOSTS_DENY)!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("/etc/hosts.deny missing or no default deny");
    });
  });

  describe("NET-TCP-WRAPPERS-CONFIGURED — rule detection", () => {
    it("passes with 'sshd: 192.168.1.0/24' (colon-based rule)", () => {
      const checks = parseNetworkChecks("sshd: 192.168.1.0/24", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_TCP_WRAPPERS_CONFIGURED)!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("Active rules found in /etc/hosts.allow");
    });

    it("fails when output is 'EMPTY' sentinel", () => {
      const checks = parseNetworkChecks("EMPTY", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_TCP_WRAPPERS_CONFIGURED)!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("No active rules in /etc/hosts.allow");
    });

    it("ignores comment lines (starting with #)", () => {
      const checks = parseNetworkChecks("# this is a comment\nEMPTY", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_TCP_WRAPPERS_CONFIGURED)!;
      expect(c.passed).toBe(false);
    });
  });

  describe("ARP checks — boundary values", () => {
    it("NET-ARP-ANNOUNCE fails at 1 (only 2 is secure)", () => {
      const checks = parseNetworkChecks("net.ipv4.conf.all.arp_announce = 1", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_ARP_ANNOUNCE)!;
      expect(c.passed).toBe(false);
    });

    it("NET-ARP-IGNORE passes at 2 (>= 1)", () => {
      const checks = parseNetworkChecks("net.ipv4.conf.all.arp_ignore = 2", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_ARP_IGNORE)!;
      expect(c.passed).toBe(true);
    });

    it("NET-ARP-IGNORE fails at 0 (not >= 1)", () => {
      const checks = parseNetworkChecks("net.ipv4.conf.all.arp_ignore = 0", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_ARP_IGNORE)!;
      expect(c.passed).toBe(false);
    });
  });

  describe("Sysctl extractValue — missing key returns Unable to determine", () => {
    it("NET-SYN-COOKIES shows 'Unable to determine' when key missing from output", () => {
      const checks = parseNetworkChecks("some random text", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_SYN_COOKIES)!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });

    it("NET-IPV6-DISABLED shows 'Unable to determine' when key missing", () => {
      const checks = parseNetworkChecks("no sysctl here", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_IPV6_DISABLED)!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });

    it("NET-RP-FILTER shows 'Unable to determine' when key missing", () => {
      const checks = parseNetworkChecks("nothing relevant", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_RP_FILTER)!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });
  });

  describe("Sysctl checks — wrong value fails (pass/fail inversion killers)", () => {
    const wrongValues: Array<[string, string, string]> = [
      [CHECK_IDS.NETWORK.NET_SYN_COOKIES, "net.ipv4.tcp_syncookies", "0"],
      [CHECK_IDS.NETWORK.NET_IPV6_DISABLED, "net.ipv6.conf.all.disable_ipv6", "0"],
      [CHECK_IDS.NETWORK.NET_ICMP_REDIRECT_SEND, "net.ipv4.conf.all.send_redirects", "1"],
      [CHECK_IDS.NETWORK.NET_ICMP_SECURE_REDIRECT, "net.ipv4.conf.all.secure_redirects", "1"],
      [CHECK_IDS.NETWORK.NET_SOURCE_ROUTING_V6, "net.ipv6.conf.all.accept_source_route", "1"],
      [CHECK_IDS.NETWORK.NET_MARTIAN_LOGGING, "net.ipv4.conf.all.log_martians", "0"],
      [CHECK_IDS.NETWORK.NET_RP_FILTER, "net.ipv4.conf.all.rp_filter", "0"],
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

  // ──────────────────────────────────────────────────────────────
  // MUTATION-KILLER WAVE 2
  // ──────────────────────────────────────────────────────────────

  describe("extractSysctlValue — null return when key missing", () => {
    it("NET-IP-FORWARDING shows 'Unable to determine' when ip_forward key absent", () => {
      const checks = parseNetworkChecks("some unrelated text only", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_IP_FORWARDING)!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });

    it("NET-ARP-ANNOUNCE shows 'Unable to determine' when arp_announce key absent", () => {
      const checks = parseNetworkChecks("some unrelated text only", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_ARP_ANNOUNCE)!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });

    it("NET-ARP-IGNORE shows 'Unable to determine' when arp_ignore key absent", () => {
      const checks = parseNetworkChecks("some unrelated text only", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_ARP_IGNORE)!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });

    it("NET-ICMP-REDIRECT-SEND shows 'Unable to determine' when send_redirects key absent", () => {
      const checks = parseNetworkChecks("unrelated output", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_ICMP_REDIRECT_SEND)!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });

    it("NET-ICMP-SECURE-REDIRECT shows 'Unable to determine' when secure_redirects key absent", () => {
      const checks = parseNetworkChecks("unrelated output", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_ICMP_SECURE_REDIRECT)!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });

    it("NET-SOURCE-ROUTING-V6 shows 'Unable to determine' when accept_source_route key absent", () => {
      const checks = parseNetworkChecks("unrelated output", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_SOURCE_ROUTING_V6)!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });

    it("NET-MARTIAN-LOGGING shows 'Unable to determine' when log_martians key absent", () => {
      const checks = parseNetworkChecks("unrelated output", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_MARTIAN_LOGGING)!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });
  });

  describe("NET-01 dangerousPorts.length === 0 — zero vs nonzero", () => {
    it("passes with 0 exposed ports (no 0.0.0.0: pattern at all)", () => {
      const checks = parseNetworkChecks("LISTEN 127.0.0.1:3306 0.0.0.0:*", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_DANGEROUS_PORTS)!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("0 port(s) listening, no dangerous ports exposed");
    });

    it("passes with non-dangerous ports only", () => {
      const checks = parseNetworkChecks("LISTEN 0.0.0.0:22 0.0.0.0:*", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_DANGEROUS_PORTS)!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("1 port(s) listening, no dangerous ports exposed");
    });

    it("fails with exactly 1 dangerous port", () => {
      const checks = parseNetworkChecks("LISTEN 0.0.0.0:3306 0.0.0.0:*", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_DANGEROUS_PORTS)!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Dangerous port(s) exposed: 3306");
      expect(c.fixCommand).toBe("ufw deny 3306/tcp");
    });
  });

  describe("NET-23 LISTENING-PORT-COUNT — boundary val >= 0 && val < 200", () => {
    it("accepts val=0 (lower boundary)", () => {
      const checks = parseNetworkChecks("0", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_LISTENING_PORT_COUNT)!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("0 listening TCP ports");
    });

    it("accepts val=199 (just below upper boundary)", () => {
      const checks = parseNetworkChecks("199", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_LISTENING_PORT_COUNT)!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("199 listening TCP ports");
    });

    it("rejects val=200 (at upper boundary — not plausible)", () => {
      const checks = parseNetworkChecks("200", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_LISTENING_PORT_COUNT)!;
      expect(c.passed).toBe(true); // null case — passes by default
      expect(c.currentValue).toBe("Port count not determinable");
    });
  });

  describe("NET-02 DNS-RESOLVER — nameserver regex case variations", () => {
    it("passes with 'NAMESERVER 8.8.8.8' (case-insensitive /i flag)", () => {
      const checks = parseNetworkChecks("NAMESERVER 8.8.8.8", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_DNS_RESOLVER)!;
      expect(c.passed).toBe(true);
    });

    it("passes with 'Nameserver 1.0.0.1' (mixed case)", () => {
      const checks = parseNetworkChecks("Nameserver 1.0.0.1", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_DNS_RESOLVER)!;
      expect(c.passed).toBe(true);
    });

    it("fails with 'nameserverx' (no whitespace after)", () => {
      const checks = parseNetworkChecks("nameserverx", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_DNS_RESOLVER)!;
      // regex requires \\s+ after nameserver, so "nameserverx" matches because \\S+ is after \\s+
      // Actually the regex is /nameserver\s+\S+/i — "nameserverx" has no whitespace, so it fails
      expect(c.passed).toBe(false);
    });
  });

  describe("NET-03 TIME-SYNC — NTP regex case sensitivity", () => {
    it("passes with 'ntp synchronized: yes' (lowercase)", () => {
      const checks = parseNetworkChecks("ntp synchronized: yes", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_TIME_SYNC)!;
      expect(c.passed).toBe(true);
    });

    it("fails with 'NTP synchronized: no'", () => {
      const checks = parseNetworkChecks("NTP synchronized: no", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_TIME_SYNC)!;
      expect(c.passed).toBe(false);
    });

    it("passes with 'system clock synchronized: YES' (case-insensitive)", () => {
      const checks = parseNetworkChecks("System clock synchronized: yes", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_TIME_SYNC)!;
      expect(c.passed).toBe(true);
    });
  });

  describe("Correct value pass/fail pairs — boolean inversion killers", () => {
    const passFailPairs: Array<[string, string, string, string]> = [
      [CHECK_IDS.NETWORK.NET_SYN_COOKIES, "net.ipv4.tcp_syncookies", "1", "0"],
      [CHECK_IDS.NETWORK.NET_IPV6_DISABLED, "net.ipv6.conf.all.disable_ipv6", "1", "0"],
      [CHECK_IDS.NETWORK.NET_ICMP_REDIRECT_SEND, "net.ipv4.conf.all.send_redirects", "0", "1"],
      [CHECK_IDS.NETWORK.NET_ICMP_SECURE_REDIRECT, "net.ipv4.conf.all.secure_redirects", "0", "1"],
      [CHECK_IDS.NETWORK.NET_SOURCE_ROUTING_V6, "net.ipv6.conf.all.accept_source_route", "0", "1"],
      [CHECK_IDS.NETWORK.NET_MARTIAN_LOGGING, "net.ipv4.conf.all.log_martians", "1", "0"],
    ];

    it.each(passFailPairs)(
      "%s passes with %s=%s, fails with %s=%s",
      (checkId, sysctlKey, passVal, failVal) => {
        const passChecks = parseNetworkChecks(`${sysctlKey} = ${passVal}`, "bare");
        const pass = passChecks.find((c) => c.id === checkId)!;
        expect(pass.passed).toBe(true);
        expect(pass.currentValue).toBe(`${sysctlKey} = ${passVal}`);

        const failChecks = parseNetworkChecks(`${sysctlKey} = ${failVal}`, "bare");
        const fail = failChecks.find((c) => c.id === checkId)!;
        expect(fail.passed).toBe(false);
        expect(fail.currentValue).toBe(`${sysctlKey} = ${failVal}`);
      },
    );
  });

  describe("NET-NO-MAIL-PORTS — NONE sentinel takes priority", () => {
    it("passes with NONE even if port pattern exists on other lines", () => {
      const output = "NONE\nLISTEN 0.0.0.0:25 0.0.0.0:*";
      const checks = parseNetworkChecks(output, "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_MAIL_PORTS)!;
      expect(c.passed).toBe(true);
    });
  });

  describe("NET-NO-PROMISCUOUS-INTERFACES — NONE sentinel takes priority", () => {
    it("passes with NONE even if PROMISC word exists on other lines", () => {
      const output = "NONE\n3: eth0: <BROADCAST,MULTICAST,PROMISC,UP>";
      const checks = parseNetworkChecks(output, "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_PROMISCUOUS_INTERFACES)!;
      expect(c.passed).toBe(true);
    });
  });

  describe("Severity assertions for all 21 checks", () => {
    it("assigns correct severity to every check", () => {
      const checks = parseNetworkChecks(secureOutput + "\nnet.ipv4.tcp_syncookies = 1", "bare");
      const byId = (id: string) => checks.find((c) => c.id === id)!;

      // warning severity
      expect(byId(CHECK_IDS.NETWORK.NET_NO_DANGEROUS_PORTS).severity).toBe("warning");
      expect(byId(CHECK_IDS.NETWORK.NET_IP_FORWARDING).severity).toBe("warning");
      expect(byId(CHECK_IDS.NETWORK.NET_SYN_COOKIES).severity).toBe("warning");
      expect(byId(CHECK_IDS.NETWORK.NET_HOSTS_DENY).severity).toBe("warning");
      expect(byId(CHECK_IDS.NETWORK.NET_ICMP_REDIRECT_SEND).severity).toBe("warning");
      expect(byId(CHECK_IDS.NETWORK.NET_ICMP_SECURE_REDIRECT).severity).toBe("warning");
      expect(byId(CHECK_IDS.NETWORK.NET_SOURCE_ROUTING_V6).severity).toBe("warning");
      expect(byId(CHECK_IDS.NETWORK.NET_NO_EXPOSED_MGMT_PORTS).severity).toBe("warning");
      expect(byId(CHECK_IDS.NETWORK.NET_RP_FILTER).severity).toBe("warning");
      expect(byId(CHECK_IDS.NETWORK.NET_ARP_ANNOUNCE).severity).toBe("warning");
      expect(byId(CHECK_IDS.NETWORK.NET_ARP_IGNORE).severity).toBe("warning");
      expect(byId(CHECK_IDS.NETWORK.NET_NO_PROMISCUOUS_INTERFACES).severity).toBe("warning");

      // info severity
      expect(byId(CHECK_IDS.NETWORK.NET_DNS_RESOLVER).severity).toBe("info");
      expect(byId(CHECK_IDS.NETWORK.NET_TIME_SYNC).severity).toBe("info");
      expect(byId(CHECK_IDS.NETWORK.NET_HOSTS_ACCESS).severity).toBe("info");
      expect(byId(CHECK_IDS.NETWORK.NET_IPV6_DISABLED).severity).toBe("info");
      expect(byId(CHECK_IDS.NETWORK.NET_MARTIAN_LOGGING).severity).toBe("info");
      expect(byId(CHECK_IDS.NETWORK.NET_NO_MAIL_PORTS).severity).toBe("info");
      expect(byId(CHECK_IDS.NETWORK.NET_LISTENING_SERVICES_AUDIT).severity).toBe("info");
      expect(byId(CHECK_IDS.NETWORK.NET_TCP_WRAPPERS_CONFIGURED).severity).toBe("info");
      expect(byId(CHECK_IDS.NETWORK.NET_LISTENING_PORT_COUNT).severity).toBe("info");
    });
  });

  describe("NET-01 fixCommand — no dangerous ports vs dangerous ports", () => {
    it("fixCommand is review suggestion when no dangerous ports", () => {
      const checks = parseNetworkChecks("LISTEN 0.0.0.0:22 0.0.0.0:*", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_DANGEROUS_PORTS)!;
      expect(c.fixCommand).toBe("Review listening ports with: ss -tlnp");
    });
  });

  describe("NET-04 IP-FORWARDING — null ipForward value", () => {
    it("shows 'Unable to determine' when ip_forward sysctl absent", () => {
      const checks = parseNetworkChecks("no relevant sysctl here", "bare");
      const c = checks.find((c) => c.id === CHECK_IDS.NETWORK.NET_IP_FORWARDING)!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });
  });

  // ──────────────────────────────────────────────────────────────
  // MUTATION-KILLER WAVE 3 — name, fixCommand, explain, expectedValue, safeToAutoFix
  // ──────────────────────────────────────────────────────────────

  describe("[MUTATION-KILLER] NET-NO-DANGEROUS-PORTS metadata", () => {
    it("has correct name and expectedValue", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_DANGEROUS_PORTS)!;
      expect(c.name).toBe("No Dangerous Ports Exposed");
      expect(c.expectedValue).toBe("No database/service ports exposed publicly");
    });

    it("explain mentions attack vectors and database", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_DANGEROUS_PORTS)!;
      expect(c.explain).toContain("attack vectors");
      expect(c.explain).toContain("Database");
    });
  });

  describe("[MUTATION-KILLER] NET-DNS-RESOLVER metadata", () => {
    it("has correct name, severity, expectedValue", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_DNS_RESOLVER)!;
      expect(c.name).toBe("DNS Resolver Configured");
      expect(c.severity).toBe("info");
      expect(c.expectedValue).toBe("DNS resolver configured");
    });

    it("fixCommand contains nameserver and resolv.conf", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_DNS_RESOLVER)!;
      expect(c.fixCommand).toContain("nameserver");
      expect(c.fixCommand).toContain("resolv.conf");
    });

    it("explain mentions package updates and security operations", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_DNS_RESOLVER)!;
      expect(c.explain).toContain("package updates");
      expect(c.explain).toContain("security operations");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_DNS_RESOLVER)!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] NET-TIME-SYNC metadata", () => {
    it("has correct name, severity, expectedValue", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_TIME_SYNC)!;
      expect(c.name).toBe("Time Synchronization");
      expect(c.severity).toBe("info");
      expect(c.expectedValue).toBe("NTP synchronized");
    });

    it("fixCommand contains timedatectl", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_TIME_SYNC)!;
      expect(c.fixCommand).toContain("timedatectl set-ntp true");
    });

    it("explain mentions TLS certificates and audit trails", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_TIME_SYNC)!;
      expect(c.explain).toContain("TLS certificates");
      expect(c.explain).toContain("audit trails");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_TIME_SYNC)!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] NET-IP-FORWARDING metadata (bare)", () => {
    it("has correct name and severity", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_IP_FORWARDING)!;
      expect(c.name).toBe("IP Forwarding Status");
      expect(c.severity).toBe("warning");
    });

    it("fixCommand contains sysctl and ip_forward", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_IP_FORWARDING)!;
      expect(c.fixCommand).toContain("sysctl -w");
      expect(c.fixCommand).toContain("ip_forward");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_IP_FORWARDING)!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] NET-SYN-COOKIES metadata", () => {
    it("has correct name and expectedValue", () => {
      const output = secureOutput + "\nnet.ipv4.tcp_syncookies = 1";
      const c = parseNetworkChecks(output, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_SYN_COOKIES)!;
      expect(c.name).toBe("TCP SYN Cookies Enabled");
      expect(c.expectedValue).toBe("net.ipv4.tcp_syncookies = 1");
    });

    it("fixCommand contains sysctl and tcp_syncookies", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_SYN_COOKIES)!;
      expect(c.fixCommand).toContain("sysctl -w");
      expect(c.fixCommand).toContain("tcp_syncookies");
    });

    it("explain mentions SYN flood and denial-of-service", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_SYN_COOKIES)!;
      expect(c.explain).toContain("SYN flood");
      expect(c.explain).toContain("denial-of-service");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_SYN_COOKIES)!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] NET-HOSTS-ACCESS metadata", () => {
    it("has correct name, expectedValue", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_HOSTS_ACCESS)!;
      expect(c.name).toBe("TCP Wrappers hosts.allow Configured");
      expect(c.expectedValue).toBe("/etc/hosts.allow configured");
    });

    it("fixCommand contains hosts.allow and sshd", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_HOSTS_ACCESS)!;
      expect(c.fixCommand).toContain("hosts.allow");
      expect(c.fixCommand).toContain("sshd");
    });

    it("explain mentions access control layer", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_HOSTS_ACCESS)!;
      expect(c.explain).toContain("access control layer");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_HOSTS_ACCESS)!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] NET-HOSTS-DENY metadata", () => {
    it("has correct name and expectedValue", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_HOSTS_DENY)!;
      expect(c.name).toBe("TCP Wrappers Default Deny Configured");
      expect(c.expectedValue).toBe("/etc/hosts.deny contains ALL : ALL");
    });

    it("fixCommand contains hosts.deny and ALL", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_HOSTS_DENY)!;
      expect(c.fixCommand).toContain("hosts.deny");
      expect(c.fixCommand).toContain("ALL: ALL");
    });

    it("explain mentions default deny rule and blocks", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_HOSTS_DENY)!;
      expect(c.explain).toContain("default deny");
      expect(c.explain).toContain("blocks");
    });

    it("safeToAutoFix is GUARDED", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_HOSTS_DENY)!;
      expect(c.safeToAutoFix).toBe("GUARDED");
    });
  });

  describe("[MUTATION-KILLER] NET-IPV6-DISABLED metadata", () => {
    it("has correct name and expectedValue", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_IPV6_DISABLED)!;
      expect(c.name).toBe("IPv6 Disabled If Not Needed");
      expect(c.expectedValue).toBe("net.ipv6.conf.all.disable_ipv6 = 1");
    });

    it("fixCommand contains sysctl and disable_ipv6", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_IPV6_DISABLED)!;
      expect(c.fixCommand).toContain("sysctl -w");
      expect(c.fixCommand).toContain("disable_ipv6");
    });

    it("explain mentions attack surface and IPv6", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_IPV6_DISABLED)!;
      expect(c.explain).toContain("attack surface");
      expect(c.explain).toContain("IPv6");
    });

    it("safeToAutoFix is GUARDED", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_IPV6_DISABLED)!;
      expect(c.safeToAutoFix).toBe("GUARDED");
    });
  });

  describe("[MUTATION-KILLER] NET-ICMP-REDIRECT-SEND metadata", () => {
    it("has correct name and expectedValue", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_ICMP_REDIRECT_SEND)!;
      expect(c.name).toBe("ICMP Redirect Sending Disabled");
      expect(c.expectedValue).toBe("net.ipv4.conf.all.send_redirects = 0");
    });

    it("fixCommand contains sysctl and send_redirects", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_ICMP_REDIRECT_SEND)!;
      expect(c.fixCommand).toContain("sysctl -w");
      expect(c.fixCommand).toContain("send_redirects");
    });

    it("explain mentions routers and redirect traffic", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_ICMP_REDIRECT_SEND)!;
      expect(c.explain).toContain("routers");
      expect(c.explain).toContain("redirect traffic");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_ICMP_REDIRECT_SEND)!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] NET-ICMP-SECURE-REDIRECT metadata", () => {
    it("has correct name and expectedValue", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_ICMP_SECURE_REDIRECT)!;
      expect(c.name).toBe("Secure ICMP Redirects Disabled");
      expect(c.expectedValue).toBe("net.ipv4.conf.all.secure_redirects = 0");
    });

    it("fixCommand contains sysctl and secure_redirects", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_ICMP_SECURE_REDIRECT)!;
      expect(c.fixCommand).toContain("sysctl -w");
      expect(c.fixCommand).toContain("secure_redirects");
    });

    it("explain mentions gateways and routing", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_ICMP_SECURE_REDIRECT)!;
      expect(c.explain).toContain("gateways");
      expect(c.explain).toContain("routing");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_ICMP_SECURE_REDIRECT)!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] NET-SOURCE-ROUTING-V6 metadata", () => {
    it("has correct name and expectedValue", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_SOURCE_ROUTING_V6)!;
      expect(c.name).toBe("IPv6 Source Routing Disabled");
      expect(c.expectedValue).toBe("net.ipv6.conf.all.accept_source_route = 0");
    });

    it("fixCommand contains sysctl and accept_source_route", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_SOURCE_ROUTING_V6)!;
      expect(c.fixCommand).toContain("sysctl -w");
      expect(c.fixCommand).toContain("accept_source_route");
    });

    it("explain mentions traffic interception and source routing", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_SOURCE_ROUTING_V6)!;
      expect(c.explain).toContain("traffic interception");
      expect(c.explain).toContain("source routing");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_SOURCE_ROUTING_V6)!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] NET-MARTIAN-LOGGING metadata", () => {
    it("has correct name and expectedValue", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_MARTIAN_LOGGING)!;
      expect(c.name).toBe("Martian Packet Logging Enabled");
      expect(c.expectedValue).toBe("net.ipv4.conf.all.log_martians = 1");
    });

    it("fixCommand contains sysctl and log_martians", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_MARTIAN_LOGGING)!;
      expect(c.fixCommand).toContain("sysctl -w");
      expect(c.fixCommand).toContain("log_martians");
    });

    it("explain mentions spoofed and network anomalies", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_MARTIAN_LOGGING)!;
      expect(c.explain).toContain("spoofed");
      expect(c.explain).toContain("network anomalies");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_MARTIAN_LOGGING)!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] NET-NO-EXPOSED-MGMT-PORTS metadata", () => {
    it("has correct name and expectedValue", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_EXPOSED_MGMT_PORTS)!;
      expect(c.name).toBe("No Management Ports Exposed Publicly");
      expect(c.expectedValue).toBe("Ports 8080, 8443, 9000, 3000 not exposed on 0.0.0.0");
    });

    it("fixCommand contains ufw deny and port numbers", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_EXPOSED_MGMT_PORTS)!;
      expect(c.fixCommand).toContain("ufw deny");
      expect(c.fixCommand).toContain("8080");
      expect(c.fixCommand).toContain("9000");
    });

    it("explain mentions unauthorized access and exploitation", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_EXPOSED_MGMT_PORTS)!;
      expect(c.explain).toContain("unauthorized access");
      expect(c.explain).toContain("exploitation");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_EXPOSED_MGMT_PORTS)!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] NET-RP-FILTER metadata (bare)", () => {
    it("has correct name", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_RP_FILTER)!;
      expect(c.name).toBe("Reverse Path Filtering Enabled");
    });

    it("fixCommand (bare) contains sysctl and rp_filter=1", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_RP_FILTER)!;
      expect(c.fixCommand).toContain("sysctl -w");
      expect(c.fixCommand).toContain("rp_filter=1");
    });

    it("explain (bare) mentions spoofed source addresses", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_RP_FILTER)!;
      expect(c.explain).toContain("spoofed source addresses");
    });
  });

  describe("[MUTATION-KILLER] NET-NO-MAIL-PORTS metadata", () => {
    it("has correct name and expectedValue", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_MAIL_PORTS)!;
      expect(c.name).toBe("No Unnecessary Mail Ports Open");
      expect(c.expectedValue).toBe("Ports 25, 110, 143 not listening (unless mail server)");
    });

    it("fixCommand contains ufw deny and mail ports", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_MAIL_PORTS)!;
      expect(c.fixCommand).toContain("ufw deny 25/tcp");
      expect(c.fixCommand).toContain("ufw deny 110/tcp");
      expect(c.fixCommand).toContain("ufw deny 143/tcp");
    });

    it("explain mentions unnecessary services and attack surface", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_MAIL_PORTS)!;
      expect(c.explain).toContain("unnecessary services");
      expect(c.explain).toContain("attack surface");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_MAIL_PORTS)!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] NET-LISTENING-SERVICES-AUDIT metadata", () => {
    it("has correct name and expectedValue", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_LISTENING_SERVICES_AUDIT)!;
      expect(c.name).toBe("Listening Services Count Reasonable");
      expect(c.expectedValue).toBe("Fewer than 20 listening TCP services");
    });

    it("fixCommand contains ss -tlnp", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_LISTENING_SERVICES_AUDIT)!;
      expect(c.fixCommand).toContain("ss -tlnp");
      expect(c.fixCommand).toContain("ufw deny");
    });

    it("explain mentions service hygiene and attack surface", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_LISTENING_SERVICES_AUDIT)!;
      expect(c.explain).toContain("service hygiene");
      expect(c.explain).toContain("attack surface");
    });

    it("safeToAutoFix is GUARDED", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_LISTENING_SERVICES_AUDIT)!;
      expect(c.safeToAutoFix).toBe("GUARDED");
    });
  });

  describe("[MUTATION-KILLER] NET-NO-PROMISCUOUS-INTERFACES metadata", () => {
    it("has correct name and expectedValue", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_PROMISCUOUS_INTERFACES)!;
      expect(c.name).toBe("No Promiscuous Mode Interfaces");
      expect(c.expectedValue).toBe("No network interfaces in PROMISC mode");
    });

    it("fixCommand contains ip link set and promisc off", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_PROMISCUOUS_INTERFACES)!;
      expect(c.fixCommand).toContain("ip link set");
      expect(c.fixCommand).toContain("promisc off");
    });

    it("explain mentions network sniffing and malware", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_PROMISCUOUS_INTERFACES)!;
      expect(c.explain).toContain("network sniffing");
      expect(c.explain).toContain("malware");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_PROMISCUOUS_INTERFACES)!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] NET-ARP-ANNOUNCE metadata", () => {
    it("has correct name and expectedValue", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_ARP_ANNOUNCE)!;
      expect(c.name).toBe("ARP Announce Protection Enabled");
      expect(c.expectedValue).toBe("net.ipv4.conf.all.arp_announce = 2");
    });

    it("fixCommand contains sysctl and arp_announce", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_ARP_ANNOUNCE)!;
      expect(c.fixCommand).toContain("sysctl -w");
      expect(c.fixCommand).toContain("arp_announce");
    });

    it("explain mentions ARP spoofing and interface address", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_ARP_ANNOUNCE)!;
      expect(c.explain).toContain("ARP spoofing");
      expect(c.explain).toContain("interface address");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_ARP_ANNOUNCE)!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] NET-ARP-IGNORE metadata", () => {
    it("has correct name and expectedValue", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_ARP_IGNORE)!;
      expect(c.name).toBe("ARP Ignore Protection Enabled");
      expect(c.expectedValue).toBe("net.ipv4.conf.all.arp_ignore >= 1");
    });

    it("fixCommand contains sysctl and arp_ignore", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_ARP_IGNORE)!;
      expect(c.fixCommand).toContain("sysctl -w");
      expect(c.fixCommand).toContain("arp_ignore");
    });

    it("explain mentions ARP cache poisoning", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_ARP_IGNORE)!;
      expect(c.explain).toContain("ARP cache poisoning");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_ARP_IGNORE)!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] NET-TCP-WRAPPERS-CONFIGURED metadata", () => {
    it("has correct name and expectedValue", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_TCP_WRAPPERS_CONFIGURED)!;
      expect(c.name).toBe("TCP Wrappers Active Rules Present");
      expect(c.expectedValue).toBe("At least one active access control rule in /etc/hosts.allow");
    });

    it("fixCommand contains hosts.allow and hosts.deny", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_TCP_WRAPPERS_CONFIGURED)!;
      expect(c.fixCommand).toContain("hosts.allow");
      expect(c.fixCommand).toContain("hosts.deny");
    });

    it("explain mentions additional layer and access control", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_TCP_WRAPPERS_CONFIGURED)!;
      expect(c.explain).toContain("additional layer");
      expect(c.explain).toContain("access control");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_TCP_WRAPPERS_CONFIGURED)!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] NET-LISTENING-PORT-COUNT metadata", () => {
    it("has correct name and expectedValue", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_LISTENING_PORT_COUNT)!;
      expect(c.name).toBe("Listening Port Count Reasonable");
      expect(c.expectedValue).toBe("20 or fewer listening TCP ports");
    });

    it("fixCommand contains ss -tlnp and review", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_LISTENING_PORT_COUNT)!;
      expect(c.fixCommand).toContain("ss -tlnp");
      expect(c.fixCommand).toContain("review");
    });

    it("explain mentions unnecessary services and attack vector", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_LISTENING_PORT_COUNT)!;
      expect(c.explain).toContain("unnecessary services");
      expect(c.explain).toContain("attack vector");
    });

    it("safeToAutoFix is SAFE", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_LISTENING_PORT_COUNT)!;
      expect(c.safeToAutoFix).toBe("SAFE");
    });
  });

  describe("[MUTATION-KILLER] N/A output preserves all metadata strings", () => {
    it("all 21 checks preserve id, name, category, expectedValue, fixCommand, explain on N/A", () => {
      const naChecks = parseNetworkChecks("N/A", "bare");
      const normalChecks = parseNetworkChecks(secureOutput, "bare");
      expect(naChecks).toHaveLength(21);
      for (let i = 0; i < naChecks.length; i++) {
        expect(naChecks[i].id).toBe(normalChecks[i].id);
        expect(naChecks[i].name).toBe(normalChecks[i].name);
        expect(naChecks[i].category).toBe("Network");
        expect(naChecks[i].expectedValue).toBe(normalChecks[i].expectedValue);
        expect(naChecks[i].fixCommand).toBe(normalChecks[i].fixCommand);
        expect(naChecks[i].explain).toBe(normalChecks[i].explain);
      }
    });
  });

  describe("[MUTATION-KILLER] currentValue strings on pass", () => {
    it("NET-HOSTS-ACCESS currentValue on pass", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_HOSTS_ACCESS)!;
      expect(c.currentValue).toBe("/etc/hosts.allow exists");
    });

    it("NET-HOSTS-DENY currentValue on pass", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_HOSTS_DENY)!;
      expect(c.currentValue).toBe("/etc/hosts.deny has ALL:ALL deny rule");
    });

    it("NET-NO-EXPOSED-MGMT-PORTS currentValue on pass", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_EXPOSED_MGMT_PORTS)!;
      expect(c.currentValue).toBe("No management ports (8080, 8443, 9000, 3000) on 0.0.0.0");
    });

    it("NET-NO-MAIL-PORTS currentValue on pass", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_MAIL_PORTS)!;
      expect(c.currentValue).toBe("No unexpected mail ports open");
    });

    it("NET-NO-PROMISCUOUS-INTERFACES currentValue on pass", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_PROMISCUOUS_INTERFACES)!;
      expect(c.currentValue).toBe("No promiscuous mode interfaces");
    });

    it("NET-TCP-WRAPPERS-CONFIGURED currentValue on pass", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_TCP_WRAPPERS_CONFIGURED)!;
      expect(c.currentValue).toBe("Active rules found in /etc/hosts.allow");
    });

    it("NET-NO-DANGEROUS-PORTS currentValue on pass (no dangerous)", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_DANGEROUS_PORTS)!;
      expect(c.currentValue).toContain("no dangerous ports exposed");
    });

    it("NET-LISTENING-PORT-COUNT currentValue on pass", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_LISTENING_PORT_COUNT)!;
      expect(c.currentValue).toBe("15 listening TCP ports");
    });

    it("NET-DNS-RESOLVER currentValue exact pass string", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_DNS_RESOLVER)!;
      expect(c.currentValue).toBe("DNS resolver configured");
    });

    it("NET-TIME-SYNC currentValue exact pass string", () => {
      const c = parseNetworkChecks(secureOutput, "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_TIME_SYNC)!;
      expect(c.currentValue).toBe("NTP synchronized");
    });
  });

  describe("[MUTATION-KILLER] currentValue strings on fail", () => {
    it("NET-HOSTS-ACCESS currentValue on fail", () => {
      const c = parseNetworkChecks("NO_HOSTS_ALLOW", "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_HOSTS_ACCESS)!;
      expect(c.currentValue).toBe("/etc/hosts.allow not found");
    });

    it("NET-HOSTS-DENY currentValue on fail (no ALL:ALL)", () => {
      const c = parseNetworkChecks("no deny rule here", "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_HOSTS_DENY)!;
      expect(c.currentValue).toBe("/etc/hosts.deny missing or no default deny");
    });

    it("NET-NO-MAIL-PORTS currentValue on fail", () => {
      const c = parseNetworkChecks("LISTEN 0.0.0.0:25 0.0.0.0:*", "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_MAIL_PORTS)!;
      expect(c.currentValue).toBe("Mail service port(s) (25/110/143) detected");
    });

    it("NET-NO-PROMISCUOUS-INTERFACES currentValue on fail", () => {
      const c = parseNetworkChecks("3: eth0: <BROADCAST,MULTICAST,PROMISC,UP>", "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_PROMISCUOUS_INTERFACES)!;
      expect(c.currentValue).toBe("Promiscuous mode interface(s) detected");
    });

    it("NET-NO-EXPOSED-MGMT-PORTS currentValue on fail", () => {
      const c = parseNetworkChecks("LISTEN 0.0.0.0:8080 0.0.0.0:*", "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_EXPOSED_MGMT_PORTS)!;
      expect(c.currentValue).toBe("Management port(s) exposed on 0.0.0.0");
    });

    it("NET-TCP-WRAPPERS-CONFIGURED currentValue on fail (EMPTY)", () => {
      const c = parseNetworkChecks("EMPTY", "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_TCP_WRAPPERS_CONFIGURED)!;
      expect(c.currentValue).toBe("No active rules in /etc/hosts.allow");
    });

    it("NET-DNS-RESOLVER currentValue on fail", () => {
      const c = parseNetworkChecks("no dns here", "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_DNS_RESOLVER)!;
      expect(c.currentValue).toBe("No DNS resolver found");
    });

    it("NET-TIME-SYNC currentValue on fail", () => {
      const c = parseNetworkChecks("NTP synchronized: no", "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_TIME_SYNC)!;
      expect(c.currentValue).toBe("NTP status unknown");
    });

    it("NET-LISTENING-PORT-COUNT currentValue on null count", () => {
      const c = parseNetworkChecks("no numbers here", "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_LISTENING_PORT_COUNT)!;
      expect(c.currentValue).toBe("Port count not determinable");
    });

    it("NET-CRON-D-FILE-COUNT currentValue shows 'Unable to determine' on no number", () => {
      const c = parseNetworkChecks("no numbers", "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_LISTENING_SERVICES_AUDIT)!;
      expect(c.currentValue).toContain("listening TCP services detected");
    });
  });

  describe("[MUTATION-KILLER] platform-specific strings (coolify/dokploy)", () => {
    const platformOutput = "net.ipv4.ip_forward = 1\nnet.ipv4.conf.all.rp_filter = 2";

    it("NET-IP-FORWARDING expectedValue on coolify mentions Docker", () => {
      const c = parseNetworkChecks(platformOutput, "coolify").find((c) => c.id === CHECK_IDS.NETWORK.NET_IP_FORWARDING)!;
      expect(c.expectedValue).toContain("Docker");
      expect(c.passed).toBe(true);
    });

    it("NET-IP-FORWARDING explain on coolify mentions Docker networking", () => {
      const c = parseNetworkChecks(platformOutput, "coolify").find((c) => c.id === CHECK_IDS.NETWORK.NET_IP_FORWARDING)!;
      expect(c.explain).toContain("Docker networking");
    });

    it("NET-RP-FILTER expectedValue on coolify mentions loose mode", () => {
      const c = parseNetworkChecks(platformOutput, "coolify").find((c) => c.id === CHECK_IDS.NETWORK.NET_RP_FILTER)!;
      expect(c.expectedValue).toContain("loose mode");
    });

    it("NET-RP-FILTER fixCommand on coolify uses rp_filter=2", () => {
      const c = parseNetworkChecks(platformOutput, "coolify").find((c) => c.id === CHECK_IDS.NETWORK.NET_RP_FILTER)!;
      expect(c.fixCommand).toContain("rp_filter=2");
    });

    it("NET-RP-FILTER explain on coolify mentions Docker Swarm IPVS", () => {
      const c = parseNetworkChecks(platformOutput, "coolify").find((c) => c.id === CHECK_IDS.NETWORK.NET_RP_FILTER)!;
      expect(c.explain).toContain("Docker Swarm");
    });

    it("NET-IP-FORWARDING explain on bare mentions router or Docker", () => {
      const c = parseNetworkChecks("net.ipv4.ip_forward = 0", "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_IP_FORWARDING)!;
      expect(c.explain).toContain("router");
    });

    it("NET-RP-FILTER explain on bare mentions spoofed source", () => {
      const c = parseNetworkChecks("net.ipv4.conf.all.rp_filter = 1", "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_RP_FILTER)!;
      expect(c.explain).toContain("spoofed source addresses");
    });
  });

  describe("[MUTATION-KILLER] NET-NO-DANGEROUS-PORTS fixCommand dynamic", () => {
    it("fixCommand includes first dangerous port when present", () => {
      const c = parseNetworkChecks("LISTEN 0.0.0.0:5432 0.0.0.0:*", "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_DANGEROUS_PORTS)!;
      expect(c.fixCommand).toBe("ufw deny 5432/tcp");
    });

    it("fixCommand is review suggestion when no dangerous ports", () => {
      const c = parseNetworkChecks("LISTEN 0.0.0.0:22 0.0.0.0:*", "bare").find((c) => c.id === CHECK_IDS.NETWORK.NET_NO_DANGEROUS_PORTS)!;
      expect(c.fixCommand).toBe("Review listening ports with: ss -tlnp");
    });
  });
});
