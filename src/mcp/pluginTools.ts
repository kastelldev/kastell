import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PluginMcpToolEntry } from "../plugin/registry.js";
import { debugLog } from "../utils/logger.js";
import { mcpSuccess, mcpError } from "./utils.js";
import type { McpResponse } from "./utils.js";
import { resolvePluginHandler } from "../plugin/handlerResolver.js";
import { PLUGIN_TOOL_PREFIX } from "../plugin/sdk/constants.js";

export const CORE_TOOL_PREFIX = PLUGIN_TOOL_PREFIX;

const defaultSchema = z.object({
  server: z.string().optional().describe("Server name or IP"),
});

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
    }, async (params): Promise<McpResponse> => {
      try {
        const handler = await resolvePluginHandler(entry.pluginDir, entry.tool.handler);
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
        const isMcpResponse = (
          typeof result === "object" &&
          result !== null &&
          "content" in result &&
          Array.isArray((result as Record<string, unknown>).content)
        );
        return (isMcpResponse ? result : mcpSuccess(result as Record<string, unknown>)) as McpResponse;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return mcpError(`Plugin tool error: ${msg}`);
      }
    });
    count++;
  }

  return count;
}
