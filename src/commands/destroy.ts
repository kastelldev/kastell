import inquirer from "inquirer";
import { resolveServer } from "../utils/serverSelect.js";
import { destroyCloudServer, removeServerRecord } from "../core/manage.js";
import { logger, createSpinner } from "../utils/logger.js";
import { listBackups, cleanupServerBackups } from "../core/backup.js";

async function promptBackupCleanup(serverName: string): Promise<void> {
  const backups = listBackups(serverName);
  if (backups.length === 0) return;

  const { cleanBackups } = await inquirer.prompt([
    {
      type: "confirm",
      name: "cleanBackups",
      message: `Found ${backups.length} backup(s) for "${serverName}". Remove them?`,
      default: false,
    },
  ]);
  if (cleanBackups) {
    const result = cleanupServerBackups(serverName);
    if (result.removed) {
      logger.success("Backups removed.");
    } else {
      logger.warning("Failed to remove backups.");
    }
  } else {
    logger.info("Backups kept. Run 'kastell backup cleanup' later to remove orphans.");
  }
}

function showDryRun(server: { name: string; ip: string; provider: string }): void {
  logger.title("Dry Run: Destroy Server");
  logger.step(`Server: ${server.name} (${server.ip})`);
  logger.step(`Provider: ${server.provider}`);
  console.log();
  logger.step("Step 1: Delete from provider API");
  logger.step("Step 2: Remove from local config");
  console.log();
  logger.info("No changes applied (dry run).");
}

export async function destroyCommand(query?: string, options?: { dryRun?: boolean }): Promise<void> {
  const server = await resolveServer(query, "Select a server to destroy:");
  if (!server) return;

  if (options?.dryRun) {
    showDryRun(server);
    return;
  }

  // First confirmation
  const { confirm } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: `Are you sure you want to destroy "${server.name}" (${server.ip})?`,
      default: false,
    },
  ]);

  if (!confirm) {
    logger.info("Destroy cancelled.");
    return;
  }

  // Second confirmation: type server name
  const { confirmName } = await inquirer.prompt([
    {
      type: "input",
      name: "confirmName",
      message: `Type the server name "${server.name}" to confirm:`,
    },
  ]);

  if (confirmName.trim() !== server.name) {
    logger.error("Server name does not match. Destroy cancelled.");
    return;
  }

  const spinner = createSpinner("Destroying server...");
  spinner.start();

  // Delegate cloud deletion to core
  const result = await destroyCloudServer(server.name);

  if (result.success && result.cloudDeleted) {
    spinner.succeed(`Server "${server.name}" destroyed`);
    logger.success("Server has been removed from your cloud provider and local config.");
    await promptBackupCleanup(server.name);
    return;
  }

  if (result.success && result.hint) {
    spinner.warn(`Server not found on ${server.provider} (may have been deleted manually)`);
    logger.info("Removed from local config.");
    await promptBackupCleanup(server.name);
    return;
  }

  // Cloud deletion failed
  spinner.fail("Failed to destroy server");
  if (result.error) logger.error(result.error);
  if (result.hint) logger.info(result.hint);

  const { removeLocal } = await inquirer.prompt([
    {
      type: "confirm",
      name: "removeLocal",
      message: "Remove this server from local config anyway?",
      default: false,
    },
  ]);
  if (removeLocal) {
    const removeResult = removeServerRecord(server.name);
    if (removeResult.success) {
      logger.success("Removed from local config.");
    }
  }
}
