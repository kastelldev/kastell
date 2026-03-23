import { z } from "zod";
import { getServers } from "../../utils/config.js";
import {
  resolveServerForMcp,
  mcpError,
  type McpResponse,
} from "../utils.js";
import { getErrorMessage } from "../../utils/errorMapper.js";
import {
  handleBackupCreate,
  handleBackupList,
  handleBackupRestore,
  handleSnapshotCreate,
  handleSnapshotList,
  handleSnapshotDelete,
  handleSnapshotRestore,
} from "./serverBackup.handlers.js";

export const serverBackupSchema = {
  action: z.enum([
    "backup-create", "backup-list", "backup-restore",
    "snapshot-create", "snapshot-list", "snapshot-delete", "snapshot-restore",
  ]).describe(
    "Backup: 'backup-create' dumps Coolify DB+config via SSH (or system config for bare servers), 'backup-list' shows local backups, 'backup-restore' restores (SAFE_MODE blocks). Snapshot: 'snapshot-create'/'snapshot-list'/'snapshot-delete'/'snapshot-restore' manage cloud snapshots (requires API token). snapshot-restore restores server disk from a cloud snapshot (SAFE_MODE blocks, destructive).",
  ),
  server: z.string().optional().describe(
    "Server name or IP. Auto-selected if only one server exists.",
  ),
  backupId: z.string().regex(/^[\w-]+$/, "Invalid backupId: only alphanumeric, hyphens, underscores allowed").optional().describe(
    "Backup timestamp folder name (required for backup-restore).",
  ),
  snapshotId: z.string().regex(/^[\w./-]+$/, "Invalid snapshotId: only alphanumeric, hyphens, dots, slashes allowed").optional().describe(
    "Cloud snapshot ID (required for snapshot-delete and snapshot-restore).",
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
      case "backup-create":   return handleBackupCreate(server);
      case "backup-list":     return handleBackupList(server);
      case "backup-restore":  return handleBackupRestore(server, params.backupId);
      case "snapshot-create": return handleSnapshotCreate(server);
      case "snapshot-list":   return handleSnapshotList(server);
      case "snapshot-delete": return handleSnapshotDelete(server, params.snapshotId);
      case "snapshot-restore": return handleSnapshotRestore(server, params.snapshotId);
      default: {
        return mcpError(`Unknown action: ${params.action as string}`);
      }
    }
  } catch (error: unknown) {
    return mcpError(getErrorMessage(error));
  }
}
