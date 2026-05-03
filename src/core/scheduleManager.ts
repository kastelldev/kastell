import { spawnSync } from "child_process";
import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import { secureWriteFileSync } from "../utils/secureWrite.js";
import {
  validateCronExpr,
  saveSchedule,
  removeSchedule,
  getSchedules,
} from "../core/backupSchedule.js";
import { KASTELL_DIR } from "../utils/paths.js";
import { sanitizedEnv } from "../utils/ssh.js";
import { dispatchWithCooldown } from "../core/notify.js";
import { ValidationError } from "../utils/errors.js";
import { extractReason } from "../utils/errors.js";

export type ScheduleType = "fix" | "audit" | "doctor-fix";

const CRONTAB_TMP = join(KASTELL_DIR, ".crontab-tmp");

/** Read current crontab, filter lines by marker, optionally add new entry, install via temp file */
function updateCrontab(marker: string, newEntry?: string): { success: boolean; error?: string } {
  const current = spawnSync("crontab", ["-l"], { encoding: "utf8", env: sanitizedEnv() });
  const lines = (current.status === 0 ? current.stdout : "")
    .split("\n")
    .filter((line) => !line.includes(marker));
  if (newEntry) lines.push(newEntry);
  secureWriteFileSync(CRONTAB_TMP, lines.join("\n") + "\n");
  try {
    const install = spawnSync("crontab", [CRONTAB_TMP], { encoding: "utf8", env: sanitizedEnv() });
    if (install.status !== 0) {
      return { success: false, error: install.stderr || "crontab update failed" };
    }
    return { success: true };
  } finally {
    try { unlinkSync(CRONTAB_TMP); } catch { /* already cleaned */ }
  }
}

export interface LocalCronResult {
  success: boolean;
  error?: string;
  windowsFallback?: boolean;
  command?: string;
}


export const SCHEDULE_MARKERS = {
  fix: "# kastell-fix-schedule",
  audit: "# kastell-audit-schedule",
  "doctor-fix": "# kastell-doctor-fix-schedule",
} as const;

const SCHEDULE_LOGS_DIR = join(KASTELL_DIR, "schedule-logs");
const LOG_RETENTION_DAYS = 30;


export function scheduleKey(server: string, type: ScheduleType): string {
  return `${server}:${type}`;
}

export function parseScheduleKey(key: string): { server: string; type: ScheduleType } | null {
  const lastColon = key.lastIndexOf(":");
  if (lastColon === -1) return null;
  const server = key.slice(0, lastColon);
  const maybeType = key.slice(lastColon + 1);
  if (maybeType !== "fix" && maybeType !== "audit" && maybeType !== "doctor-fix") return null;
  return { server, type: maybeType as ScheduleType };
}


export function sanitizeServerName(name: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    throw new ValidationError(
      `Invalid server name "${name}": only alphanumeric characters, dots, hyphens, and underscores are allowed`,
      { hint: "Server name must contain only letters, numbers, dots, hyphens, and underscores" },
    );
  }
  return name;
}


export function resolveKastellBin(): string {
  const argv1 = process.argv[1];
  if (!argv1) return "kastell";
  if (argv1.endsWith(".ts")) return `npx tsx ${argv1}`;
  return argv1;
}


export function installLocalCron(
  cronExpr: string,
  serverName: string,
  type: ScheduleType,
): LocalCronResult {
  const validation = validateCronExpr(cronExpr);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  let sanitized: string;
  try {
    sanitized = sanitizeServerName(serverName);
  } catch (err) {
    return { success: false, error: extractReason(err) };
  }

  const kastellBin = resolveKastellBin();
  const fixCmd = `${kastellBin} fix --safe --server "${sanitized}" --no-interactive`;
  const auditCmd = `${kastellBin} audit --server "${sanitized}" --json`;
  const doctorFixCmd = `${kastellBin} doctor --auto-fix --server "${sanitized}" --force`;
  const command = type === "fix" ? fixCmd : type === "audit" ? auditCmd : doctorFixCmd;

  if (process.platform === "win32") {
    saveSchedule(scheduleKey(sanitized, type), cronExpr);
    return { success: true, windowsFallback: true, command };
  }

  const marker = SCHEDULE_MARKERS[type];
  const entry = `${cronExpr} ${command} ${marker}`;

  try {
    const result = updateCrontab(marker, entry);
    if (!result.success) return result;
  } catch (err) {
    return { success: false, error: extractReason(err) };
  }

  saveSchedule(scheduleKey(sanitized, type), cronExpr);
  return { success: true };
}

export function removeLocalCron(serverName: string, type: ScheduleType): LocalCronResult {
  const marker = SCHEDULE_MARKERS[type];

  if (process.platform !== "win32") {
    try {
      const result = updateCrontab(marker);
      if (!result.success) return result;
    } catch (err) {
      return { success: false, error: extractReason(err) };
    }
  }

  removeSchedule(scheduleKey(serverName, type));
  return { success: true };
}

export function listLocalCron(
  serverFilter?: string,
): Array<{ server: string; type: ScheduleType; cronExpr: string }> {
  const schedules = getSchedules();
  const results: Array<{ server: string; type: ScheduleType; cronExpr: string }> = [];

  for (const [key, cronExpr] of Object.entries(schedules)) {
    const parsed = parseScheduleKey(key);
    if (!parsed) continue;
    if (serverFilter && parsed.server !== serverFilter) continue;
    results.push({ server: parsed.server, type: parsed.type, cronExpr });
  }

  return results;
}


export function writeScheduleLog(
  type: ScheduleType,
  serverName: string,
  result: { applied: number; failed: number; scoreBefore?: number; scoreAfter?: number },
): void {
  mkdirSync(SCHEDULE_LOGS_DIR, { recursive: true });

  const now = new Date();
  const isoTimestamp = now.toISOString();
  const dateStr = isoTimestamp.slice(0, 10);
  const logFile = join(SCHEDULE_LOGS_DIR, `${type}-${serverName}-${dateStr}.log`);

  const hasDelta = result.scoreBefore !== undefined && result.scoreAfter !== undefined;
  const delta = hasDelta ? result.scoreAfter! - result.scoreBefore! : undefined;

  let line = `[${isoTimestamp}] applied=${result.applied} failed=${result.failed}`;
  if (delta !== undefined) line += ` scoreDelta=${delta}`;
  line += "\n";

  appendFileSync(logFile, line);

  const summaryMessage =
    `Schedule ${type} complete: applied=${result.applied} failed=${result.failed}` +
    (delta !== undefined ? ` scoreDelta=${delta}` : "");

  dispatchWithCooldown(serverName, `schedule-${type}`, summaryMessage).catch(() => {});

  cleanOldScheduleLogs();
}

export function cleanOldScheduleLogs(): void {
  const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let files: string[];

  try {
    files = readdirSync(SCHEDULE_LOGS_DIR);
  } catch {
    return;
  }

  for (const file of files) {
    try {
      const filePath = join(SCHEDULE_LOGS_DIR, file);
      const { mtime } = statSync(filePath);
      if (mtime.getTime() < cutoff) {
        unlinkSync(filePath);
      }
    } catch {
      // Skip files we can't stat/unlink
    }
  }
}
