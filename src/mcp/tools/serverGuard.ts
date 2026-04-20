import { z } from "zod";
import { getServers } from "../../utils/config.js";
import { startGuard, stopGuard, guardStatus } from "../../core/guard.js";
import {
  resolveServerForMcp,
  mcpSuccess,
  mcpError,
  type McpResponse,
} from "../utils.js";
import { getErrorMessage, sanitizeStderr } from "../../utils/errorMapper.js";
import { isSafeMode } from "../../core/manage.js";
import { logSafeModeBlock } from "../../utils/safeMode.js";

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

    // SAFE_MODE guard: block start/stop, allow status
    if (params.action !== "status" && isSafeMode()) {
      logSafeModeBlock("guard-modify", { category: "destructive" });
      return mcpError(
        `Guard ${params.action} is disabled in SAFE_MODE`,
        "Set KASTELL_SAFE_MODE=false to enable guard start/stop. Use action:'status' to check guard state safely.",
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

      default:
        return mcpError(`Invalid action: ${String(params.action)}`, "Valid actions: start, stop, status");
    }
  } catch (error: unknown) {
    return mcpError(sanitizeStderr(getErrorMessage(error)));
  }
}
