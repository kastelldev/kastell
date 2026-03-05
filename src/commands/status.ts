import { getServers } from "../utils/config.js";
import { resolveServer, promptApiToken, collectProviderTokens } from "../utils/serverSelect.js";
import { checkSshAvailable, sshExec } from "../utils/ssh.js";
import { logger, createSpinner } from "../utils/logger.js";
import { getErrorMessage, mapProviderError, mapSshError } from "../utils/errorMapper.js";
import {
  getCloudServerStatus,
  checkAllServersStatus,
  checkCoolifyHealth,
} from "../core/status.js";
import { isBareServer, getServerMode } from "../utils/modeGuard.js";
import type { ServerRecord } from "../types/index.js";
import type { StatusResult } from "../core/status.js";
import { COOLIFY_RESTART_CMD } from "../constants.js";

interface StatusOptions {
  all?: boolean;
  autostart?: boolean;
}

function printStatusTable(results: StatusResult[]): void {
  const header = `${"Name".padEnd(20)} ${"IP".padEnd(16)} ${"Provider".padEnd(14)} ${"Mode".padEnd(10)} ${"Server".padEnd(12)} ${"Coolify".padEnd(14)}`;
  console.log(header);
  console.log("─".repeat(header.length));

  for (const r of results) {
    const serverStr = r.error ? "error" : r.serverStatus;
    const coolifyStr = r.coolifyStatus;
    const modeStr = getServerMode(r.server);
    console.log(
      `${r.server.name.padEnd(20)} ${r.server.ip.padEnd(16)} ${r.server.provider.padEnd(14)} ${modeStr.padEnd(10)} ${serverStr.padEnd(12)} ${coolifyStr.padEnd(14)}`,
    );
  }
}

function printStatusSummary(results: StatusResult[]): void {
  const coolifyResults = results.filter((r) => !isBareServer(r.server));
  const running = coolifyResults.filter((r) => r.coolifyStatus === "running").length;
  const errors = results.filter((r) => r.error).length;
  const bareCount = results.filter((r) => isBareServer(r.server)).length;
  if (errors > 0) {
    logger.warning(`${running} running, ${errors} error(s)${bareCount > 0 ? `, ${bareCount} bare` : ""}`);
  } else if (bareCount > 0 && coolifyResults.length === 0) {
    logger.success(`${bareCount} bare server(s) running`);
  } else {
    logger.success(`${running}/${coolifyResults.length} server(s) with Coolify running${bareCount > 0 ? `, ${bareCount} bare` : ""}`);
  }
}

async function statusAll(): Promise<void> {
  const servers = getServers();
  if (servers.length === 0) {
    logger.info("No servers found. Deploy one with: kastell init");
    return;
  }

  const tokenMap = await collectProviderTokens(servers);
  const spinner = createSpinner(`Checking status of ${servers.length} server(s)...`);
  spinner.start();

  const results = await checkAllServersStatus(servers, tokenMap);

  spinner.succeed("Status check complete");
  console.log();

  printStatusTable(results);
  console.log();
  printStatusSummary(results);
}

async function autostartCoolify(server: ServerRecord): Promise<void> {
  if (!checkSshAvailable()) {
    logger.warning("SSH not available. Cannot autostart Coolify.");
    return;
  }

  const spinner = createSpinner("Restarting Coolify via SSH...");
  spinner.start();

  try {
    const result = await sshExec(server.ip, COOLIFY_RESTART_CMD);
    if (result.code === 0) {
      spinner.succeed("Coolify restart command sent");

      // Wait and check again
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const healthStatus = await checkCoolifyHealth(server.ip);
      if (healthStatus === "running") {
        logger.success("Coolify is now running!");
      } else {
        logger.warning("Coolify may still be starting. Check again in a moment.");
      }
    } else {
      spinner.fail("Coolify restart failed");
      if (result.stderr) logger.error(result.stderr);
    }
  } catch (error: unknown) {
    spinner.fail("Failed to restart Coolify");
    logger.error(getErrorMessage(error));
    const hint = mapSshError(error, server.ip);
    if (hint) logger.info(hint);
  }
}

export async function statusCommand(query?: string, options?: StatusOptions): Promise<void> {
  if (options?.all) {
    return statusAll();
  }

  const server = await resolveServer(query);
  if (!server) return;

  // Ask for API token (skip for manually added servers)
  const apiToken = server.id.startsWith("manual-") ? "" : await promptApiToken(server.provider);

  const spinner = createSpinner("Checking server status...");
  spinner.start();

  try {
    const serverStatus = await getCloudServerStatus(server, apiToken);

    spinner.succeed("Status retrieved");

    console.log();
    logger.info(`Name:           ${server.name}`);
    logger.info(`Provider:       ${server.provider}`);
    logger.info(`IP:             ${server.ip}`);
    logger.info(`Region:         ${server.region}`);
    logger.info(`Size:           ${server.size}`);
    logger.info(`Mode:           ${getServerMode(server)}`);
    logger.info(`Server Status:  ${serverStatus}`);

    if (isBareServer(server)) {
      // Bare servers: no Coolify, show SSH info
      logger.info("Mode: bare (no platform installed)");
      console.log();
      logger.info(`SSH:            ssh root@${server.ip}`);
    } else {
      // Coolify servers: check and display Coolify status
      const coolifyStatus = await checkCoolifyHealth(server.ip);
      logger.info(`Coolify Status: ${coolifyStatus}`);
      console.log();

      if (coolifyStatus === "running") {
        logger.success(`Access Coolify: http://${server.ip}:8000`);
        logger.warning("Running on HTTP. Set up a domain + SSL for production use.");
      } else {
        logger.warning("Coolify is not reachable. It may still be installing.");

        // Autostart: restart Coolify if server is running but Coolify is down
        if (options?.autostart && serverStatus === "running") {
          await autostartCoolify(server);
        }
      }
    }
  } catch (error: unknown) {
    spinner.fail("Failed to check status");
    logger.error(getErrorMessage(error));
    const hint = mapProviderError(error, server.provider);
    if (hint) logger.info(hint);
  }
}
