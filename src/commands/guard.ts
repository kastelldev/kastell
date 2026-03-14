import chalk from "chalk";
import inquirer from "inquirer";
import { resolveServer } from "../utils/serverSelect.js";
import { checkSshAvailable } from "../utils/ssh.js";
import { logger, createSpinner } from "../utils/logger.js";
import { startGuard, stopGuard, guardStatus, dispatchGuardBreaches } from "../core/guard.js";

export async function guardCommand(
  action: "start" | "status" | "stop",
  query: string | undefined,
  options: { force?: boolean },
): Promise<void> {
  if (action === "start") {
    if (!checkSshAvailable()) {
      logger.error("SSH client not found. Please install OpenSSH.");
      return;
    }

    const server = await resolveServer(query, "Select a server to start guard on:");
    if (!server) return;

    if (!options.force) {
      const { confirm } = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirm",
          message: `Install guard daemon on ${server.name} (${server.ip})? Checks disk, RAM, CPU every 5 minutes.`,
          default: false,
        },
      ]);
      if (!confirm) {
        logger.info("Guard install cancelled.");
        return;
      }
    }

    const spinner = createSpinner("Installing guard daemon...");
    spinner.start();

    const result = await startGuard(server.ip, server.name);

    spinner.stop();

    if (result.success) {
      logger.success(`Guard daemon installed on ${server.name}. Runs every 5 minutes.`);
    } else {
      logger.error(result.error ?? "Failed to install guard daemon.");
      if (result.hint) {
        logger.info(result.hint);
      }
    }
  } else if (action === "stop") {
    if (!checkSshAvailable()) {
      logger.error("SSH client not found. Please install OpenSSH.");
      return;
    }

    const server = await resolveServer(query, "Select a server to stop guard on:");
    if (!server) return;

    if (!options.force) {
      const { confirm } = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirm",
          message: `Remove guard daemon from ${server.name} (${server.ip})?`,
          default: false,
        },
      ]);
      if (!confirm) {
        logger.info("Guard removal cancelled.");
        return;
      }
    }

    const spinner = createSpinner("Removing guard daemon...");
    spinner.start();

    const result = await stopGuard(server.ip, server.name);

    spinner.stop();

    if (result.success) {
      logger.success(`Guard daemon removed from ${server.name}.`);
    } else {
      logger.error(result.error ?? "Failed to remove guard daemon.");
      if (result.hint) {
        logger.info(result.hint);
      }
    }
  } else {
    // status — no checkSshAvailable pre-flight
    const server = await resolveServer(query, "Select a server to check guard status:");
    if (!server) return;

    const spinner = createSpinner("Checking guard status...");
    spinner.start();

    const result = await guardStatus(server.ip, server.name);

    spinner.stop();

    if (!result.success) {
      logger.error(result.error ?? "Failed to check guard status.");
      return;
    }

    if (result.isActive) {
      logger.info(chalk.green("Guard: ACTIVE"));
    } else {
      logger.info(chalk.red("Guard: INACTIVE"));
    }

    if (result.isActive && result.lastRunAt) {
      logger.info(`Last check: ${result.lastRunAt}`);
    }

    if (result.isActive && result.installedAt) {
      logger.info(`Installed: ${result.installedAt}`);
    }

    if (result.breaches.length > 0) {
      logger.info("Active breaches:");
      for (const breach of result.breaches) {
        logger.info(`  ${breach}`);
      }
      await dispatchGuardBreaches(server.name, result.breaches);
    }

    if (result.logTail) {
      logger.info("Recent log:");
      logger.info(result.logTail);
    }
  }
}
