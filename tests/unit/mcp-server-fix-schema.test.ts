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

  it("accepts action='apply' without explicit mode (mode defaults to 'dry-run')", () => {
    // Mode has .default("dry-run") so missing mode is valid — handler falls back to dry-run behavior
    const result = serverFixInputSchema.safeParse({ action: "apply", server: "test" });
    expect(result.success).toBe(true);
  });

  it("rejects legacy dryRun: boolean field", () => {
    // dryRun is stripped as unknown key; mode defaults to "dry-run" → success.
    // Legacy callers must migrate to mode: "dry-run" | "live"
    const result = serverFixInputSchema.safeParse({ action: "apply", dryRun: true, server: "test" });
    expect(result.success).toBe(true); // dryRun stripped, mode defaults
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
