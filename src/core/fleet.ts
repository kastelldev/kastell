import pLimit from "p-limit";
import chalk from "chalk";
import { getServers } from "../utils/config.js";
import { createSpinner } from "../utils/logger.js";
import { checkServerHealth } from "./health.js";
import { loadAuditHistory } from "./audit/history.js";
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
      return { health, auditScore };
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

    const { health, auditScore } = result.value;

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
  const header = `${"Name".padEnd(20)} ${"IP".padEnd(16)} ${"Provider".padEnd(14)} ${"Status".padEnd(12)} ${"Score".padEnd(8)} ${"Response".padEnd(10)}`;
  console.log(header);
  console.log("─".repeat(header.length));

  for (const row of rows) {
    const statusColored = colorStatus(row.status);
    const score = row.auditScore !== null ? String(row.auditScore) : "--";
    const response = row.responseTime !== null ? `${row.responseTime}ms` : "--";

    console.log(
      `${row.name.padEnd(20)} ${row.ip.padEnd(16)} ${row.provider.padEnd(14)} ${statusColored.padEnd(12)} ${score.padEnd(8)} ${response.padEnd(10)}`,
    );
  }

  console.log();
}

function colorStatus(status: FleetRow["status"]): string {
  if (status === "ONLINE") return chalk.green(status);
  if (status === "DEGRADED") return chalk.yellow(status);
  return chalk.red(status);
}
