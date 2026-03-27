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
    ? `Son audit: ${ageHours} saat once (stale -- run: kastell audit ${serverName})`
    : `Son audit: ${ageHours} saat once`;

  const sorted = [...categories].sort(
    (a, b) => (a.score / (a.maxScore || 1)) - (b.score / (b.maxScore || 1)),
  );
  const worst5 = sorted.slice(0, 5);

  const lines = [
    `Audit: ${serverName} -- Skor: ${overallScore}/100`,
    ageLine,
    "",
    "En kotu 5 kategori:",
    ...worst5.map((c) => `  ${c.name}: ${c.score}/${c.maxScore}`),
    "",
    `Detay: kastell audit ${serverName}`,
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
    ? `Guard: aktif (son kontrol: ${guardState.installedAt ?? "bilinmiyor"})`
    : "Guard: kurulu degil";

  let auditLine: string;
  if (latestSnapshot) {
    const ageMs = Date.now() - new Date(latestSnapshot.savedAt).getTime();
    const ageHours = Math.floor(ageMs / 3600000);
    auditLine = `Son audit: skor ${latestSnapshot.overallScore}, ${ageHours} saat once`;
  } else {
    auditLine = "Audit: snapshot yok";
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
    return "Kayitli sunucu yok. Eklemek icin: kastell add";
  }

  const lines = [`Sunucu Durumu (${servers.length} sunucu)`, ""];

  for (const s of servers) {
    const guard = guardStates[s.name] ? "aktif" : "yok";
    const snap = snapshots.get(s.ip);
    const score = snap ? String(snap.overallScore) : "-";
    lines.push(`${s.name} | ${s.platform ?? s.mode} | Guard: ${guard} | Skor: ${score}`);
  }

  return truncate(lines.join("\n"));
}

/**
 * Format doctor findings for /doctor reply (D-03, D-04).
 * Shows cached findings grouped by severity, limited to 5 total.
 */
export function formatDoctorMessage(serverName: string, findings: DoctorFinding[]): string {
  if (findings.length === 0) {
    return `${serverName}: Doctor verisi yok. Calistir: kastell doctor ${serverName}`;
  }

  const sorted = [...findings].sort((a, b) => {
    const order: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    return (order[a.severity] ?? 2) - (order[b.severity] ?? 2);
  });
  const top5 = sorted.slice(0, 5);

  const lines = [
    `Doctor: ${serverName} -- ${findings.length} bulgu`,
    "",
    ...top5.map((f) => `  [${f.severity}] ${f.description}`),
    "",
    `Detay: kastell doctor ${serverName}`,
  ];

  return truncate(lines.join("\n"));
}
