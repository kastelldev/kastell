import { parseAllChecks, CHECK_REGISTRY } from "../../src/core/audit/checks/index.js";
import type { CategoryEntry } from "../../src/core/audit/checks/index.js";

describe("CHECK_REGISTRY", () => {
  it("should have entries for all 9 categories", () => {
    expect(CHECK_REGISTRY).toHaveLength(9);
    const names = CHECK_REGISTRY.map((e: CategoryEntry) => e.name);
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

  it("should map section names to correct parsers", () => {
    const sshEntry = CHECK_REGISTRY.find((e: CategoryEntry) => e.sectionName === "SSH");
    expect(sshEntry).toBeDefined();
    expect(sshEntry!.name).toBe("SSH");
    expect(typeof sshEntry!.parser).toBe("function");

    const dockerEntry = CHECK_REGISTRY.find((e: CategoryEntry) => e.sectionName === "DOCKER");
    expect(dockerEntry).toBeDefined();
    expect(dockerEntry!.name).toBe("Docker");
  });

  it("should have sectionName on every entry (not sectionIndex)", () => {
    CHECK_REGISTRY.forEach((e: CategoryEntry) => {
      expect(typeof e.sectionName).toBe("string");
      expect(e.sectionName.length).toBeGreaterThan(0);
      expect((e as Record<string, unknown>)["sectionIndex"]).toBeUndefined();
    });
  });

  it("BATCH1_SECTION_COUNT should not exist in checks/index module", async () => {
    const mod = await import("../../src/core/audit/checks/index.js");
    expect((mod as Record<string, unknown>)["BATCH1_SECTION_COUNT"]).toBeUndefined();
  });
});

describe("parseAllChecks", () => {
  const makeBatch = (...sections: Array<[string, string]>): string =>
    sections.map(([name, content]) => `---SECTION:${name}---\n${content}`).join("\n");

  const minimalBatch1 = makeBatch(
    ["SSH", "passwordauthentication no\npermitRootLogin prohibit-password\npermitemptypasswords no\npubkeyauthentication yes\nmaxauthtries 3\nx11forwarding no"],
    ["FIREWALL", "Status: active\nDefault: deny (incoming)"],
    ["UPDATES", "0\nii unattended-upgrades\n1709654400\nNO_REBOOT"],
    ["AUTH", "auth required pam_unix.so\nsudo:x:27:admin\nPASS_MAX_DAYS 99999\nN/A"],
  );

  const minimalBatch2 = makeBatch(
    ["DOCKER", "N/A"],
    ["NETWORK", "N/A"],
    ["LOGGING", "active\nactive\nweekly\nEXISTS"],
    ["KERNEL", "kernel.randomize_va_space = 2\n5.15.0-91-generic\napparmor"],
  );

  const minimalBatch3 = makeBatch(
    ["FILESYSTEM", "N/A"],
  );

  it("should correctly route SSH section to SSH parser", () => {
    const categories = parseAllChecks([minimalBatch1, minimalBatch2, minimalBatch3], "bare");
    const ssh = categories.find((c) => c.name === "SSH");
    expect(ssh).toBeDefined();
    expect(ssh!.checks.length).toBeGreaterThan(0);
    // passwordauthentication no → SSH-01 should pass
    const pwdCheck = ssh!.checks.find((c) => c.id === "SSH-01");
    expect(pwdCheck).toBeDefined();
    expect(pwdCheck!.passed).toBe(true);
  });

  it("should correctly route all 9 categories to their parsers", () => {
    const categories = parseAllChecks([minimalBatch1, minimalBatch2, minimalBatch3], "bare");
    expect(categories).toHaveLength(9);
    const names = categories.map((c) => c.name);
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

  it("should not shift FIREWALL parser when a new category is inserted between SSH and FIREWALL", () => {
    // Normal batch: FIREWALL section has "Status: active"
    const normalBatch = makeBatch(
      ["SSH", "passwordauthentication no"],
      ["FIREWALL", "Status: active\nDefault: deny (incoming)"],
    );
    const normalCategories = parseAllChecks([normalBatch, minimalBatch2, minimalBatch3], "bare");
    const normalFirewall = normalCategories.find((c) => c.name === "Firewall");

    // Batch with NEWCATEGORY inserted between SSH and FIREWALL
    const batchWithExtra = makeBatch(
      ["SSH", "passwordauthentication no"],
      ["NEWCATEGORY", "some extra data"],
      ["FIREWALL", "Status: active\nDefault: deny (incoming)"],
    );
    const extraCategories = parseAllChecks([batchWithExtra, minimalBatch2, minimalBatch3], "bare");
    const extraFirewall = extraCategories.find((c) => c.name === "Firewall");

    // Both should produce the same firewall results
    expect(extraFirewall!.checks).toEqual(normalFirewall!.checks);
  });

  it("should give empty string to parser when a section is missing from output", () => {
    // Batch with no DOCKER section marker
    const batchWithoutDocker = makeBatch(
      ["NETWORK", "N/A"],
      ["LOGGING", "active\nactive\nweekly\nEXISTS"],
      ["KERNEL", "kernel.randomize_va_space = 2\n5.15.0-91-generic\napparmor"],
    );
    const categories = parseAllChecks([minimalBatch1, batchWithoutDocker, minimalBatch3], "bare");
    const docker = categories.find((c) => c.name === "Docker");
    // Docker parser receives empty string — should still return checks (all failed)
    expect(docker).toBeDefined();
    expect(docker!.checks.length).toBeGreaterThan(0);
  });

  it("should return 9 AuditCategory objects from batch outputs", () => {
    const categories = parseAllChecks([minimalBatch1, minimalBatch2, minimalBatch3], "bare");
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
    const categories = parseAllChecks(["", "", ""], "bare");
    expect(categories).toHaveLength(9);
    categories.forEach((cat) => {
      expect(cat.checks.length).toBeGreaterThan(0);
    });
  });
});
