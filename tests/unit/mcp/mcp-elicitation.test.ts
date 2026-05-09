import { supportsElicitation, elicitMissingParams } from "../../../src/mcp/utils.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function mockMcpServer(elicitationCapable: boolean, elicitResult?: unknown): McpServer {
  const server = {
    getClientCapabilities: jest.fn().mockReturnValue(
      elicitationCapable ? { elicitation: {} } : {},
    ),
    elicitInput: jest.fn().mockResolvedValue(elicitResult ?? {
      action: "accept",
      content: { name: "test-server", provider: "hetzner" },
    }),
  };
  return { server } as unknown as McpServer;
}

describe("supportsElicitation", () => {
  it("returns true when client declares elicitation capability", () => {
    const mcp = mockMcpServer(true);
    expect(supportsElicitation(mcp)).toBe(true);
  });

  it("returns false when client has no elicitation capability", () => {
    const mcp = mockMcpServer(false);
    expect(supportsElicitation(mcp)).toBe(false);
  });

  it("returns false when getClientCapabilities is not available", () => {
    const mcp = { server: {} } as unknown as McpServer;
    expect(supportsElicitation(mcp)).toBe(false);
  });
});

describe("elicitMissingParams", () => {
  it("returns accepted content on successful elicitation", async () => {
    const mcp = mockMcpServer(true, {
      action: "accept",
      content: { name: "my-server" },
    });
    const result = await elicitMissingParams(mcp, "Provide server details:", {
      type: "object",
      properties: {
        name: { type: "string", title: "Server Name" },
      },
      required: ["name"],
    });
    expect(result).toEqual({ status: "accepted", content: { name: "my-server" } });
  });

  it("returns cancelled when user declines", async () => {
    const mcp = mockMcpServer(true, { action: "decline" });
    const result = await elicitMissingParams(mcp, "Provide details:", {
      type: "object",
      properties: { name: { type: "string" } },
    });
    expect(result).toEqual({ status: "cancelled" });
  });

  it("returns unsupported when capability not available", async () => {
    const mcp = mockMcpServer(false);
    const result = await elicitMissingParams(mcp, "Provide details:", {
      type: "object",
      properties: { name: { type: "string" } },
    });
    expect(result).toEqual({ status: "unsupported" });
  });

  it("returns unsupported when mcpServer is undefined", async () => {
    const result = await elicitMissingParams(undefined, "Provide details:", {
      type: "object",
      properties: { name: { type: "string" } },
    });
    expect(result).toEqual({ status: "unsupported" });
  });
});

import { handleServerProvision } from "../../../src/mcp/tools/serverProvision.js";

jest.mock("../../../src/core/provision.js", () => ({
  provisionServer: jest.fn().mockResolvedValue({
    success: true,
    server: {
      id: "test-id",
      name: "test-server",
      provider: "hetzner",
      ip: "1.2.3.4",
      region: "nbg1",
      size: "cax11",
      createdAt: "2026-01-01",
      mode: "coolify",
    },
  }),
}));

jest.mock("../../../src/utils/config.js", () => ({
  getServers: jest.fn().mockReturnValue([]),
  findServer: jest.fn(),
}));

jest.mock("../../../src/core/tokens.js", () => ({
  getProviderToken: jest.fn().mockReturnValue("fake-token"),
}));

jest.mock("../../../src/utils/safeMode.js", () => ({
  isSafeMode: jest.fn().mockReturnValue(false),
  logSafeModeBlock: jest.fn(),
}));

describe("server_provision elicitation", () => {
  it("elicits provider and name when missing and client supports elicitation", async () => {
    const mcp = mockMcpServer(true, {
      action: "accept",
      content: { provider: "hetzner", name: "my-server" },
    });

    const result = await handleServerProvision(
      { provider: undefined as any, name: undefined as any },
      mcp,
    );

    expect(mcp.server.elicitInput).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedSchema: expect.objectContaining({
          properties: expect.objectContaining({
            provider: expect.any(Object),
            name: expect.any(Object),
          }),
        }),
      }),
    );
    expect(result.isError).toBeUndefined();
  });

  it("returns error when params missing and elicitation not supported", async () => {
    const mcp = mockMcpServer(false);
    const result = await handleServerProvision(
      { provider: undefined as any, name: undefined as any },
      mcp,
    );
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toContain("required");
  });

  it("returns cancelled response when user declines elicitation", async () => {
    const mcp = mockMcpServer(true, { action: "decline" });
    const result = await handleServerProvision(
      { provider: undefined as any, name: undefined as any },
      mcp,
    );
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toHaveProperty("status", "cancelled");
  });

  it("skips elicitation when all required params provided", async () => {
    const mcp = mockMcpServer(true);
    await handleServerProvision(
      { provider: "hetzner", name: "my-server" },
      mcp,
    );
    expect(mcp.server.elicitInput).not.toHaveBeenCalled();
  });
});

import { handleServerSecure } from "../../../src/mcp/tools/serverSecure.js";

jest.mock("../../../src/core/secure.js");
jest.mock("../../../src/core/firewall.js");
jest.mock("../../../src/core/domain.js");

describe("server_secure elicitation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("elicits port when firewall-add called without port", async () => {
    const mcp = mockMcpServer(true, {
      action: "accept",
      content: { port: 8080, protocol: "tcp" },
    });

    await handleServerSecure(
      { action: "firewall-add", server: "test" } as any,
      mcp,
    );

    expect(mcp.server.elicitInput).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedSchema: expect.objectContaining({
          properties: expect.objectContaining({
            port: expect.any(Object),
          }),
        }),
      }),
    );
  });

  it("elicits domain when domain-set called without domain", async () => {
    const mcp = mockMcpServer(true, {
      action: "accept",
      content: { domain: "example.com" },
    });

    await handleServerSecure(
      { action: "domain-set", server: "test" } as any,
      mcp,
    );

    expect(mcp.server.elicitInput).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedSchema: expect.objectContaining({
          properties: expect.objectContaining({
            domain: expect.any(Object),
          }),
        }),
      }),
    );
  });

  it("returns error when port missing and elicitation unsupported", async () => {
    const mcp = mockMcpServer(false);
    const result = await handleServerSecure(
      { action: "firewall-add", server: "test" } as any,
      mcp,
    );
    expect(result.isError).toBe(true);
  });
});
