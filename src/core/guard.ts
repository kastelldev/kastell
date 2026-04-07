import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { sshExec, assertValidIp } from "../utils/ssh.js";
import { raw, type SshCommand } from "../utils/sshCommand.js";
import { KASTELL_DIR } from "../utils/paths.js";
import { warnIfPermissionError } from "../utils/fileLock.js";
import { ValidationError } from "../utils/errors.js";
import { dispatchWithCooldown } from "./notify.js";
import { listSnapshots, loadSnapshot } from "./audit/snapshot.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GuardStateEntry {
  installedAt: string; // ISO timestamp
  cronExpr: string; // "*/5 * * * *"
}

export interface GuardStartResult {
  success: boolean;
  error?: string;
  hint?: string;
}

export interface GuardStopResult {
  success: boolean;
  error?: string;
  hint?: string;
}

export interface GuardStatusResult {
  success: boolean;
  isActive: boolean;
  lastRunAt?: string; // parsed from last log line timestamp
  breaches: string[]; // recent BREACH log lines
  logTail: string; // raw last N lines for display
  installedAt?: string; // from local guard-state.json
  error?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const GUARD_CRON_EXPR = "*/5 * * * *";
export const GUARD_SCRIPT_PATH = "/root/kastell-guard.sh";
export const GUARD_LOG_PATH = "/var/log/kastell-guard.log";
export const GUARD_METRICS_PATH = "/var/lib/kastell/metrics.json";
export const GUARD_MARKER = "# kastell-guard";
export const GUARD_AUDIT_STALENESS_MS = 24 * 60 * 60 * 1000; // 24 hours
export const SCORE_DROP_WARNING_THRESHOLD = 5;
export const SCORE_DROP_CRITICAL_THRESHOLD = 10;

const GUARD_STATE_FILE = join(KASTELL_DIR, "guard-state.json");

// ─── Local State Persistence ──────────────────────────────────────────────────

const guardStateEntrySchema = z.object({
  installedAt: z.string(),
  cronExpr: z.string(),
});
const guardStateSchema = z.record(z.string(), guardStateEntrySchema);

export function getGuardStates(): Record<string, GuardStateEntry> {
  if (!existsSync(GUARD_STATE_FILE)) return {};
  try {
    const parsed = guardStateSchema.safeParse(JSON.parse(readFileSync(GUARD_STATE_FILE, "utf-8")));
    return parsed.success ? parsed.data : {};
  } catch (err: unknown) {
    warnIfPermissionError(err, "guard state");
    return {};
  }
}

export function saveGuardState(serverName: string, entry: GuardStateEntry): void {
  mkdirSync(KASTELL_DIR, { recursive: true });
  const states = getGuardStates();
  states[serverName] = entry;
  writeFileSync(GUARD_STATE_FILE, JSON.stringify(states, null, 2), { mode: 0o600 });
}

export function removeGuardState(serverName: string): void {
  mkdirSync(KASTELL_DIR, { recursive: true });
  const states = getGuardStates();
  delete states[serverName];
  writeFileSync(GUARD_STATE_FILE, JSON.stringify(states, null, 2), { mode: 0o600 });
}

// ─── Command Builders ─────────────────────────────────────────────────────────

export function buildDeployGuardScriptCommand(): SshCommand {
  const lines = [
    `cat <<'KASTELL_EOF' > ${GUARD_SCRIPT_PATH}`,
    "#!/bin/bash",
    "# kastell-guard v1.8 — autonomous security monitoring",
    "exec 200>/run/kastell-guard.lock",
    `flock -n 200 || { echo "[kastell-guard] already running, skipping"; exit 0; }`,
    `LOG=${GUARD_LOG_PATH}`,
    "METRICS_DIR=/var/lib/kastell",
    `METRICS_FILE=${GUARD_METRICS_PATH}`,
    "TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "mkdir -p \"$METRICS_DIR\"",
    "log() { echo \"[kastell-guard] $TS $1: $2\" >> \"$LOG\" 2>/dev/null || true; }",
    "# KASTELL_NOTIFY_HOOK — notifications dispatched client-side by kastell CLI (dispatchGuardBreaches).",
    "notify() {",
    "  local level=\"$1\" msg=\"$2\"",
    "  # Client-side dispatch — notifications sent by kastell CLI, not this script",
    "  :",
    "}",
    "# ─── Disk check ──────────────────────────────────────────────────────────",
    "DISK_PCT=$(df / --output=pcent 2>/dev/null | tail -1 | tr -d ' %' || echo \"0\")",
    "if [ \"$DISK_PCT\" -ge 80 ] 2>/dev/null; then",
    "  log \"BREACH\" \"Disk usage ${DISK_PCT}% exceeds 80% threshold\"",
    "  notify \"warn\" \"Disk ${DISK_PCT}% on $(hostname)\"",
    "else",
    "  log \"OK\" \"Disk ${DISK_PCT}%\"",
    "fi",
    "# ─── RAM check ───────────────────────────────────────────────────────────",
    "RAM_USED_PCT=$(free | awk '/^Mem:/{printf \"%.0f\", $3/$2*100}' 2>/dev/null || echo \"0\")",
    "if [ \"$RAM_USED_PCT\" -ge 90 ] 2>/dev/null; then",
    "  log \"BREACH\" \"RAM usage ${RAM_USED_PCT}% exceeds 90% threshold\"",
    "  notify \"warn\" \"RAM ${RAM_USED_PCT}% on $(hostname)\"",
    "else",
    "  log \"OK\" \"RAM ${RAM_USED_PCT}%\"",
    "fi",
    "# ─── CPU check (1-min load avg vs nproc) ─────────────────────────────────",
    "LOAD1=$(awk '{print $1}' /proc/loadavg 2>/dev/null | cut -d. -f1 || echo \"0\")",
    "NCPU=$(nproc 2>/dev/null || echo \"1\")",
    "if [ \"$LOAD1\" -ge \"$NCPU\" ] 2>/dev/null; then",
    "  log \"BREACH\" \"CPU load avg ${LOAD1} >= ${NCPU} (nproc)\"",
    "  notify \"warn\" \"CPU load ${LOAD1} on $(hostname)\"",
    "else",
    "  log \"OK\" \"CPU load ${LOAD1}/${NCPU}\"",
    "fi",
    "# ─── Audit proxy check (GUARD-04) ────────────────────────────────────────",
    "PASSWD_AUTH=$(sshd -T 2>/dev/null | grep -i 'passwordauthentication no' | wc -l || echo \"0\")",
    "PREV_SCORE=$(python3 -c \"import json,sys; d=json.load(open('$METRICS_FILE')); print(d.get('auditScore',0))\" 2>/dev/null || echo \"0\")",
    "if [ \"$PASSWD_AUTH\" -eq 0 ] && [ \"$PREV_SCORE\" -gt 50 ] 2>/dev/null; then",
    "  log \"REGRESSION\" \"Audit score regression detected (passwordauth may have changed)\"",
    "  notify \"warn\" \"Audit regression on $(hostname)\"",
    "fi",
    "# ─── MetricSnapshot write (GUARD-09) ─────────────────────────────────────",
    "cat > \"$METRICS_FILE\" <<METRICS_EOF",
    "{",
    "  \"timestamp\": \"$TS\",",
    "  \"diskPct\": $DISK_PCT,",
    "  \"ramPct\": $RAM_USED_PCT,",
    "  \"cpuLoad1\": $LOAD1,",
    "  \"ncpu\": $NCPU,",
    "  \"auditScore\": 0",
    "}",
    "METRICS_EOF",
    "log \"OK\" \"MetricSnapshot written to $METRICS_FILE\"",
    "log \"OK\" \"Guard run complete\"",
    "KASTELL_EOF",
    `chmod +x ${GUARD_SCRIPT_PATH}`,
  ];
  return raw(lines.join("\n"));
}

export function buildInstallGuardCronCommand(): SshCommand {
  // Defense-in-depth: validate even hardcoded cron expressions
  const fields = GUARD_CRON_EXPR.trim().split(/\s+/);
  if (fields.length !== 5 || fields.some((f) => !/^[0-9*,/-]+$/.test(f))) {
    throw new ValidationError("Invalid guard cron expression", { hint: "Check cron syntax (5 fields: min hour day month weekday)" });
  }
  const entry = `${GUARD_CRON_EXPR} ${GUARD_SCRIPT_PATH} ${GUARD_MARKER}`;
  return raw(`(crontab -l 2>/dev/null | grep -v '${GUARD_MARKER}'; echo '${entry}') | crontab -`);
}

export function buildListGuardCronCommand(): SshCommand {
  return raw(`crontab -l 2>/dev/null | grep '${GUARD_MARKER}' || echo ""`);
}

export function buildRemoveGuardCronCommand(): SshCommand {
  return raw(`(crontab -l 2>/dev/null | grep -v '${GUARD_MARKER}') | crontab -`);
}

export function buildGuardStatusCommand(): SshCommand {
  return raw(
    `crontab -l 2>/dev/null | grep -q '${GUARD_MARKER}' && echo "CRON_ACTIVE" || echo "CRON_INACTIVE"` +
    ` && tail -30 ${GUARD_LOG_PATH} 2>/dev/null || echo "LOG_EMPTY"`,
  );
}

// ─── Orchestrators ────────────────────────────────────────────────────────────

export async function startGuard(ip: string, serverName: string): Promise<GuardStartResult> {
  assertValidIp(ip);

  const deployResult = await sshExec(ip, buildDeployGuardScriptCommand());
  if (deployResult.code !== 0) {
    return {
      success: false,
      error: "Failed to deploy guard script",
      hint: deployResult.stderr || undefined,
    };
  }

  const cronResult = await sshExec(ip, buildInstallGuardCronCommand());
  if (cronResult.code !== 0) {
    return {
      success: false,
      error: "Failed to install guard cron entry",
      hint: cronResult.stderr || undefined,
    };
  }

  saveGuardState(serverName, {
    installedAt: new Date().toISOString(),
    cronExpr: GUARD_CRON_EXPR,
  });

  return { success: true };
}

export async function stopGuard(ip: string, serverName: string): Promise<GuardStopResult> {
  assertValidIp(ip);

  const result = await sshExec(ip, buildRemoveGuardCronCommand());
  if (result.code !== 0) {
    return {
      success: false,
      error: "Failed to remove guard cron entry",
      hint: result.stderr || undefined,
    };
  }

  removeGuardState(serverName);

  return { success: true };
}

// ─── Notification Helpers ─────────────────────────────────────────────────────

function categorizeBreach(breachMsg: string): string {
  if (/disk/i.test(breachMsg)) return "disk";
  if (/ram/i.test(breachMsg)) return "ram";
  if (/cpu|load/i.test(breachMsg)) return "cpu";
  if (/regression/i.test(breachMsg)) return "regression";
  return "unknown";
}

export async function dispatchGuardBreaches(serverName: string, breaches: string[]): Promise<void> {
  for (const breach of breaches) {
    const findingType = categorizeBreach(breach);
    await dispatchWithCooldown(serverName, findingType, `[Kastell Guard] ${serverName}: ${breach}`);
  }
}

// ─── Audit Score Drop Monitoring ──────────────────────────────────────────────

function buildWarningMessage(
  serverName: string,
  newScore: number,
  oldScore: number,
  absDelta: number,
): string {
  return `\u26a0\ufe0f [Kastell] ${serverName}: Audit score dropped ${oldScore}\u2192${newScore} (-${absDelta}) \u2014 WARNING`;
}

async function buildCriticalMessage(
  serverName: string,
  serverIp: string,
  recentFilename: string,
  previousFilename: string,
  newScore: number,
  oldScore: number,
  absDelta: number,
): Promise<string> {
  const header = `\ud83d\udea8 [Kastell] ${serverName}: Audit score dropped ${oldScore}\u2192${newScore} (-${absDelta}) \u2014 CRITICAL`;

  const [recentFull, previousFull] = await Promise.all([
    loadSnapshot(serverIp, recentFilename),
    loadSnapshot(serverIp, previousFilename),
  ]);

  if (!recentFull || !previousFull) return header;

  const prevScoreMap = new Map(
    previousFull.audit.categories.map((c) => [c.name, c.score]),
  );

  const degradedNames = recentFull.audit.categories
    .filter((cat) => {
      const prev = prevScoreMap.get(cat.name);
      return prev !== undefined && cat.score < prev;
    })
    .map((cat) => cat.name);

  if (degradedNames.length === 0) return header;

  const categoryList = degradedNames.map((n) => `\u2022 ${n} \u2193`).join("\n");
  return `${header}\n\nDegraded categories:\n${categoryList}\n\nRun: kastell audit --server ${serverName}`;
}

/**
 * Check for audit score drops between the two most recent local snapshots.
 * Sends a warning notification for 5-9pt drops, critical for 10+pt drops.
 * Skips if fewer than 2 snapshots exist or the most recent is older than 24h.
 */
export async function checkAuditScoreDrop(
  serverName: string,
  serverIp: string,
): Promise<void> {
  const entries = await listSnapshots(serverIp);
  if (entries.length < 2) return;

  const recent = entries[entries.length - 1];
  const previous = entries[entries.length - 2];

  // Staleness guard (D-02): skip if most recent snapshot > 24h old
  const ageMs = Date.now() - new Date(recent.savedAt).getTime();
  if (ageMs > GUARD_AUDIT_STALENESS_MS) return;

  const delta = recent.overallScore - previous.overallScore;
  // Only alert on drops of SCORE_DROP_WARNING_THRESHOLD or more
  if (delta > -SCORE_DROP_WARNING_THRESHOLD) return;

  const absDelta = Math.abs(delta);
  const isCritical = absDelta >= SCORE_DROP_CRITICAL_THRESHOLD;

  const message = isCritical
    ? await buildCriticalMessage(
        serverName, serverIp,
        recent.filename, previous.filename,
        recent.overallScore, previous.overallScore, absDelta,
      )
    : buildWarningMessage(serverName, recent.overallScore, previous.overallScore, absDelta);

  await dispatchWithCooldown(serverName, "audit-score-drop", message);
}

export async function guardStatus(ip: string, serverName: string): Promise<GuardStatusResult> {
  assertValidIp(ip);

  const result = await sshExec(ip, buildGuardStatusCommand());
  if (result.code !== 0) {
    return {
      success: false,
      isActive: false,
      breaches: [],
      logTail: "",
      error: "Failed to check guard status",
    };
  }

  const output = result.stdout;
  const isActive = output.includes("CRON_ACTIVE");

  // Extract log lines (lines after the CRON_ACTIVE/CRON_INACTIVE line)
  const lines = output.split("\n").filter((l) => l.trim().length > 0);
  const logLines = lines.filter((l) => l.includes("[kastell-guard]"));
  const logTail = logLines.join("\n");

  // Parse BREACH lines
  const breaches = logLines
    .filter((l) => l.includes("BREACH:"))
    .map((l) => {
      // Extract the message after the level prefix: "[kastell-guard] <TS> BREACH: <msg>"
      const match = l.match(/\[kastell-guard\]\s+\S+\s+BREACH:\s+(.*)/);
      return match ? match[1].trim() : l;
    });

  // Extract last timestamp from most recent log line
  let lastRunAt: string | undefined;
  for (let i = logLines.length - 1; i >= 0; i--) {
    const match = logLines[i].match(/\[kastell-guard\]\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/);
    if (match) {
      lastRunAt = match[1];
      break;
    }
  }

  // Supplementary local state
  const states = getGuardStates();
  const installedAt = states[serverName]?.installedAt;

  return {
    success: true,
    isActive,
    lastRunAt,
    breaches,
    logTail,
    installedAt,
  };
}
