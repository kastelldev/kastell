import { getServers, findServer } from "../utils/config.js";
import { logger, createSpinner } from "../utils/logger.js";
import { checkServerHealth } from "../core/health.js";
import type { ServerHealthResult } from "../core/health.js";

export { checkServerHealth, type ServerHealthResult } from "../core/health.js";

export async function healthCommand(query?: string): Promise<void> {
  let servers = getServers();

  if (servers.length === 0) {
    logger.info("No servers found. Deploy one with: kastell init");
    return;
  }

  // If query provided, filter to matching server
  if (query) {
    const found = findServer(query);
    if (!found) {
      logger.error(`Server not found: ${query}`);
      return;
    }
    servers = [found];
  }

  const spinner = createSpinner(`Checking health of ${servers.length} server(s)...`);
  spinner.start();

  const results = await Promise.all(servers.map(checkServerHealth));

  spinner.succeed("Health check complete");

  console.log();

  // Table header
  const header = `${"Name".padEnd(20)} ${"IP".padEnd(16)} ${"Status".padEnd(22)} ${"Response".padEnd(10)}`;
  console.log(header);
  console.log("─".repeat(header.length));

  // Table rows
  const hostKeyMismatches: ServerHealthResult[] = [];
  for (const result of results) {
    let statusStr: string;
    let timeStr: string;

    if (result.status === "healthy") {
      statusStr = "✔ healthy";
      timeStr = `${result.responseTime}ms`;
    } else if (result.status === "unhealthy") {
      statusStr = "⚠ unhealthy";
      timeStr = `${result.responseTime}ms`;
    } else if (result.status === "host-key-mismatch") {
      statusStr = "⚠ host key changed";
      timeStr = "n/a";
      hostKeyMismatches.push(result);
    } else {
      statusStr = "✖ unreachable";
      timeStr = "timeout";
    }

    console.log(
      `${result.server.name.padEnd(20)} ${result.server.ip.padEnd(16)} ${statusStr.padEnd(22)} ${timeStr.padEnd(10)}`,
    );
  }

  console.log();

  // Show actionable hint for host key mismatches
  if (hostKeyMismatches.length > 0) {
    for (const r of hostKeyMismatches) {
      logger.warning(
        `Run: ssh-keygen -R ${r.server.ip} to fix host key mismatch (or it will auto-fix on next SSH operation)`,
      );
    }
    console.log();
  }

  const healthy = results.filter((r) => r.status === "healthy").length;
  const unhealthy = results.filter((r) => r.status === "unhealthy").length;
  const unreachable = results.filter((r) => r.status === "unreachable").length;
  const hostKeyCount = hostKeyMismatches.length;

  if (unreachable > 0 || unhealthy > 0 || hostKeyCount > 0) {
    const parts: string[] = [];
    if (healthy > 0) parts.push(`${healthy} healthy`);
    if (unhealthy > 0) parts.push(`${unhealthy} unhealthy`);
    if (unreachable > 0) parts.push(`${unreachable} unreachable`);
    if (hostKeyCount > 0) parts.push(`${hostKeyCount} host key changed`);
    logger.warning(parts.join(", "));
  } else {
    logger.success(`All ${healthy} server(s) are healthy`);
  }
}
