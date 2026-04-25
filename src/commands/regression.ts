import chalk from "chalk";
import { loadBaseline, listBaselines, formatBaselineStatus, deleteBaseline, formatRelativeTime } from "../core/audit/regression.js";
import { logger } from "../utils/logger.js";
import { confirmOrCancel } from "../utils/prompts.js";

export async function regressionStatusCommand(server?: string): Promise<void> {
  if (server) {
    const baseline = loadBaseline(server);
    if (!baseline) {
      logger.info(`No baseline found for ${server}`);
      return;
    }
    console.log(formatBaselineStatus(baseline));
    return;
  }

  const baselines = listBaselines();
  if (baselines.length === 0) {
    logger.info("No baselines found. Run an audit to create one.");
    return;
  }

  const header = `${"Server".padEnd(20)} ${"Best Score".padEnd(12)} ${"Checks".padEnd(8)} Last Updated`;
  console.log(chalk.bold(header));

  for (const b of baselines) {
    console.log(
      `${b.serverIp.padEnd(20)} ${String(b.bestScore).padEnd(12)} ${String(b.passedChecks.length).padEnd(8)} ${formatRelativeTime(b.lastUpdated)}`
    );
  }
}

export async function regressionResetCommand(server: string, options: { force?: boolean }): Promise<void> {
  const baseline = loadBaseline(server);
  if (!baseline) {
    logger.info(`No baseline found for ${server}`);
    return;
  }

  const proceed = await confirmOrCancel(
    `Delete baseline for ${server}? (Best Score: ${baseline.bestScore}, ${baseline.passedChecks.length} checks)`,
    !!options.force,
    "Use --force to reset baseline in non-interactive mode.",
  );
  if (!proceed) {
    logger.info("Reset cancelled.");
    return;
  }

  deleteBaseline(server);
  logger.info(`Baseline for ${server} has been deleted.`);
}