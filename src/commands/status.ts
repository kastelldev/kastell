import { getServers } from "../utils/config.js";
import { resolveServer, promptApiToken, collectProviderTokens } from "../utils/serverSelect.js";
import { checkSshAvailable } from "../utils/ssh.js";
import { logger, createSpinner } from "../utils/logger.js";
import { mapProviderError, classifyError } from "../utils/errorMapper.js";
import {
  getCloudServerStatus,
  checkAllServersStatus,
  restartCoolify,
} from "../core/status.js";
import { isBareServer, getServerModeLabel } from "../utils/modeGuard.js";
import { getAdapter, resolvePlatform } from "../adapters/factory.js";
import { adapterDisplayName } from "../adapters/shared.js";
import type { ServerRecord } from "../types/index.js";
import type { StatusResult } from "../core/status.js";

interface StatusOptions {
  all?: boolean;
  autostart?: boolean;
}

function printStatusTable(results: StatusResult[]): void {
  const header = `${"Name".padEnd(20)} ${"IP".padEnd(16)} ${"Provider".padEnd(14)} ${"Platform".padEnd(10)} ${"Server".padEnd(12)} ${"Platform".padEnd(14)}`;
  console.log(header);
  console.log("─".repeat(header.length));

  for (const r of results) {
    const serverStr = r.error ? "error" : r.serverStatus;
    const coolifyStr = r.platformStatus;
    const modeLabel = getServerModeLabel(r.server);
    console.log(
      `${r.server.name.padEnd(20)} ${r.server.ip.padEnd(16)} ${r.server.provider.padEnd(14)} ${modeLabel.padEnd(10)} ${serverStr.padEnd(12)} ${coolifyStr.padEnd(14)}`,
    );
  }
}

function printStatusSummary(results: StatusResult[]): void {
  const coolifyResults = results.filter((r) => !isBareServer(r.server));
  const running = coolifyResults.filter((r) => r.platformStatus === "running").length;
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

  const result = await restartCoolify(server);

  if (!result.success) {
    spinner.fail("Coolify restart failed");
    if (result.error) logger.error(result.error);
    if (result.hint) logger.info(result.hint);
    return;
  }

  spinner.succeed("Coolify restart command sent");

  if (result.nowRunning) {
    logger.success("Coolify is now running!");
  } else {
    logger.warning("Coolify may still be starting. Check again in a moment.");
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
    logger.info(`Platform:       ${getServerModeLabel(server)}`);
    logger.info(`Server Status:  ${serverStatus}`);

    if (isBareServer(server)) {
      // Bare servers: no Coolify, show SSH info
      logger.info("No platform installed (bare server)");
      console.log();
      logger.info(`SSH:            ssh root@${server.ip}`);
    } else {
      // Platform servers: check and display platform status
      const platform = resolvePlatform(server) ?? "coolify";
      const adapter = getAdapter(platform);
      const platformLabel = adapterDisplayName(adapter);
      const platformPort = adapter.port;
      const healthResult = await adapter.healthCheck(server.ip, server.domain);
      const platformStatus = healthResult.status;
      logger.info(`${platformLabel} Status: ${platformStatus}`);
      console.log();

      if (platformStatus === "running") {
        logger.success(`Access ${platformLabel}: http://${server.ip}:${platformPort}`);
        logger.warning("Running on HTTP. Set up a domain + SSL for production use.");
      } else {
        logger.warning(`${platformLabel} is not reachable. It may still be installing.`);

        // Autostart: restart Coolify if server is running but Coolify is down
        if (options?.autostart && serverStatus === "running") {
          await autostartCoolify(server);
        }
      }
    }
  } catch (error: unknown) {
    spinner.fail("Failed to check status");
    const classified = classifyError(error);
    logger.error(classified.message);
    if (classified.hint) logger.info(classified.hint);
    if (!classified.isTyped) {
      const hint = mapProviderError(error, server.provider);
      if (hint) logger.info(hint);
    }
  }
}
