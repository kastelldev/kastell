import inquirer from "inquirer";
import { resolveServer } from "../utils/serverSelect.js";
import { rebootServer } from "../core/manage.js";
import { getCloudServerStatus } from "../core/status.js";
import { getProviderToken } from "../core/tokens.js";
import { isBareServer } from "../utils/modeGuard.js";
import { resolvePlatform } from "../adapters/factory.js";
import { platformDefaults } from "../core/domain.js";
import { logger, createSpinner } from "../utils/logger.js";
import { RESTART_DELAY_MS } from "../constants.js";

function showDryRun(server: { name: string; ip: string; provider: string }): void {
  logger.title("Dry Run: Restart Server");
  logger.step(`Server: ${server.name} (${server.ip})`);
  logger.step(`Provider: ${server.provider}`);
  console.log();
  logger.step("Step 1: Reboot server via provider API");
  logger.step("Step 2: Wait for server to come back online");
  console.log();
  logger.info("No changes applied (dry run).");
}

export async function restartCommand(query?: string, options?: { dryRun?: boolean; force?: boolean }): Promise<void> {
  const server = await resolveServer(query, "Select a server to restart:");
  if (!server) return;

  if (options?.dryRun) {
    showDryRun(server);
    return;
  }

  if (!options?.force) {
    const { confirm } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirm",
        message: `Restart server "${server.name}" (${server.ip})? This will cause brief downtime.`,
        default: false,
      },
    ]);

    if (!confirm) {
      logger.info("Restart cancelled.");
      return;
    }
  }

  const spinner = createSpinner("Rebooting server...");
  spinner.start();

  // Delegate reboot to core
  const result = await rebootServer(server.name);

  if (!result.success) {
    spinner.fail(result.error ?? "Failed to reboot server");
    if (result.hint) logger.info(result.hint);
    return;
  }

  spinner.succeed("Reboot initiated");

  const pollSpinner = createSpinner("Waiting for server to come back online...");
  pollSpinner.start();

  const token = getProviderToken(server.provider) ?? "";
  let attempts = 0;
  const maxAttempts = 30;

  while (attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, RESTART_DELAY_MS));
    try {
      const status = await getCloudServerStatus(server, token);
      if (status === "running") {
        pollSpinner.succeed("Server is running");
        console.log();
        logger.success(`Server "${server.name}" restarted successfully`);
        if (isBareServer(server)) {
          logger.info(`SSH: ssh root@${server.ip}`);
        } else {
          const platform = resolvePlatform(server) ?? "coolify";
          const { label, port } = platformDefaults(platform);
          logger.info(`Access ${label}: http://${server.ip}:${port}`);
        }
        return;
      }
    } catch {
      // Server might be temporarily unreachable during reboot
    }
    attempts++;
    pollSpinner.text = `Waiting for server... (${attempts}/${maxAttempts})`;
  }

  pollSpinner.warn("Server did not come back in time");
  logger.warning("The server may still be rebooting. Check status later with: kastell status");
}
