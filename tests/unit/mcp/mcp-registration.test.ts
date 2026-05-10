import { createMcpServer } from "../../../src/mcp/server.js";

jest.mock("../../../src/utils/version.js", () => ({
  getVersion: jest.fn().mockReturnValue("0.0.0-test"),
}));

jest.mock("../../../src/plugin/loader.js", () => ({
  loadPlugins: jest.fn().mockResolvedValue({ loaded: [], errors: [] }),
}));

jest.mock("../../../src/core/audit/explainCheck.js", () => ({
  getFullCheckCatalog: jest.fn().mockReturnValue([]),
  findCheckById: jest.fn().mockReturnValue({ match: null, suggestions: [] }),
}));

jest.mock("../../../src/utils/config.js", () => ({
  getServers: jest.fn().mockReturnValue([]),
  findServer: jest.fn(),
}));

jest.mock("../../../src/core/audit/history.js", () => ({
  loadAuditHistory: jest.fn().mockReturnValue([]),
}));

describe("createMcpServer registration", () => {
  it("creates server with all registrations without throwing", async () => {
    const mcpServer = await createMcpServer();
    expect(mcpServer).toBeDefined();
    expect(mcpServer.server).toBeDefined();
  });

  it("build succeeds with resource and prompt registrations", async () => {
    await expect(createMcpServer()).resolves.toBeDefined();
  });
});
