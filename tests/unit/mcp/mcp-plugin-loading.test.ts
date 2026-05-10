jest.mock("../../../src/plugin/loader.js", () => ({
  loadPlugins: jest.fn().mockResolvedValue({ loaded: [], errors: [] }),
}));

jest.mock("../../../src/utils/version.js", () => ({
  getVersion: jest.fn().mockReturnValue("0.0.0-test"),
}));

import { loadPlugins } from "../../../src/plugin/loader.js";
import { createMcpServer } from "../../../src/mcp/server.js";

describe("MCP server plugin loading", () => {
  beforeEach(() => jest.clearAllMocks());

  it("calls loadPlugins during server creation", async () => {
    await createMcpServer();
    expect(loadPlugins).toHaveBeenCalledTimes(1);
  });
});
