import { z } from "zod";
import { getServers } from "../../utils/config.js";
import { getProviderToken } from "../../core/tokens.js";
import { isSafeMode } from "../../core/manage.js";
import { logSafeModeBlock } from "../../utils/safeMode.js";
import {
  rebootAndWait,
  maintainServer,
} from "../../core/maintain.js";
import { updateServer } from "../../core/update.js";
import { resolvePlatform } from "../../adapters/factory.js";
import { requireManagedMode } from "../../utils/modeGuard.js";
import {
  resolveServerForMcp,
  mcpSuccess,
  mcpError,
  type McpResponse,
} from "../utils.js";
import { getErrorMessage, sanitizeStderr } from "../../utils/errorMapper.js";

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

// ─── Output Schema ────────────────────────────────────────────────────────────

const serverMaintainUpdateOutputSchema = z.object({
  success: z.boolean(),
  server: z.string(),
  ip: z.string(),
  message: z.string(),
  suggested_actions: z.array(z.object({ command: z.string(), reason: z.string() })),
});

const serverMaintainRestartOutputSchema = z.object({
  success: z.boolean(),
  server: z.string(),
  ip: z.string(),
  message: z.string(),
  finalStatus: z.string(),
  suggested_actions: z.array(z.object({ command: z.string(), reason: z.string() })),
});

const serverMaintainMaintainOutputSchema = z.object({
  success: z.boolean(),
  server: z.string(),
  ip: z.string(),
  provider: z.string(),
  steps: z.array(z.object({
    step: z.string(),
    status: z.string(),
    message: z.string().optional(),
    error: z.string().optional(),
  })),
  summary: z.object({
    total: z.number(),
    success: z.number(),
    failure: z.number(),
    skipped: z.number(),
  }),
  suggested_actions: z.array(z.object({ command: z.string(), reason: z.string() })),
});

export const serverMaintainOutputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update") }).merge(serverMaintainUpdateOutputSchema),
  z.object({ action: z.literal("restart") }).merge(serverMaintainRestartOutputSchema),
  z.object({ action: z.literal("maintain") }).merge(serverMaintainMaintainOutputSchema),
]);

export type ServerMaintainOutput = z.infer<typeof serverMaintainOutputSchema>;

// ─── Handler ──────────────────────────────────────────────────────────────────

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
        // Guard: update requires managed platform (Coolify/Dokploy)
        const modeError = requireManagedMode(server, "update");
        if (modeError) {
          return mcpError(modeError, "Use SSH to manage bare servers directly");
        }

        // SAFE_MODE guard
        if (isSafeMode()) {
          logSafeModeBlock("maintain-update", { category: "destructive" });
          return mcpError(
            "Update is disabled in SAFE_MODE",
            "Set KASTELL_SAFE_MODE=false to enable platform updates",
            [{ command: `server_info { action: 'health', server: '${server.name}' }`, reason: "Check server health status" }],
          );
        }

        const platform = resolvePlatform(server);
        if (!platform) {
          return mcpError("No platform adapter available for this server");
        }

        // Use core updateServer which validates via provider API before updating
        const apiToken = server.id.startsWith("manual-") ? "" : (getProviderToken(server.provider) ?? "");
        const result = await updateServer(server, apiToken, platform);

        if (!result.success) {
          return mcpError(result.error ?? "Update failed", `Server: ${server.name} (${server.ip}). ${result.hint ?? ""}`, [
            { command: `server_info { action: 'health', server: '${server.name}' }`, reason: "Check if server is reachable" },
          ]);
        }

        const displayName = result.displayName ?? "Platform";
        return mcpSuccess({
          success: true,
          server: server.name,
          ip: server.ip,
          message: `${displayName} update completed successfully`,
          suggested_actions: [
            { command: `server_info { action: 'health', server: '${server.name}' }`, reason: "Verify platform is running after update" },
            { command: `server_logs { action: 'logs', server: '${server.name}' }`, reason: "Check logs after update" },
          ],
        });
      }

      case "restart": {
        if (isSafeMode()) {
          logSafeModeBlock("maintain-restart", { category: "destructive" });
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
          return mcpError(result.error ?? "Restart failed", `Server: ${server.name} (${server.ip}). ${result.hint ?? ""}`, [
            { command: `server_info { action: 'status', server: '${server.name}' }`, reason: "Check current server status" },
          ]);
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

        const hasFailure = result.steps.some((s) => s.status === "failure");

        const suggestedActions: { command: string; reason: string }[] = [];

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

        const payload = {
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
        };

        // Partial success: mcpSuccess can't express isError=true, use inline response
        if (hasFailure) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify(payload) }],
            structuredContent: payload,
            isError: true,
          };
        }

        return mcpSuccess(payload);
      }
      default: {
        return mcpError(`Unknown action: ${params.action as string}`);
      }
    }
  } catch (error: unknown) {
    return mcpError(sanitizeStderr(getErrorMessage(error)));
  }
}
