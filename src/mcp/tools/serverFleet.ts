import { z } from "zod";
import { getServers } from "../../utils/config.js";
import { runFleet } from "../../core/fleet.js";
import { mcpSuccess, mcpError, type McpResponse } from "../utils.js";
import { getErrorMessage, sanitizeStderr } from "../../utils/errorMapper.js";
import type { FleetRow } from "../../types/index.js";

export const serverFleetSchema = {
  sort: z
    .enum(["score", "name", "provider"])
    .optional()
    .default("name")
    .describe("Sort field: score (descending), name (A-Z), provider (A-Z). Default: name."),
  categories: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include weakest audit category per server. Default: false."),
};

export const serverFleetOutputSchema = z.object({
  result: z.object({
    servers: z.array(z.object({
      name: z.string(),
      ip: z.string(),
      provider: z.string(),
      status: z.enum(["ONLINE", "DEGRADED", "OFFLINE"]),
      auditScore: z.number().nullable(),
      responseTime: z.number().nullable(),
      weakestCategory: z.string().optional(),
      weakestCategoryScore: z.number().optional(),
    })),
    total: z.number(),
    suggested_actions: z.array(z.object({
      command: z.string(),
      reason: z.string(),
    })).optional(),
  }),
});

type ServerFleetOutput = z.infer<typeof serverFleetOutputSchema>;

export async function handleServerFleet(params: {
  sort?: "score" | "name" | "provider";
  categories?: boolean;
}): Promise<McpResponse> {
  try {
    const servers = getServers();
    if (servers.length === 0) {
      return mcpError("No servers found", undefined, [
        { command: "kastell add", reason: "Add a server first" },
      ]);
    }

    const rows = await runFleet({
      json: true,
      sort: params.sort ?? "name",
      categories: params.categories,
    });

    const data = {
      servers: rows as FleetRow[],
      total: rows.length,
    };
    return mcpSuccess(data);
  } catch (error: unknown) {
    return mcpError(sanitizeStderr(getErrorMessage(error)));
  }
}
