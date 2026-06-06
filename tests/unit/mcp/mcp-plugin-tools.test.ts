import { registerPluginMcpTools, CORE_TOOL_PREFIX } from "../../../src/mcp/pluginTools.js";
import type { PluginMcpToolEntry } from "../../../src/plugin/registry.js";

jest.mock("../../../src/utils/logger.js", () => ({ debugLog: undefined }));

describe("registerPluginMcpTools", () => {
  const mockServer = {
    registeredTools: new Map<string, unknown>(),
    registerTool(name: string, config: unknown, handler: unknown) {
      this.registeredTools.set(name, { config, handler });
    },
  };

  beforeEach(() => {
    mockServer.registeredTools.clear();
  });

  it("registers plugin tool with correct naming convention", () => {
    const entries: PluginMcpToolEntry[] = [{
      pluginShortName: "wordpress",
      toolName: "server_plugin_wordpress_scan",
      tool: { name: "scan", description: "Run WP scan", handler: "./mcp/scan.js" },
      pluginDir: "/fake/path",
    }];
    const count = registerPluginMcpTools(mockServer as any, entries);
    expect(count).toBe(1);
    expect(mockServer.registeredTools.has("server_plugin_wordpress_scan")).toBe(true);
  });

  it("sets readOnlyHint to false by default (plugin tools may have side effects)", () => {
    const entries: PluginMcpToolEntry[] = [{
      pluginShortName: "wordpress",
      toolName: "server_plugin_wordpress_scan",
      tool: { name: "scan", description: "Run WP scan", handler: "./mcp/scan.js" },
      pluginDir: "/fake/path",
    }];
    registerPluginMcpTools(mockServer as any, entries);
    const registered = mockServer.registeredTools.get("server_plugin_wordpress_scan") as any;
    expect(registered.config.annotations.readOnlyHint).toBe(false);
  });

  it("rejects tool name not matching server_plugin_ prefix", () => {
    const entries: PluginMcpToolEntry[] = [{
      pluginShortName: "wordpress",
      toolName: "server_wordpress_scan",  // wrong prefix
      tool: { name: "scan", description: "Run WP scan", handler: "./mcp/scan.js" },
      pluginDir: "/fake/path",
    }];
    const count = registerPluginMcpTools(mockServer as any, entries);
    expect(count).toBe(0);
  });

  it("returns 0 for empty entries", () => {
    const count = registerPluginMcpTools(mockServer as any, []);
    expect(count).toBe(0);
  });

  it("registers multiple tools from same plugin", () => {
    const entries: PluginMcpToolEntry[] = [
      {
        pluginShortName: "wordpress",
        toolName: "server_plugin_wordpress_scan",
        tool: { name: "scan", description: "Scan", handler: "./mcp/scan.js" },
        pluginDir: "/fake",
      },
      {
        pluginShortName: "wordpress",
        toolName: "server_plugin_wordpress_report",
        tool: { name: "report", description: "Report", handler: "./mcp/report.js" },
        pluginDir: "/fake",
      },
    ];
    const count = registerPluginMcpTools(mockServer as any, entries);
    expect(count).toBe(2);
  });

  it("CORE_TOOL_PREFIX constant equals server_plugin_", () => {
    expect(CORE_TOOL_PREFIX).toBe("server_plugin_");
  });
});
