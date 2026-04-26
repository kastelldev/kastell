import pLimit from "p-limit";
import chalk from "chalk";
import { getServers } from "../utils/config.js";
import { createSpinner } from "../utils/logger.js";
import { checkServerHealth } from "./health.js";
import { loadAuditHistory } from "./audit/history.js";
import { listSnapshots, loadSnapshot } from "./audit/snapshot.js";
import type { FleetRow, FleetOptions, ServerRecord } from "../types/index.js";

const VALID_SORT_FIELDS = ["score", "name", "provider"];

export type { FleetRow, FleetOptions };

/**
 * Get the most recent audit score for a server IP from history.
 * Returns null when no history exists.
 */
export function getLatestAuditScore(serverIp: string): number | null {
  const history = loadAuditHistory(serverIp);
  if (history.length === 0) return null;
  const sorted = [...history].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return sorted[0].overallScore;
}

/**
 * Get the lowest-scoring audit category from the latest snapshot for a server.
 * Returns null when no snapshots exist or snapshot has no categories.
 */
export async function getWeakestCategory(
  serverIp: string,
): Promise<{ name: string; score: number } | null> {
  try {
    const snapshots = await listSnapshots(serverIp);
    if (snapshots.length === 0) return null;

    const latest = snapshots[snapshots.length - 1];
    const snap = await loadSnapshot(serverIp, latest.filename);
    if (!snap?.audit?.categories?.length) return null;

    let weakest = snap.audit.categories[0];
    for (const cat of snap.audit.categories) {
      if (cat.score < weakest.score) {
        weakest = cat;
      }
    }
    return { name: weakest.name, score: weakest.score };
  } catch {
    return null;
  }
}

/**
 * Sort FleetRow[] by the given field.
 * - score: descending, null scores last
 * - name/provider: ascending alphabetical
 * - unknown field: falls back to name sort
 */
export function sortRows(rows: FleetRow[], field: string): FleetRow[] {
  const copy = [...rows];
  const effectiveField = VALID_SORT_FIELDS.includes(field) ? field : "name";

  if (effectiveField === "score") {
    return copy.sort((a, b) => {
      if (a.auditScore === null && b.auditScore === null) return 0;
      if (a.auditScore === null) return 1;
      if (b.auditScore === null) return -1;
      return b.auditScore - a.auditScore;
    });
  }

  const key = effectiveField as "name" | "provider";
  return copy.sort((a, b) => a[key].localeCompare(b[key]));
}

/**
 * Probe all registered servers in parallel (p-limit 5) and return fleet rows.
 * Uses Promise.allSettled — rejected probes become OFFLINE rows, never thrown.
 */
export async function runFleet(options: FleetOptions): Promise<FleetRow[]> {
  const servers = getServers();

  if (servers.length === 0) {
    console.log("No servers found. Deploy one with: kastell init");
    return [];
  }

  const spinner = createSpinner(`Probing ${servers.length} server(s)...`);
  spinner.start();

  const limit = pLimit(5);

  const tasks = servers.map((server: ServerRecord) =>
    limit(async () => {
      const health = await checkServerHealth(server);
      const auditScore = getLatestAuditScore(server.ip);
      const weakest = options.categories ? await getWeakestCategory(server.ip) : undefined;
      return { health, auditScore, weakest };
    }),
  );

  const results = await Promise.allSettled(tasks);

  spinner.stop();

  const rows: FleetRow[] = results.map((result, i) => {
    const server = servers[i];

    if (result.status === "rejected") {
      return {
        name: server.name,
        ip: server.ip,
        provider: server.provider,
        status: "OFFLINE",
        auditScore: null,
        responseTime: null,
        errorReason: String(result.reason),
      } satisfies FleetRow;
    }

    const { health, auditScore, weakest } = result.value;

    let status: FleetRow["status"];
    if (health.status === "healthy") {
      status = "ONLINE";
    } else if (health.status === "unhealthy") {
      status = "DEGRADED";
    } else {
      status = "OFFLINE";
    }

    return {
      name: server.name,
      ip: server.ip,
      provider: server.provider,
      status,
      auditScore,
      responseTime: health.responseTime,
      errorReason: null,
      ...(weakest ? { weakestCategory: weakest.name, weakestCategoryScore: weakest.score } : {}),
    } satisfies FleetRow;
  });

  const sorted = sortRows(rows, options.sort ?? "name");

  if (options.json) {
    console.log(JSON.stringify(sorted, null, 2));
    return sorted;
  }

  renderTable(sorted);

  const online = sorted.filter((r) => r.status === "ONLINE").length;
  const degraded = sorted.filter((r) => r.status === "DEGRADED").length;
  const offline = sorted.filter((r) => r.status === "OFFLINE").length;

  const parts: string[] = [];
  if (online > 0) parts.push(chalk.green(`${online} online`));
  if (degraded > 0) parts.push(chalk.yellow(`${degraded} degraded`));
  if (offline > 0) parts.push(chalk.red(`${offline} offline`));
  console.log(parts.join(", "));

  return sorted;
}

function renderTable(rows: FleetRow[]): void {
  const hasCategories = rows.some((r) => r.weakestCategory);

  let header = `${"Name".padEnd(20)} ${"IP".padEnd(16)} ${"Provider".padEnd(14)} ${"Status".padEnd(12)} ${"Score".padEnd(8)} ${"Response".padEnd(10)}`;
  if (hasCategories) header += ` ${"Weakest Category".padEnd(25)}`;

  console.log(header);
  console.log("─".repeat(header.length));

  const scores = rows.map((r) => r.auditScore).filter((s): s is number => s !== null);
  const avg = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

  for (const row of rows) {
    const statusColored = colorStatus(row.status);
    const scoreStr = row.auditScore !== null ? String(row.auditScore) : "--";
    const response = row.responseTime !== null ? `${row.responseTime}ms` : "--";

    let line = `${row.name.padEnd(20)} ${row.ip.padEnd(16)} ${row.provider.padEnd(14)} ${statusColored.padEnd(12)} ${scoreStr.padEnd(8)} ${response.padEnd(10)}`;

    if (hasCategories) {
      const catStr = row.weakestCategory
        ? `${row.weakestCategory} (${row.weakestCategoryScore})`
        : "--";
      line += ` ${catStr.padEnd(25)}`;
    }

    console.log(line);
  }

  if (avg !== null) {
    console.log();
    console.log(chalk.dim(`Fleet average score: ${avg}`));
  }

  console.log();
}

function colorStatus(status: FleetRow["status"]): string {
  if (status === "ONLINE") return chalk.green(status);
  if (status === "DEGRADED") return chalk.yellow(status);
  return chalk.red(status);
}
