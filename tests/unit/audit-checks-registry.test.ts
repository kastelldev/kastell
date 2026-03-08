import { parseAllChecks, CHECK_REGISTRY } from "../../src/core/audit/checks/index.js";
import { SECTION_INDICES } from "../../src/core/audit/commands.js";

describe("CHECK_REGISTRY", () => {
  it("should have entries for all 9 categories", () => {
    expect(CHECK_REGISTRY).toHaveLength(9);
    const names = CHECK_REGISTRY.map((e: { name: string }) => e.name);
    expect(names).toContain("SSH");
    expect(names).toContain("Firewall");
    expect(names).toContain("Updates");
    expect(names).toContain("Auth");
    expect(names).toContain("Docker");
    expect(names).toContain("Network");
    expect(names).toContain("Filesystem");
    expect(names).toContain("Logging");
    expect(names).toContain("Kernel");
  });

  it("should map section indices to correct parsers", () => {
    const sshEntry = CHECK_REGISTRY.find((e: { sectionIndex: number }) => e.sectionIndex === SECTION_INDICES.SSH);
    expect(sshEntry).toBeDefined();
    expect(sshEntry!.name).toBe("SSH");
    expect(typeof sshEntry!.parser).toBe("function");

    const dockerEntry = CHECK_REGISTRY.find((e: { sectionIndex: number }) => e.sectionIndex === SECTION_INDICES.DOCKER);
    expect(dockerEntry).toBeDefined();
    expect(dockerEntry!.name).toBe("Docker");
  });
});

describe("parseAllChecks", () => {
  it("should return 9 AuditCategory objects from batch outputs", () => {
    // Create minimal batch outputs with separator
    const batch1 = [
      "passwordauthentication no\npermitRootLogin prohibit-password\npermitemptypasswords no\npubkeyauthentication yes\nmaxauthtries 3\nx11forwarding no",
      "Status: active\nDefault: deny (incoming)",
      "0\nii unattended-upgrades\n1709654400\nNO_REBOOT",
      "auth required pam_unix.so\nsudo:x:27:admin\nPASS_MAX_DAYS 99999\nN/A",
    ].join("\n---SEPARATOR---\n");

    const batch2 = [
      "N/A",  // Docker (not installed)
      "N/A",  // Network
      "N/A",  // Filesystem
      "active\nactive\nweekly\nEXISTS",  // Logging
      "kernel.randomize_va_space = 2\n5.15.0-91-generic\napparmor",  // Kernel
    ].join("\n---SEPARATOR---\n");

    const categories = parseAllChecks([batch1, batch2], "bare");
    expect(categories).toHaveLength(9);
    categories.forEach((cat) => {
      expect(cat.name).toBeDefined();
      expect(cat.checks).toBeDefined();
      expect(Array.isArray(cat.checks)).toBe(true);
      expect(typeof cat.score).toBe("number");
      expect(typeof cat.maxScore).toBe("number");
    });
  });

  it("should handle empty batch outputs gracefully", () => {
    const categories = parseAllChecks(["", ""], "bare");
    expect(categories).toHaveLength(9);
    // All categories should have checks (even if all failed)
    categories.forEach((cat) => {
      expect(cat.checks.length).toBeGreaterThan(0);
    });
  });
});
