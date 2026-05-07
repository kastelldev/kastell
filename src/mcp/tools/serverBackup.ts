import { z } from "zod";
import { getServers } from "../../utils/config.js";
import {
  resolveServerForMcp,
  mcpError,
  type McpResponse,
} from "../utils.js";
import { getErrorMessage, sanitizeStderr } from "../../utils/errorMapper.js";
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

// ─── Output Schema ────────────────────────────────────────────────────────────

const backupCreateOutputSchema = z.object({
  success: z.boolean(),
  server: z.string(),
  ip: z.string(),
  backupPath: z.string(),
  manifest: z.string(),
  suggested_actions: z.array(z.object({ command: z.string(), reason: z.string() })),
});

const backupListOutputSchema = z.object({
  server: z.string(),
  backupCount: z.number(),
  backups: z.array(z.object({
    backupId: z.string(),
    timestamp: z.string().optional(),
    coolifyVersion: z.string().optional(),
    files: z.number().optional(),
    status: z.string().optional(),
  })),
  message: z.string().optional(),
  suggested_actions: z.array(z.object({ command: z.string(), reason: z.string() })),
});

const backupRestoreOutputSchema = z.object({
  success: z.boolean(),
  server: z.string(),
  ip: z.string(),
  backupId: z.string(),
  steps: z.array(z.object({ status: z.string(), message: z.string() })),
  hint: z.string().optional(),
  suggested_actions: z.array(z.object({ command: z.string(), reason: z.string() })),
});

const snapshotCreateOutputSchema = z.object({
  success: z.boolean(),
  server: z.string(),
  ip: z.string(),
  snapshot: z.object({ id: z.string(), name: z.string(), createdAt: z.string() }),
  costEstimate: z.string(),
  suggested_actions: z.array(z.object({ command: z.string(), reason: z.string() })),
});

const snapshotListOutputSchema = z.object({
  server: z.string(),
  ip: z.string(),
  snapshotCount: z.number(),
  snapshots: z.array(z.object({ id: z.string(), name: z.string(), createdAt: z.string() })),
  message: z.string().optional(),
  suggested_actions: z.array(z.object({ command: z.string(), reason: z.string() })),
});

const snapshotDeleteOutputSchema = z.object({
  success: z.boolean(),
  server: z.string(),
  ip: z.string(),
  snapshotId: z.string(),
  message: z.string(),
  suggested_actions: z.array(z.object({ command: z.string(), reason: z.string() })),
});

const snapshotRestoreOutputSchema = z.object({
  success: z.boolean(),
  server: z.string(),
  ip: z.string(),
  snapshotId: z.string(),
  message: z.string(),
  suggested_actions: z.array(z.object({ command: z.string(), reason: z.string() })),
});

export const serverBackupOutputSchema = z.object({
  result: z.discriminatedUnion("action", [
    z.object({ action: z.literal("backup-create") }).merge(backupCreateOutputSchema),
    z.object({ action: z.literal("backup-list") }).merge(backupListOutputSchema),
    z.object({ action: z.literal("backup-restore") }).merge(backupRestoreOutputSchema),
    z.object({ action: z.literal("snapshot-create") }).merge(snapshotCreateOutputSchema),
    z.object({ action: z.literal("snapshot-list") }).merge(snapshotListOutputSchema),
    z.object({ action: z.literal("snapshot-delete") }).merge(snapshotDeleteOutputSchema),
    z.object({ action: z.literal("snapshot-restore") }).merge(snapshotRestoreOutputSchema),
  ]),
});

export type ServerBackupOutput = z.infer<typeof serverBackupOutputSchema>;

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
    return mcpError(sanitizeStderr(getErrorMessage(error)));
  }
}
