import { resolveServer } from "../utils/serverSelect.js";
import { checkSshAvailable, sshExec } from "../utils/ssh.js";
import { logger, createSpinner } from "../utils/logger.js";
import { mapSshError, classifyError } from "../utils/errorMapper.js";
import { buildMonitorCommand, parseMetrics } from "../core/logs.js";
import type { SystemMetrics } from "../core/logs.js";

export { parseMetrics, type SystemMetrics };

export async function monitorCommand(
  query?: string,
  options?: { containers?: boolean },
): Promise<void> {
  if (!checkSshAvailable()) {
    logger.error("SSH client not found. Please install OpenSSH.");
    return;
  }

  const server = await resolveServer(query, "Select a server to monitor:");
  if (!server) return;

  const spinner = createSpinner(`Fetching metrics from ${server.name}...`);
  spinner.start();

  try {
    // Gather all metrics in a single SSH command
    const command = buildMonitorCommand(options?.containers ?? false);

    const result = await sshExec(server.ip, command);

    if (result.code !== 0) {
      spinner.fail("Failed to fetch metrics");
      if (result.stderr) logger.error(result.stderr);
      return;
    }

    spinner.succeed(`Metrics for ${server.name} (${server.ip})`);

    const metrics = parseMetrics(result.stdout);

    console.log();
    logger.info(`CPU Usage:    ${metrics.cpu}`);
    logger.info(`RAM Usage:    ${metrics.ramUsed} / ${metrics.ramTotal}`);
    logger.info(
      `Disk Usage:   ${metrics.diskUsed} / ${metrics.diskTotal} (${metrics.diskPercent})`,
    );

    if (options?.containers) {
      const sections = result.stdout.split("---SEPARATOR---");
      if (sections.length >= 4) {
        console.log();
        logger.title("Docker Containers");
        console.log(sections[3].trim());
      }
    }
  } catch (error: unknown) {
    spinner.fail("Failed to fetch metrics");
    const classified = classifyError(error);
    logger.error(classified.message);
    if (classified.hint) logger.info(classified.hint);
    if (!classified.isTyped) {
      const hint = mapSshError(error, server.ip);
      if (hint) logger.info(hint);
    }
  }
}
