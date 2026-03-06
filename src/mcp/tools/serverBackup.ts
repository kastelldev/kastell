import { z } from "zod";
import { getServers } from "../../utils/config.js";
import { isSafeMode } from "../../core/manage.js";
import {
  createBackup,
  createBareBackup,
  restoreBackup,
  restoreBareBackup,
  listBackups,
  loadManifest,
} from "../../core/backup.js";
import {
  createSnapshot,
  listSnapshots,
  deleteSnapshot,
} from "../../core/snapshot.js";
import { isBareServer } from "../../utils/modeGuard.js";
import { resolvePlatform } from "../../adapters/factory.js";
import {
  resolveServerForMcp,
  mcpSuccess,
  mcpError,
  requireProviderToken,
  type McpResponse,
} from "../utils.js";
import { getErrorMessage } from "../../utils/errorMapper.js";

export const serverBackupSchema = {
  action: z.enum([
    "backup-create", "backup-list", "backup-restore",
    "snapshot-create", "snapshot-list", "snapshot-delete",
  ]).describe(
    "Backup: 'backup-create' dumps Coolify DB+config via SSH (or system config for bare servers), 'backup-list' shows local backups, 'backup-restore' restores (SAFE_MODE blocks). Snapshot: 'snapshot-create'/'snapshot-list'/'snapshot-delete' manage cloud snapshots (requires API token).",
  ),
  server: z.string().optional().describe(
    "Server name or IP. Auto-selected if only one server exists.",
  ),
  backupId: z.string().regex(/^[\w-]+$/, "Invalid backupId: only alphanumeric, hyphens, underscores allowed").optional().describe(
    "Backup timestamp folder name (required for backup-restore).",
  ),
  snapshotId: z.string().optional().describe(
    "Cloud snapshot ID (required for snapshot-delete).",
  ),
};

type Action = z.infer<typeof serverBackupSchema.action>;

export async function handleServerBackup(params: {
  action: Action;
  server?: string;
  backupId?: string;
  snapshotId?: string;
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
      // ─── Backup Actions ──────────────────────────────────────────────

      case "backup-create": {
        const bare = isBareServer(server);
        const platform = resolvePlatform(server);
        const result = bare
          ? await createBareBackup(server.ip, server.name, server.provider)
          : await createBackup(server.ip, server.name, server.provider, platform || "coolify");

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
          backupPath: result.backupPath,
          manifest: result.manifest,
          suggested_actions: [
            { command: `server_backup { action: 'backup-list', server: '${server.name}' }`, reason: "View all backups" },
            { command: `server_secure { action: 'secure-audit', server: '${server.name}' }`, reason: "Run security audit" },
          ],
        });
      }

      case "backup-list": {
        const backupIds = listBackups(server.name);

        if (backupIds.length === 0) {
          return mcpSuccess({
            server: server.name,
            backups: [],
            message: "No backups found for this server",
            suggested_actions: [
              { command: `server_backup { action: 'backup-create', server: '${server.name}' }`, reason: "Create a backup" },
            ],
          });
        }

        const { getBackupDir } = await import("../../core/backup.js");
        const { join } = await import("path");
        const backups = backupIds.map((id) => {
          const manifest = loadManifest(join(getBackupDir(server.name), id));
          if (manifest) {
            return {
              backupId: id,
              timestamp: manifest.timestamp,
              coolifyVersion: manifest.coolifyVersion,
              files: manifest.files,
            };
          }
          return { backupId: id, status: "corrupt/unreadable" };
        });

        return mcpSuccess({
          server: server.name,
          backupCount: backupIds.length,
          backups,
          suggested_actions: [
            { command: `server_backup { action: 'backup-restore', server: '${server.name}', backupId: '${backupIds[0]}' }`, reason: "Restore latest backup" },
          ],
        });
      }

      case "backup-restore": {
        if (isSafeMode()) {
          return mcpError(
            "Restore disabled in SAFE_MODE",
            "Set KASTELL_SAFE_MODE=false to enable restore operations",
          );
        }

        if (!params.backupId) {
          return mcpError(
            "backupId is required for backup-restore",
            "Use backup-list to see available backups",
            [{ command: `server_backup { action: 'backup-list', server: '${server.name}' }`, reason: "List available backups" }],
          );
        }

        const bare = isBareServer(server);
        const result = bare
          ? await restoreBareBackup(server.ip, server.name, params.backupId)
          : await restoreBackup(server.ip, server.name, params.backupId);

        if (!result.success) {
          return {
            content: [{ type: "text", text: JSON.stringify({
              server: server.name,
              ip: server.ip,
              backupId: params.backupId,
              error: result.error,
              steps: result.steps,
              ...(result.hint ? { hint: result.hint } : {}),
            }) }],
            isError: true,
          };
        }

        const successPayload: Record<string, unknown> = {
          success: true,
          server: server.name,
          ip: server.ip,
          backupId: params.backupId,
          steps: result.steps,
          suggested_actions: [
            {
              command: `server_info { action: 'health', server: '${server.name}' }`,
              reason: bare ? "Verify SSH access after restore" : "Verify Coolify is running",
            },
          ],
        };

        if (bare) {
          successPayload.hint = "Config restored. You may need to restart services (e.g., nginx, fail2ban) for changes to take effect.";
        }

        return mcpSuccess(successPayload);
      }

      // ─── Snapshot Actions ────────────────────────────────────────────

      case "snapshot-create": {
        if (isSafeMode()) {
          return mcpError(
            "Snapshot creation is disabled in SAFE_MODE",
            "Set KASTELL_SAFE_MODE=false to enable snapshot creation (billable operation)",
            [{ command: `server_backup { action: 'backup-create', server: '${server.name}' }`, reason: "Use SSH-based backup instead (free)" }],
          );
        }

        const isManual = server.id.startsWith("manual-");
        if (isManual) {
          return mcpError(
            "Snapshots require cloud provider API. Manual servers don't have provider IDs.",
            "Use backup-create for SSH-based backup instead.",
            [{ command: `server_backup { action: 'backup-create', server: '${server.name}' }`, reason: "SSH-based backup" }],
          );
        }

        const tokenResult = requireProviderToken(server.provider);
        if ("error" in tokenResult) return tokenResult.error;

        const result = await createSnapshot(server, tokenResult.token);

        if (!result.success) {
          return {
            content: [{ type: "text", text: JSON.stringify({
              server: server.name,
              ip: server.ip,
              error: result.error,
              ...(result.hint ? { hint: result.hint } : {}),
            }) }],
            isError: true,
          };
        }

        return mcpSuccess({
          success: true,
          server: server.name,
          ip: server.ip,
          snapshot: result.snapshot,
          costEstimate: result.costEstimate,
          suggested_actions: [
            { command: `server_backup { action: 'snapshot-list', server: '${server.name}' }`, reason: "View all snapshots" },
          ],
        });
      }

      case "snapshot-list": {
        const isManual = server.id.startsWith("manual-");
        if (isManual) {
          return mcpError(
            "Snapshots require cloud provider API. Manual servers don't have provider IDs.",
            "Use backup-list for local backups instead.",
            [{ command: `server_backup { action: 'backup-list', server: '${server.name}' }`, reason: "List local backups" }],
          );
        }

        const tokenResult = requireProviderToken(server.provider);
        if ("error" in tokenResult) return tokenResult.error;

        const result = await listSnapshots(server, tokenResult.token);

        if (result.error) {
          return {
            content: [{ type: "text", text: JSON.stringify({
              server: server.name,
              ip: server.ip,
              error: result.error,
              ...(result.hint ? { hint: result.hint } : {}),
            }) }],
            isError: true,
          };
        }

        if (result.snapshots.length === 0) {
          return mcpSuccess({
            server: server.name,
            snapshots: [],
            message: "No snapshots found",
            suggested_actions: [
              { command: `server_backup { action: 'snapshot-create', server: '${server.name}' }`, reason: "Create a snapshot" },
            ],
          });
        }

        return mcpSuccess({
          server: server.name,
          ip: server.ip,
          snapshotCount: result.snapshots.length,
          snapshots: result.snapshots,
          suggested_actions: [
            { command: `server_backup { action: 'snapshot-delete', server: '${server.name}', snapshotId: '${result.snapshots[0].id}' }`, reason: "Delete a snapshot" },
          ],
        });
      }

      case "snapshot-delete": {
        if (isSafeMode()) {
          return mcpError(
            "Snapshot delete disabled in SAFE_MODE",
            "Set KASTELL_SAFE_MODE=false to enable snapshot deletion",
          );
        }

        const isManual = server.id.startsWith("manual-");
        if (isManual) {
          return mcpError(
            "Snapshots require cloud provider API. Manual servers don't have provider IDs.",
            "Manual servers cannot manage cloud snapshots.",
          );
        }

        const tokenResult = requireProviderToken(server.provider);
        if ("error" in tokenResult) return tokenResult.error;

        if (!params.snapshotId) {
          return mcpError(
            "snapshotId is required for snapshot-delete",
            "Use snapshot-list to see available snapshots",
            [{ command: `server_backup { action: 'snapshot-list', server: '${server.name}' }`, reason: "List snapshots" }],
          );
        }

        const result = await deleteSnapshot(server, tokenResult.token, params.snapshotId);

        if (!result.success) {
          return {
            content: [{ type: "text", text: JSON.stringify({
              server: server.name,
              ip: server.ip,
              snapshotId: params.snapshotId,
              error: result.error,
              ...(result.hint ? { hint: result.hint } : {}),
            }) }],
            isError: true,
          };
        }

        return mcpSuccess({
          success: true,
          server: server.name,
          ip: server.ip,
          snapshotId: params.snapshotId,
          message: "Snapshot deleted",
          suggested_actions: [
            { command: `server_backup { action: 'snapshot-list', server: '${server.name}' }`, reason: "View remaining snapshots" },
          ],
        });
      }
    }
  } catch (error: unknown) {
    return mcpError(getErrorMessage(error));
  }
}

