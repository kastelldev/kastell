import { describe, it, expect } from "@jest/globals";
import { serverCompareOutputSchema } from "../../src/mcp/tools/serverCompare.js";

describe("serverCompare outputSchema", () => {
  it("category format parses valid data", () => {
    const data = {
      format: "category" as const,
      serverA: "host-a",
      serverB: "host-b",
      categories: [{ category: "ssh", scoreBefore: 80, scoreAfter: 90, delta: 10 }],
      overallA: 80,
      overallB: 90,
      overallDelta: 10,
    };
    const parsed = serverCompareOutputSchema.safeParse({ result: data });
    expect(parsed.success).toBe(true);
  });

  it("check format parses valid data", () => {
    const data = {
      format: "check" as const,
      serverA: "host-a",
      serverB: "host-b",
      checks: [
        {
          id: "ssh-001",
          name: "SSH Hardening",
          status: "A_better" as const,
          before: true,
          after: null,
        },
      ],
    };
    const parsed = serverCompareOutputSchema.safeParse({ result: data });
    expect(parsed.success).toBe(true);
  });

  it("rejects invalid format value", () => {
    const data = {
      format: "invalid" as const,
      serverA: "host-a",
      serverB: "host-b",
      categories: [],
    };
    const parsed = serverCompareOutputSchema.safeParse({ result: data });
    expect(parsed.success).toBe(false);
  });

});