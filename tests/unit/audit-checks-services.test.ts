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
    // SRV-NO-WILDCARD-LISTENERS: 3 wildcard listeners (<=5 = pass)
    "3",
    // SRV-NO-WILDCARD-LISTENERS details
    "NONE",
    // SRV-NO-XINETD-SERVICES: xinetd inactive
    "inactive",
    // SRV-NO-WORLD-READABLE-CONFIGS: no world-readable configs
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

  it("should return 28 checks for the Services category", () => {
    const checks = parseServicesChecks(secureOutput, "bare");
    expect(checks).toHaveLength(28);
    checks.forEach((c) => expect(c.category).toBe("Services"));
  });

  it("all check IDs should start with SVC- or SRV-", () => {
    const checks = parseServicesChecks(secureOutput, "bare");
    checks.forEach((c) => expect(c.id).toMatch(/^S[RV][CV]-/));
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
    expect(checks).toHaveLength(28);
    checks.forEach((c) => {
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });
  });

  it("should handle empty string output gracefully", () => {
    const checks = parseServicesChecks("", "bare");
    expect(checks).toHaveLength(28);
    checks.forEach((c) => expect(c.passed).toBe(false));
  });

  it("SRV-RUNNING-COUNT-REASONABLE passes when running count is 18", () => {
    const checks = parseServicesChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "SRV-RUNNING-COUNT-REASONABLE");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("SRV-NO-RPCBIND passes when rpcbind is not active", () => {
    const checks = parseServicesChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "SRV-NO-RPCBIND");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("severity budget: <= 40% critical checks", () => {
    const checks = parseServicesChecks("", "bare");
    const criticalCount = checks.filter((c) => c.severity === "critical").length;
    const ratio = criticalCount / checks.length;
    expect(ratio).toBeLessThanOrEqual(0.4);
  });

  it("SRV-NO-WILDCARD-LISTENERS passes when <= 5 wildcard listeners", () => {
    const checks = parseServicesChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "SRV-NO-WILDCARD-LISTENERS");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("warning");
    expect(check!.currentValue).toContain("3");
  });

  it("SRV-NO-WILDCARD-LISTENERS fails when > 5 wildcard listeners", () => {
    const output = ["inactive","inactive","inactive","inactive","inactive","inactive",
      "inactive","inactive","inactive","inactive","inactive","inactive","inactive",
      "inactive","inactive","inactive","inactive","inactive","NONE","NONE","5","10",
      "NONE","inactive","NONE"].join("\n");
    const checks = parseServicesChecks(output, "bare");
    const check = checks.find((c) => c.id === "SRV-NO-WILDCARD-LISTENERS");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toContain("10");
  });

  it("SRV-NO-XINETD-SERVICES passes when xinetd is not active", () => {
    const checks = parseServicesChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "SRV-NO-XINETD-SERVICES");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("info");
    expect(check!.currentValue).toContain("not running");
  });

  it("SRV-NO-XINETD-SERVICES fails when xinetd is active", () => {
    const activeOutput = "inactive\ninactive\ninactive\ninactive\ninactive\ninactive\n"
      + "inactive\ninactive\ninactive\ninactive\ninactive\ninactive\ninactive\n"
      + "inactive\ninactive\nxinetd active\ninactive\ninactive\nNONE\nNONE\n18\n3\nNONE\nactive\nNONE";
    const checks = parseServicesChecks(activeOutput, "bare");
    const check = checks.find((c) => c.id === "SRV-NO-XINETD-SERVICES");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("SRV-NO-WORLD-READABLE-CONFIGS passes when no world-readable configs", () => {
    const checks = parseServicesChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "SRV-NO-WORLD-READABLE-CONFIGS");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.severity).toBe("info");
  });

  it("SRV-NO-WORLD-READABLE-CONFIGS fails when world-readable configs found", () => {
    const worldReadableOutput = "inactive\ninactive\ninactive\ninactive\ninactive\ninactive\n"
      + "inactive\ninactive\ninactive\ninactive\ninactive\ninactive\ninactive\n"
      + "inactive\ninactive\ninactive\ninactive\ninactive\nNONE\nNONE\n18\n3\nNONE\ninactive\n"
      + "/etc/systemd/system/myservice.conf";
    const checks = parseServicesChecks(worldReadableOutput, "bare");
    const check = checks.find((c) => c.id === "SRV-NO-WORLD-READABLE-CONFIGS");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
    expect(check!.currentValue).toContain("1");
  });
});
