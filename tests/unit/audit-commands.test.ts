import { buildAuditBatchCommands, SECTION_INDICES } from "../../src/core/audit/commands.js";

describe("buildAuditBatchCommands", () => {
  it("should return 2-3 batch command strings for bare platform", () => {
    const commands = buildAuditBatchCommands("bare");
    expect(commands.length).toBeGreaterThanOrEqual(2);
    expect(commands.length).toBeLessThanOrEqual(3);
    commands.forEach((cmd) => {
      expect(typeof cmd).toBe("string");
      expect(cmd.length).toBeGreaterThan(0);
    });
  });

  it("should separate sections with ---SEPARATOR--- within each batch", () => {
    const commands = buildAuditBatchCommands("bare");
    commands.forEach((cmd) => {
      expect(cmd).toContain("---SEPARATOR---");
    });
  });

  it("should include platform-specific sections for coolify", () => {
    const bareCommands = buildAuditBatchCommands("bare");
    const coolifyCommands = buildAuditBatchCommands("coolify");
    const coolifyAll = coolifyCommands.join("\n");
    const bareAll = bareCommands.join("\n");
    expect(coolifyAll.length).toBeGreaterThan(bareAll.length);
  });

  it("should include platform-specific sections for dokploy", () => {
    const bareCommands = buildAuditBatchCommands("bare");
    const dokployCommands = buildAuditBatchCommands("dokploy");
    const dokployAll = dokployCommands.join("\n");
    const bareAll = bareCommands.join("\n");
    expect(dokployAll.length).toBeGreaterThan(bareAll.length);
  });

  it("should use defensive patterns in commands", () => {
    const commands = buildAuditBatchCommands("bare");
    const allCommands = commands.join("\n");
    expect(allCommands).toContain("2>/dev/null");
    expect(allCommands).toMatch(/\|\| echo ['"]N\/A['"]/);
  });

  it("should export deterministic section indices", () => {
    expect(typeof SECTION_INDICES).toBe("object");
    expect(SECTION_INDICES.SSH).toBeDefined();
    expect(SECTION_INDICES.FIREWALL).toBeDefined();
    expect(SECTION_INDICES.UPDATES).toBeDefined();
    expect(SECTION_INDICES.DOCKER).toBeDefined();
    expect(SECTION_INDICES.NETWORK).toBeDefined();
    expect(SECTION_INDICES.FILESYSTEM).toBeDefined();
    expect(SECTION_INDICES.AUTH).toBeDefined();
    expect(SECTION_INDICES.LOGGING).toBeDefined();
    expect(SECTION_INDICES.KERNEL).toBeDefined();
    // Values should be sequential integers
    const values = Object.values(SECTION_INDICES) as number[];
    values.forEach((v) => expect(Number.isInteger(v)).toBe(true));
  });
});
