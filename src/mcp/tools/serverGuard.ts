import { z } from "zod";
import { getServers } from "../../utils/config.js";
import { startGuard, stopGuard, guardStatus } from "../../core/guard.js";
import {
  resolveServerForMcp,
  mcpSuccess,
  mcpError,
  type McpResponse,
} from "../utils.js";
import { getErrorMessage } from "../../utils/errorMapper.js";

export const serverGuardSchema = {
  server: z.string().optional().describe("Server name or IP. Auto-selected if only one server exists."),
  action: z.enum(["start", "stop", "status"]).describe("Guard action: 'start' installs guard cron, 'stop' removes it, 'status' shows current state and recent breaches."),
};

export async function handleServerGuard(params: {
  server?: string;
  action: "start" | "stop" | "status";
}): Promise<McpResponse> {
  try {
    const servers = getServers();
    if (servers.length === 0) {
      return mcpError("No servers found", undefined, [
        { command: "kastell add", reason: "Add a server first" },
      ]);
    }

    const server = resolveServerForMcp(params, servers);
    if (!server) {
      if (params.server) {
        return mcpError(
          `Server not found: ${params.server}`,
          `Available servers: ${servers.map((s) => s.name).join(", ")}`,
        );
      }
      return mcpError(
        "Multiple servers found. Specify which server to use.",
        `Available: ${servers.map((s) => s.name).join(", ")}`,
      );
    }

    switch (params.action) {
      case "start": {
        const result = await startGuard(server.ip, server.name);
        if (!result.success) {
          return mcpError(result.error ?? "Failed to start guard", result.hint);
        }
        return mcpSuccess({
          success: true,
          message: `Guard installed on ${server.name}. Runs every 5 minutes via cron.`,
        });
      }

      case "stop": {
        const result = await stopGuard(server.ip, server.name);
        if (!result.success) {
          return mcpError(result.error ?? "Failed to stop guard", result.hint);
        }
        return mcpSuccess({
          success: true,
          message: `Guard removed from ${server.name}.`,
        });
      }

      case "status": {
        const result = await guardStatus(server.ip, server.name);
        if (!result.success) {
          return mcpError(result.error ?? "Failed to check guard status");
        }
        return mcpSuccess({
          isActive: result.isActive,
          lastRunAt: result.lastRunAt,
          breaches: result.breaches,
          logTail: result.logTail,
          installedAt: result.installedAt,
        });
      }
    }
  } catch (error: unknown) {
    return mcpError(getErrorMessage(error));
  }
}
