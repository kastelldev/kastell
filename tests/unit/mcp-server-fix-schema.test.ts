import { z } from "zod";
import { serverFixInputSchema } from "../../src/mcp/tools/serverFix";

describe("serverFix input schema (Wave B)", () => {
  it("accepts action='apply' with mode='dry-run'", () => {
    const result = serverFixInputSchema.safeParse({ action: "apply", mode: "dry-run", server: "test" });
    expect(result.success).toBe(true);
  });

  it("accepts action='apply' with mode='live'", () => {
    const result = serverFixInputSchema.safeParse({ action: "apply", mode: "live", server: "test" });
    expect(result.success).toBe(true);
  });

  it("rejects action='apply' without mode", () => {
    const result = serverFixInputSchema.safeParse({ action: "apply", server: "test" });
    expect(result.success).toBe(false);
  });

  it("rejects legacy dryRun: boolean field", () => {
    const result = serverFixInputSchema.safeParse({ action: "apply", dryRun: true, server: "test" });
    // mode missing → fail. Even if it passed unknown-key, mode requirement fails.
    expect(result.success).toBe(false);
  });

  it("accepts action='rollback' with rollbackId", () => {
    expect(serverFixInputSchema.safeParse({ action: "rollback", rollbackId: "fix-2026-05-16-001", server: "test" }).success).toBe(true);
  });

  it("accepts action='history' with no mode", () => {
    expect(serverFixInputSchema.safeParse({ action: "history", server: "test" }).success).toBe(true);
  });

  it("registers without throwing (no Duplicate discriminator)", () => {
    expect(() => serverFixInputSchema.parse({ action: "history", server: "test" })).not.toThrow();
  });
});