import { parseUpdatesChecks } from "../../src/core/audit/checks/updates.js";

describe("parseUpdatesChecks", () => {
  const secureOutput = [
    "0",                                          // 0 security updates
    "ii  unattended-upgrades  2.9.1  all",        // unattended-upgrades installed
    "1709654400",                                  // recent apt update timestamp
    "NO_REBOOT",                                   // no reboot required
  ].join("\n");

  const insecureOutput = [
    "5",                                           // 5 security updates
    "N/A",                                         // unattended-upgrades not installed
    "1609459200",                                  // old apt update timestamp (Jan 2021)
    "REBOOT_REQUIRED",                             // reboot required
  ].join("\n");

  it("should return 4 checks", () => {
    const checks = parseUpdatesChecks(secureOutput, "bare");
    expect(checks).toHaveLength(4);
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

  it("should handle N/A output gracefully", () => {
    const checks = parseUpdatesChecks("N/A", "bare");
    expect(checks).toHaveLength(4);
    checks.forEach((check) => {
      expect(check.passed).toBe(false);
    });
  });
});
