import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolve } from "path";
import { pathToFileURL } from "url";
import type { PluginMcpToolEntry } from "../plugin/registry.js";
import { debugLog } from "../utils/logger.js";
import { mcpSuccess, mcpError } from "./utils.js";

export const CORE_TOOL_PREFIX = "server_plugin_";

interface PluginModuleExport {
  default?: Record<string, unknown> | ((...args: unknown[]) => unknown);
  handler?: (...args: unknown[]) => unknown;
  run?: (...args: unknown[]) => unknown;
}

export function registerPluginMcpTools(
  server: McpServer,
  entries: PluginMcpToolEntry[],
): number {
  if (entries.length === 0) return 0;

  let count = 0;
  for (const entry of entries) {
    if (!entry.toolName.startsWith(CORE_TOOL_PREFIX)) {
      debugLog?.(`plugin tool "${entry.toolName}" does not start with "${CORE_TOOL_PREFIX}", skipping`);
      continue;
    }

    // Default inputSchema — plugin module may override via export
    const defaultSchema = z.object({
      server: z.string().optional().describe("Server name or IP"),
    });

    server.registerTool(entry.toolName, {
      description: `[Plugin: ${entry.pluginShortName}] ${entry.tool.description}`,
      inputSchema: defaultSchema,
      annotations: {
        title: `Plugin: ${entry.pluginShortName} — ${entry.tool.name}`,
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    }, async (params) => {
      try {
        const handlerPath = resolve(entry.pluginDir, entry.tool.handler);
        const handlerUrl = pathToFileURL(handlerPath).href;
        const mod = (await import(handlerUrl)) as PluginModuleExport;
        const handler = (typeof mod.default === "function" ? mod.default : mod.default?.handler) ?? mod.handler ?? mod.run;
        if (typeof handler !== "function") {
          return mcpError(`Plugin tool handler not found: ${entry.tool.handler}`);
        }
        // PluginContext with ssh — spec PLG-CAP-02 requirement
        const result = await handler(params, {
          server: (params as Record<string, unknown>).server as string | undefined,
          logger: {
            info: (msg: string) => debugLog?.(msg),
            warn: (msg: string) => debugLog?.(msg),
            error: (msg: string) => debugLog?.(msg),
          },
          ssh: async () => {
            return mcpError("SSH not available in MCP context — use server_audit or server_fix for SSH operations");
          },
        });
        return mcpSuccess(result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return mcpError(`Plugin tool error: ${msg}`);
      }
    });
    count++;
  }

  return count;
}