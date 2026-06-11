// Mock version.ts which uses import.meta.url (ESM-only)
jest.mock("../../src/utils/version.js", () => ({
  KASTELL_VERSION: "0.0.0-test",
}));

import { ALL_MCP_TOOLS } from "../../src/mcp/server.js";
import { FIXTURES, assertCoverage } from "./__fixtures__/index.js";
import {
  normalizeObjectSchema,
  safeParseAsync,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";

// Re-export types needed by consumers (avoid circular import in __fixtures__/index.ts)
export type ActionFixture = {
  action: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setup?: () => any;
};

describe("MCP outputSchema round-trip — coverage gate", () => {
  it("every registered tool has a fixture", () => {
    expect(() => assertCoverage()).not.toThrow();
  });
});

describe.each(Object.values(ALL_MCP_TOOLS))(
  "MCP outputSchema round-trip: $name",
  (tool) => {
    const fixture = FIXTURES[tool.name];
    if (!fixture) return; // coverage gate above will fail; skip body to avoid noise

    for (const actionFixture of fixture.fixtures) {
      it(`action=${actionFixture.action} parses against outputSchema`, async () => {
        const teardown = actionFixture.setup?.();
        try {
          const response = await tool.handler(actionFixture.input);
          const structured = (response as { structuredContent?: unknown }).structuredContent;
          expect(structured).toBeDefined();
          const normalizedSchema = normalizeObjectSchema(tool.outputSchema);
          expect(normalizedSchema).toBeDefined();
          const parsed = await safeParseAsync(normalizedSchema!, structured);
          expect(parsed.success).toBe(true);
          if (tool.name === "server_manage") {
            const result = (structured as {
              result: {
                action: string;
                server: { id?: string };
                platformStatus?: string | null;
                cloudDeleted?: boolean;
                localRemoved?: boolean;
              };
            }).result;

            expect(result.action).toBe(actionFixture.action);
            if (actionFixture.action === "add") {
              expect(result.server.id).toBe("manual-web-stage-1");
              expect(result.platformStatus).toBe("skipped");
            }
            if (actionFixture.action === "destroy") {
              expect(result.cloudDeleted).toBe(true);
              expect(result.localRemoved).toBe(true);
            }
          }
        } finally {
          if (typeof teardown === "function") teardown();
        }
      });
    }
  },
);
