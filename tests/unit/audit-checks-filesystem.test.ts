import { parseFilesystemChecks } from "../../src/core/audit/checks/filesystem.js";

describe("parseFilesystemChecks", () => {
  const secureOutput = [
    // World-writable files (none)
    "N/A",
    // SUID binaries (typical safe set)
    "/usr/bin/passwd\n/usr/bin/sudo\n/usr/bin/chfn",
    // /tmp permissions
    "1777 root root",
    // Disk usage
    "Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1        50G   20G   28G  42% /",
  ].join("\n");

  const insecureOutput = [
    // World-writable files found
    "/etc/cron.d/something\n/etc/sensitive\n/usr/local/bin/app",
    // Many SUID binaries
    Array(15).fill("/usr/bin/something").join("\n"),
    // /tmp permissions (no sticky bit)
    "0777 root root",
    // Disk usage high
    "Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1        50G   48G    1G  96% /",
  ].join("\n");

  it("should return 5 checks", () => {
    const checks = parseFilesystemChecks(secureOutput, "bare");
    expect(checks).toHaveLength(5);
    checks.forEach((check) => {
      expect(check.category).toBe("Filesystem");
      expect(check.id).toMatch(/^FS-0[1-5]$/);
    });
  });

  it("should return FS-01 passed when /tmp has sticky bit (1777)", () => {
    const checks = parseFilesystemChecks(secureOutput, "bare");
    const fs01 = checks.find((c: { id: string }) => c.id === "FS-01");
    expect(fs01!.passed).toBe(true);
  });

  it("should return FS-01 failed when /tmp has 0777 (no sticky bit)", () => {
    const checks = parseFilesystemChecks(insecureOutput, "bare");
    const fs01 = checks.find((c: { id: string }) => c.id === "FS-01");
    expect(fs01!.passed).toBe(false);
  });

  it("should return FS-02 passed when no world-writable files", () => {
    const checks = parseFilesystemChecks(secureOutput, "bare");
    const fs02 = checks.find((c: { id: string }) => c.id === "FS-02");
    expect(fs02!.passed).toBe(true);
  });

  it("should return FS-02 failed when world-writable files exist", () => {
    const checks = parseFilesystemChecks(insecureOutput, "bare");
    const fs02 = checks.find((c: { id: string }) => c.id === "FS-02");
    expect(fs02!.passed).toBe(false);
  });

  it("should handle N/A output gracefully", () => {
    const checks = parseFilesystemChecks("N/A", "bare");
    expect(checks).toHaveLength(5);
  });
});
