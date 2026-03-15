import {
  createBackup,
  createBareBackup,
  restoreBackup,
  restoreBareBackup,
  listBackups,
  loadManifest,
  getBackupDir,
} from "../../core/backup.js";
import {
  createSnapshot,
  listSnapshots,
  deleteSnapshot,
} from "../../core/snapshot.js";
import { isSafeMode } from "../../core/manage.js";
import { isBareServer } from "../../utils/modeGuard.js";
import { resolvePlatform } from "../../adapters/factory.js";
import { join } from "path";
import {
  mcpSuccess,
  mcpError,
  requireProviderToken,
  type McpResponse,
} from "../utils.js";
import type { ServerRecord } from "../../types/index.js";

// ─── Backup handlers ──────────────────────────────────────────────────────────

export async function handleBackupCreate(server: ServerRecord): Promise<McpResponse> {
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

export async function handleBackupList(server: ServerRecord): Promise<McpResponse> {
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

export async function handleBackupRestore(
  server: ServerRecord,
  backupId: string | undefined,
): Promise<McpResponse> {
  if (isSafeMode()) {
    return mcpError(
      "Restore disabled in SAFE_MODE",
      "Set KASTELL_SAFE_MODE=false to enable restore operations",
    );
  }

  if (!backupId) {
    return mcpError(
      "backupId is required for backup-restore",
      "Use backup-list to see available backups",
      [{ command: `server_backup { action: 'backup-list', server: '${server.name}' }`, reason: "List available backups" }],
    );
  }

  const bare = isBareServer(server);
  const result = bare
    ? await restoreBareBackup(server.ip, server.name, backupId)
    : await restoreBackup(server.ip, server.name, backupId);

  if (!result.success) {
    return {
      content: [{ type: "text", text: JSON.stringify({
        server: server.name,
        ip: server.ip,
        backupId,
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
    backupId,
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

// ─── Snapshot handlers ────────────────────────────────────────────────────────

export async function handleSnapshotCreate(server: ServerRecord): Promise<McpResponse> {
  if (isSafeMode()) {
    return mcpError(
      "Snapshot creation is disabled in SAFE_MODE",
      "Set KASTELL_SAFE_MODE=false to enable snapshot creation (billable operation)",
      [{ command: `server_backup { action: 'backup-create', server: '${server.name}' }`, reason: "Use SSH-based backup instead (free)" }],
    );
  }

  if (server.id.startsWith("manual-")) {
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

export async function handleSnapshotList(server: ServerRecord): Promise<McpResponse> {
  if (server.id.startsWith("manual-")) {
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

export async function handleSnapshotDelete(
  server: ServerRecord,
  snapshotId: string | undefined,
): Promise<McpResponse> {
  if (isSafeMode()) {
    return mcpError(
      "Snapshot delete disabled in SAFE_MODE",
      "Set KASTELL_SAFE_MODE=false to enable snapshot deletion",
    );
  }

  if (server.id.startsWith("manual-")) {
    return mcpError(
      "Snapshots require cloud provider API. Manual servers don't have provider IDs.",
      "Manual servers cannot manage cloud snapshots.",
    );
  }

  const tokenResult = requireProviderToken(server.provider);
  if ("error" in tokenResult) return tokenResult.error;

  if (!snapshotId) {
    return mcpError(
      "snapshotId is required for snapshot-delete",
      "Use snapshot-list to see available snapshots",
      [{ command: `server_backup { action: 'snapshot-list', server: '${server.name}' }`, reason: "List snapshots" }],
    );
  }

  const result = await deleteSnapshot(server, tokenResult.token, snapshotId);

  if (!result.success) {
    return {
      content: [{ type: "text", text: JSON.stringify({
        server: server.name,
        ip: server.ip,
        snapshotId,
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
    snapshotId,
    message: "Snapshot deleted",
    suggested_actions: [
      { command: `server_backup { action: 'snapshot-list', server: '${server.name}' }`, reason: "View remaining snapshots" },
    ],
  });
}
