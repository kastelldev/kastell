import { z } from "zod";
import { listPlugins, validatePlugins } from "../../core/plugin.js";
import { mcpSuccess, mcpError } from "../utils.js";

export const serverPluginSchema = z.object({
  action: z.enum(["list", "validate", "install", "remove"]).describe("Action: 'list' shows installed plugins, 'validate' checks manifest integrity. 'install'/'remove' are CLI-only (rejected here)."),
  name: z.string().optional().describe("Plugin name for validate action (validates all if omitted)"),
});

type ServerPluginParams = z.infer<typeof serverPluginSchema>;

export async function handleServerPlugin(params: ServerPluginParams) {
  const BLOCKED_MCP_ACTIONS = new Set(["install", "remove"]);
  if (BLOCKED_MCP_ACTIONS.has(params.action)) {
    return mcpError(
      `Action '${params.action}' is not available via MCP. Use the CLI: kastell plugin ${params.action} <name>`,
      "Plugin install/remove requires explicit user consent and is restricted to CLI usage.",
    );
  }

  if (params.action === "list") {
    const plugins = listPlugins();
    return mcpSuccess({
      plugins,
      count: plugins.length,
    });
  }

  if (params.action === "validate") {
    const results = validatePlugins(params.name);
    return mcpSuccess({ results });
  }

  // TypeScript exhaustiveness: Zod enum guarantees all cases handled above
  return mcpError(`Unexpected action: ${params.action}`);
}