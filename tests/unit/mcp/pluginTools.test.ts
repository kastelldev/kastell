import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { McpResponse } from "../../../src/mcp/utils.js";
import type { PluginMcpToolEntry } from "../../../src/plugin/registry.js";

// Mock module-level dependencies before importing pluginTools
jest.mock("../../../src/utils/logger.js", () => ({
  debugLog: jest.fn<(msg: string) => void>(),
}));

jest.mock("../../../src/plugin/handlerResolver.js");

// Import after mocks are set up
import { registerPluginMcpTools, CORE_TOOL_PREFIX } from "../../../src/mcp/pluginTools.js";
import { resolvePluginHandler } from "../../../src/plugin/handlerResolver.js";
import { debugLog } from "../../../src/utils/logger.js";

// Plugin handler function type returned by resolvePluginHandler
type PluginHandlerFn = (...args: unknown[]) => Promise<unknown>;

const mockResolvePluginHandler = resolvePluginHandler as jest.MockedFunction<typeof resolvePluginHandler>;
const mockDebugLog = debugLog as jest.MockedFunction<(msg: string) => void>;

// Create a mock function for plugin handlers — use jest.fn() (no generic) so it
// returns Mock<any,any> with mockResolvedValueOnce etc, then narrow via unknown.
const mkHandler = (): jest.MockedFunction<PluginHandlerFn> =>
  jest.fn() as unknown as jest.MockedFunction<PluginHandlerFn>;

describe("registerPluginMcpTools", () => {
  // ─── Mock server that captures registerTool calls ───────────────────────────
  interface RegisteredTool {
    config: unknown;
    handler: (params: Record<string, unknown>, context: Record<string, unknown>) => Promise<unknown>;
  }
  const mockServer: {
    registeredTools: Map<string, RegisteredTool>;
    registerTool(
      name: string,
      config: unknown,
      handler: (params: Record<string, unknown>, context: Record<string, unknown>) => Promise<unknown>,
    ): void;
  } = {
    registeredTools: new Map<string, RegisteredTool>(),
    registerTool(name, config, handler) {
      this.registeredTools.set(name, { config, handler });
    },
  };

  beforeEach(() => {
    mockServer.registeredTools.clear();
    mockResolvePluginHandler.mockReset();
    mockDebugLog.mockReset();
    mockDebugLog.mockImplementation(() => {});
  });

  // ════════════════════════════════════════════════════════════════════════════
  // PLGN-01: Registration — prefix filtering, count, annotations
  // ════════════════════════════════════════════════════════════════════════════

  describe("PLGN-01 — registration", () => {
    it("should return 0 when entries is empty", () => {
      const count = registerPluginMcpTools(
        mockServer as unknown as Parameters<typeof registerPluginMcpTools>[0],
        [],
      );
      expect(count).toBe(0);
      expect(mockServer.registeredTools.size).toBe(0);
    });

    it("should skip entries with wrong prefix and not count them", () => {
      const noopHandler = mkHandler();
      mockResolvePluginHandler.mockResolvedValue(noopHandler);

      const entries: PluginMcpToolEntry[] = [
        {
          pluginShortName: "wordpress",
          toolName: "server_wordpress_scan", // wrong prefix — missing "plugin_"
          tool: { name: "scan", description: "Scan", handler: "./mcp/scan.js" },
          pluginDir: "/fake",
        },
        {
          pluginShortName: "nginx",
          toolName: "server_plugin_nginx_fix", // correct prefix
          tool: { name: "fix", description: "Fix", handler: "./mcp/fix.js" },
          pluginDir: "/fake",
        },
      ];
      const count = registerPluginMcpTools(
        mockServer as unknown as Parameters<typeof registerPluginMcpTools>[0],
        entries,
      );
      expect(count).toBe(1);
      expect(mockServer.registeredTools.has("server_wordpress_scan")).toBe(false);
      expect(mockServer.registeredTools.has("server_plugin_nginx_fix")).toBe(true);
    });

    it("should register with correct annotations", () => {
      const noopHandler = mkHandler();
      mockResolvePluginHandler.mockResolvedValue(noopHandler);

      const entries: PluginMcpToolEntry[] = [
        {
          pluginShortName: "wordpress",
          toolName: "server_plugin_wordpress_audit",
          tool: { name: "audit", description: "Audit WP", handler: "./mcp/audit.js" },
          pluginDir: "/fake",
        },
      ];
      registerPluginMcpTools(
        mockServer as unknown as Parameters<typeof registerPluginMcpTools>[0],
        entries,
      );
      const registered = mockServer.registeredTools.get("server_plugin_wordpress_audit")!;
      const config = registered.config as Record<string, unknown>;
      expect(config.description).toBe("[Plugin: wordpress] Audit WP");
      const annotations = config.annotations as Record<string, unknown>;
      expect(annotations.readOnlyHint).toBe(false);
      expect(annotations.destructiveHint).toBe(false);
      expect(annotations.idempotentHint).toBe(false);
      expect(annotations.openWorldHint).toBe(true);
      expect(annotations.title).toBe("Plugin: wordpress — audit");
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // PLGN-02: Handler context — params, server, logger (info/warn/error), ssh
  // ════════════════════════════════════════════════════════════════════════════

  describe("PLGN-02 — handler context", () => {
    it("should pass params.server to handler and provide logger + ssh context", async () => {
      const pluginHandler = mkHandler();
      mockResolvePluginHandler.mockResolvedValue(pluginHandler);

      const entries: PluginMcpToolEntry[] = [
        {
          pluginShortName: "test",
          toolName: "server_plugin_test_tool",
          tool: { name: "tool", description: "Tool", handler: "./mcp/tool.js" },
          pluginDir: "/fake",
        },
      ];
      registerPluginMcpTools(
        mockServer as unknown as Parameters<typeof registerPluginMcpTools>[0],
        entries,
      );
      const registered = mockServer.registeredTools.get("server_plugin_test_tool")!;

      // Invoke the registered handler directly (simulating MCP server call)
      const params = { server: "my-server" };
      await registered.handler(params, {});

      // PLUGIN-02: handler receives params + context with server, logger, ssh
      expect(pluginHandler).toHaveBeenCalledWith(params, expect.objectContaining({
        server: "my-server",
        logger: expect.objectContaining({
          info: expect.any(Function),
          warn: expect.any(Function),
          error: expect.any(Function),
        }),
        ssh: expect.any(Function),
      }));
    });

    it("should call resolvePluginHandler with correct pluginDir and handler path", async () => {
      const pluginHandler = mkHandler();
      mockResolvePluginHandler.mockResolvedValue(pluginHandler);

      const entries: PluginMcpToolEntry[] = [
        {
          pluginShortName: "wordpress",
          toolName: "server_plugin_wordpress_scan",
          tool: { name: "scan", description: "Scan", handler: "./mcp/scan.js" },
          pluginDir: "/plugins/kastell-plugin-wordpress",
        },
      ];
      registerPluginMcpTools(
        mockServer as unknown as Parameters<typeof registerPluginMcpTools>[0],
        entries,
      );
      const registered = mockServer.registeredTools.get("server_plugin_wordpress_scan")!;

      // Trigger handler
      await registered.handler({ server: "test" }, {});

      expect(mockResolvePluginHandler).toHaveBeenCalledWith(
        "/plugins/kastell-plugin-wordpress",
        "./mcp/scan.js",
      );
    });

    it("should return mcpError when ssh() is called in context", async () => {
      const pluginHandler = mkHandler();
      mockResolvePluginHandler.mockResolvedValue(pluginHandler);

      const entries: PluginMcpToolEntry[] = [
        {
          pluginShortName: "test",
          toolName: "server_plugin_test_ssh",
          tool: { name: "ssh", description: "SSH", handler: "./mcp/ssh.js" },
          pluginDir: "/fake",
        },
      ];
      registerPluginMcpTools(
        mockServer as unknown as Parameters<typeof registerPluginMcpTools>[0],
        entries,
      );
      const registered = mockServer.registeredTools.get("server_plugin_test_ssh")!;

      // Simulate plugin handler calling ssh() which returns mcpError
      pluginHandler.mockImplementation(async () => {
        const { mcpError: mcpErr } = await import("../../../src/mcp/utils.js");
        return mcpErr("SSH not available in MCP context — use server_audit or server_fix for SSH operations");
      });

      const result = await registered.handler({}, {}) as McpResponse;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("SSH not available");
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // PLGN-03: mcpError pass-through — no double-wrap
  // ════════════════════════════════════════════════════════════════════════════

  describe("PLGN-03 — mcpError pass-through (no double-wrap)", () => {
    it("should pass through when handler returns an mcpError response", async () => {
      const rawErrorResponse: McpResponse = {
        content: [{ type: "text", text: '{"error":"original error"}' }],
        isError: true,
      };
      const pluginHandler = mkHandler();
      mockResolvePluginHandler.mockResolvedValue(pluginHandler);

      const entries: PluginMcpToolEntry[] = [
        {
          pluginShortName: "test",
          toolName: "server_plugin_test_error",
          tool: { name: "error", description: "Error", handler: "./mcp/error.js" },
          pluginDir: "/fake",
        },
      ];
      registerPluginMcpTools(
        mockServer as unknown as Parameters<typeof registerPluginMcpTools>[0],
        entries,
      );
      const registered = mockServer.registeredTools.get("server_plugin_test_error")!;

      // Simulate handler returning the raw mcpError directly
      pluginHandler.mockResolvedValueOnce(rawErrorResponse);

      const result = await registered.handler({}, {}) as McpResponse;

      // isMcpResponse guard: typeof object (true), !== null (true),
      // "content" in result (true), Array.isArray(content) (true) → pass-through
      expect(result).toBe(rawErrorResponse);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('{"error":"original error"}');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // PLGN-04: Plain object → mcpSuccess wrap
  // ════════════════════════════════════════════════════════════════════════════

  describe("PLGN-04 — plain object gets wrapped with mcpSuccess", () => {
    it("should wrap plain object result with mcpSuccess", async () => {
      const plainResult = { status: "audited", checks: 5 };
      const pluginHandler = mkHandler();
      mockResolvePluginHandler.mockResolvedValue(pluginHandler);

      const entries: PluginMcpToolEntry[] = [
        {
          pluginShortName: "test",
          toolName: "server_plugin_test_plain",
          tool: { name: "plain", description: "Plain", handler: "./mcp/plain.js" },
          pluginDir: "/fake",
        },
      ];
      registerPluginMcpTools(
        mockServer as unknown as Parameters<typeof registerPluginMcpTools>[0],
        entries,
      );
      const registered = mockServer.registeredTools.get("server_plugin_test_plain")!;

      // Simulate handler returning plain object
      pluginHandler.mockResolvedValueOnce(plainResult);

      const result = await registered.handler({}, {}) as McpResponse;

      // isMcpResponse guard: plain object has no "content" → false → wrap
      // mcpSuccess puts data in structuredContent.result; text has { ...data, _kastell_version }
      expect(result.content[0].type).toBe("text");
      expect(result.structuredContent).toEqual({ result: plainResult });
      expect(result.isError).toBeUndefined();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // isMcpResponse guard branches — 4 conditions
  // ════════════════════════════════════════════════════════════════════════════

  describe("isMcpResponse guard — branch coverage", () => {
    // Branch 1a: typeof result === "string" (not object)
    it("should wrap primitive string result (typeof !== object)", async () => {
      const pluginHandler = mkHandler();
      mockResolvePluginHandler.mockResolvedValue(pluginHandler);

      const entries: PluginMcpToolEntry[] = [
        {
          pluginShortName: "t",
          toolName: "server_plugin_t_str",
          tool: { name: "str", description: "Str", handler: "./mcp/str.js" },
          pluginDir: "/fake",
        },
      ];
      registerPluginMcpTools(
        mockServer as unknown as Parameters<typeof registerPluginMcpTools>[0],
        entries,
      );
      const registered = mockServer.registeredTools.get("server_plugin_t_str")!;

      pluginHandler.mockResolvedValueOnce("just a string");

      const result = await registered.handler({}, {}) as McpResponse;

      // typeof "string" !== "object" → false → mcpSuccess wraps it
      // text = JSON.stringify({ _kastell_version }) since spreading primitive loses it;
      // structuredContent = { result: "just a string" }
      expect(result.content[0].type).toBe("text");
      expect(result.structuredContent).toEqual({ result: "just a string" });
    });

    // Branch 1b: typeof result === "number" (not object)
    it("should wrap primitive number result", async () => {
      const pluginHandler = mkHandler();
      mockResolvePluginHandler.mockResolvedValue(pluginHandler);

      const entries: PluginMcpToolEntry[] = [
        {
          pluginShortName: "t",
          toolName: "server_plugin_t_num",
          tool: { name: "num", description: "Num", handler: "./mcp/num.js" },
          pluginDir: "/fake",
        },
      ];
      registerPluginMcpTools(
        mockServer as unknown as Parameters<typeof registerPluginMcpTools>[0],
        entries,
      );
      const registered = mockServer.registeredTools.get("server_plugin_t_num")!;

      pluginHandler.mockResolvedValueOnce(42);

      const result = await registered.handler({}, {}) as McpResponse;

      expect(result.structuredContent).toEqual({ result: 42 });
    });

    // Branch 2: result === null (typeof null === "object" but null !== null)
    it("should wrap null result", async () => {
      const pluginHandler = mkHandler();
      mockResolvePluginHandler.mockResolvedValue(pluginHandler);

      const entries: PluginMcpToolEntry[] = [
        {
          pluginShortName: "t",
          toolName: "server_plugin_t_null",
          tool: { name: "null", description: "Null", handler: "./mcp/null.js" },
          pluginDir: "/fake",
        },
      ];
      registerPluginMcpTools(
        mockServer as unknown as Parameters<typeof registerPluginMcpTools>[0],
        entries,
      );
      const registered = mockServer.registeredTools.get("server_plugin_t_null")!;

      pluginHandler.mockResolvedValueOnce(null);

      const result = await registered.handler({}, {}) as McpResponse;

      // result === null → typeof null === "object" (true) but null !== null (false) → wrap
      expect(result.structuredContent).toEqual({ result: null });
    });

    // Branch 3: "content" not in result (object without content property)
    it("should wrap object without content property", async () => {
      const pluginHandler = mkHandler();
      mockResolvePluginHandler.mockResolvedValue(pluginHandler);

      const entries: PluginMcpToolEntry[] = [
        {
          pluginShortName: "t",
          toolName: "server_plugin_t_nocontent",
          tool: { name: "nocontent", description: "NoContent", handler: "./mcp/nocontent.js" },
          pluginDir: "/fake",
        },
      ];
      registerPluginMcpTools(
        mockServer as unknown as Parameters<typeof registerPluginMcpTools>[0],
        entries,
      );
      const registered = mockServer.registeredTools.get("server_plugin_t_nocontent")!;

      pluginHandler.mockResolvedValueOnce({ status: 200 });

      const result = await registered.handler({}, {}) as McpResponse;

      expect(result.content[0].type).toBe("text");
      expect(result.structuredContent).toEqual({ result: { status: 200 } });
    });

    // Branch 4: "content" in result but not Array (typeof object, not null, has content, not array)
    it("should wrap when result.content is an object (not array)", async () => {
      const objWithWrongContent: McpResponse = {
        content: { text: "not an array" } as unknown as McpResponse["content"],
      };
      const pluginHandler = mkHandler();
      mockResolvePluginHandler.mockResolvedValue(pluginHandler);

      const entries: PluginMcpToolEntry[] = [
        {
          pluginShortName: "t",
          toolName: "server_plugin_t_badcontent",
          tool: { name: "badcontent", description: "BadContent", handler: "./mcp/badcontent.js" },
          pluginDir: "/fake",
        },
      ];
      registerPluginMcpTools(
        mockServer as unknown as Parameters<typeof registerPluginMcpTools>[0],
        entries,
      );
      const registered = mockServer.registeredTools.get("server_plugin_t_badcontent")!;

      pluginHandler.mockResolvedValueOnce(objWithWrongContent);

      const result = await registered.handler({}, {}) as McpResponse;

      // typeof object (true), !== null (true), "content" in result (true),
      // Array.isArray(content) (false) → wrap
      expect(result.content[0].type).toBe("text");
      // mcpSuccess wraps the whole objectWithWrongContent into structuredContent.result
      expect(result.structuredContent).toEqual({ result: objWithWrongContent });
    });

    // All 4 guard conditions true → pass-through
    it("should pass through when all 4 isMcpResponse conditions are true", async () => {
      const properMcpResponse: McpResponse = {
        content: [{ type: "text", text: '{"result":"proper"}' }],
        structuredContent: { result: "proper" },
        isError: false,
      };
      const pluginHandler = mkHandler();
      mockResolvePluginHandler.mockResolvedValue(pluginHandler);

      const entries: PluginMcpToolEntry[] = [
        {
          pluginShortName: "t",
          toolName: "server_plugin_t_proper",
          tool: { name: "proper", description: "Proper", handler: "./mcp/proper.js" },
          pluginDir: "/fake",
        },
      ];
      registerPluginMcpTools(
        mockServer as unknown as Parameters<typeof registerPluginMcpTools>[0],
        entries,
      );
      const registered = mockServer.registeredTools.get("server_plugin_t_proper")!;

      pluginHandler.mockResolvedValueOnce(properMcpResponse);

      const result = await registered.handler({}, {}) as McpResponse;

      expect(result).toBe(properMcpResponse);
      expect(result.structuredContent).toEqual({ result: "proper" });
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Catch path — handler throws
  // ════════════════════════════════════════════════════════════════════════════

  describe("catch path — handler throws", () => {
    it("should return mcpError when handler throws an Error", async () => {
      const pluginHandler = mkHandler();
      mockResolvePluginHandler.mockResolvedValue(pluginHandler);

      const entries: PluginMcpToolEntry[] = [
        {
          pluginShortName: "test",
          toolName: "server_plugin_test_throw",
          tool: { name: "throw", description: "Throw", handler: "./mcp/throw.js" },
          pluginDir: "/fake",
        },
      ];
      registerPluginMcpTools(
        mockServer as unknown as Parameters<typeof registerPluginMcpTools>[0],
        entries,
      );
      const registered = mockServer.registeredTools.get("server_plugin_test_throw")!;

      // Simulate handler throwing
      pluginHandler.mockRejectedValueOnce(new Error("something went wrong"));

      const result = await registered.handler({}, {}) as McpResponse;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Plugin tool error");
      expect(result.content[0].text).toContain("something went wrong");
    });

    it("should return mcpError with string error when handler throws non-Error", async () => {
      const pluginHandler = mkHandler();
      mockResolvePluginHandler.mockResolvedValue(pluginHandler);

      const entries: PluginMcpToolEntry[] = [
        {
          pluginShortName: "test",
          toolName: "server_plugin_test_strerr",
          tool: { name: "strerr", description: "StrErr", handler: "./mcp/strerr.js" },
          pluginDir: "/fake",
        },
      ];
      registerPluginMcpTools(
        mockServer as unknown as Parameters<typeof registerPluginMcpTools>[0],
        entries,
      );
      const registered = mockServer.registeredTools.get("server_plugin_test_strerr")!;

      pluginHandler.mockRejectedValueOnce("string error");

      const result = await registered.handler({}, {}) as McpResponse;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("string error");
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // CORE_TOOL_PREFIX constant
  // ════════════════════════════════════════════════════════════════════════════

  describe("CORE_TOOL_PREFIX", () => {
    it("should equal server_plugin_", () => {
      expect(CORE_TOOL_PREFIX).toBe("server_plugin_");
    });
  });
});
