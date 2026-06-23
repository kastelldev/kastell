import { handleServerPlugin } from "../../src/mcp/tools/serverPlugin";
import * as registry from "../../src/plugin/registry";

jest.mock("../../src/utils/version.js", () => ({
  KASTELL_VERSION: "2.2.7",
}));

describe("server_plugin list", () => {
  beforeEach(() => {
    registry.clearPluginRegistry();
  });

  afterEach(() => {
    registry.clearPluginRegistry();
  });

  it("returns plugins from the loaded registry", async () => {
    // Register plugins directly in the registry (simulating loadPlugins)
    registry.registerPlugin(
      {
        name: "kastell-plugin-auditor",
        version: "1.0.0",
        apiVersion: "2",
        kastell: "*",
        capabilities: ["audit"],
        checkPrefix: "AUD",
        entry: "./index.js",
      },
      [
        { id: "AUD-001", name: "Check One", description: "Test", severity: "info" as const, category: "test", sourceApiVersion: "2" as const, checkCommand: { kind: "read", cmd: "echo test" } },
        { id: "AUD-002", name: "Check Two", description: "Test", severity: "warning" as const, category: "test", sourceApiVersion: "2" as const, checkCommand: { kind: "read", cmd: "echo test" } },
      ],
    );

    const result = await handleServerPlugin({ action: "list" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.plugins).toHaveLength(1);
    expect(data.plugins[0].name).toBe("kastell-plugin-auditor");
    expect(data.plugins[0].checks).toBe(2);
    expect(data.count).toBe(1);
  });

  it("returns empty array when registry is empty", async () => {
    const result = await handleServerPlugin({ action: "list" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.plugins).toEqual([]);
    expect(data.count).toBe(0);
  });

  it("maps registry entry fields correctly for MCP response", async () => {
    registry.registerPlugin(
      {
        name: "kastell-plugin-wordpress",
        version: "2.0.0",
        apiVersion: "2",
        kastell: "*",
        capabilities: ["audit"],
        checkPrefix: "WP",
        entry: "./index.js",
      },
      [{ id: "WP-001", name: "WordPress Check", description: "Test", severity: "info" as const, category: "test", sourceApiVersion: "2" as const, checkCommand: { kind: "read", cmd: "echo test" } }],
    );

    const result = await handleServerPlugin({ action: "list" });
    const data = JSON.parse(result.content[0].text);

    const plugin = data.plugins[0];
    expect(plugin).toMatchObject({
      name: "kastell-plugin-wordpress",
      version: "2.0.0",
      status: "loaded",
      checks: 1,
    });
    expect(plugin).toHaveProperty("commandCount");
    expect(plugin).toHaveProperty("mcpToolCount");
  });
});
