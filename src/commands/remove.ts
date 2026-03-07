import inquirer from "inquirer";
import { removeServer } from "../utils/config.js";
import { resolveServer } from "../utils/serverSelect.js";
import { logger } from "../utils/logger.js";
import { listBackups, cleanupServerBackups } from "../core/backup.js";

function showDryRun(server: { name: string; ip: string }): void {
  logger.title("Dry Run: Remove Server");
  logger.step(`Server: ${server.name} (${server.ip})`);
  console.log();
  logger.step("Step 1: Remove from local config (~/.kastell/servers.json)");
  logger.step("Note: Cloud server is NOT destroyed");
  console.log();
  logger.info("No changes applied (dry run).");
}

export async function removeCommand(query?: string, options?: { dryRun?: boolean }): Promise<void> {
  const server = await resolveServer(query, "Select a server to remove:");
  if (!server) return;

  if (options?.dryRun) {
    showDryRun(server);
    return;
  }

  const { confirm } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: `Remove "${server.name}" (${server.ip}) from local config? (Server will NOT be destroyed)`,
      default: false,
    },
  ]);

  if (!confirm) {
    logger.info("Remove cancelled.");
    return;
  }

  removeServer(server.id);
  logger.success(`"${server.name}" removed from local config.`);
  logger.info(
    "The cloud server is still running. Use 'destroy' to also delete it from the provider.",
  );

  // Offer to clean up backups
  const backups = listBackups(server.name);
  if (backups.length > 0) {
    const { cleanBackups } = await inquirer.prompt([
      {
        type: "confirm",
        name: "cleanBackups",
        message: `Found ${backups.length} backup(s) for "${server.name}". Remove them?`,
        default: false,
      },
    ]);
    if (cleanBackups) {
      const result = cleanupServerBackups(server.name);
      if (result.removed) {
        logger.success("Backups removed.");
      } else {
        logger.warning("Failed to remove backups.");
      }
    } else {
      logger.info("Backups kept. Run 'kastell backup cleanup' later to remove orphans.");
    }
  }
}
