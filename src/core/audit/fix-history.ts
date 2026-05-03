/**
 * Fix history persistence and backup/rollback SSH helpers.
 * Stores fix operations per server with remote backup support.
 * History entries are validated with Zod .strict() to prevent bloat.
 */

import {
  readFileSync,
  existsSync,
  mkdirSync,
  renameSync,
} from "fs";
import { join } from "path";
import { z } from "zod";
import { KASTELL_DIR } from "../../utils/paths.js";
import { withFileLock, warnIfPermissionError } from "../../utils/fileLock.js";
import { sshExec } from "../../utils/ssh.js";
import { raw } from "../../utils/sshCommand.js";
import { secureWriteFileSync } from "../../utils/secureWrite.js";
import type { FixExecutionLogEntry, FixHistoryEntry } from "./types.js";

const MAX_STDOUT_LEN = 4096;
const MAX_STDERR_LEN = 1024;

const FIX_HISTORY_FILENAME = "fix-history.json";

/** Remote base directory for fix backups on the managed server */
export const REMOTE_BACKUP_BASE = "/root/.kastell/fix-backups";

/** Max fix history entries per server to prevent unbounded growth */
const MAX_ENTRIES_PER_SERVER = 100;

/** Get fix history file path lazily to support testing */
function getFixHistoryPath(): string {
  return join(KASTELL_DIR, FIX_HISTORY_FILENAME);
}

/**
 * Zod schema for a single fix history entry.
 * Uses .strict() to reject extra fields that would bloat the history file.
 */
const fixExecutionLogSchema = z.object({
  checkId: z.string(),
  command: z.string(),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number(),
  success: z.boolean(),
});

export const fixHistoryEntrySchema = z.object({
  fixId: z.string(),
  serverIp: z.string(),
  serverName: z.string(),
  timestamp: z.string(),
  checks: z.array(z.string()),
  scoreBefore: z.number(),
  scoreAfter: z.number().nullable(),
  status: z.enum(["applied", "rolled-back", "failed"]),
  backupPath: z.string().regex(/^\/root\/\.kastell\/fix-backups\/fix-[\d-]+$/, "Invalid backup path format").optional(),
  executionLog: z.array(fixExecutionLogSchema).optional(),
  source: z.enum(["fix", "doctor"]).optional(),
}).strict();

export function truncateExecutionLog(log: FixExecutionLogEntry[]): FixExecutionLogEntry[] {
  return log.map((entry) => ({
    ...entry,
    stdout: entry.stdout.slice(0, MAX_STDOUT_LEN),
    stderr: entry.stderr.slice(0, MAX_STDERR_LEN),
  }));
}

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
  } catch (err: unknown) {
    warnIfPermissionError(err, "fix history");
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
    if (!existsSync(KASTELL_DIR)) {
      mkdirSync(KASTELL_DIR, { recursive: true });
    }

    let entries: FixHistoryEntry[] = [];
    try {
      if (existsSync(historyFile)) {
        const data = readFileSync(historyFile, "utf-8");
        const validated = fixHistoryFileSchema.safeParse(JSON.parse(data));
        if (validated.success) {
          entries = validated.data;
        }
      }
    } catch {
      entries = [];
    }

    entries.push(entry);

    const serverEntries = entries.filter((e) => e.serverIp === entry.serverIp);
    if (serverEntries.length > MAX_ENTRIES_PER_SERVER) {
      serverEntries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      // .filter() preserves object references, so Set membership check works
      const toRemove = new Set(
        serverEntries.slice(0, serverEntries.length - MAX_ENTRIES_PER_SERVER),
      );
      entries = entries.filter(
        (e) => e.serverIp !== entry.serverIp || !toRemove.has(e),
      );
    }

    const tmpFile = historyFile + ".tmp";
    secureWriteFileSync(tmpFile, JSON.stringify(entries, null, 2), { encoding: "utf-8" });
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
 * Save a rollback history entry for a previously applied fix.
 * Encapsulates the fix ID naming convention (appends "-rollback").
 */
export async function saveRollbackEntry(
  entry: FixHistoryEntry,
  scoreAfter: number | null,
): Promise<void> {
  await saveFixHistory({
    fixId: `${entry.fixId}-rollback`,
    serverIp: entry.serverIp,
    serverName: entry.serverName,
    timestamp: new Date().toISOString(),
    checks: entry.checks,
    scoreBefore: entry.scoreAfter ?? entry.scoreBefore,
    scoreAfter,
    status: "rolled-back",
    backupPath: entry.backupPath,
  });
}

/**
 * Extract absolute file paths from a fix command.
 * Matches /etc/..., /root/..., /var/..., /usr/..., /home/... paths.
 * Returns [] for sysctl/systemctl/useradd commands (no file paths to back up).
 */
export function extractFilePathsFromFixCommand(cmd: string): string[] {
  if (
    cmd.startsWith("sysctl ") ||
    cmd.startsWith("systemctl ") ||
    cmd.startsWith("useradd ") ||
    cmd.startsWith("gpasswd ") ||
    cmd.startsWith("passwd ")
  ) {
    return [];
  }

  if (cmd.startsWith("sed-replace:")) {
    const parts = cmd.split(":");
    if (parts[1] && parts[1].startsWith("/")) {
      return [parts[1]];
    }
    return [];
  }

  const regex = /(?:^|\s)(\/(?:etc|root|var|usr|home)\/\S+)/g;
  const paths: string[] = [];
  let match;
  while ((match = regex.exec(cmd)) !== null) {
    const p = match[1];
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

  // Collect all file paths and sysctl params, then batch into minimal SSH calls
  const allFilePaths: string[] = [];
  const sysctlParams: string[] = [];

  for (const { fixCommand } of fixCommands) {
    allFilePaths.push(...extractFilePathsFromFixCommand(fixCommand));
    const sysctlMatch = fixCommand.match(/^sysctl\s+-w\s+(\S+)=/);
    if (sysctlMatch) {
      sysctlParams.push(sysctlMatch[1]);
    }
  }

  // Single SSH call: create backup dir + mirror dirs + copy files
  // BUG-01: explicitly create REMOTE_BACKUP_BASE before per-fix subdir
  const cmds = [`mkdir -p ${REMOTE_BACKUP_BASE}`, `mkdir -p ${backupDir}`];
  for (const fp of allFilePaths) {
    cmds.push(`mkdir -p ${backupDir}$(dirname ${fp})`);
    cmds.push(`test -f ${fp} && { test -e ${backupDir}${fp} || cp ${fp} ${backupDir}${fp}; } || true`);
  }
  for (const param of sysctlParams) {
    cmds.push(`echo "sysctl -w ${param}=$(sysctl -n ${param})" >> ${backupDir}/restore-commands.sh`);
  }
  // Write SHA256 checksum of restore script for integrity verification during rollback
  cmds.push(`test -f ${backupDir}/restore-commands.sh && sha256sum ${backupDir}/restore-commands.sh > ${backupDir}/restore-commands.sha256 || true`);
  await sshExec(ip, raw(cmds.join(" && ")));

  return backupDir;
}

/**
 * Rollback a fix by restoring files from backup directory.
 * 1. Runs restore-commands.sh if exists (sysctl rollback)
 * 2. Finds all backed-up files and copies them back to original paths
 */
export async function rollbackFix(
  ip: string,
  backupPath: string,
): Promise<{ restored: string[]; errors: string[] }> {
  const restored: string[] = [];
  const errors: string[] = [];

  const checkDir = await sshExec(ip, raw(`test -d ${backupPath} && echo exists`));
  if (!checkDir.stdout.includes("exists")) {
    errors.push(`Backup directory not found: ${backupPath}`);
    return { restored, errors };
  }

  // Restore sysctl values if restore script exists (with integrity check)
  const hasScript = await sshExec(ip, raw(`test -f ${backupPath}/restore-commands.sh && echo exists`));
  if (hasScript.stdout.includes("exists")) {
    // Verify SHA256 integrity before executing
    const hasChecksum = await sshExec(ip, raw(`test -f ${backupPath}/restore-commands.sha256 && echo exists`));
    if (hasChecksum.stdout.includes("exists")) {
      const verifyResult = await sshExec(ip, raw(`cd ${backupPath} && sha256sum -c restore-commands.sha256 --status && echo verified`));
      if (!verifyResult.stdout.includes("verified")) {
        errors.push("restore-commands.sh integrity check FAILED — script may have been tampered with");
        return { restored, errors };
      }
    }
    const scriptResult = await sshExec(ip, raw(`bash ${backupPath}/restore-commands.sh`));
    if (scriptResult.code === 0) {
      restored.push("restore-commands.sh");
    } else {
      errors.push(`restore-commands.sh failed (exit ${scriptResult.code})`);
    }
  }

  // Batch-restore all backed-up files in a single SSH call
  const findResult = await sshExec(
    ip,
    raw(`find ${backupPath} -type f ! -name 'restore-commands.sh' -printf '%P\\n'`),
  );
  const files = findResult.stdout.trim().split("\n").filter(Boolean);
  const SAFE_PATH = /^[a-zA-Z0-9_./-]+$/;
  const safeFiles = files.filter((f) => SAFE_PATH.test(f) && !f.includes(".."));
  if (safeFiles.length < files.length) {
    errors.push(`skipped ${files.length - safeFiles.length} file(s) with suspicious path characters`);
  }

  if (safeFiles.length > 0) {
    // Server-side path traversal guard: reject any path containing ..
    // Client-side SAFE_PATH filter is defense-in-depth; SSH command is the primary guard
    const cpCmds = safeFiles.map((relPath) => {
      if (relPath.includes("..") || relPath.startsWith("/")) return "true";
      return `cp ${backupPath}/${relPath} /${relPath}`;
    }).join(" && ");
    const batchResult = await sshExec(ip, raw(cpCmds));
    if (batchResult.code === 0) {
      restored.push(...safeFiles.map((r) => `/${r}`));
    } else {
      errors.push(`batch restore failed (exit ${batchResult.code})`);
    }
  }

  return { restored, errors };
}

/** Execute rollback loop over entries in order, continuing on failure. */
async function executeRollbackLoop(
  ip: string,
  entries: FixHistoryEntry[],
): Promise<{ rolledBack: string[]; errors: string[] }> {
  const rolledBack: string[] = [];
  const errors: string[] = [];

  for (const entry of entries) {
    if (!entry.backupPath) {
      errors.push(`${entry.fixId}: No backup path (doctor fix entries cannot be rolled back)`);
      continue;
    }
    const { restored, errors: rbErrors } = await rollbackFix(ip, entry.backupPath);
    // Partial success counts — at least one file restored is enough to record as rolled-back
    if (rbErrors.length === 0 || restored.length > 0) {
      await saveRollbackEntry(entry, null);
      rolledBack.push(entry.fixId);
    } else {
      errors.push(...rbErrors.map((e) => `${entry.fixId}: ${e}`));
    }
  }

  return { rolledBack, errors };
}

/**
 * Roll back all applied fixes for a server in reverse-chronological order.
 * Continues on individual failure, collecting all errors.
 */
export async function rollbackAllFixes(
  ip: string,
): Promise<{ rolledBack: string[]; errors: string[] }> {
  const history = loadFixHistory(ip);
  const toRollback = history
    .filter((e) => e.status === "applied")
    .reverse();

  return executeRollbackLoop(ip, toRollback);
}

/**
 * Roll back all fixes from newest down to and including the target fix-id.
 * Returns error if target fix-id is not found or not in applied state.
 */
export async function rollbackToFix(
  ip: string,
  targetFixId: string,
): Promise<{ rolledBack: string[]; errors: string[] }> {
  const history = loadFixHistory(ip);
  const applied = history.filter((e) => e.status === "applied");

  const targetIdx = applied.findIndex((e) => e.fixId === targetFixId);
  if (targetIdx === -1) {
    return {
      rolledBack: [],
      errors: [`Fix not found or not in applied state: ${targetFixId}`],
    };
  }

  return executeRollbackLoop(ip, applied.slice(targetIdx).reverse());
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
