import { buildAuditBatchCommands, BATCH_TIMEOUTS } from "../../src/core/audit/commands.js";
import type { BatchDef } from "../../src/core/audit/commands.js";

describe("buildAuditBatchCommands", () => {
  it("should return exactly 3 BatchDef objects", () => {
    const batches = buildAuditBatchCommands("bare");
    expect(batches).toHaveLength(3);
  });

  it("should give each BatchDef a valid tier property", () => {
    const batches = buildAuditBatchCommands("bare");
    const tiers = batches.map((b: BatchDef) => b.tier);
    expect(tiers).toEqual(["fast", "medium", "slow"]);
  });

  it("should contain named separators for SSH, FIREWALL, UPDATES, AUTH in batch 1 (fast)", () => {
    const [fast] = buildAuditBatchCommands("bare");
    expect(fast.command).toContain("---SECTION:SSH---");
    expect(fast.command).toContain("---SECTION:FIREWALL---");
    expect(fast.command).toContain("---SECTION:UPDATES---");
    expect(fast.command).toContain("---SECTION:AUTH---");
  });

  it("should contain named separators for DOCKER, NETWORK, LOGGING, KERNEL in batch 2 (medium)", () => {
    const [, medium] = buildAuditBatchCommands("bare");
    expect(medium.command).toContain("---SECTION:DOCKER---");
    expect(medium.command).toContain("---SECTION:NETWORK---");
    expect(medium.command).toContain("---SECTION:LOGGING---");
    expect(medium.command).toContain("---SECTION:KERNEL---");
  });

  it("should contain named separator for FILESYSTEM in batch 3 (slow)", () => {
    const [, , slow] = buildAuditBatchCommands("bare");
    expect(slow.command).toContain("---SECTION:FILESYSTEM---");
  });

  it("BATCH_TIMEOUTS should have fast=30000, medium=60000, slow=120000", () => {
    expect(BATCH_TIMEOUTS.fast).toBe(30_000);
    expect(BATCH_TIMEOUTS.medium).toBe(60_000);
    expect(BATCH_TIMEOUTS.slow).toBe(120_000);
  });

  it("should not contain old ---SEPARATOR--- format in any batch", () => {
    const batches = buildAuditBatchCommands("bare");
    batches.forEach((b: BatchDef) => {
      expect(b.command).not.toContain("---SEPARATOR---");
    });
  });

  it("should not export SECTION_INDICES", async () => {
    const mod = await import("../../src/core/audit/commands.js");
    expect((mod as Record<string, unknown>)["SECTION_INDICES"]).toBeUndefined();
  });

  it("should include platform-specific sections for coolify in medium batch", () => {
    const [, mediumBare] = buildAuditBatchCommands("bare");
    const [, mediumCoolify] = buildAuditBatchCommands("coolify");
    expect(mediumCoolify.command.length).toBeGreaterThan(mediumBare.command.length);
  });

  it("should include platform-specific sections for dokploy in medium batch", () => {
    const [, mediumBare] = buildAuditBatchCommands("bare");
    const [, mediumDokploy] = buildAuditBatchCommands("dokploy");
    expect(mediumDokploy.command.length).toBeGreaterThan(mediumBare.command.length);
  });

  it("should use defensive patterns in commands", () => {
    const batches = buildAuditBatchCommands("bare");
    const allCommands = batches.map((b: BatchDef) => b.command).join("\n");
    expect(allCommands).toContain("2>/dev/null");
    expect(allCommands).toMatch(/\|\| echo ['"]N\/A['"]/);
  });
});
