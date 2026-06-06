import { describe, it, expect } from "@jest/globals";
import { supportsElicitation, type McpServerInternal } from "../../../src/mcp/utils.js";

describe("McpServerInternal named type (CQS-05)", () => {
  it("should export McpServerInternal type that accepts getClientCapabilities method", () => {
    // Type-level assertion: McpServerInternal can hold a getClientCapabilities function
    const internal: McpServerInternal = {
      getClientCapabilities: () => ({ elicitation: { foo: "bar" } }),
    };
    expect(typeof internal.getClientCapabilities).toBe("function");
    expect(internal.getClientCapabilities?.()).toEqual({ elicitation: { foo: "bar" } });
  });

  it("should allow getClientCapabilities to be omitted", () => {
    // Type-level: method is optional
    const internal: McpServerInternal = {};
    expect(internal.getClientCapabilities).toBeUndefined();
  });

  it("should be usable in cast context — supportsElicitation with getClientCapabilities", () => {
    // Behavioral: supportsElicitation uses the named type under the hood.
    // Mock the McpServer.server property to return an object matching McpServerInternal.
    const fakeMcpServer = {
      server: {
        getClientCapabilities: () => ({ elicitation: { present: true } }),
      } satisfies McpServerInternal,
    } as unknown as Parameters<typeof supportsElicitation>[0];
    expect(supportsElicitation(fakeMcpServer)).toBe(true);
  });

  it("should be usable in cast context — supportsElicitation without getClientCapabilities", () => {
    const fakeMcpServer = {
      server: {} satisfies McpServerInternal,
    } as unknown as Parameters<typeof supportsElicitation>[0];
    expect(supportsElicitation(fakeMcpServer)).toBe(false);
  });
});
