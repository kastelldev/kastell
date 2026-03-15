import { parseBootChecks } from "../../src/core/audit/checks/boot.js";

describe("parseBootChecks", () => {
  const secureOutput = [
    "600 root root",
    "GRUB_PW_SET",
    "SecureBoot enabled",
    "BOOT_IMAGE=/vmlinuz root=/dev/sda1 apparmor=1 security=apparmor",
    "700 root root /etc/grub.d",
    "/boot ext4 rw,nosuid,nodev 0 0",
    "/usr/lib/systemd/system/rescue.service:ExecStart=-/usr/lib/systemd/systemd-sulogin-shell rescue",
    "kernel.modules_disabled = 1",
  ].join("\n");

  const insecureOutput = [
    "644 root root",
    "GRUB_NO_PW",
    "N/A",
    "BOOT_IMAGE=/vmlinuz root=/dev/sda1",
    "755 root root /etc/grub.d",
    "N/A",
    "N/A",
    "kernel.modules_disabled = 0",
  ].join("\n");

  it("should return 8 checks for the Boot category", () => {
    const checks = parseBootChecks(secureOutput, "bare");
    expect(checks.length).toBeGreaterThanOrEqual(8);
    checks.forEach((c) => expect(c.category).toBe("Boot"));
  });

  it("all check IDs should start with BOOT-", () => {
    const checks = parseBootChecks(secureOutput, "bare");
    checks.forEach((c) => expect(c.id).toMatch(/^BOOT-/));
  });

  it("all checks should have explain > 20 chars and fixCommand defined", () => {
    const checks = parseBootChecks(secureOutput, "bare");
    checks.forEach((c) => {
      expect(c.explain!.length).toBeGreaterThan(20);
      expect(c.fixCommand).toBeDefined();
      expect(c.fixCommand!.length).toBeGreaterThan(0);
    });
  });

  it("BOOT-GRUB-PERMS passes with 600 root:root", () => {
    const checks = parseBootChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "BOOT-GRUB-PERMS");
    expect(check!.passed).toBe(true);
  });

  it("BOOT-GRUB-PERMS fails with 644", () => {
    const checks = parseBootChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === "BOOT-GRUB-PERMS");
    expect(check!.passed).toBe(false);
  });

  it("BOOT-GRUB-PASSWORD passes when GRUB_PW_SET", () => {
    const checks = parseBootChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "BOOT-GRUB-PASSWORD");
    expect(check!.passed).toBe(true);
  });

  it("BOOT-GRUB-PASSWORD fails when GRUB_NO_PW", () => {
    const checks = parseBootChecks(insecureOutput, "bare");
    const check = checks.find((c) => c.id === "BOOT-GRUB-PASSWORD");
    expect(check!.passed).toBe(false);
  });

  it("BOOT-SECURE-BOOT passes when SecureBoot enabled", () => {
    const checks = parseBootChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "BOOT-SECURE-BOOT");
    expect(check!.passed).toBe(true);
  });

  it("BOOT-SINGLE-USER-AUTH passes when sulogin configured", () => {
    const checks = parseBootChecks(secureOutput, "bare");
    const check = checks.find((c) => c.id === "BOOT-SINGLE-USER-AUTH");
    expect(check!.passed).toBe(true);
  });

  it("should handle N/A output gracefully", () => {
    const checks = parseBootChecks("N/A", "bare");
    expect(checks.length).toBeGreaterThanOrEqual(8);
    checks.forEach((c) => {
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    });
  });
});
