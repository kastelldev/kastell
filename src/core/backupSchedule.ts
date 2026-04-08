import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { sshExec, assertValidIp } from "../utils/ssh.js";
import { raw, type SshCommand } from "../utils/sshCommand.js";
import { KASTELL_DIR } from "../utils/paths.js";
import { ValidationError } from "../utils/errors.js";
import { shellEscape } from "../utils/shellEscape.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScheduleResult {
  success: boolean;
  error?: string;
  hint?: string;
}

export interface ListScheduleResult {
  success: boolean;
  cronExpr?: string;
  localCronExpr?: string;
  error?: string;
}

// ─── Local Schedule Persistence ──────────────────────────────────────────────

const SCHEDULES_FILE = join(KASTELL_DIR, "schedules.json");

const schedulesSchema = z.record(z.string(), z.string());

export function getSchedules(): Record<string, string> {
  if (!existsSync(SCHEDULES_FILE)) return {};
  try {
    const parsed = schedulesSchema.safeParse(JSON.parse(readFileSync(SCHEDULES_FILE, "utf-8")));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export function saveSchedule(serverName: string, cronExpr: string): void {
  mkdirSync(KASTELL_DIR, { recursive: true });
  const schedules = getSchedules();
  schedules[serverName] = cronExpr;
  writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2), { mode: 0o600 });
}

export function removeSchedule(serverName: string): void {
  mkdirSync(KASTELL_DIR, { recursive: true });
  const schedules = getSchedules();
  delete schedules[serverName];
  writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2), { mode: 0o600 });
}

// ─── Validation ───────────────────────────────────────────────────────────────

export function validateCronExpr(expr: string): { valid: boolean; error?: string } {
  if (!expr || expr.trim().length === 0) {
    return { valid: false, error: "Cron expression cannot be empty" };
  }
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    return { valid: false, error: `Cron expression must have 5 fields, got ${fields.length}` };
  }
  const fieldPattern = /^[0-9*,/-]+$/;
  for (const field of fields) {
    if (!fieldPattern.test(field)) {
      return { valid: false, error: `Invalid cron field: "${field}"` };
    }
  }
  return { valid: true };
}

// ─── Command Builders ─────────────────────────────────────────────────────────

export function buildDeployBackupScriptCommand(): SshCommand {
  const lines = [
    "cat <<'KASTELL_EOF' > /root/kastell-backup.sh",
    "#!/bin/bash",
    "exec 200>/tmp/kastell-backup.lock",
    "flock -n 200 || { echo \"[kastell-backup] already running, skipping\"; exit 0; }",
    "mkdir -p /var/backups/kastell",
    "echo \"[kastell-backup] Started at $(date -u +%Y-%m-%dT%H:%M:%SZ)\" >> /var/log/kastell-backup.log",
    "if command -v docker &>/dev/null && docker ps --format '{{.Names}}' 2>/dev/null | grep -q 'coolify'; then",
    "  OUTFILE=\"/var/backups/kastell/kastell-backup-coolify-$(date -u +%Y-%m-%dT%H-%M-%SZ).sql.gz\"",
    "  docker exec coolify-db pg_dump -U coolify -d coolify 2>/dev/null | gzip > \"$OUTFILE\" || true",
    "  echo \"[kastell-backup] Coolify backup at $(date -u +%Y-%m-%dT%H:%M:%SZ)\" >> /var/log/kastell-backup.log",
    "else",
    "  OUTFILE=\"/var/backups/kastell/kastell-backup-bare-$(date -u +%Y-%m-%dT%H-%M-%SZ).tar.gz\"",
    "  tar czf \"$OUTFILE\" --ignore-failed-read -C / etc/nginx etc/ssh/sshd_config etc/ufw etc/fail2ban etc/crontab 2>/dev/null || true",
    "  echo \"[kastell-backup] Bare backup at $(date -u +%Y-%m-%dT%H:%M:%SZ)\" >> /var/log/kastell-backup.log",
    "fi",
    "echo \"[kastell-backup] Done at $(date -u +%Y-%m-%dT%H:%M:%SZ)\" >> /var/log/kastell-backup.log",
    "KASTELL_EOF",
    "chmod +x /root/kastell-backup.sh",
  ];
  return raw(lines.join("\n"));
}

export function buildInstallCronCommand(cronExpr: string): SshCommand {
  // Defense-in-depth: validate inside command builder so callers cannot bypass
  const validation = validateCronExpr(cronExpr);
  if (!validation.valid) {
    throw new ValidationError(`Invalid cron expression: ${validation.error}`, { hint: "Check cron syntax (5 fields: min hour day month weekday)" });
  }
  const entry = `${cronExpr} /root/kastell-backup.sh # kastell-backup`;
  // shellEscape provides POSIX single-quote wrapping with embedded quote escaping (defense-in-depth, SEC-05)
  return raw(`(crontab -l 2>/dev/null | grep -v '# kastell-backup'; echo ${shellEscape(entry)}) | crontab -`);
}

export function buildListCronCommand(): SshCommand {
  return raw(`crontab -l 2>/dev/null | grep '# kastell-backup' || echo ""`);
}

export function buildRemoveCronCommand(): SshCommand {
  return raw(`(crontab -l 2>/dev/null | grep -v '# kastell-backup') | crontab -`);
}

// ─── Orchestrators ────────────────────────────────────────────────────────────

export async function scheduleBackup(
  ip: string,
  serverName: string,
  cronExpr: string,
): Promise<ScheduleResult> {
  assertValidIp(ip);

  const validation = validateCronExpr(cronExpr);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const deployResult = await sshExec(ip, buildDeployBackupScriptCommand());
  if (deployResult.code !== 0) {
    return {
      success: false,
      error: "Failed to deploy backup script",
      hint: deployResult.stderr || undefined,
    };
  }

  const cronResult = await sshExec(ip, buildInstallCronCommand(cronExpr));
  if (cronResult.code !== 0) {
    return {
      success: false,
      error: "Failed to install cron entry — check cron expression syntax",
      hint: cronResult.stderr || undefined,
    };
  }

  saveSchedule(serverName, cronExpr);

  return { success: true };
}

export async function listBackupSchedule(
  ip: string,
  serverName: string,
): Promise<ListScheduleResult> {
  assertValidIp(ip);

  const result = await sshExec(ip, buildListCronCommand());
  if (result.code !== 0) {
    return { success: false, error: "Failed to list backup schedule" };
  }

  const stdout = result.stdout.trim();
  let cronExpr: string | undefined;
  if (stdout) {
    // Extract the cron expression (first 5 fields) from the crontab line
    const parts = stdout.split(/\s+/);
    if (parts.length >= 5) {
      cronExpr = parts.slice(0, 5).join(" ");
    }
  }

  const schedules = getSchedules();
  const localCronExpr = schedules[serverName];

  return {
    success: true,
    cronExpr,
    localCronExpr,
  };
}

export async function removeBackupSchedule(
  ip: string,
  serverName: string,
): Promise<ScheduleResult> {
  assertValidIp(ip);

  const result = await sshExec(ip, buildRemoveCronCommand());
  if (result.code !== 0) {
    return { success: false, error: "Failed to remove backup schedule" };
  }

  removeSchedule(serverName);

  return { success: true };
}
