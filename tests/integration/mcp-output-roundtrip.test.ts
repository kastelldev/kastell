// Mock version.ts which uses import.meta.url (ESM-only)
jest.mock("../../src/utils/version.js", () => ({
  KASTELL_VERSION: "0.0.0-test",
}));

import { ALL_MCP_TOOLS } from "../../src/mcp/server.js";
import { FIXTURES, assertCoverage } from "./__fixtures__/index.js";

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
          expect(() => tool.outputSchema.parse(structured)).not.toThrow();
        } finally {
          if (typeof teardown === "function") teardown();
        }
      });
    }
  },
);
