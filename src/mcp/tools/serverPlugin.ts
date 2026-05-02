import { z } from "zod";
import { listPlugins, validatePlugins } from "../../core/plugin.js";
import { mcpSuccess, mcpError } from "../utils.js";

export const serverPluginSchema = z.object({
  action: z.enum(["list", "validate"]).describe("Action: 'list' shows installed plugins, 'validate' checks manifest integrity. Install/remove not available via MCP — use CLI for security (requires explicit user consent)."),
  name: z.string().optional().describe("Plugin name for validate action (validates all if omitted)"),
});

type ServerPluginParams = z.infer<typeof serverPluginSchema>;

export async function handleServerPlugin(params: ServerPluginParams) {
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

  return mcpError(`Unexpected action: ${params.action}`);
}
