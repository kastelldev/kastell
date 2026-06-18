import inquirer from "inquirer";
import { resolveServer } from "../utils/serverSelect.js";
import { destroyCloudServer, removeServerRecord } from "../core/manage.js";
import { logger, createSpinner } from "../utils/logger.js";
import { listBackups, cleanupServerBackups } from "../core/backup.js";
import { confirmOrCancel, enforceOrCancel, confirmTypedNameInTty } from "../utils/prompts.js";

async function promptBackupCleanup(serverName: string, force?: boolean): Promise<void> {
  const backups = listBackups(serverName);
  if (backups.length === 0) return;

  if (force) {
    logger.info(`Skipping backup cleanup for "${serverName}" (${backups.length} backup(s) kept).`);
    return;
  }

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

export async function destroyCommand(query?: string, options?: { dryRun?: boolean; force?: boolean }): Promise<void> {
  const server = await resolveServer(query, "Select a server to destroy:");
  if (!server) return;

  if (options?.dryRun) {
    showDryRun(server);
    return;
  }

  if (!options?.force) {
    // First confirmation — confirmOrCancel handles non-TTY refusal + exit code 1
    const decision = await confirmOrCancel(
      `Are you sure you want to destroy "${server.name}" (${server.ip})?`,
      false,
      "Use --force to destroy in non-interactive mode.",
    );
    if (!enforceOrCancel(decision)) return;

    // Second confirmation (interactive TTY only): type server name
    if (process.stdin.isTTY) {
      const nameMatches = await confirmTypedNameInTty({
        expected: server.name,
        promptMessage: `Type the server name "${server.name}" to confirm:`,
      });
      if (!nameMatches) {
        logger.error("Server name does not match. Destroy cancelled.");
        return;
      }
    }
  }

  const spinner = createSpinner("Destroying server...");
  spinner.start();

  // Delegate cloud deletion to core
  const result = await destroyCloudServer(server.name);

  if (result.success && result.cloudDeleted) {
    spinner.succeed(`Server "${server.name}" destroyed`);
    logger.success("Server has been removed from your cloud provider and local config.");
    await promptBackupCleanup(server.name, options?.force);
    return;
  }

  if (result.success && result.hint) {
    spinner.warn(`Server not found on ${server.provider} (may have been deleted manually)`);
    logger.info("Removed from local config.");
    await promptBackupCleanup(server.name, options?.force);
    return;
  }

  // Cloud deletion failed
  spinner.fail("Failed to destroy server");
  if (result.error) logger.error(result.error);
  if (result.hint) logger.info(result.hint);

  if (options?.force) {
    const removeResult = await removeServerRecord(server.name);
    if (removeResult.success) {
      logger.success("Removed from local config.");
    }
  } else {
    const removeDecision = await confirmOrCancel(
      "Remove this server from local config anyway?",
      false,
      "Use --force to remove from local config in non-interactive mode.",
    );
    if (removeDecision.confirmed) {
      const removeResult = await removeServerRecord(server.name);
      if (removeResult.success) {
        logger.success("Removed from local config.");
      }
    }
  }
}
