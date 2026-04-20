import { z } from "zod";
import { getServers } from "../../utils/config.js";
import { applyLock } from "../../core/lock.js";
import {
  resolveServerForMcp,
  mcpSuccess,
  mcpError,
  mcpLog,
  type McpResponse,
} from "../utils.js";
import { getErrorMessage, sanitizeStderr } from "../../utils/errorMapper.js";
import { isSafeMode } from "../../core/manage.js";
import { logSafeModeBlock } from "../../utils/safeMode.js";
import type { Platform } from "../../types/index.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const serverLockSchema = {
  server: z.string().optional().describe("Server name or IP. Auto-selected if only one server exists."),
  production: z.boolean().default(false).describe("Set to true to confirm hardening intent. Required to apply 19 hardening steps (safety gate). Omit or pass false to preview with dryRun=true."),
  dryRun: z.boolean().default(false).describe("Preview changes without applying. Returns what would be done. Bypasses the production safety gate."),
  force: z.boolean().default(false).describe("Force lock even if server already appears hardened."),
};

export async function handleServerLock(params: {
  server?: string;
  production?: boolean;
  dryRun?: boolean;
  force?: boolean;
}, mcpServer?: McpServer): Promise<McpResponse> {
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

    const production = params.production ?? false;
    const dryRun = params.dryRun ?? false;
    const force = params.force ?? false;

    // SAFE_MODE guard: block actual hardening, allow preview
    if (production && !dryRun && isSafeMode()) {
      logSafeModeBlock("lock-production", { category: "destructive" });
      return mcpError(
        "Server hardening is disabled in SAFE_MODE",
        "Set KASTELL_SAFE_MODE=false to enable production hardening. Use dryRun=true to preview changes safely.",
      );
    }

    // Safety gate: require explicit production=true unless doing a dry run
    if (!production && !dryRun) {
      return mcpError(
        "Pass production=true to confirm hardening intent. This applies 19 hardening steps in 4 groups: SSH & Auth (SSH config, fail2ban, login banners, account locking, SSH cipher blacklist), Firewall & Network (UFW, cloud metadata block, DNS security), System (sysctl, unattended-upgrades, APT validation, resource limits, service disabling, backup permissions, password quality, Docker hardening), Monitoring (auditd, log retention, AIDE integrity).",
        "Use dryRun=true to preview changes without applying.",
      );
    }

    // Resolve platform from server record (same pattern as serverAudit.ts line 44)
    const platformStr = server.platform ?? server.mode;
    const platform: Platform | undefined =
      platformStr === "coolify" || platformStr === "dokploy" ? platformStr : undefined;

    await mcpLog(mcpServer, `Starting 24-step hardening on ${server.name}`);

    const result = await applyLock(server.ip, server.name, platform, {
      production,
      dryRun,
      force,
    });

    if (!result.success) {
      return mcpError(result.error ?? "Lock hardening failed", result.hint);
    }

    await mcpLog(mcpServer, "Hardening complete");

    return mcpSuccess({
      success: result.success,
      steps: result.steps,
      ...(result.stepErrors && { stepErrors: result.stepErrors }),
      scoreBefore: result.scoreBefore,
      scoreAfter: result.scoreAfter,
    });
  } catch (error: unknown) {
    return mcpError(sanitizeStderr(getErrorMessage(error)));
  }
}
