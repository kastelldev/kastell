import { z } from "zod";
import { getServers } from "../../utils/config.js";
import { runFleet } from "../../core/fleet.js";
import { mcpSuccess, mcpError, type McpResponse } from "../utils.js";
import { getErrorMessage, sanitizeStderr } from "../../utils/errorMapper.js";

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

    return mcpSuccess({ servers: rows.length, rows });
  } catch (error: unknown) {
    return mcpError(sanitizeStderr(getErrorMessage(error)));
  }
}
