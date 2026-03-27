/**
 * Telegram message formatters for bot commands.
 * Each function produces a plain-text message within Telegram's 4096 char limit.
 * All data comes from local snapshots/config — zero SSH (D-07).
 */

import type { SnapshotFile, SnapshotListEntry } from "../audit/types.js";
import type { DoctorFinding } from "../doctor.js";
import type { ServerRecord } from "../../types/index.js";
import type { GuardStateEntry } from "../guard.js";

const MAX_MESSAGE_LENGTH = 4000;

/** Truncate text to fit Telegram's 4096 char limit (with safety margin). */
function truncate(text: string): string {
  if (text.length <= MAX_MESSAGE_LENGTH) return text;
  return text.slice(0, MAX_MESSAGE_LENGTH) + "\n...";
}

/**
 * Format audit snapshot for /audit reply (D-03, D-04, D-08).
 * Shows overall score, age, worst 5 categories, and CLI hint.
 */
export function formatAuditMessage(snapshot: SnapshotFile, ageHours: number): string {
  const { overallScore, categories, serverName } = snapshot.audit;

  const ageLine = ageHours > 24
    ? `Last audit: ${ageHours}h ago (stale -- run: kastell audit ${serverName})`
    : `Last audit: ${ageHours}h ago`;

  const sorted = [...categories].sort(
    (a, b) => (a.score / (a.maxScore || 1)) - (b.score / (b.maxScore || 1)),
  );
  const worst5 = sorted.slice(0, 5);

  const lines = [
    `Audit: ${serverName} -- Score: ${overallScore}/100`,
    ageLine,
    "",
    "Worst 5 categories:",
    ...worst5.map((c) => `  ${c.name}: ${c.score}/${c.maxScore}`),
    "",
    `Details: kastell audit ${serverName}`,
  ];

  return truncate(lines.join("\n"));
}

/**
 * Format server status for /status reply (D-04).
 * Shows locally available data: name, IP, platform, guard state, latest audit snapshot.
 */
export function formatStatusMessage(
  server: ServerRecord,
  guardState: GuardStateEntry | undefined,
  latestSnapshot: SnapshotListEntry | undefined,
): string {
  const guardLine = guardState
    ? `Guard: active (last check: ${guardState.installedAt ?? "unknown"})`
    : "Guard: not installed";

  let auditLine: string;
  if (latestSnapshot) {
    const ageMs = Date.now() - new Date(latestSnapshot.savedAt).getTime();
    const ageHours = Math.floor(ageMs / 3600000);
    auditLine = `Last audit: score ${latestSnapshot.overallScore}, ${ageHours}h ago`;
  } else {
    auditLine = "Audit: no snapshot";
  }

  const lines = [
    `${server.name} (${server.ip})`,
    `Platform: ${server.platform ?? server.mode}`,
    guardLine,
    auditLine,
  ];

  return truncate(lines.join("\n"));
}

/**
 * Format fleet health overview for /health reply (D-04).
 * Shows all servers in a compact table format.
 */
export function formatHealthMessage(
  servers: ServerRecord[],
  guardStates: Record<string, GuardStateEntry>,
  snapshots: Map<string, SnapshotListEntry>,
): string {
  if (servers.length === 0) {
    return "No servers registered. Add one with: kastell add";
  }

  const lines = [`Server Status (${servers.length} servers)`, ""];

  for (const s of servers) {
    const guard = guardStates[s.name] ? "active" : "none";
    const snap = snapshots.get(s.ip);
    const score = snap ? String(snap.overallScore) : "-";
    lines.push(`${s.name} | ${s.platform ?? s.mode} | Guard: ${guard} | Score: ${score}`);
  }

  return truncate(lines.join("\n"));
}

/**
 * Format doctor findings for /doctor reply (D-03, D-04).
 * Shows cached findings grouped by severity, limited to 5 total.
 */
export function formatDoctorMessage(serverName: string, findings: DoctorFinding[]): string {
  if (findings.length === 0) {
    return `${serverName}: No doctor data. Run: kastell doctor ${serverName}`;
  }

  const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  const sorted = [...findings].sort(
    (a, b) => (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2),
  );
  const top5 = sorted.slice(0, 5);

  const lines = [
    `Doctor: ${serverName} -- ${findings.length} finding(s)`,
    "",
    ...top5.map((f) => `  [${f.severity}] ${f.description}`),
    "",
    `Details: kastell doctor ${serverName}`,
  ];

  return truncate(lines.join("\n"));
}
