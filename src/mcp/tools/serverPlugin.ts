import { z } from "zod";
import { listPlugins, validatePlugins } from "../../core/plugin.js";
import { mcpSuccess, mcpError } from "../utils.js";

export const serverPluginSchema = z.object({
  action: z.enum(["list", "validate"]).describe("Action: 'list' shows installed plugins, 'validate' checks manifest integrity. Install/remove not available via MCP — use CLI for security (requires explicit user consent)."),
  name: z.string().optional().describe("Plugin name for validate action (validates all if omitted)"),
});

type ServerPluginParams = z.infer<typeof serverPluginSchema>;

export const serverPluginOutputSchema = z.object({
  result: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("list"),
      plugins: z.array(z.object({
        name: z.string(),
        version: z.string().optional(),
        status: z.string(),
        checks: z.number().optional(),
        commandCount: z.number().optional(),
        mcpToolCount: z.number().optional(),
      })),
      count: z.number(),
    }),
    z.object({
      action: z.literal("validate"),
      results: z.array(z.object({
        name: z.string(),
        valid: z.boolean(),
        errors: z.array(z.string()).optional(),
      })),
    }),
  ]),
});


export async function handleServerPlugin(params: ServerPluginParams) {
  if (params.action === "list") {
    const plugins = listPlugins();
    return mcpSuccess({
      action: "list" as const,
      plugins: plugins.map((p) => ({
        name: p.name,
        version: p.version,
        status: p.status,
        checks: p.checks,
        commandCount: p.commands?.length ?? 0,
        mcpToolCount: p.mcpTools?.length ?? 0,
      })),
      count: plugins.length,
    });
  }

  if (params.action === "validate") {
    const results = validatePlugins(params.name);
    return mcpSuccess({
      action: "validate" as const,
      results,
    });
  }

  return mcpError(`Unexpected action: ${params.action}`);
}
