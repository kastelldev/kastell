import { z } from "zod";
import { getServers } from "../../utils/config.js";
import { getProviderToken } from "../../core/tokens.js";
import { isSafeMode } from "../../core/manage.js";
import {
  rebootAndWait,
  maintainServer,
} from "../../core/maintain.js";
import { getAdapter, resolvePlatform } from "../../adapters/factory.js";
import { requireManagedMode } from "../../utils/modeGuard.js";
import {
  resolveServerForMcp,
  mcpSuccess,
  mcpError,
  type McpResponse,
} from "../utils.js";
import { getErrorMessage } from "../../utils/errorMapper.js";

export const serverMaintainSchema = {
  action: z.enum(["update", "restart", "maintain"]).describe(
    "Action: 'update' runs platform update via SSH (managed servers — Coolify or Dokploy), 'restart' reboots server via cloud provider API (both modes), 'maintain' runs full 5-step maintenance (status → update → health → reboot → final, managed servers only)",
  ),
  server: z.string().optional().describe(
    "Server name or IP. Auto-selected if only one server exists.",
  ),
  skipReboot: z.boolean().default(false).describe(
    "Skip reboot and final check steps (only for 'maintain' action). Useful during business hours.",
  ),
};

export async function handleServerMaintain(params: {
  action: "update" | "restart" | "maintain";
  server?: string;
  skipReboot?: boolean;
}): Promise<McpResponse> {
  try {
    const servers = getServers();
    if (servers.length === 0) {
      return mcpError("No servers found", undefined, [
        { command: "kastell init", reason: "Deploy a server first" },
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
      case "update": {
        // Guard: update requires Coolify
        const modeError = requireManagedMode(server, "update");
        if (modeError) {
          return mcpError(modeError, "Use SSH to manage bare servers directly");
        }

        const platform = resolvePlatform(server);
        const adapter = platform ? getAdapter(platform) : null;
        if (!adapter) {
          return mcpError("No platform adapter available for this server");
        }
        const result = await adapter.update(server.ip);

        if (!result.success) {
          return {
            content: [{ type: "text", text: JSON.stringify({
              server: server.name,
              ip: server.ip,
              error: result.error,
              ...(result.hint ? { hint: result.hint } : {}),
              suggested_actions: [
                { command: `server_info { action: 'health', server: '${server.name}' }`, reason: "Check if server is reachable" },
              ],
            }) }],
            isError: true,
          };
        }

        return mcpSuccess({
          success: true,
          server: server.name,
          ip: server.ip,
          message: `${adapter.name.charAt(0).toUpperCase() + adapter.name.slice(1)} update completed successfully`,
          suggested_actions: [
            { command: `server_info { action: 'health', server: '${server.name}' }`, reason: "Verify platform is running after update" },
            { command: `server_logs { action: 'logs', server: '${server.name}' }`, reason: "Check logs after update" },
          ],
        });
      }

      case "restart": {
        if (isSafeMode()) {
          return mcpError(
            "Restart is disabled in SAFE_MODE",
            "Set KASTELL_SAFE_MODE=false to enable server reboot",
            [{ command: `server_maintain { action: 'update', server: '${server.name}' }`, reason: "Run platform update instead (non-destructive)" }],
          );
        }

        // Restart requires API token for cloud provider — no mode guard (works on both)
        const isManual = server.id.startsWith("manual-");
        if (isManual) {
          return mcpError(
            "Cannot reboot manually added server via API",
            `Use SSH: ssh root@${server.ip} reboot`,
          );
        }

        const token = getProviderToken(server.provider);
        if (!token) {
          return mcpError(
            `No API token found for provider: ${server.provider}`,
            `Set environment variable: ${server.provider.toUpperCase()}_TOKEN`,
          );
        }

        const result = await rebootAndWait(server, token);

        if (!result.success) {
          return {
            content: [{ type: "text", text: JSON.stringify({
              server: server.name,
              ip: server.ip,
              error: result.error,
              ...(result.hint ? { hint: result.hint } : {}),
              suggested_actions: [
                { command: `server_info { action: 'status', server: '${server.name}' }`, reason: "Check current server status" },
              ],
            }) }],
            isError: true,
          };
        }

        return mcpSuccess({
          success: true,
          server: server.name,
          ip: server.ip,
          message: "Server restarted successfully",
          finalStatus: result.finalStatus,
          suggested_actions: [
            { command: `server_info { action: 'health', server: '${server.name}' }`, reason: "Verify platform is accessible" },
            { command: `server_logs { action: 'logs', server: '${server.name}' }`, reason: "Check logs after restart" },
          ],
        });
      }

      case "maintain": {
        // Guard: maintain requires Coolify
        const modeError = requireManagedMode(server, "maintain");
        if (modeError) {
          return mcpError(modeError, "Use SSH to manage bare servers directly");
        }

        if (isSafeMode()) {
          return mcpError(
            "Maintenance is disabled in SAFE_MODE",
            "Set KASTELL_SAFE_MODE=false to enable full maintenance (includes reboot)",
            [{ command: `server_maintain { action: 'update', server: '${server.name}' }`, reason: "Run platform update only (no token needed)" }],
          );
        }

        // Maintain requires API token for non-manual servers
        const isManual = server.id.startsWith("manual-");
        let token = "";

        if (!isManual) {
          const envToken = getProviderToken(server.provider);
          if (!envToken) {
            return mcpError(
              `No API token found for provider: ${server.provider}`,
              `Set environment variable: ${server.provider.toUpperCase()}_TOKEN`,
              [{ command: `server_maintain { action: 'update', server: '${server.name}' }`, reason: "Run update only (no token needed)" }],
            );
          }
          token = envToken;
        }

        const result = await maintainServer(server, token, {
          skipReboot: params.skipReboot ?? false,
        });

        const suggestedActions = [];
        const hasFailure = result.steps.some((s) => s.status === "failure");

        if (hasFailure) {
          suggestedActions.push(
            { command: `server_info { action: 'health', server: '${server.name}' }`, reason: "Check platform reachability" },
            { command: `server_logs { action: 'logs', server: '${server.name}' }`, reason: "Check logs for errors" },
          );
        } else {
          suggestedActions.push(
            { command: `server_info { action: 'status', server: '${server.name}' }`, reason: "Verify full server status" },
            { command: `server_logs { action: 'logs', server: '${server.name}' }`, reason: "Check platform startup logs" },
          );
        }

        return {
          content: [{ type: "text", text: JSON.stringify({
            success: result.success,
            server: result.server,
            ip: result.ip,
            provider: result.provider,
            steps: result.steps,
            summary: {
              total: result.steps.length,
              success: result.steps.filter((s) => s.status === "success").length,
              failure: result.steps.filter((s) => s.status === "failure").length,
              skipped: result.steps.filter((s) => s.status === "skipped").length,
            },
            suggested_actions: suggestedActions,
          }) }],
          ...(hasFailure ? { isError: true } : {}),
        };
      }
    }
  } catch (error: unknown) {
    return mcpError(getErrorMessage(error));
  }
}
