import inquirer from "inquirer";
import { getServers } from "../utils/config.js";
import { resolveServer, promptApiToken, collectProviderTokens } from "../utils/serverSelect.js";
import { checkSshAvailable } from "../utils/ssh.js";
import { createProviderWithToken } from "../utils/providerFactory.js";
import { logger, createSpinner } from "../utils/logger.js";
import { getErrorMessage, mapProviderError } from "../utils/errorMapper.js";
import { executeCoolifyUpdate } from "../core/maintain.js";
import { isBareServer, requireCoolifyMode } from "../utils/modeGuard.js";

interface UpdateOptions {
  all?: boolean;
}

async function updateSingleServer(
  serverName: string,
  serverIp: string,
  serverId: string,
  provider: string,
  apiToken: string,
): Promise<boolean> {
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

  logger.info(`Updating Coolify on ${serverName} (${serverIp})...`);

  const result = await executeCoolifyUpdate(serverIp);

  if (result.output) console.log(result.output);

  if (result.success) {
    logger.success(`${serverName}: Coolify update completed!`);
    return true;
  } else {
    logger.error(`${serverName}: Update failed with exit code`);
    return false;
  }
}

async function updateAll(): Promise<void> {
  if (!checkSshAvailable()) {
    logger.error("SSH client not found. Required for Coolify update.");
    return;
  }

  const servers = getServers();
  if (servers.length === 0) {
    logger.info("No servers found. Deploy one with: kastell init");
    return;
  }

  const { confirm } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: `Update Coolify on all ${servers.length} server(s)? This may cause brief downtime.`,
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
        `Skipping ${server.name}: update command is not available for bare servers (requires Coolify).`,
      );
      console.log();
      continue;
    }
    const token = tokenMap.get(server.provider)!;
    const ok = await updateSingleServer(server.name, server.ip, server.id, server.provider, token);
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
    return updateAll();
  }

  if (!checkSshAvailable()) {
    logger.error("SSH client not found. Required for Coolify update.");
    logger.info("Windows: Settings > Apps > Optional Features > OpenSSH Client");
    logger.info("Linux/macOS: SSH is usually pre-installed.");
    return;
  }

  const server = await resolveServer(query, "Select a server to update:");
  if (!server) return;

  const modeError = requireCoolifyMode(server, "update");
  if (modeError) {
    logger.error(modeError);
    return;
  }

  const { confirm } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: `Update Coolify on "${server.name}" (${server.ip})? This may cause brief downtime.`,
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

  logger.info("Running Coolify update script...");
  logger.info("This may take several minutes. Please wait.");
  console.log();

  const result = await executeCoolifyUpdate(server.ip);

  if (result.output) console.log(result.output);

  if (result.success) {
    logger.success("Coolify update completed successfully!");
    logger.info(`Access Coolify: http://${server.ip}:8000`);
  } else {
    logger.error(`Update failed with exit code ${result.error ?? ""}`);
    logger.info("Check the output above for details.");
  }
}
