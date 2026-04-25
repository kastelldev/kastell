/**
 * Doctor core module — proactive server health analysis.
 *
 * All 7 check functions are pure (no I/O). The orchestrator runServerDoctor
 * handles I/O (SSH, file cache) and delegates to the pure functions.
 */

import { readFileSync, existsSync, renameSync } from "fs";
import { join } from "path";
import { KASTELL_DIR } from "../utils/paths.js";
import { secureWriteFileSync, secureMkdirSync } from "../utils/secureWrite.js";
import { assertValidIp, sshExec } from "../utils/ssh.js";
import { raw } from "../utils/sshCommand.js";
import { MS_PER_DAY } from "../utils/dates.js";
import { loadAuditHistory } from "./audit/history.js";
import type { MetricSnapshot, KastellResult } from "../types/index.js";
import type { AuditHistoryEntry } from "./audit/types.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DoctorSeverity = "critical" | "warning" | "info";

export const DOCTOR_SEVERITY_WEIGHTS: Record<DoctorSeverity, number> = {
  critical: 10,
  warning: 5,
  info: 1,
};

export interface DoctorFinding {
  id: string;
  severity: DoctorSeverity;
  description: string;
  command: string;
  fixCommand?: string;
  weight: number;
}

export function computeDoctorScore(findings: DoctorFinding[]): number {
  if (findings.length === 0) return 100;
  // 7 checks × max weight 10 = 70 total possible penalty
  const maxPenalty = 70;
  const totalPenalty = findings.reduce((sum, f) => sum + f.weight, 0);
  return Math.max(0, Math.round(100 - (totalPenalty / maxPenalty) * 100));
}

export interface DoctorResult {
  serverName: string;
  serverIp: string;
  findings: DoctorFinding[];
  ranAt: string;
  usedFreshData: boolean;
  score: number;
}

// ─── Metrics cache helpers ────────────────────────────────────────────────────

/** Path to the local per-server metrics history file */
export function metricsHistoryPath(serverIp: string): string {
  return join(KASTELL_DIR, `doctor-metrics-${serverIp.replace(/\./g, "-")}.json`);
}

/** Load cached MetricSnapshot history for a server. Returns [] on missing/corrupt file. */
export function loadMetricsHistory(serverIp: string): MetricSnapshot[] {
  try {
    const filePath = metricsHistoryPath(serverIp);
    if (!existsSync(filePath)) return [];
    const data = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) return [];
    return parsed as MetricSnapshot[];
  } catch {
    return [];
  }
}

/** Append a new snapshot to the local history and persist atomically. */
export function saveMetricsHistory(serverIp: string, snapshots: MetricSnapshot[]): void {
  const filePath = metricsHistoryPath(serverIp);
  const dir = join(filePath, "..");
  if (!existsSync(dir)) {
    secureMkdirSync(dir);
  }
  const tmpFile = filePath + ".tmp";
  secureWriteFileSync(tmpFile, JSON.stringify(snapshots, null, 2), { encoding: "utf-8" });
  renameSync(tmpFile, filePath);
}

// ─── Pure check functions ─────────────────────────────────────────────────────

/**
 * DOC-02: Disk trend — linear extrapolation from 2+ MetricSnapshot data points.
 * Projects when root filesystem will reach 95% full.
 */
export function checkDiskTrend(
  snapshots: MetricSnapshot[],
  serverName: string,
): DoctorFinding | null {
  if (snapshots.length < 2) return null;

  const sorted = [...snapshots].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  const dtHours = (Date.parse(last.timestamp) - Date.parse(first.timestamp)) / 3_600_000;
  if (dtHours <= 0) return null;

  const slope = (last.diskPct - first.diskPct) / dtHours; // %/hour
  if (slope <= 0) return null;

  const hoursToFull = (95 - last.diskPct) / slope;
  const daysToFull = hoursToFull / 24;

  if (daysToFull > 30) return null;

  const daysRounded = Math.round(daysToFull);
  let severity: DoctorSeverity;
  if (daysToFull < 3) {
    severity = "critical";
  } else if (daysToFull < 14) {
    severity = "warning";
  } else {
    severity = "info";
  }

  return {
    id: "DISK_TREND",
    severity,
    description: `Disk projected to reach 95% full in ~${daysRounded} day${daysRounded === 1 ? "" : "s"} at current growth rate`,
    command: `df -h / && kastell audit ${serverName}`,
    weight: DOCTOR_SEVERITY_WEIGHTS[severity],
  };
}

/**
 * DOC-03: High swap usage.
 * Input: output of `free | awk '/Swap:/{if($2>0) printf "%.0f", $3/$2*100; else print "0"}'`
 */
export function checkSwapUsage(swapOutput: string): DoctorFinding | null {
  const trimmed = swapOutput.trim();
  if (!trimmed) return null;

  const pct = parseInt(trimmed, 10);
  if (isNaN(pct)) return null;
  if (pct <= 50) return null;

  const severity: DoctorSeverity = pct > 80 ? "critical" : "warning";

  return {
    id: "HIGH_SWAP",
    severity,
    description: `Swap usage is at ${pct}% — high swap can indicate memory pressure`,
    command: "free -h",
    weight: DOCTOR_SEVERITY_WEIGHTS[severity],
  };
}

/**
 * DOC-03: Stale packages — count of upgradable packages from apt.
 * Input: output of `apt list --upgradable 2>/dev/null` (subtract 1 for header line).
 */
export function checkStalePackages(aptOutput: string): DoctorFinding | null {
  const trimmed = aptOutput.trim();
  if (!trimmed) return null;

  const lines = trimmed.split("\n").filter((l) => l.trim().length > 0);
  // Subtract 1 for the "Listing..." header line
  const count = Math.max(0, lines.length - 1);

  if (count <= 10) return null;

  const severity: DoctorSeverity = count > 50 ? "critical" : "warning";

  return {
    id: "STALE_PACKAGES",
    severity,
    description: `${count} package${count === 1 ? "" : "s"} available for upgrade — keep packages updated to reduce security exposure`,
    command: "sudo apt update && sudo apt upgrade",
    fixCommand: "apt-upgrade",
    weight: DOCTOR_SEVERITY_WEIGHTS[severity],
  };
}

/**
 * DOC-03: High fail2ban ban rate — total bans across all jails.
 * Input: output of combined fail2ban-client status pipeline.
 */
export function checkFail2banBanRate(fail2banOutput: string): DoctorFinding | null {
  const trimmed = fail2banOutput.trim();
  if (!trimmed) return null;

  const total = parseInt(trimmed, 10);
  if (isNaN(total)) return null;
  if (total <= 100) return null;

  return {
    id: "HIGH_BAN_RATE",
    severity: "warning",
    description: `fail2ban has recorded ${total} total bans — review attack patterns and consider additional hardening`,
    command: "sudo fail2ban-client status",
    weight: DOCTOR_SEVERITY_WEIGHTS["warning"],
  };
}

/**
 * DOC-04: Audit regression streak — 2+ consecutive audit score drops.
 */
export function checkAuditRegressionStreak(
  history: AuditHistoryEntry[],
  serverName: string,
): DoctorFinding | null {
  if (history.length < 2) return null;

  const sorted = [...history].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  let maxStreak = 0;
  let currentStreak = 0;

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].overallScore < sorted[i - 1].overallScore) {
      currentStreak++;
      if (currentStreak > maxStreak) maxStreak = currentStreak;
    } else {
      currentStreak = 0;
    }
  }

  // maxStreak counts transitions — 2 consecutive drops means maxStreak >= 2
  if (maxStreak < 2) return null;

  return {
    id: "AUDIT_REGRESSION",
    severity: "warning",
    description: `Audit score has declined in ${maxStreak + 1} consecutive runs — security posture may be degrading`,
    command: `kastell audit ${serverName}`,
    weight: DOCTOR_SEVERITY_WEIGHTS["warning"],
  };
}

/**
 * DOC-04: Backup age — days since last kastell backup log entry.
 * Input: output of `tail -1 /var/log/kastell-backup.log 2>/dev/null` (ISO timestamp).
 */
export function checkBackupAge(
  backupLogOutput: string,
  serverName: string,
): DoctorFinding | null {
  const trimmed = backupLogOutput.trim();
  if (!trimmed) return null;

  const lastTs = Date.parse(trimmed);
  if (isNaN(lastTs)) return null;

  const daysOld = (Date.now() - lastTs) / MS_PER_DAY;
  if (daysOld <= 7) return null;

  const severity: DoctorSeverity = daysOld > 30 ? "critical" : "warning";
  const daysRounded = Math.round(daysOld);

  return {
    id: "OLD_BACKUP",
    severity,
    description: `Last backup was ${daysRounded} day${daysRounded === 1 ? "" : "s"} ago — consider running a backup soon`,
    command: `kastell backup ${serverName}`,
    weight: DOCTOR_SEVERITY_WEIGHTS[severity],
  };
}

/**
 * DOC-05: Docker reclaimable disk space.
 * Input: output of `docker system df --format '{{json .}}'` (one JSON object per line).
 * Parses the Reclaimable field from each line and sums total GB.
 */
export function checkDockerDisk(dockerDfOutput: string): DoctorFinding | null {
  const trimmed = dockerDfOutput.trim();
  if (!trimmed) return null;

  let totalGB = 0;

  for (const line of trimmed.split("\n")) {
    const l = line.trim();
    if (!l) continue;
    try {
      const obj = JSON.parse(l) as Record<string, string>;
      const reclaimable = obj["Reclaimable"] ?? "";
      totalGB += parseReclaimableGB(reclaimable);
    } catch {
      // ignore unparseable lines
    }
  }

  if (totalGB <= 5) return null;

  const severity: DoctorSeverity = totalGB > 20 ? "critical" : "warning";
  const gbDisplay = totalGB.toFixed(1);

  return {
    id: "DOCKER_DISK",
    severity,
    description: `Docker has ~${gbDisplay} GB of reclaimable disk space`,
    command: "docker system prune -a",
    weight: DOCTOR_SEVERITY_WEIGHTS[severity],
  };
}

/** Parse a reclaimable string like "8GB (30%)" or "500MB (5%)" into gigabytes. */
function parseReclaimableGB(reclaimable: string): number {
  const match = reclaimable.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)/i);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  switch (unit) {
    case "TB":
      return value * 1024;
    case "GB":
      return value;
    case "MB":
      return value / 1024;
    case "KB":
      return value / (1024 * 1024);
    case "B":
      return value / (1024 * 1024 * 1024);
    default:
      return 0;
  }
}

// ─── Severity sort order ──────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<DoctorSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

// ─── SSH commands for --fresh mode ────────────────────────────────────────────

const CMD_METRICS = "cat /var/lib/kastell/metrics.json 2>/dev/null || echo {}";
const CMD_SWAP =
  "free | awk '/Swap:/{if($2>0) printf \"%.0f\", $3/$2*100; else print \"0\"}'";
const CMD_APT = "apt list --upgradable 2>/dev/null";
const CMD_FAIL2BAN =
  "fail2ban-client status 2>/dev/null | grep -oP 'Jail list:\\s*\\K.*' | tr ',' '\\n' | xargs -I{} fail2ban-client status {} 2>/dev/null | grep 'Total banned' | awk '{sum+=$NF} END {print sum+0}'";
const CMD_BACKUP_LOG = "tail -1 /var/log/kastell-backup.log 2>/dev/null";
const CMD_DOCKER =
  "command -v docker &>/dev/null && docker system df --format '{{json .}}' 2>/dev/null || echo \"\"";

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * DOC-01: Run proactive server health analysis.
 *
 * Default (fresh=false): reads cached metrics + local audit history, no SSH.
 * With fresh=true: SSHes to collect a live MetricSnapshot and live probe data.
 */
export async function runServerDoctor(
  ip: string,
  serverName: string,
  options: { fresh?: boolean },
): Promise<KastellResult<DoctorResult>> {
  try {
    assertValidIp(ip);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const fresh = options.fresh ?? false;

  // Load cached metrics history
  let snapshots = loadMetricsHistory(ip);

  // SSH probe data (only available when fresh=true)
  let swapOutput: string | undefined;
  let aptOutput: string | undefined;
  let fail2banOutput: string | undefined;
  let backupLogOutput: string | undefined;
  let dockerDfOutput: string | undefined;

  if (fresh) {
    // Fetch current MetricSnapshot from VPS and append to local cache
    const metricsResult = await sshExec(ip, raw(CMD_METRICS), { useStdin: true });
    if (metricsResult.code === 0 && metricsResult.stdout.trim()) {
      try {
        const parsed = JSON.parse(metricsResult.stdout) as MetricSnapshot;
        if (parsed && typeof parsed.diskPct === "number") {
          snapshots = [...snapshots, parsed];
          saveMetricsHistory(ip, snapshots);
        }
      } catch {
        // ignore parse failure
      }
    }

    // Collect live probe data
    const [swapRes, aptRes, fail2banRes, backupRes, dockerRes] = await Promise.all([
      sshExec(ip, raw(CMD_SWAP)),
      sshExec(ip, raw(CMD_APT)),
      sshExec(ip, raw(CMD_FAIL2BAN)),
      sshExec(ip, raw(CMD_BACKUP_LOG)),
      sshExec(ip, raw(CMD_DOCKER)),
    ]);

    swapOutput = swapRes.stdout;
    aptOutput = aptRes.stdout;
    fail2banOutput = fail2banRes.stdout;
    backupLogOutput = backupRes.stdout;
    dockerDfOutput = dockerRes.stdout;
  }

  // Load audit history (always local)
  const auditHistory = loadAuditHistory(ip);

  // Run all check functions
  const rawFindings: (DoctorFinding | null)[] = [
    checkDiskTrend(snapshots, serverName),
    swapOutput !== undefined ? checkSwapUsage(swapOutput) : null,
    aptOutput !== undefined ? checkStalePackages(aptOutput) : null,
    fail2banOutput !== undefined ? checkFail2banBanRate(fail2banOutput) : null,
    checkAuditRegressionStreak(auditHistory, serverName),
    backupLogOutput !== undefined ? checkBackupAge(backupLogOutput, serverName) : null,
    dockerDfOutput !== undefined ? checkDockerDisk(dockerDfOutput) : null,
  ];

  const findings = (rawFindings.filter(Boolean) as DoctorFinding[]).sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  const score = computeDoctorScore(findings);

  return {
    success: true,
    data: {
      serverName,
      serverIp: ip,
      findings,
      ranAt: new Date().toISOString(),
      usedFreshData: fresh,
      score,
    },
  };
}
