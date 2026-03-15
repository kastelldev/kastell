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
  ].join("\n");

  it("should return 10 checks", () => {
    const checks = parseUpdatesChecks(secureOutput, "bare");
    expect(checks).toHaveLength(10);
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

  it("should handle N/A output gracefully", () => {
    const checks = parseUpdatesChecks("N/A", "bare");
    expect(checks).toHaveLength(10);
    checks.forEach((check) => {
      expect(check.passed).toBe(false);
    });
  });
});
