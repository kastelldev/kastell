import { createMcpServer } from "../../../src/mcp/server.js";

jest.mock("../../../src/utils/version.js", () => ({
  getVersion: jest.fn().mockReturnValue("0.0.0-test"),
}));

jest.mock("../../../src/plugin/loader.js", () => ({
  loadPlugins: jest.fn().mockResolvedValue({ loaded: [], errors: [] }),
}));

jest.mock("../../../src/core/audit/explainCheck.js", () => {
  // Reuse the real describeAuditCatalog() so the mock reflects the live
  // catalog count — hardcoding 449/31 here re-introduces the exact
  // catalog-drift trap that describeAuditCatalog was added to prevent.
  const actual = jest.requireActual("../../../src/core/audit/explainCheck.js") as {
    describeAuditCatalog: () => {
      checks: number;
      categories: number;
      description: string;
      short: string;
      resource: string;
    };
  };
  return {
    getFullCheckCatalog: jest.fn().mockReturnValue([]),
    findCheckById: jest.fn().mockReturnValue({ match: null, suggestions: [] }),
    describeAuditCatalog: jest.fn(() => actual.describeAuditCatalog()),
  };
});

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
