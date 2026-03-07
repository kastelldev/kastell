import inquirer from "inquirer";
import { getServers } from "../utils/config.js";
import { resolveServer, promptApiToken, collectProviderTokens } from "../utils/serverSelect.js";
import { checkSshAvailable } from "../utils/ssh.js";
import { createProviderWithToken } from "../utils/providerFactory.js";
import { logger, createSpinner } from "../utils/logger.js";
import { getErrorMessage, mapProviderError } from "../utils/errorMapper.js";
import { isBareServer, requireManagedMode } from "../utils/modeGuard.js";
import { getAdapter, resolvePlatform } from "../adapters/factory.js";
import type { Platform } from "../types/index.js";

interface UpdateOptions {
  all?: boolean;
  dryRun?: boolean;
}

function showDryRun(server: { name: string; ip: string }, platformDisplayName: string): void {
  logger.title("Dry Run: Update Server");
  logger.step(`Server: ${server.name} (${server.ip})`);
  logger.step(`Platform: ${platformDisplayName}`);
  console.log();
  logger.step("Step 1: Validate server status via provider API");
  logger.step("Step 2: Run update script via SSH");
  console.log();
  logger.info("No changes applied (dry run).");
}

async function updateSingleServer(
  serverName: string,
  serverIp: string,
  serverId: string,
  provider: string,
  apiToken: string,
  platform: Platform,
): Promise<boolean> {
  const adapter = getAdapter(platform);
  const adapterDisplayName = adapter.name.charAt(0).toUpperCase() + adapter.name.slice(1);

  const spinner = createSpinner(`Validating ${serverName}...`);
  spinner.start();

  if (serverId.startsWith("manual-")) {
    spinner.succeed(`${serverName}: Manually added server — skipping API check`);
  } else {
    try {
      const providerInstance = createProviderWithToken(provider, apiToken);
      const status = await providerInstance.getServerStatus(serverId);
      if (status !== "running") {
        spinner.fail(`${serverName}: Server is not running (status: ${status})`);
        return false;
      }
      spinner.succeed(`${serverName}: Server verified`);
    } catch (error: unknown) {
      spinner.fail(`${serverName}: Failed to verify server`);
      logger.error(getErrorMessage(error));
      const hint = mapProviderError(error, provider);
      if (hint) logger.info(hint);
      return false;
    }
  }

  logger.info(`Updating ${adapterDisplayName} on ${serverName} (${serverIp})...`);

  const result = await adapter.update(serverIp);

  if (result.output) console.log(result.output);

  if (result.success) {
    logger.success(`${serverName}: ${adapterDisplayName} update completed!`);
    return true;
  } else {
    logger.error(`${serverName}: Update failed`);
    if (result.error) logger.error(result.error);
    return false;
  }
}

async function updateAll(options?: UpdateOptions): Promise<void> {
  if (!checkSshAvailable()) {
    logger.error("SSH client not found. Required for platform update.");
    return;
  }

  const servers = getServers();
  if (servers.length === 0) {
    logger.info("No servers found. Deploy one with: kastell init");
    return;
  }

  if (options?.dryRun) {
    for (const server of servers) {
      if (isBareServer(server)) {
        logger.warning(
          `Skipping ${server.name}: update command is not available for bare servers.`,
        );
        console.log();
        continue;
      }
      const serverPlatform = resolvePlatform(server);
      if (!serverPlatform) {
        logger.warning(`Skipping ${server.name}: no platform detected.`);
        console.log();
        continue;
      }
      const adapter = getAdapter(serverPlatform);
      const displayName = adapter.name.charAt(0).toUpperCase() + adapter.name.slice(1);
      showDryRun(server, displayName);
      console.log();
    }
    return;
  }

  const { confirm } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: `Update platform on all ${servers.length} server(s)? This may cause brief downtime.`,
      default: false,
    },
  ]);

  if (!confirm) {
    logger.info("Update cancelled.");
    return;
  }

  const tokenMap = await collectProviderTokens(servers);

  let succeeded = 0;
  let failed = 0;

  for (const server of servers) {
    if (isBareServer(server)) {
      logger.warning(
        `Skipping ${server.name}: update command is not available for bare servers.`,
      );
      console.log();
      continue;
    }
    const serverPlatform = resolvePlatform(server);
    if (!serverPlatform) {
      logger.warning(`Skipping ${server.name}: no platform detected.`);
      console.log();
      continue;
    }
    const token = tokenMap.get(server.provider)!;
    const ok = await updateSingleServer(server.name, server.ip, server.id, server.provider, token, serverPlatform);
    if (ok) succeeded++;
    else failed++;
    console.log();
  }

  if (failed === 0) {
    logger.success(`All ${succeeded} server(s) updated successfully!`);
  } else {
    logger.warning(`${succeeded} succeeded, ${failed} failed`);
  }
}

export async function updateCommand(query?: string, options?: UpdateOptions): Promise<void> {
  if (options?.all) {
    return updateAll(options);
  }

  if (!checkSshAvailable()) {
    logger.error("SSH client not found. Required for platform update.");
    logger.info("Windows: Settings > Apps > Optional Features > OpenSSH Client");
    logger.info("Linux/macOS: SSH is usually pre-installed.");
    return;
  }

  const server = await resolveServer(query, "Select a server to update:");
  if (!server) return;

  const modeError = requireManagedMode(server, "update");
  if (modeError) {
    logger.error(modeError);
    return;
  }

  const platform = resolvePlatform(server);
  if (!platform) {
    logger.error("No platform detected for this server.");
    return;
  }

  const adapter = getAdapter(platform);
  const adapterDisplayName = adapter.name.charAt(0).toUpperCase() + adapter.name.slice(1);

  if (options?.dryRun) {
    showDryRun(server, adapterDisplayName);
    return;
  }

  const { confirm } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: `Update ${adapterDisplayName} on "${server.name}" (${server.ip})? This may cause brief downtime.`,
      default: false,
    },
  ]);

  if (!confirm) {
    logger.info("Update cancelled.");
    return;
  }

  const apiToken = server.id.startsWith("manual-") ? "" : await promptApiToken(server.provider);

  const spinner = createSpinner("Validating access...");
  spinner.start();

  if (server.id.startsWith("manual-")) {
    spinner.succeed("Manually added server — skipping API check");
  } else {
    try {
      const provider = createProviderWithToken(server.provider, apiToken);
      const status = await provider.getServerStatus(server.id);
      if (status !== "running") {
        spinner.fail(`Server is not running (status: ${status})`);
        return;
      }
      spinner.succeed("Server verified");
    } catch (error: unknown) {
      spinner.fail("Failed to verify server");
      logger.error(getErrorMessage(error));
      const hint = mapProviderError(error, server.provider);
      if (hint) logger.info(hint);
      return;
    }
  }

  logger.info(`Running ${adapterDisplayName} update script...`);
  logger.info("This may take several minutes. Please wait.");
  console.log();

  const result = await adapter.update(server.ip);

  if (result.output) console.log(result.output);

  if (result.success) {
    logger.success(`${adapterDisplayName} update completed successfully!`);
  } else {
    logger.error(`Update failed${result.error ? `: ${result.error}` : ""}`);
    logger.info("Check the output above for details.");
  }
}
