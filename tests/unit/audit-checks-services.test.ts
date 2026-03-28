import { parseServicesChecks } from "../../src/core/audit/checks/services.js";

describe("parseServicesChecks", () => {
  const secureOutput = [
    // Legacy services all inactive
    "inactive",
    "inactive",
    "inactive",
    "inactive",
    "inactive",
    "inactive",
    // Network services all inactive
    "inactive",
    "inactive",
    "inactive",
    "inactive",
    "inactive",
    "inactive",
    "inactive",
    "inactive",
    "inactive",
    "inactive",
    "inactive",
    "inactive",
    // No inetd
    "NONE",
    // No xinetd
    "NONE",
    // Running service count (standalone number 1-200)
    "18",
    // SVC-NO-WILDCARD-LISTENERS: 3 wildcard listeners (<=5 = pass)
    "3",
    // SVC-NO-WILDCARD-LISTENERS details
    "NONE",
    // SVC-NO-XINETD-SERVICES: xinetd inactive
    "inactive",
    // SVC-NO-WORLD-READABLE-CONFIGS: no world-readable configs
    "NONE",
  ].join("\n");

  const insecureOutput = [
    // telnet active
    "telnet active",
    "rsh active",
    "rlogin active",
    "vsftpd active",
    "ftp active",
    "tftpd active",
    // Network services
    "nfs-server active",
    "rpcbind active",
    "smbd active",
    "avahi-daemon active",
    "cups active",
    "isc-dhcp-server active",
    "named active",
    "snmpd active",
    "squid active",
    "xinetd active",
    "ypserv active",
    // inetd with dangerous services
    "telnet stream tcp nowait root /usr/sbin/telnetd",
    "chargen stream tcp nowait root internal",
    "daytime stream tcp nowait root internal",
    "discard stream tcp nowait root internal",
    "echo stream tcp nowait root internal",
  ].join("\n");

  it("should return 25 checks for the Services category", () => {
    const checks = parseServicesChecks(secureOutput, "bare");
    expect(checks).toHaveLength(25);
    checks.forEach((c) => expect(c.category).toBe("Services"));
  });

  it("all check IDs should start with SVC-", () => {
    const checks = parseServicesChecks(secureOutput, "bare");
    checks.forEach((c) => expect(c.id).toMatch(/^SVC-/));
  });

  it("all checks should have explain > 20 chars and fixCommand defined", () => {
    const checks = parseServicesChecks(secureOutput, "bare");
    checks.forEach((c) => {
      expect(c.explain!.length).toBeGreaterThan(20);
      expect(c.fixCommand).toBeDefined();
      expect(c.fixCommand!.length).toBeGreaterThan(0);
    });
  });

  it("SVC-NO-TELNET passes when telnet is inactive", () => {
    const checks = parseServicesChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "SVC-NO-TELNET");
    expect(check!.passed).toBe(true);
  });

  it("SVC-NO-TELNET fails when telnet is active", () => {
    const checks = parseServicesChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === "SVC-NO-TELNET");
    expect(check!.passed).toBe(false);
  });

  it("SVC-NO-RSH passes when rsh is inactive", () => {
    const checks = parseServicesChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "SVC-NO-RSH");
    expect(check!.passed).toBe(true);
  });

  it("SVC-NO-FTP fails when vsftpd is active", () => {
    const checks = parseServicesChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === "SVC-NO-FTP");
    expect(check!.passed).toBe(false);
  });

  it("treats 'not-found' as passing (service not installed)", () => {
    const notFoundOutput = "not-found\nnot-found\nnot-found\nNONE\nNONE";
    const checks = parseServicesChecks(notFoundOutput, "bare");
    const telnet = checks.find((c) => c.id === "SVC-NO-TELNET");
    expect(telnet!.passed).toBe(true);
  });

  it("SVC-NO-INETD passes when no inetd.conf", () => {
    const checks = parseServicesChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "SVC-NO-INETD");
    expect(check!.passed).toBe(true);
  });

  it("SVC-NO-CHARGEN fails when chargen in inetd", () => {
    const checks = parseServicesChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === "SVC-NO-CHARGEN");
    expect(check!.passed).toBe(false);
  });

  it("should handle N/A output gracefully", () => {
    const checks = parseServicesChecks("N/A", "bare");
    expect(checks).toHaveLength(25);
    checks.forEach((c) => {
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });
  });

  it("should handle empty string output gracefully", () => {
    const checks = parseServicesChecks("", "bare");
    expect(checks).toHaveLength(25);
    checks.forEach((c) => expect(c.passed).toBe(false));
  });

  it("SVC-RUNNING-COUNT-REASONABLE passes when running count is 18", () => {
    const checks = parseServicesChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "SVC-RUNNING-COUNT-REASONABLE");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("severity budget: <= 40% critical checks", () => {
    const checks = parseServicesChecks("", "bare");
    const criticalCount = checks.filter((c) => c.severity === "critical").length;
    const ratio = criticalCount / checks.length;
    expect(ratio).toBeLessThanOrEqual(0.4);
  });

  it("SVC-NO-WILDCARD-LISTENERS passes when <= 5 wildcard listeners", () => {
    const checks = parseServicesChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "SVC-NO-WILDCARD-LISTENERS");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("warning");
    expect(check!.currentValue).toContain("3");
  });

  it("SVC-NO-WILDCARD-LISTENERS fails when > 5 wildcard listeners", () => {
    const output = ["inactive","inactive","inactive","inactive","inactive","inactive",
      "inactive","inactive","inactive","inactive","inactive","inactive","inactive",
      "inactive","inactive","inactive","inactive","inactive","NONE","NONE","5","10",
      "NONE","inactive","NONE"].join("\n");
    const checks = parseServicesChecks(output, "bare");
    const check = checks.find((c) => c.id === "SVC-NO-WILDCARD-LISTENERS");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toContain("10");
  });

  it("SVC-NO-XINETD-SERVICES passes when xinetd is not active", () => {
    const checks = parseServicesChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "SVC-NO-XINETD-SERVICES");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("info");
    expect(check!.currentValue).toContain("not running");
  });

  it("SVC-NO-XINETD-SERVICES fails when xinetd is active", () => {
    const activeOutput = "inactive\ninactive\ninactive\ninactive\ninactive\ninactive\n"
      + "inactive\ninactive\ninactive\ninactive\ninactive\ninactive\ninactive\n"
      + "inactive\ninactive\nxinetd active\ninactive\ninactive\nNONE\nNONE\n18\n3\nNONE\nactive\nNONE";
    const checks = parseServicesChecks(activeOutput, "bare");
    const check = checks.find((c) => c.id === "SVC-NO-XINETD-SERVICES");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("SVC-NO-WORLD-READABLE-CONFIGS passes when no world-readable configs", () => {
    const checks = parseServicesChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "SVC-NO-WORLD-READABLE-CONFIGS");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("info");
  });

  it("SVC-NO-WORLD-READABLE-CONFIGS fails when world-readable configs found", () => {
    const worldReadableOutput = "inactive\ninactive\ninactive\ninactive\ninactive\ninactive\n"
      + "inactive\ninactive\ninactive\ninactive\ninactive\ninactive\ninactive\n"
      + "inactive\ninactive\ninactive\ninactive\ninactive\nNONE\nNONE\n18\n3\nNONE\ninactive\n"
      + "/etc/systemd/system/myservice.conf";
    const checks = parseServicesChecks(worldReadableOutput, "bare");
    const check = checks.find((c) => c.id === "SVC-NO-WORLD-READABLE-CONFIGS");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toContain("1");
  });
});

// ============================================================
// Mutation-killer tests: target survived mutants in services.ts
// ============================================================
describe("parseServicesChecks — mutation killers", () => {
  // Helper: build a baseline output where all services are inactive
  const baseline = (overrides: Record<number, string> = {}): string => {
    const lines = [
      "inactive", // 0: telnet (isServiceLineActive index 0)
      "inactive", // 1: rsh
      "inactive", // 2: rlogin
      "inactive", // 3: ftp/vsftpd
      "inactive", // 4: tftp
      "inactive", // 5: nfs-server
      "inactive", // 6: rpcbind
      "inactive", // 7: samba/smbd
      "inactive", // 8: avahi-daemon
      "inactive", // 9: cups
      "inactive", // 10: isc-dhcp-server
      "inactive", // 11: named/bind9
      "inactive", // 12: snmpd
      "inactive", // 13: squid
      "inactive", // 14: xinetd
      "inactive", // 15: ypserv
      "inactive", // 16: extra
      "inactive", // 17: extra
      "NONE",     // 18: inetd section
      "NONE",     // 19: chargen/daytime/discard/echo section
      "18",       // 20: running service count
      "3",        // 21: wildcard listener count
      "NONE",     // 22: extra
      "inactive", // 23: xinetd-services
      "NONE",     // 24: world-readable configs
    ];
    for (const [idx, val] of Object.entries(overrides)) {
      lines[Number(idx)] = val;
    }
    return lines.join("\n");
  };

  const findCheck = (checks: ReturnType<typeof parseServicesChecks>, id: string) =>
    checks.find((c) => c.id === id)!;

  // Helper: build output with NO "NONE" anywhere (for inetd/chargen/daytime/discard/echo tests)
  const baselineNoNone = (overrides: Record<number, string> = {}): string => {
    const b = baseline(overrides);
    return b.split("\n").map(l => l === "NONE" ? "safe" : l).join("\n");
  };

  // ── L25-29: isServiceLineActive — ArrowFunction, MethodExpression, ConditionalExpression, EqualityOperator ──

  describe("isServiceLineActive (L25-29)", () => {
    it("SVC-NO-TELNET fails when first line is literally 'active'", () => {
      const output = baseline({ 0: "active" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-TELNET").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-TELNET").currentValue).toContain("telnet is active");
    });

    it("SVC-NO-TELNET passes when first line is empty then inactive", () => {
      const output = "\n\ninactive\ninactive\n" + baseline().split("\n").slice(2).join("\n");
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-TELNET").passed).toBe(true);
    });

    it("SVC-NO-TELNET passes when index >= lines.length (short output)", () => {
      const checks = parseServicesChecks("short", "bare");
      expect(findCheck(checks, "SVC-NO-TELNET").passed).toBe(true);
    });

    it("SVC-NO-TELNET fails via regex path (telnet...active in text)", () => {
      const output = baseline({ 0: "telnet service is active and running" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-TELNET").passed).toBe(false);
    });

    it("SVC-NO-TELNET passes when line contains 'active' but not as exact match and no telnet keyword", () => {
      const output = baseline({ 0: "activeX" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-TELNET").passed).toBe(true);
    });
  });

  // ── L32: ArrayDeclaration — SERVICES_CHECKS array must have 25 elements ──

  describe("ArrayDeclaration (L32)", () => {
    it("always returns exactly 25 checks regardless of input", () => {
      expect(parseServicesChecks("anything", "bare")).toHaveLength(25);
      expect(parseServicesChecks("", "bare")).toHaveLength(25);
      expect(parseServicesChecks("N/A", "bare")).toHaveLength(25);
    });
  });

  // ── L39-73: Regex patterns for legacy services ──

  describe("Regex service detection patterns (L39-73)", () => {
    it("SVC-NO-RSH fails only when rsh word boundary matches", () => {
      const output = baseline({ 1: "rsh active" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-RSH").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-RSH").currentValue).toBe("rsh is active");
    });

    it("SVC-NO-RSH passes when 'crash active' (no word boundary for rsh)", () => {
      const output = baseline({ 1: "crash active" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-RSH").passed).toBe(true);
      expect(findCheck(checks, "SVC-NO-RSH").currentValue).toBe("rsh is not running");
    });

    it("SVC-NO-RLOGIN fails when rlogin is active", () => {
      const output = baseline({ 2: "rlogin active" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-RLOGIN").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-RLOGIN").currentValue).toBe("rlogin is active");
    });

    it("SVC-NO-RLOGIN passes when rlogin is not present", () => {
      const checks = parseServicesChecks(baseline(), "bare");
      expect(findCheck(checks, "SVC-NO-RLOGIN").passed).toBe(true);
      expect(findCheck(checks, "SVC-NO-RLOGIN").currentValue).toBe("rlogin is not running");
    });

    it("SVC-NO-FTP fails via vsftpd path", () => {
      const output = baseline({ 3: "vsftpd active" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-FTP").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-FTP").currentValue).toBe("FTP server is active");
    });

    it("SVC-NO-FTP fails via ftp path (second regex)", () => {
      const output = baseline({ 3: "ftp active" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-FTP").passed).toBe(false);
    });

    it("SVC-NO-FTP passes when neither vsftpd nor ftp active", () => {
      const checks = parseServicesChecks(baseline(), "bare");
      expect(findCheck(checks, "SVC-NO-FTP").passed).toBe(true);
      expect(findCheck(checks, "SVC-NO-FTP").currentValue).toBe("FTP server is not running");
    });

    it("SVC-NO-TFTP fails via tftpd path", () => {
      const output = baseline({ 4: "tftpd active" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-TFTP").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-TFTP").currentValue).toBe("TFTP is active");
    });

    it("SVC-NO-TFTP fails via tftp path (second regex)", () => {
      const output = baseline({ 4: "tftp active" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-TFTP").passed).toBe(false);
    });

    it("SVC-NO-TFTP passes when inactive", () => {
      const checks = parseServicesChecks(baseline(), "bare");
      expect(findCheck(checks, "SVC-NO-TFTP").passed).toBe(true);
      expect(findCheck(checks, "SVC-NO-TFTP").currentValue).toBe("TFTP is not running");
    });
  });

  // ── L75-128: BooleanLiteral, ConditionalExpression, LogicalOperator, Regex — network services ──

  describe("Network service checks (L75-128)", () => {
    it("SVC-NFS-RESTRICTED fails when nfs-server active", () => {
      const output = baseline({ 5: "nfs-server active" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NFS-RESTRICTED").passed).toBe(false);
      expect(findCheck(checks, "SVC-NFS-RESTRICTED").currentValue).toBe("NFS server is running");
    });

    it("SVC-NFS-RESTRICTED passes when nfs-server not active", () => {
      const checks = parseServicesChecks(baseline(), "bare");
      expect(findCheck(checks, "SVC-NFS-RESTRICTED").passed).toBe(true);
      expect(findCheck(checks, "SVC-NFS-RESTRICTED").currentValue).toBe("NFS server is not running");
    });

    it("SVC-NO-RPCBIND fails when rpcbind active", () => {
      const output = baseline({ 6: "rpcbind active" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-RPCBIND").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-RPCBIND").currentValue).toBe("rpcbind is running");
    });

    it("SVC-NO-RPCBIND passes when inactive", () => {
      const checks = parseServicesChecks(baseline(), "bare");
      expect(findCheck(checks, "SVC-NO-RPCBIND").passed).toBe(true);
      expect(findCheck(checks, "SVC-NO-RPCBIND").currentValue).toBe("rpcbind is not running");
    });

    it("SVC-SAMBA-RESTRICTED fails via smbd path", () => {
      const output = baseline({ 7: "smbd active" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-SAMBA-RESTRICTED").passed).toBe(false);
      expect(findCheck(checks, "SVC-SAMBA-RESTRICTED").currentValue).toBe("Samba is running");
    });

    it("SVC-SAMBA-RESTRICTED fails via nmbd path", () => {
      const output = baseline({ 7: "nmbd active" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-SAMBA-RESTRICTED").passed).toBe(false);
    });

    it("SVC-SAMBA-RESTRICTED passes when neither smbd nor nmbd", () => {
      const checks = parseServicesChecks(baseline(), "bare");
      expect(findCheck(checks, "SVC-SAMBA-RESTRICTED").passed).toBe(true);
      expect(findCheck(checks, "SVC-SAMBA-RESTRICTED").currentValue).toBe("Samba is not running");
    });

    it("SVC-NO-AVAHI fails when avahi-daemon active", () => {
      const output = baseline({ 8: "avahi-daemon active" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-AVAHI").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-AVAHI").currentValue).toBe("avahi-daemon is running");
    });

    it("SVC-NO-AVAHI passes when inactive", () => {
      const checks = parseServicesChecks(baseline(), "bare");
      expect(findCheck(checks, "SVC-NO-AVAHI").passed).toBe(true);
      expect(findCheck(checks, "SVC-NO-AVAHI").currentValue).toBe("avahi-daemon is not running");
    });

    it("SVC-NO-CUPS fails when cups active", () => {
      const output = baseline({ 9: "cups active" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-CUPS").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-CUPS").currentValue).toBe("CUPS is running");
    });

    it("SVC-NO-CUPS passes when inactive", () => {
      const checks = parseServicesChecks(baseline(), "bare");
      expect(findCheck(checks, "SVC-NO-CUPS").passed).toBe(true);
      expect(findCheck(checks, "SVC-NO-CUPS").currentValue).toBe("CUPS is not running");
    });

    it("SVC-NO-DHCP-SERVER fails when isc-dhcp-server active", () => {
      const output = baseline({ 10: "isc-dhcp-server active" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-DHCP-SERVER").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-DHCP-SERVER").currentValue).toBe("DHCP server is running");
    });

    it("SVC-NO-DHCP-SERVER passes when inactive", () => {
      const checks = parseServicesChecks(baseline(), "bare");
      expect(findCheck(checks, "SVC-NO-DHCP-SERVER").passed).toBe(true);
      expect(findCheck(checks, "SVC-NO-DHCP-SERVER").currentValue).toBe("DHCP server is not running");
    });

    it("SVC-NO-DNS-SERVER fails via named path", () => {
      const output = baseline({ 11: "named active" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-DNS-SERVER").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-DNS-SERVER").currentValue).toBe("DNS server is running");
    });

    it("SVC-NO-DNS-SERVER fails via bind9 path", () => {
      const output = baseline({ 11: "bind9 active" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-DNS-SERVER").passed).toBe(false);
    });

    it("SVC-NO-DNS-SERVER passes when inactive", () => {
      const checks = parseServicesChecks(baseline(), "bare");
      expect(findCheck(checks, "SVC-NO-DNS-SERVER").passed).toBe(true);
      expect(findCheck(checks, "SVC-NO-DNS-SERVER").currentValue).toBe("DNS server is not running");
    });

    it("SVC-NO-SNMP fails when snmpd active", () => {
      const output = baseline({ 12: "snmpd active" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-SNMP").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-SNMP").currentValue).toBe("SNMP is running");
    });

    it("SVC-NO-SNMP passes when inactive", () => {
      const checks = parseServicesChecks(baseline(), "bare");
      expect(findCheck(checks, "SVC-NO-SNMP").passed).toBe(true);
      expect(findCheck(checks, "SVC-NO-SNMP").currentValue).toBe("SNMP is not running");
    });

    it("SVC-NO-SQUID fails when squid active", () => {
      const output = baseline({ 13: "squid active" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-SQUID").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-SQUID").currentValue).toBe("Squid proxy is running");
    });

    it("SVC-NO-SQUID passes when inactive", () => {
      const checks = parseServicesChecks(baseline(), "bare");
      expect(findCheck(checks, "SVC-NO-SQUID").passed).toBe(true);
      expect(findCheck(checks, "SVC-NO-SQUID").currentValue).toBe("Squid proxy is not running");
    });

    it("SVC-NO-XINETD fails when xinetd active", () => {
      const output = baseline({ 14: "xinetd active" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-XINETD").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-XINETD").currentValue).toBe("xinetd is running");
    });

    it("SVC-NO-XINETD passes when inactive", () => {
      const checks = parseServicesChecks(baseline(), "bare");
      expect(findCheck(checks, "SVC-NO-XINETD").passed).toBe(true);
      expect(findCheck(checks, "SVC-NO-XINETD").currentValue).toBe("xinetd is not running");
    });

    it("SVC-NO-YPSERV fails when ypserv active", () => {
      const output = baseline({ 15: "ypserv active" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-YPSERV").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-YPSERV").currentValue).toBe("NIS is running");
    });

    it("SVC-NO-YPSERV passes when inactive", () => {
      const checks = parseServicesChecks(baseline(), "bare");
      expect(findCheck(checks, "SVC-NO-YPSERV").passed).toBe(true);
      expect(findCheck(checks, "SVC-NO-YPSERV").currentValue).toBe("NIS is not running");
    });
  });

  // ── L313-371: SVC-NO-INETD — ConditionalExpression, LogicalOperator, BooleanLiteral, BlockStatement ──

  describe("SVC-NO-INETD edge cases (L313-371)", () => {
    it("passes when output includes NONE", () => {
      const output = baseline({ 18: "NONE" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-INETD").passed).toBe(true);
      expect(findCheck(checks, "SVC-NO-INETD").currentValue).toBe("No inetd.conf or no dangerous entries");
    });

    it("passes when output does not contain 'inetd' at all", () => {
      const output = "some random output with no relevant keywords\ninactive\ninactive";
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-INETD").passed).toBe(true);
    });

    it("fails when inetd output contains telnet", () => {
      const output = baselineNoNone({ 18: "inetd telnet stream tcp" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-INETD").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-INETD").currentValue).toBe("Dangerous services found in inetd.conf");
    });

    it("fails when inetd output contains ftp", () => {
      const output = baselineNoNone({ 18: "inetd ftp stream tcp" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-INETD").passed).toBe(false);
    });

    it("fails when inetd output contains rsh", () => {
      const output = baselineNoNone({ 18: "inetd rsh stream tcp" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-INETD").passed).toBe(false);
    });

    it("fails when inetd output contains rlogin", () => {
      const output = baselineNoNone({ 18: "inetd rlogin stream tcp" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-INETD").passed).toBe(false);
    });

    it("fails when inetd output contains tftp", () => {
      const output = baselineNoNone({ 18: "inetd tftp dgram udp" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-INETD").passed).toBe(false);
    });

    it("fails when inetd output contains chargen", () => {
      const output = baselineNoNone({ 18: "inetd chargen stream tcp" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-INETD").passed).toBe(false);
    });

    it("fails when inetd output contains daytime", () => {
      const output = baselineNoNone({ 18: "inetd daytime stream tcp" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-INETD").passed).toBe(false);
    });

    it("fails when inetd output contains discard", () => {
      const output = baselineNoNone({ 18: "inetd discard stream tcp" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-INETD").passed).toBe(false);
    });

    it("fails when inetd output contains echo service", () => {
      const output = baselineNoNone({ 18: "inetd echo stream tcp" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-INETD").passed).toBe(false);
    });

    it("passes when inetd present but no dangerous entries (no NONE in output)", () => {
      const output = baselineNoNone({ 18: "inetd safe-service stream tcp" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-INETD").passed).toBe(true);
      expect(findCheck(checks, "SVC-NO-INETD").currentValue).toBe("No dangerous inetd entries");
    });
  });

  // ── L387-421: SVC-NO-CHARGEN, SVC-NO-DAYTIME, SVC-NO-DISCARD ──

  describe("chargen/daytime/discard checks (L387-421)", () => {
    it("SVC-NO-CHARGEN fails when chargen present without NONE", () => {
      const output = baselineNoNone({ 19: "chargen stream tcp nowait" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-CHARGEN").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-CHARGEN").currentValue).toBe("chargen service found");
    });

    it("SVC-NO-CHARGEN passes when chargen present but NONE also present", () => {
      const checks = parseServicesChecks(baseline(), "bare");
      expect(findCheck(checks, "SVC-NO-CHARGEN").passed).toBe(true);
      expect(findCheck(checks, "SVC-NO-CHARGEN").currentValue).toBe("chargen not found");
    });

    it("SVC-NO-DAYTIME fails when daytime present without NONE", () => {
      const lines = baseline({ 19: "daytime stream tcp nowait" }).split("\n");
      const noNone = lines.map(l => l === "NONE" ? "safe" : l).join("\n");
      const checks = parseServicesChecks(noNone, "bare");
      expect(findCheck(checks, "SVC-NO-DAYTIME").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-DAYTIME").currentValue).toBe("daytime service found");
    });

    it("SVC-NO-DAYTIME passes when daytime not present", () => {
      const checks = parseServicesChecks(baseline(), "bare");
      expect(findCheck(checks, "SVC-NO-DAYTIME").passed).toBe(true);
      expect(findCheck(checks, "SVC-NO-DAYTIME").currentValue).toBe("daytime not found");
    });

    it("SVC-NO-DISCARD fails when discard present without NONE", () => {
      const lines = baseline({ 19: "discard stream tcp nowait" }).split("\n");
      const noNone = lines.map(l => l === "NONE" ? "safe" : l).join("\n");
      const checks = parseServicesChecks(noNone, "bare");
      expect(findCheck(checks, "SVC-NO-DISCARD").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-DISCARD").currentValue).toBe("discard service found");
    });

    it("SVC-NO-DISCARD passes when discard not present", () => {
      const checks = parseServicesChecks(baseline(), "bare");
      expect(findCheck(checks, "SVC-NO-DISCARD").passed).toBe(true);
      expect(findCheck(checks, "SVC-NO-DISCARD").currentValue).toBe("discard not found");
    });
  });

  // ── L384-397: SVC-NO-ECHO-SVC — Regex /^\s*echo\s/im ──

  describe("SVC-NO-ECHO-SVC (L384-397)", () => {
    it("fails when echo appears as inetd service line start without NONE", () => {
      const lines = baseline().split("\n");
      const noNone = lines.map(l => l === "NONE" ? "safe" : l);
      noNone.push("echo stream tcp nowait root internal");
      const checks = parseServicesChecks(noNone.join("\n"), "bare");
      expect(findCheck(checks, "SVC-NO-ECHO-SVC").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-ECHO-SVC").currentValue).toBe("echo service found in inetd");
    });

    it("passes when echo is NOT at line start (e.g., 'my-echo service')", () => {
      const output = baseline({ 19: "my-echo service running" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-ECHO-SVC").passed).toBe(true);
    });

    it("passes when NONE is present even if echo appears", () => {
      const output = baseline() + "\necho stream tcp nowait";
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-ECHO-SVC").passed).toBe(true);
      expect(findCheck(checks, "SVC-NO-ECHO-SVC").currentValue).toBe("echo service not found");
    });

    it("fails when echo at line start with leading whitespace", () => {
      const lines = baseline().split("\n").map(l => l === "NONE" ? "safe" : l);
      lines.push("  echo stream tcp nowait root internal");
      const checks = parseServicesChecks(lines.join("\n"), "bare");
      expect(findCheck(checks, "SVC-NO-ECHO-SVC").passed).toBe(false);
    });
  });

  // ── L399-433: SVC-RUNNING-COUNT-REASONABLE — boundary values ──

  describe("SVC-RUNNING-COUNT-REASONABLE boundaries (L399-433)", () => {
    it("passes when count is 49 (just under threshold)", () => {
      const output = baseline({ 20: "49" });
      const checks = parseServicesChecks(output, "bare");
      const check = findCheck(checks, "SVC-RUNNING-COUNT-REASONABLE");
      expect(check.passed).toBe(true);
      expect(check.currentValue).toContain("49");
      expect(check.currentValue).toContain("acceptable");
    });

    it("fails when count is 50 (at threshold)", () => {
      const output = baseline({ 20: "50" });
      const checks = parseServicesChecks(output, "bare");
      const check = findCheck(checks, "SVC-RUNNING-COUNT-REASONABLE");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toContain("50");
      expect(check.currentValue).toContain("review recommended");
    });

    it("fails when count is 100", () => {
      const output = baseline({ 20: "100" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-RUNNING-COUNT-REASONABLE").passed).toBe(false);
    });

    it("passes when count is 1 (minimum valid)", () => {
      const output = baseline({ 20: "1" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-RUNNING-COUNT-REASONABLE").passed).toBe(true);
    });

    it("ignores count of 0 (not plausible, val > 0 required)", () => {
      // Override both digit lines so the loop finds no valid serviceCount
      const output = baseline({ 20: "0", 21: "none" });
      const checks = parseServicesChecks(output, "bare");
      const check = findCheck(checks, "SVC-RUNNING-COUNT-REASONABLE");
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("Running service count not determinable");
    });

    it("ignores count of 200 (not plausible, val < 200 required)", () => {
      // Override both digit lines so the loop finds no valid serviceCount
      const output = baseline({ 20: "200", 21: "none" });
      const checks = parseServicesChecks(output, "bare");
      const check = findCheck(checks, "SVC-RUNNING-COUNT-REASONABLE");
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("Running service count not determinable");
    });

    it("ignores count of 199 (plausible, fails threshold)", () => {
      const output = baseline({ 20: "199" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-RUNNING-COUNT-REASONABLE").passed).toBe(false);
    });

    it("returns not determinable when no standalone digit line exists", () => {
      const output = "inactive\ninactive\nNONE\nno-numbers-here";
      const checks = parseServicesChecks(output, "bare");
      const check = findCheck(checks, "SVC-RUNNING-COUNT-REASONABLE");
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("Running service count not determinable");
    });

    it("skips non-digit lines when looking for count", () => {
      const output = baseline({ 20: "abc" });
      const checks = parseServicesChecks(output, "bare");
      const check = findCheck(checks, "SVC-RUNNING-COUNT-REASONABLE");
      expect(check.passed).toBe(true);
    });
  });

  // ── L447-462: SVC-NO-WILDCARD-LISTENERS — second standalone digit ──

  describe("SVC-NO-WILDCARD-LISTENERS boundaries (L447-462)", () => {
    it("passes when wildcard count is exactly 5 (boundary)", () => {
      const output = baseline({ 21: "5" });
      const checks = parseServicesChecks(output, "bare");
      const check = findCheck(checks, "SVC-NO-WILDCARD-LISTENERS");
      expect(check.passed).toBe(true);
      expect(check.currentValue).toContain("5");
      expect(check.currentValue).toContain("acceptable");
    });

    it("fails when wildcard count is 6 (just over boundary)", () => {
      const output = baseline({ 21: "6" });
      const checks = parseServicesChecks(output, "bare");
      const check = findCheck(checks, "SVC-NO-WILDCARD-LISTENERS");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toContain("6");
      expect(check.currentValue).toContain("review recommended");
    });

    it("passes when wildcard count is 0", () => {
      const output = baseline({ 21: "0" });
      const checks = parseServicesChecks(output, "bare");
      const check = findCheck(checks, "SVC-NO-WILDCARD-LISTENERS");
      expect(check.passed).toBe(true);
      expect(check.currentValue).toContain("0");
    });

    it("returns not determinable when second standalone digit is missing", () => {
      const output = "inactive\ninactive\nNONE\n18";
      const checks = parseServicesChecks(output, "bare");
      const check = findCheck(checks, "SVC-NO-WILDCARD-LISTENERS");
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("Wildcard listener count not determinable");
    });

    it("ignores values >= 1000", () => {
      const output = baseline({ 21: "1000" });
      const checks = parseServicesChecks(output, "bare");
      const check = findCheck(checks, "SVC-NO-WILDCARD-LISTENERS");
      expect(check.passed).toBe(true);
      expect(check.currentValue).toBe("Wildcard listener count not determinable");
    });

    it("correctly finds second standalone digit after first", () => {
      const output = baseline();
      const checks = parseServicesChecks(output, "bare");
      const check = findCheck(checks, "SVC-NO-WILDCARD-LISTENERS");
      expect(check.passed).toBe(true);
      expect(check.currentValue).toContain("3");
    });
  });

  // ── L482-536: SVC-NO-XINETD-SERVICES — complex xinetd detection ──

  describe("SVC-NO-XINETD-SERVICES edge cases (L482-536)", () => {
    it("fails when standalone 'active' line AND xinetd in output", () => {
      const output = baseline({ 23: "active" }) + "\nxinetd";
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-XINETD-SERVICES").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-XINETD-SERVICES").currentValue).toBe("xinetd is active");
    });

    it("passes when standalone 'active' line but NO xinetd keyword", () => {
      const output = "active\nsome-other-service";
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-XINETD-SERVICES").passed).toBe(true);
    });

    it("fails via regex path: 'xinetd active' in output", () => {
      const output = baseline({ 23: "xinetd active" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-XINETD-SERVICES").passed).toBe(false);
    });

    it("passes when xinetd keyword present but not 'active'", () => {
      const output = baseline({ 23: "xinetd inactive" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-XINETD-SERVICES").passed).toBe(true);
      expect(findCheck(checks, "SVC-NO-XINETD-SERVICES").currentValue).toBe("xinetd is not running");
    });

    it("handles map/trim/filter in line processing", () => {
      const output = baseline({ 23: "  inactive  " });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-XINETD-SERVICES").passed).toBe(true);
    });
  });

  // ── L497-525: SVC-NO-WORLD-READABLE-CONFIGS ──

  describe("SVC-NO-WORLD-READABLE-CONFIGS edge cases (L497-525)", () => {
    it("fails with multiple config file paths", () => {
      const output = baseline({ 24: "/etc/systemd/system/foo.conf\n/etc/systemd/system/bar.conf" });
      const checks = parseServicesChecks(output, "bare");
      const check = findCheck(checks, "SVC-NO-WORLD-READABLE-CONFIGS");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toContain("2");
    });

    it("passes when last line is NONE", () => {
      const output = baseline({ 24: "NONE" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-WORLD-READABLE-CONFIGS").passed).toBe(true);
      expect(findCheck(checks, "SVC-NO-WORLD-READABLE-CONFIGS").currentValue).toBe("None found");
    });

    it("passes when no path lines and last line is not NONE", () => {
      const output = baseline({ 24: "no-configs-here" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-WORLD-READABLE-CONFIGS").passed).toBe(true);
    });

    it("only counts lines starting with / that contain .conf", () => {
      const output = baseline({ 24: "/etc/systemd/system/myservice.service" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-WORLD-READABLE-CONFIGS").passed).toBe(true);
    });

    it("fails when path line contains .conf", () => {
      const output = baseline({ 24: "/etc/systemd/system/myservice.conf" });
      const checks = parseServicesChecks(output, "bare");
      const check = findCheck(checks, "SVC-NO-WORLD-READABLE-CONFIGS");
      expect(check.passed).toBe(false);
      expect(check.currentValue).toContain("1 world-readable");
    });
  });

  // ── parseServicesChecks wrapper (L528-567): N/A, empty, whitespace ──

  describe("parseServicesChecks wrapper — isNA logic (L528-567)", () => {
    it("treats whitespace-only as N/A (all fail)", () => {
      const checks = parseServicesChecks("   \n  \n  ", "bare");
      checks.forEach((c) => {
        expect(c.passed).toBe(false);
        expect(c.currentValue).toBe("Unable to determine");
      });
    });

    it("treats 'N/A' with surrounding whitespace as N/A", () => {
      const checks = parseServicesChecks("  N/A  ", "bare");
      checks.forEach((c) => {
        expect(c.passed).toBe(false);
        expect(c.currentValue).toBe("Unable to determine");
      });
    });

    it("does NOT treat 'N/A extra' as N/A", () => {
      const checks = parseServicesChecks("N/A extra", "bare");
      const telnet = findCheck(checks, "SVC-NO-TELNET");
      expect(telnet.currentValue).not.toBe("Unable to determine");
    });

    it("each check has correct category, severity, safeToAutoFix, explain", () => {
      const checks = parseServicesChecks(baseline(), "bare");
      checks.forEach((c) => {
        expect(c.category).toBe("Services");
        expect(["critical", "warning", "info"]).toContain(c.severity);
        expect(c.explain).toBeDefined();
        expect(c.explain!.length).toBeGreaterThan(0);
        expect(c.fixCommand).toBeDefined();
      });
    });

    it("safeToAutoFix is defined for all checks", () => {
      const checks = parseServicesChecks(baseline(), "bare");
      checks.forEach((c) => {
        expect(c.safeToAutoFix).toBeDefined();
        expect(["SAFE", "GUARDED"]).toContain(c.safeToAutoFix);
      });
    });
  });

  // ── Boolean negation killers: explicitly verify both passed=true AND passed=false for each check ──

  describe("Boolean literal killers — explicit passed values", () => {
    it("every check passes with secure baseline", () => {
      const checks = parseServicesChecks(baseline(), "bare");
      checks.forEach((c) => {
        expect(c.passed).toBe(true);
      });
    });

    it("insecure output: all checks fail", () => {
      const insecure = [
        "active",                        // telnet (line 0 = active for isServiceLineActive)
        "rsh active",
        "rlogin active",
        "vsftpd active",
        "tftpd active",
        "nfs-server active",
        "rpcbind active",
        "smbd active",
        "avahi-daemon active",
        "cups active",
        "isc-dhcp-server active",
        "named active",
        "snmpd active",
        "squid active",
        "xinetd active",
        "ypserv active",
        "inetd telnet ftp rsh rlogin tftp chargen daytime discard",
        "chargen daytime discard",
        "75",                            // running count > 50
        "10",                            // wildcard > 5
        "xinetd active",                 // xinetd-services
        "/etc/systemd/system/test.conf", // world-readable
      ].join("\n");
      const withEcho = insecure + "\necho stream tcp nowait root";

      const checks = parseServicesChecks(withEcho, "bare");

      expect(findCheck(checks, "SVC-NO-TELNET").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-RSH").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-RLOGIN").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-FTP").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-TFTP").passed).toBe(false);
      expect(findCheck(checks, "SVC-NFS-RESTRICTED").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-RPCBIND").passed).toBe(false);
      expect(findCheck(checks, "SVC-SAMBA-RESTRICTED").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-AVAHI").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-CUPS").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-DHCP-SERVER").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-DNS-SERVER").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-SNMP").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-SQUID").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-XINETD").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-YPSERV").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-INETD").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-CHARGEN").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-DAYTIME").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-DISCARD").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-ECHO-SVC").passed).toBe(false);
      expect(findCheck(checks, "SVC-RUNNING-COUNT-REASONABLE").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-WILDCARD-LISTENERS").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-XINETD-SERVICES").passed).toBe(false);
      expect(findCheck(checks, "SVC-NO-WORLD-READABLE-CONFIGS").passed).toBe(false);
    });
  });

  // ── Case insensitivity killer: regex /i flag ──

  describe("Case insensitivity (regex /i flag)", () => {
    it("SVC-NO-TELNET detects TELNET ACTIVE (uppercase)", () => {
      const output = baseline({ 0: "TELNET ACTIVE" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-TELNET").passed).toBe(false);
    });

    it("SVC-NO-RSH detects RSH Active (mixed case)", () => {
      const output = baseline({ 1: "RSH Active" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-RSH").passed).toBe(false);
    });

    it("SVC-NO-AVAHI detects Avahi-Daemon Active (mixed case)", () => {
      const output = baseline({ 8: "Avahi-Daemon Active" });
      const checks = parseServicesChecks(output, "bare");
      expect(findCheck(checks, "SVC-NO-AVAHI").passed).toBe(false);
    });
  });

  // ── currentValue string verification (kills string literal mutants) ──

  describe("currentValue exact strings", () => {
    const secureChecks = parseServicesChecks(
      baseline(),
      "bare",
    );

    it.each([
      ["SVC-NO-TELNET", "telnet is not running"],
      ["SVC-NO-RSH", "rsh is not running"],
      ["SVC-NO-RLOGIN", "rlogin is not running"],
      ["SVC-NO-FTP", "FTP server is not running"],
      ["SVC-NO-TFTP", "TFTP is not running"],
      ["SVC-NFS-RESTRICTED", "NFS server is not running"],
      ["SVC-NO-RPCBIND", "rpcbind is not running"],
      ["SVC-SAMBA-RESTRICTED", "Samba is not running"],
      ["SVC-NO-AVAHI", "avahi-daemon is not running"],
      ["SVC-NO-CUPS", "CUPS is not running"],
      ["SVC-NO-DHCP-SERVER", "DHCP server is not running"],
      ["SVC-NO-DNS-SERVER", "DNS server is not running"],
      ["SVC-NO-SNMP", "SNMP is not running"],
      ["SVC-NO-SQUID", "Squid proxy is not running"],
      ["SVC-NO-XINETD", "xinetd is not running"],
      ["SVC-NO-YPSERV", "NIS is not running"],
    ])("%s has correct inactive currentValue: %s", (id, expected) => {
      expect(findCheck(secureChecks, id).currentValue).toBe(expected);
    });
  });
});
