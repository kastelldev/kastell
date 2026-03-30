import { Command } from "commander";
import chalk from "chalk";
import { resolveServer } from "../utils/serverSelect.js";
import { logger } from "../utils/logger.js";
import { validateCronExpr } from "../core/backupSchedule.js";
import {
  installLocalCron,
  removeLocalCron,
  listLocalCron,
  type ScheduleType,
} from "../core/scheduleManager.js";

export function scheduleCommand(): Command {
  const schedule = new Command("schedule").description(
    "Schedule automatic fix and audit runs (local cron + SSH)",
  );

  // ─── fix subcommand ───────────────────────────────────────────────────────────
  schedule
    .command("fix")
    .description("Install a local cron schedule for kastell fix --safe runs")
    .option("--server <name>", "Server name to schedule fixes for")
    .option("--cron <expr>", "Cron expression (e.g. '0 3 * * *' for 3am daily)")
    .action(async (opts: { server?: string; cron?: string }) => {
      if (!opts.cron) {
        logger.error("Cron expression required. Use --cron '0 3 * * *'");
        return;
      }

      const validation = validateCronExpr(opts.cron);
      if (!validation.valid) {
        logger.error(`Invalid cron expression: ${validation.error}`);
        return;
      }

      const server = await resolveServer(opts.server, "Select a server to schedule fixes for:");
      if (!server) return;

      const result = installLocalCron(opts.cron, server.name, "fix");

      if (!result.success) {
        logger.error(`Failed to install fix schedule: ${result.error}`);
        return;
      }

      if (result.windowsFallback) {
        console.log(chalk.yellow("Windows detected. Schedule saved. Run this command with Task Scheduler:"));
        console.log(chalk.white(`  ${result.command}`));
      } else {
        logger.success(`Fix schedule installed for ${server.name}: ${opts.cron}`);
      }

      logger.info("Note: Your machine must be running at the scheduled time for the fix to execute.");
    });

  // ─── audit subcommand ─────────────────────────────────────────────────────────
  schedule
    .command("audit")
    .description("Install a local cron schedule for kastell audit runs")
    .option("--server <name>", "Server name to schedule audits for")
    .option("--cron <expr>", "Cron expression (e.g. '0 6 * * 1' for 6am every Monday)")
    .action(async (opts: { server?: string; cron?: string }) => {
      if (!opts.cron) {
        logger.error("Cron expression required. Use --cron '0 6 * * 1'");
        return;
      }

      const validation = validateCronExpr(opts.cron);
      if (!validation.valid) {
        logger.error(`Invalid cron expression: ${validation.error}`);
        return;
      }

      const server = await resolveServer(opts.server, "Select a server to schedule audits for:");
      if (!server) return;

      const result = installLocalCron(opts.cron, server.name, "audit");

      if (!result.success) {
        logger.error(`Failed to install audit schedule: ${result.error}`);
        return;
      }

      if (result.windowsFallback) {
        console.log(chalk.yellow("Windows detected. Schedule saved. Run this command with Task Scheduler:"));
        console.log(chalk.white(`  ${result.command}`));
      } else {
        logger.success(`Audit schedule installed for ${server.name}: ${opts.cron}`);
      }

      logger.info("Note: Your machine must be running at the scheduled time for the fix to execute.");
    });

  // ─── list subcommand ──────────────────────────────────────────────────────────
  schedule
    .command("list")
    .description("List all installed fix/audit schedules")
    .option("--server <name>", "Filter by server name")
    .action((opts: { server?: string }) => {
      const entries = listLocalCron(opts.server);

      if (entries.length === 0) {
        logger.info("No schedules found.");
        return;
      }

      const headerServer = chalk.bold("Server".padEnd(24));
      const headerType = chalk.bold("Type".padEnd(8));
      const headerCron = chalk.bold("Cron Expression");
      console.log(`  ${headerServer} ${headerType} ${headerCron}`);
      console.log(`  ${"─".repeat(56)}`);

      for (const entry of entries) {
        const typeColor = entry.type === "fix" ? chalk.cyan : chalk.magenta;
        console.log(
          `  ${entry.server.padEnd(24)} ${typeColor(entry.type.padEnd(8))} ${entry.cronExpr}`,
        );
      }
    });

  // ─── remove subcommand ────────────────────────────────────────────────────────
  schedule
    .command("remove")
    .description("Remove an installed fix or audit schedule")
    .option("--server <name>", "Server name to remove schedule for")
    .option("--type <type>", "Schedule type to remove: fix or audit")
    .action(async (opts: { server?: string; type?: string }) => {
      if (!opts.type) {
        logger.error("Type required (fix or audit). Use --type fix");
        return;
      }

      if (opts.type !== "fix" && opts.type !== "audit") {
        logger.error(`Invalid type: ${opts.type}. Must be 'fix' or 'audit'`);
        return;
      }

      const server = await resolveServer(opts.server, "Select a server to remove schedule for:");
      if (!server) return;

      const result = removeLocalCron(server.name, opts.type as ScheduleType);

      if (!result.success) {
        logger.error(`Failed to remove ${opts.type} schedule: ${result.error}`);
        return;
      }

      logger.success(`Removed ${opts.type} schedule for ${server.name}`);
    });

  return schedule;
}
