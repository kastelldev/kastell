/**
 * Fix history persistence and backup/rollback SSH helpers.
 * Stores fix operations per server with remote backup support.
 * History entries are validated with Zod .strict() to prevent bloat.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
} from "fs";
import { join } from "path";
import { z } from "zod";
import { CONFIG_DIR } from "../../utils/config.js";
import { withFileLock } from "../../utils/fileLock.js";
import { sshExec } from "../../utils/ssh.js";
import { raw } from "../../utils/sshCommand.js";
import type { FixHistoryEntry } from "./types.js";

const FIX_HISTORY_FILENAME = "fix-history.json";

/** Remote base directory for fix backups on the managed server */
export const REMOTE_BACKUP_BASE = "/root/.kastell/fix-backups";

/** Max fix history entries per server to prevent unbounded growth */
const MAX_ENTRIES_PER_SERVER = 100;

/** Get fix history file path lazily to support testing */
function getFixHistoryPath(): string {
  return join(CONFIG_DIR, FIX_HISTORY_FILENAME);
}

/**
 * Zod schema for a single fix history entry.
 * Uses .strict() to reject extra fields that would bloat the history file.
 */
const fixHistoryEntrySchema = z.object({
  fixId: z.string(),
  serverIp: z.string(),
  serverName: z.string(),
  timestamp: z.string(),
  checks: z.array(z.string()),
  scoreBefore: z.number(),
  scoreAfter: z.number().nullable(),
  status: z.enum(["applied", "rolled-back", "failed"]),
  backupPath: z.string(),
}).strict();

const fixHistoryFileSchema = z.array(fixHistoryEntrySchema);

/**
 * Load fix history for a specific server IP.
 * Returns empty array if no history exists, file is corrupt, or any entry fails Zod .strict() validation.
 */
export function loadFixHistory(serverIp: string): FixHistoryEntry[] {
  try {
    const historyFile = getFixHistoryPath();
    if (!existsSync(historyFile)) {
      return [];
    }
    const data = readFileSync(historyFile, "utf-8");
    const result = fixHistoryFileSchema.safeParse(JSON.parse(data));
    if (!result.success) {
      return [];
    }
    return result.data.filter((e) => e.serverIp === serverIp);
  } catch {
    return [];
  }
}

/**
 * Save fix history entry.
 * Appends to existing history, caps at MAX_ENTRIES_PER_SERVER per server.
 * Uses atomic write pattern (write then rename) for safety.
 * Wrapped in withFileLock to prevent concurrent write corruption.
 */
export async function saveFixHistory(entry: FixHistoryEntry): Promise<void> {
  const historyFile = getFixHistoryPath();

  await withFileLock(historyFile, () => {
    // Ensure config directory exists
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }

    // Load existing history
    let entries: FixHistoryEntry[] = [];
    try {
      if (existsSync(historyFile)) {
        const data = readFileSync(historyFile, "utf-8");
        const parsed = JSON.parse(data);
        const validated = fixHistoryFileSchema.safeParse(parsed);
        if (validated.success) {
          entries = validated.data;
        }
        // If validation fails, start fresh to avoid bloat propagation
      }
    } catch {
      // Start fresh if corrupt
      entries = [];
    }

    entries.push(entry);

    // Cap per server: keep most recent MAX_ENTRIES_PER_SERVER
    const serverEntries = entries.filter((e) => e.serverIp === entry.serverIp);
    if (serverEntries.length > MAX_ENTRIES_PER_SERVER) {
      // Sort by timestamp ascending, remove oldest
      serverEntries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const toRemove = new Set(
        serverEntries.slice(0, serverEntries.length - MAX_ENTRIES_PER_SERVER),
      );
      entries = entries.filter(
        (e) => e.serverIp !== entry.serverIp || !toRemove.has(e),
      );
    }

    // Write atomically via temp file + rename
    const tmpFile = historyFile + ".tmp";
    writeFileSync(tmpFile, JSON.stringify(entries, null, 2), { encoding: "utf-8", mode: 0o600 });
    renameSync(tmpFile, historyFile);
  });
}

/**
 * Generate a new fix ID in "fix-YYYY-MM-DD-NNN" format.
 * NNN is a daily counter per server — increments if same server has fixes today.
 */
export function generateFixId(serverIp: string): string {
  const today = new Date().toISOString().split("T")[0];
  const history = loadFixHistory(serverIp);
  const todayEntries = history.filter((e) => e.fixId.startsWith(`fix-${today}`));
  const count = todayEntries.length;
  const nnn = (count + 1).toString().padStart(3, "0");
  return `fix-${today}-${nnn}`;
}

/**
 * Get the last successfully applied fix ID for a server.
 * Skips "rolled-back" and "failed" status entries.
 * Returns null if no applied fix exists.
 */
export function getLastFixId(serverIp: string): string | null {
  const history = loadFixHistory(serverIp);
  const applied = history.filter((e) => e.status === "applied");
  if (applied.length === 0) return null;
  return applied[applied.length - 1].fixId;
}

/**
 * Extract absolute file paths from a fix command.
 * Matches /etc/..., /root/..., /var/..., /usr/..., /home/... paths.
 * Returns [] for sysctl/systemctl/useradd commands (no file paths to back up).
 */
export function extractFilePathsFromFixCommand(cmd: string): string[] {
  // Sysctl, systemctl, useradd don't operate on files — no paths to extract
  if (
    cmd.startsWith("sysctl ") ||
    cmd.startsWith("systemctl ") ||
    cmd.startsWith("useradd ") ||
    cmd.startsWith("gpasswd ") ||
    cmd.startsWith("passwd ")
  ) {
    return [];
  }

  const regex = /(?:^|\s)(\/(?:etc|root|var|usr|home)\/\S+)/g;
  const paths: string[] = [];
  let match;
  while ((match = regex.exec(cmd)) !== null) {
    const p = match[1];
    // Filter out paths ending with / (directories, not files)
    if (!p.endsWith("/")) {
      paths.push(p);
    }
  }
  return paths;
}

/**
 * Backup files on remote server before fix.
 * Uses mirror directory structure: /root/.kastell/fix-backups/{fixId}/etc/ssh/sshd_config
 * For sysctl-type fixes, captures current value in restore-commands.sh.
 * Returns the backup directory path.
 */
export async function backupFilesBeforeFix(
  ip: string,
  fixId: string,
  fixCommands: Array<{ checkId: string; fixCommand: string }>,
): Promise<string> {
  const backupDir = `${REMOTE_BACKUP_BASE}/${fixId}`;
  await sshExec(ip, raw(`mkdir -p ${backupDir}`));

  for (const { fixCommand } of fixCommands) {
    const filePaths = extractFilePathsFromFixCommand(fixCommand);
    for (const fp of filePaths) {
      // Mirror directory structure — create parent dir in backup
      await sshExec(ip, raw(`mkdir -p ${backupDir}$(dirname ${fp})`));
      // Only backup if file exists on remote (test -f guard)
      await sshExec(ip, raw(`test -f ${fp} && cp ${fp} ${backupDir}${fp} || true`));
    }

    // For sysctl fixes: capture current value in restore script
    const sysctlMatch = fixCommand.match(/^sysctl\s+-w\s+(\S+)=/);
    if (sysctlMatch) {
      const param = sysctlMatch[1];
      await sshExec(
        ip,
        raw(`echo "sysctl -w ${param}=$(sysctl -n ${param})" >> ${backupDir}/restore-commands.sh`),
      );
    }
  }

  return backupDir;
}

/**
 * Rollback a fix by restoring files from backup directory.
 * 1. Runs restore-commands.sh if exists (sysctl rollback)
 * 2. Finds all backed-up files and copies them back to original paths
 */
export async function rollbackFix(
  ip: string,
  _fixId: string,
  backupPath: string,
): Promise<{ restored: string[]; errors: string[] }> {
  const restored: string[] = [];
  const errors: string[] = [];

  // Check backup directory exists
  const checkDir = await sshExec(ip, raw(`test -d ${backupPath} && echo exists`));
  if (!checkDir.stdout.includes("exists")) {
    errors.push(`Backup directory not found: ${backupPath}`);
    return { restored, errors };
  }

  // Run restore-commands.sh if exists (sysctl rollback)
  const hasScript = await sshExec(ip, raw(`test -f ${backupPath}/restore-commands.sh && echo exists`));
  if (hasScript.stdout.includes("exists")) {
    const scriptResult = await sshExec(ip, raw(`bash ${backupPath}/restore-commands.sh`));
    if (scriptResult.code === 0) {
      restored.push("restore-commands.sh");
    } else {
      errors.push(`restore-commands.sh failed (exit ${scriptResult.code})`);
    }
  }

  // Find and restore backed-up files (mirror structure)
  const findResult = await sshExec(
    ip,
    raw(`find ${backupPath} -type f ! -name 'restore-commands.sh' -printf '%P\\n'`),
  );
  const files = findResult.stdout.trim().split("\n").filter(Boolean);

  for (const relPath of files) {
    const origPath = `/${relPath}`;
    const backupFile = `${backupPath}/${relPath}`;
    const cpResult = await sshExec(ip, raw(`cp ${backupFile} ${origPath}`));
    if (cpResult.code === 0) {
      restored.push(origPath);
    } else {
      errors.push(`${origPath}: restore failed (exit ${cpResult.code})`);
    }
  }

  return { restored, errors };
}

/**
 * Prune old backup directories on remote server.
 * Keeps last 20, deletes oldest. Called after successful fix apply.
 */
export async function backupRemoteCleanup(ip: string): Promise<void> {
  await sshExec(
    ip,
    raw(
      `cd ${REMOTE_BACKUP_BASE} 2>/dev/null && ls -d fix-* 2>/dev/null | sort | head -n -20 | xargs -r rm -rf`,
    ),
  );
}
