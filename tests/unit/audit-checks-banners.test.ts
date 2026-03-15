import { parseBannersChecks } from "../../src/core/audit/checks/banners.js";

describe("parseBannersChecks", () => {
  const secureOutput = [
    "Authorized access only. All activity is monitored and logged.",
    "issue.net Authorized access only.",
    "motd This system is for authorized use only.",
    "Banner /etc/issue.net",
  ].join("\n");

  const insecureOutput = [
    "Ubuntu 22.04.3 LTS \\n \\l",
    "MISSING",
    "MISSING",
    "N/A",
  ].join("\n");

  it("should return 5 checks for the Banners category", () => {
    const checks = parseBannersChecks(secureOutput, "bare");
    expect(checks.length).toBeGreaterThanOrEqual(5);
    checks.forEach((c) => expect(c.category).toBe("Banners"));
  });

  it("all check IDs should start with BANNER-", () => {
    const checks = parseBannersChecks(secureOutput, "bare");
    checks.forEach((c) => expect(c.id).toMatch(/^BANNER-/));
  });

  it("all checks should have explain > 20 chars and fixCommand defined", () => {
    const checks = parseBannersChecks(secureOutput, "bare");
    checks.forEach((c) => {
      expect(c.explain!.length).toBeGreaterThan(20);
      expect(c.fixCommand).toBeDefined();
    });
  });

  it("BANNER-SSH-BANNER passes when Banner points to a file", () => {
    const checks = parseBannersChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "BANNER-SSH-BANNER");
    expect(check!.passed).toBe(true);
  });

  it("BANNER-SSH-BANNER fails when no Banner configured", () => {
    const checks = parseBannersChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === "BANNER-SSH-BANNER");
    expect(check!.passed).toBe(false);
  });

  it("BANNER-NO-OS-INFO passes when no OS info in banners", () => {
    const checks = parseBannersChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "BANNER-NO-OS-INFO");
    expect(check!.passed).toBe(true);
  });

  it("BANNER-NO-OS-INFO fails when Ubuntu found in banner", () => {
    const checks = parseBannersChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === "BANNER-NO-OS-INFO");
    expect(check!.passed).toBe(false);
  });

  it("BANNER-MOTD-EXISTS passes when motd is present", () => {
    const checks = parseBannersChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "BANNER-MOTD-EXISTS");
    expect(check!.passed).toBe(true);
  });

  it("should handle N/A output gracefully", () => {
    const checks = parseBannersChecks("N/A", "bare");
    expect(checks.length).toBeGreaterThanOrEqual(5);
    checks.forEach((c) => {
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });
  });
});
