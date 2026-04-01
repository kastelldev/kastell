import { parseUpdatesChecks } from "../../src/core/audit/checks/updates.js";

describe("parseUpdatesChecks", () => {
  // Recent timestamp: current time minus 5 days (in seconds)
  const recentTimestamp = Math.floor(Date.now() / 1000) - 5 * 24 * 60 * 60;
  const oldTimestamp = 1609459200; // Jan 2021 (old)

  const secureOutput = [
    "0",                                          // 0 security updates
    "ii  unattended-upgrades  2.9.1  all",        // unattended-upgrades installed
    "1709654400",                                  // recent apt update timestamp (within 7 days)
    "NO_REBOOT",                                   // no reboot required
    String(recentTimestamp),                       // recent dpkg.log activity timestamp
    "/usr/local/bin/trivy",                        // CVE scanner present
    "0",                                           // dpkg --audit: 0 partial packages
    "5.15.0-91-generic",                           // uname -r kernel version
    "5.15.0-91.101",                               // installed kernel version
    'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";', // auto-upgrades enabled
    "deb https://security.ubuntu.com/ubuntu focal-security main",  // security repo
  ].join("\n");

  const insecureOutput = [
    "5",                                           // 5 security updates
    "N/A",                                         // unattended-upgrades not installed
    String(oldTimestamp),                          // old apt update timestamp (Jan 2021)
    "REBOOT_REQUIRED",                             // reboot required
    String(oldTimestamp),                          // old dpkg.log activity
    "NONE",                                        // no CVE scanner
    "3",                                           // 3 partial packages
    "N/A",                                         // kernel unknown
    "N/A",                                         // installed kernel unknown
    "N/A",                                         // no auto-upgrades config
    "NONE",                                        // no security repo
  ].join("\n");

  it("should return 11 checks", () => {
    const checks = parseUpdatesChecks(secureOutput, "bare");
    expect(checks).toHaveLength(11);
    checks.forEach((check) => {
      expect(check.category).toBe("Updates");
      expect(check.id).toMatch(/^UPD-[A-Z][A-Z0-9]*(-[A-Z][A-Z0-9]*)+$/);
    });
  });

  it("should return UPD-SECURITY-PATCHES passed when no security updates pending", () => {
    const checks = parseUpdatesChecks(secureOutput, "bare");
    const upd01 = checks.find((c) => c.id === "UPD-SECURITY-PATCHES");
    expect(upd01!.passed).toBe(true);
  });

  it("should return UPD-SECURITY-PATCHES failed when security updates pending", () => {
    const checks = parseUpdatesChecks(insecureOutput, "bare");
    const upd01 = checks.find((c) => c.id === "UPD-SECURITY-PATCHES");
    expect(upd01!.passed).toBe(false);
    expect(upd01!.severity).toBe("critical");
  });

  it("should return UPD-AUTO-UPDATES passed when unattended-upgrades installed", () => {
    const checks = parseUpdatesChecks(secureOutput, "bare");
    const upd02 = checks.find((c) => c.id === "UPD-AUTO-UPDATES");
    expect(upd02!.passed).toBe(true);
  });

  it("should return UPD-AUTO-UPDATES failed when unattended-upgrades missing", () => {
    const checks = parseUpdatesChecks(insecureOutput, "bare");
    const upd02 = checks.find((c) => c.id === "UPD-AUTO-UPDATES");
    expect(upd02!.passed).toBe(false);
  });

  it("should return UPD-REBOOT-REQUIRED passed when no reboot required", () => {
    const checks = parseUpdatesChecks(secureOutput, "bare");
    const upd04 = checks.find((c) => c.id === "UPD-REBOOT-REQUIRED");
    expect(upd04!.passed).toBe(true);
  });

  it("should return UPD-REBOOT-REQUIRED failed when reboot required", () => {
    const checks = parseUpdatesChecks(insecureOutput, "bare");
    const upd04 = checks.find((c) => c.id === "UPD-REBOOT-REQUIRED");
    expect(upd04!.passed).toBe(false);
    expect(upd04!.severity).toBe("warning");
  });

  it("should return UPD-LAST-UPGRADE-RECENT passed with recent timestamp", () => {
    const checks = parseUpdatesChecks(secureOutput, "bare");
    const upd05 = checks.find((c) => c.id === "UPD-LAST-UPGRADE-RECENT");
    expect(upd05!.passed).toBe(true);
    expect(upd05!.severity).toBe("warning");
  });

  it("should return UPD-LAST-UPGRADE-RECENT failed with old timestamp", () => {
    const checks = parseUpdatesChecks(insecureOutput, "bare");
    const upd05 = checks.find((c) => c.id === "UPD-LAST-UPGRADE-RECENT");
    expect(upd05!.passed).toBe(false);
  });

  it("should return UPD-CVE-SCANNER-PRESENT passed when trivy found", () => {
    const checks = parseUpdatesChecks(secureOutput, "bare");
    const upd06 = checks.find((c) => c.id === "UPD-CVE-SCANNER-PRESENT");
    expect(upd06!.passed).toBe(true);
  });

  it("should return UPD-CVE-SCANNER-PRESENT failed when no scanner found", () => {
    const checks = parseUpdatesChecks(insecureOutput, "bare");
    const upd06 = checks.find((c) => c.id === "UPD-CVE-SCANNER-PRESENT");
    expect(upd06!.passed).toBe(false);
  });

  it("should return UPD-UNATTENDED-ENABLED passed when 20auto-upgrades contains Unattended-Upgrade '1'", () => {
    const checks = parseUpdatesChecks(secureOutput, "bare");
    const upd09 = checks.find((c) => c.id === "UPD-UNATTENDED-ENABLED");
    expect(upd09!.passed).toBe(true);
  });

  it("should return UPD-UNATTENDED-ENABLED failed when config missing", () => {
    const checks = parseUpdatesChecks(insecureOutput, "bare");
    const upd09 = checks.find((c) => c.id === "UPD-UNATTENDED-ENABLED");
    expect(upd09!.passed).toBe(false);
  });

  it("should return UPD-SECURITY-REPO-PRIORITY passed when security repo found", () => {
    const checks = parseUpdatesChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "UPD-SECURITY-REPO-PRIORITY");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("should return UPD-SECURITY-REPO-PRIORITY failed when no security repo found", () => {
    const checks = parseUpdatesChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === "UPD-SECURITY-REPO-PRIORITY");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
  });

  it("should handle N/A output gracefully", () => {
    const checks = parseUpdatesChecks("N/A", "bare");
    expect(checks).toHaveLength(11);
    checks.forEach((check) => {
      expect(check.passed).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // MUTATION-KILLER WAVE 2
  // ──────────────────────────────────────────────────────────────

  describe("ID array assertion — exact order", () => {
    it("should return all 11 check IDs in exact order", () => {
      const checks = parseUpdatesChecks(secureOutput, "bare");
      const ids = checks.map((c) => c.id);
      expect(ids).toEqual([
        "UPD-SECURITY-PATCHES",
        "UPD-AUTO-UPDATES",
        "UPD-CACHE-FRESH",
        "UPD-REBOOT-REQUIRED",
        "UPD-LAST-UPGRADE-RECENT",
        "UPD-CVE-SCANNER-PRESENT",
        "UPD-DPKG-NO-PARTIAL",
        "UPD-KERNEL-CURRENT",
        "UPD-UNATTENDED-ENABLED",
        "UPD-APT-HTTPS",
        "UPD-SECURITY-REPO-PRIORITY",
      ]);
    });
  });

  describe("N/A blanket assertion — all checks Unable to determine", () => {
    it("should set currentValue 'Unable to determine' for all applicable checks on N/A", () => {
      const checks = parseUpdatesChecks("N/A", "bare");
      for (const check of checks) {
        expect(check.passed).toBe(false);
      }
    });

    it("should set passed=false for empty string input", () => {
      const checks = parseUpdatesChecks("", "bare");
      expect(checks).toHaveLength(11);
      for (const check of checks) {
        expect(check.passed).toBe(false);
      }
    });

    it("should set passed=false for whitespace-only input", () => {
      const checks = parseUpdatesChecks("   \n  \n  ", "bare");
      expect(checks).toHaveLength(11);
      for (const check of checks) {
        expect(check.passed).toBe(false);
      }
    });
  });

  describe("UPD-01 SECURITY-PATCHES — boundary: securityCount=0 vs 1", () => {
    it("passes with securityCount=0 (exactly 0)", () => {
      const output = "0\nN/A\nN/A\nNO_REBOOT";
      const checks = parseUpdatesChecks(output, "bare");
      const c = checks.find((c) => c.id === "UPD-SECURITY-PATCHES")!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("No security updates pending");
    });

    it("fails with securityCount=1 (exactly 1)", () => {
      const output = "1\nN/A\nN/A\nNO_REBOOT";
      const checks = parseUpdatesChecks(output, "bare");
      const c = checks.find((c) => c.id === "UPD-SECURITY-PATCHES")!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("1 security update(s) pending");
    });

    it("currentValue shows 'Unable to determine' when securityCount is NaN", () => {
      const output = "abc\nN/A\nN/A\nNO_REBOOT";
      const checks = parseUpdatesChecks(output, "bare");
      const c = checks.find((c) => c.id === "UPD-SECURITY-PATCHES")!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });
  });

  describe("UPD-01 regex — securityCountStr ^\\ d{1,4}$ boundary", () => {
    it("matches 4-digit number (9999)", () => {
      const output = "9999\nN/A\nN/A\nNO_REBOOT";
      const checks = parseUpdatesChecks(output, "bare");
      const c = checks.find((c) => c.id === "UPD-SECURITY-PATCHES")!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("9999 security update(s) pending");
    });

    it("does not match 5-digit number as security count (10000 is a timestamp candidate)", () => {
      // 10000 is 5 digits — regex ^\d{1,4}$ won't match, so securityCountStr falls to N/A
      const output = "10000\nN/A\nN/A\nNO_REBOOT";
      const checks = parseUpdatesChecks(output, "bare");
      const c = checks.find((c) => c.id === "UPD-SECURITY-PATCHES")!;
      // securityCountStr becomes "N/A", so passed = false (NaN)
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });
  });

  describe("UPD-03 CACHE-FRESH — boundary: aptTimestamp within/beyond 7 days", () => {
    it("passes when apt timestamp is 1 day old", () => {
      const oneDayAgo = Math.floor(Date.now() / 1000) - 1 * 24 * 60 * 60;
      const output = `0\nN/A\n${oneDayAgo}\nNO_REBOOT`;
      const checks = parseUpdatesChecks(output, "bare");
      const c = checks.find((c) => c.id === "UPD-CACHE-FRESH")!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("APT cache updated within 7 days");
    });

    it("passes when apt timestamp is exactly 6 days old (within 7)", () => {
      const sixDaysAgo = Math.floor(Date.now() / 1000) - 6 * 24 * 60 * 60;
      const output = `0\nN/A\n${sixDaysAgo}\nNO_REBOOT`;
      const checks = parseUpdatesChecks(output, "bare");
      const c = checks.find((c) => c.id === "UPD-CACHE-FRESH")!;
      expect(c.passed).toBe(true);
    });

    it("fails when apt timestamp is 8 days old (beyond 7)", () => {
      const eightDaysAgo = Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60;
      const output = `0\nN/A\n${eightDaysAgo}\nNO_REBOOT`;
      const checks = parseUpdatesChecks(output, "bare");
      const c = checks.find((c) => c.id === "UPD-CACHE-FRESH")!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("APT cache older than 7 days");
    });

    it("currentValue shows 'Unable to determine' when aptTimestamp is NaN", () => {
      const output = "0\nN/A\nabc\nNO_REBOOT";
      const checks = parseUpdatesChecks(output, "bare");
      const c = checks.find((c) => c.id === "UPD-CACHE-FRESH")!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });
  });

  describe("UPD-03 regex — aptTimestampStr ^\\ d{10,}$ boundary", () => {
    it("matches 10-digit number (1709654400)", () => {
      const output = `0\nN/A\n1709654400\nNO_REBOOT`;
      const checks = parseUpdatesChecks(output, "bare");
      const c = checks.find((c) => c.id === "UPD-CACHE-FRESH")!;
      // Old timestamp, so fails freshness check but should be parsed
      expect(c.currentValue).not.toBe("Unable to determine");
    });

    it("does not match 9-digit number as timestamp", () => {
      // 123456789 is 9 digits — regex ^\d{10,}$ won't match
      const output = `0\nN/A\n123456789\nNO_REBOOT`;
      const checks = parseUpdatesChecks(output, "bare");
      const c = checks.find((c) => c.id === "UPD-CACHE-FRESH")!;
      expect(c.currentValue).toBe("Unable to determine");
    });
  });

  describe("UPD-04 REBOOT-REQUIRED — exact sentinel matching", () => {
    it("passes with NO_REBOOT", () => {
      const output = "0\nN/A\nN/A\nNO_REBOOT";
      const checks = parseUpdatesChecks(output, "bare");
      const c = checks.find((c) => c.id === "UPD-REBOOT-REQUIRED")!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("No reboot required");
    });

    it("fails with REBOOT_REQUIRED", () => {
      const output = "0\nN/A\nN/A\nREBOOT_REQUIRED";
      const checks = parseUpdatesChecks(output, "bare");
      const c = checks.find((c) => c.id === "UPD-REBOOT-REQUIRED")!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Reboot required");
    });

    it("shows 'Unable to determine' when neither sentinel present", () => {
      const output = "0\nN/A\nN/A\nSOMETHING_ELSE";
      const checks = parseUpdatesChecks(output, "bare");
      const c = checks.find((c) => c.id === "UPD-REBOOT-REQUIRED")!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });
  });

  describe("UPD-07 DPKG-NO-PARTIAL — boundary: dpkgPartialCount=0 vs 1", () => {
    it("passes when dpkg count is 0 and security count differs", () => {
      // When securityCountStr="5" and dpkg="0", the parser can find "0" as distinct
      const output = "5\nN/A\nN/A\nNO_REBOOT\nN/A\nNONE\n0";
      const checks = parseUpdatesChecks(output, "bare");
      const c = checks.find((c) => c.id === "UPD-DPKG-NO-PARTIAL")!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("0 partially installed package(s)");
    });

    it("fails when dpkg count is non-zero (securityCount=0, dpkg=3)", () => {
      // When securityCountStr="0", dpkgAuditLine finds lines !== "0"
      const output = "0\nN/A\nN/A\nNO_REBOOT\nN/A\nNONE\n3";
      const checks = parseUpdatesChecks(output, "bare");
      const c = checks.find((c) => c.id === "UPD-DPKG-NO-PARTIAL")!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("3 partially installed package(s)");
    });

    it("fails with 3 partial packages from insecureOutput", () => {
      const checks = parseUpdatesChecks(insecureOutput, "bare");
      const c = checks.find((c) => c.id === "UPD-DPKG-NO-PARTIAL")!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toContain("3");
    });

    it("NaN when securityCount and dpkgCount are same value (parser quirk)", () => {
      // When both are "0", dpkgAuditLine skips it (l !== securityCountStr)
      const output = "0\nN/A\nN/A\nNO_REBOOT\nN/A\nNONE\n0";
      const checks = parseUpdatesChecks(output, "bare");
      const c = checks.find((c) => c.id === "UPD-DPKG-NO-PARTIAL")!;
      // dpkgAuditLine is undefined (filtered), dpkgPartialCount is NaN, noDpkgPartial=false
      expect(c.passed).toBe(false);
    });
  });

  describe("UPD-06 CVE-SCANNER-PRESENT — tool detection", () => {
    it("passes when grype is present", () => {
      const output = "0\nN/A\nN/A\nNO_REBOOT\nN/A\n/usr/local/bin/grype\n0";
      const checks = parseUpdatesChecks(output, "bare");
      const c = checks.find((c) => c.id === "UPD-CVE-SCANNER-PRESENT")!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toContain("grype");
    });

    it("fails when line is NONE", () => {
      const output = "0\nN/A\nN/A\nNO_REBOOT\nN/A\nNONE\n0";
      const checks = parseUpdatesChecks(output, "bare");
      const c = checks.find((c) => c.id === "UPD-CVE-SCANNER-PRESENT")!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("No CVE scanner found");
    });
  });

  describe("UPD-08 KERNEL-CURRENT — version detection", () => {
    it("passes when kernel version pattern present", () => {
      const checks = parseUpdatesChecks(secureOutput, "bare");
      const c = checks.find((c) => c.id === "UPD-KERNEL-CURRENT")!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toContain("5.15.0");
    });

    it("fails when no kernel version pattern found", () => {
      const output = "0\nN/A\nN/A\nNO_REBOOT\nN/A\nNONE\n0\nN/A\nN/A\nN/A\nNONE";
      const checks = parseUpdatesChecks(output, "bare");
      const c = checks.find((c) => c.id === "UPD-KERNEL-CURRENT")!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine kernel version");
    });
  });

  describe("UPD-10 APT-HTTPS — http:// detection", () => {
    it("passes when all repos use https://", () => {
      const checks = parseUpdatesChecks(secureOutput, "bare");
      const c = checks.find((c) => c.id === "UPD-APT-HTTPS")!;
      expect(c.passed).toBe(true);
    });

    it("fails when repos use http://", () => {
      const httpOutput = secureOutput.replace("https://", "http://");
      const checks = parseUpdatesChecks(httpOutput, "bare");
      const c = checks.find((c) => c.id === "UPD-APT-HTTPS")!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Some APT repos use HTTP");
    });

    it("shows 'Unable to determine' when isNA", () => {
      const checks = parseUpdatesChecks("N/A", "bare");
      const c = checks.find((c) => c.id === "UPD-APT-HTTPS")!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });
  });

  describe("UPD-09 UNATTENDED-ENABLED — APT::Periodic regex", () => {
    it("passes with exact config line", () => {
      const output = '0\nN/A\nN/A\nNO_REBOOT\nN/A\nNONE\n0\nN/A\nN/A\nAPT::Periodic::Unattended-Upgrade "1";\nNONE';
      const checks = parseUpdatesChecks(output, "bare");
      const c = checks.find((c) => c.id === "UPD-UNATTENDED-ENABLED")!;
      expect(c.passed).toBe(true);
    });

    it("fails with APT::Periodic::Unattended-Upgrade \"0\"", () => {
      const output = '0\nN/A\nN/A\nNO_REBOOT\nN/A\nNONE\n0\nN/A\nN/A\nAPT::Periodic::Unattended-Upgrade "0";\nNONE';
      const checks = parseUpdatesChecks(output, "bare");
      const c = checks.find((c) => c.id === "UPD-UNATTENDED-ENABLED")!;
      expect(c.passed).toBe(false);
    });
  });

  describe("UPD-11 SECURITY-REPO-PRIORITY — repo detection", () => {
    it("passes with deb https://security... line", () => {
      const checks = parseUpdatesChecks(secureOutput, "bare");
      const c = checks.find((c) => c.id === "UPD-SECURITY-REPO-PRIORITY")!;
      expect(c.passed).toBe(true);
      expect(c.currentValue).toBe("Security repository found in APT sources");
    });

    it("fails when no security repo found", () => {
      const output = "0\nN/A\nN/A\nNO_REBOOT\nN/A\nNONE\n0\nN/A\nN/A\nN/A\nNONE";
      const checks = parseUpdatesChecks(output, "bare");
      const c = checks.find((c) => c.id === "UPD-SECURITY-REPO-PRIORITY")!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("No dedicated security repository found in APT sources");
    });
  });

  describe("Severity assertions for all 11 checks", () => {
    it("assigns correct severity to every check", () => {
      const checks = parseUpdatesChecks(secureOutput, "bare");
      const byId = (id: string) => checks.find((c) => c.id === id)!;

      expect(byId("UPD-SECURITY-PATCHES").severity).toBe("critical");
      expect(byId("UPD-AUTO-UPDATES").severity).toBe("warning");
      expect(byId("UPD-CACHE-FRESH").severity).toBe("info");
      expect(byId("UPD-REBOOT-REQUIRED").severity).toBe("warning");
      expect(byId("UPD-LAST-UPGRADE-RECENT").severity).toBe("warning");
      expect(byId("UPD-CVE-SCANNER-PRESENT").severity).toBe("info");
      expect(byId("UPD-DPKG-NO-PARTIAL").severity).toBe("warning");
      expect(byId("UPD-KERNEL-CURRENT").severity).toBe("info");
      expect(byId("UPD-UNATTENDED-ENABLED").severity).toBe("warning");
      expect(byId("UPD-APT-HTTPS").severity).toBe("info");
      expect(byId("UPD-SECURITY-REPO-PRIORITY").severity).toBe("info");
    });
  });

  describe("UPD-02 AUTO-UPDATES — currentValue exact strings", () => {
    it("shows 'unattended-upgrades installed' when present", () => {
      const checks = parseUpdatesChecks(secureOutput, "bare");
      const c = checks.find((c) => c.id === "UPD-AUTO-UPDATES")!;
      expect(c.currentValue).toBe("unattended-upgrades installed");
    });

    it("shows 'unattended-upgrades not installed' when absent", () => {
      const checks = parseUpdatesChecks(insecureOutput, "bare");
      const c = checks.find((c) => c.id === "UPD-AUTO-UPDATES")!;
      expect(c.currentValue).toBe("unattended-upgrades not installed");
    });

    it("shows 'Unable to determine' when isNA", () => {
      const checks = parseUpdatesChecks("N/A", "bare");
      const c = checks.find((c) => c.id === "UPD-AUTO-UPDATES")!;
      expect(c.currentValue).toBe("Unable to determine");
    });
  });

  describe("secureOutput — expected pass/fail", () => {
    it("key checks pass with secure output", () => {
      const checks = parseUpdatesChecks(secureOutput, "bare");
      const byId = (id: string) => checks.find((c) => c.id === id)!;

      // These pass with the test's secureOutput
      expect(byId("UPD-SECURITY-PATCHES").passed).toBe(true);
      expect(byId("UPD-AUTO-UPDATES").passed).toBe(true);
      expect(byId("UPD-REBOOT-REQUIRED").passed).toBe(true);
      expect(byId("UPD-LAST-UPGRADE-RECENT").passed).toBe(true);
      expect(byId("UPD-CVE-SCANNER-PRESENT").passed).toBe(true);
      expect(byId("UPD-KERNEL-CURRENT").passed).toBe(true);
      expect(byId("UPD-UNATTENDED-ENABLED").passed).toBe(true);
      expect(byId("UPD-SECURITY-REPO-PRIORITY").passed).toBe(true);
    });
  });

  describe("insecureOutput — key checks fail", () => {
    it("UPD-SECURITY-PATCHES fails (5 updates)", () => {
      const checks = parseUpdatesChecks(insecureOutput, "bare");
      const c = checks.find((c) => c.id === "UPD-SECURITY-PATCHES")!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("5 security update(s) pending");
    });

    it("UPD-AUTO-UPDATES fails (N/A)", () => {
      const checks = parseUpdatesChecks(insecureOutput, "bare");
      const c = checks.find((c) => c.id === "UPD-AUTO-UPDATES")!;
      expect(c.passed).toBe(false);
    });

    it("UPD-REBOOT-REQUIRED fails (REBOOT_REQUIRED)", () => {
      const checks = parseUpdatesChecks(insecureOutput, "bare");
      const c = checks.find((c) => c.id === "UPD-REBOOT-REQUIRED")!;
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Reboot required");
    });

    it("UPD-CVE-SCANNER-PRESENT fails (NONE)", () => {
      const checks = parseUpdatesChecks(insecureOutput, "bare");
      const c = checks.find((c) => c.id === "UPD-CVE-SCANNER-PRESENT")!;
      expect(c.passed).toBe(false);
    });
  });

  describe("[MUTATION-KILLER] Updates check metadata", () => {
    const checks = parseUpdatesChecks(secureOutput, "bare");

    const expectedMeta: Array<[string, string, string]> = [
      ["UPD-SECURITY-PATCHES", "critical", "SAFE"],
      ["UPD-AUTO-UPDATES", "warning", "SAFE"],
      ["UPD-CACHE-FRESH", "info", "SAFE"],
      ["UPD-REBOOT-REQUIRED", "warning", "GUARDED"],
      ["UPD-LAST-UPGRADE-RECENT", "warning", "SAFE"],
      ["UPD-CVE-SCANNER-PRESENT", "info", "SAFE"],
      ["UPD-DPKG-NO-PARTIAL", "warning", "SAFE"],
      ["UPD-KERNEL-CURRENT", "info", "SAFE"],
      ["UPD-UNATTENDED-ENABLED", "warning", "SAFE"],
      ["UPD-APT-HTTPS", "info", "GUARDED"],
      ["UPD-SECURITY-REPO-PRIORITY", "info", "GUARDED"],
    ];

    it.each(expectedMeta)("[MUTATION-KILLER] %s has severity=%s, safeToAutoFix=%s", (id, severity, safe) => {
      const c = checks.find((c) => c.id === id);
      expect(c).toBeDefined();
      expect(c!.category).toBe("Updates");
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

    it("[MUTATION-KILLER] all IDs start with UPD-", () => {
      checks.forEach((c) => expect(c.id).toMatch(/^UPD-/));
    });
  });
});
