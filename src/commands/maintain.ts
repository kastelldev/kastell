import inquirer from "inquirer";
import { getServers } from "../utils/config.js";
import { resolveServer, promptApiToken, collectProviderTokens } from "../utils/serverSelect.js";
import { checkSshAvailable } from "../utils/ssh.js";
import { logger, createSpinner } from "../utils/logger.js";
import { getErrorMessage, mapProviderError } from "../utils/errorMapper.js";
import { createProviderWithToken } from "../utils/providerFactory.js";
import { isBareServer, requireManagedMode } from "../utils/modeGuard.js";
import type { ServerRecord } from "../types/index.js";
import {
  pollHealth,
} from "../core/maintain.js";
import { getAdapter, resolvePlatform } from "../adapters/factory.js";

interface MaintainOptions {
  skipReboot?: boolean;
  all?: boolean;
  dryRun?: boolean;
  skipSnapshot?: boolean;
}

interface MaintainResult {
  serverName: string;
  statusCheck: boolean;
  update: boolean;
  healthCheck: boolean;
  reboot: boolean | "skipped";
  finalCheck: boolean | "skipped";
}

function showDryRun(server: ServerRecord, skipReboot: boolean): void {
  const platform = resolvePlatform(server);
  const adapterName = platform ? getAdapter(platform).name : "platform";
  const displayName = adapterName.charAt(0).toUpperCase() + adapterName.slice(1);

  logger.title("Dry Run: Maintenance Steps");
  logger.step(`Target: ${server.name} (${server.ip})`);
  console.log();
  logger.step("Step 0: Offer snapshot creation (cost estimate from API)");
  logger.step("Step 1: Check server status via provider API");
  logger.step(`Step 2: Update ${displayName} via SSH (install script)`);
  logger.step(`Step 3: Health check — poll ${displayName} endpoint`);
  if (skipReboot) {
    logger.step("Step 4: Reboot — SKIPPED (--skip-reboot)");
    logger.step("Step 5: Final check — SKIPPED (no reboot)");
  } else {
    logger.step("Step 4: Reboot server via provider API");
    logger.step(`Step 5: Final check — server + ${displayName} running`);
  }
  console.log();
  logger.info("No changes applied (dry run).");
}

async function maintainSingleServer(
  server: ServerRecord,
  apiToken: string,
  options: MaintainOptions,
): Promise<MaintainResult> {
  const result: MaintainResult = {
    serverName: server.name,
    statusCheck: false,
    update: false,
    healthCheck: false,
    reboot: options.skipReboot ? "skipped" : false,
    finalCheck: options.skipReboot ? "skipped" : false,
  };

  logger.title(`Maintenance: ${server.name} (${server.ip})`);

  const provider = createProviderWithToken(server.provider, apiToken);

  // Step 0: Offer snapshot creation
  if (!options.skipSnapshot && !server.id.startsWith("manual-")) {
    try {
      const costEstimate = await provider.getSnapshotCostEstimate(server.id);
      const { createSnap } = await inquirer.prompt([
        {
          type: "confirm",
          name: "createSnap",
          message: `Create snapshot before maintenance? (Estimated cost: ${costEstimate})`,
          default: true,
        },
      ]);

      if (createSnap) {
        const snapSpinner = createSpinner("Step 0: Creating snapshot...");
        snapSpinner.start();
        try {
          const snapshotName = `kastell-maintain-${Date.now()}`;
          await provider.createSnapshot(server.id, snapshotName);
          snapSpinner.succeed(`Step 0: Snapshot created (${snapshotName})`);
        } catch (error: unknown) {
          snapSpinner.warn("Step 0: Snapshot failed — continuing maintenance");
          logger.error(getErrorMessage(error));
          const hint = mapProviderError(error, server.provider);
          if (hint) logger.info(hint);
        }
      } else {
        logger.info("Step 0: Snapshot skipped");
      }
    } catch {
      logger.info("Step 0: Could not estimate snapshot cost — skipping");
    }
  } else if (server.id.startsWith("manual-")) {
    logger.info("Step 0: Manual server — snapshot skipped");
  }
  console.log();

  // Step 1: Status check
  const statusSpinner = createSpinner("Step 1: Checking server status...");
  statusSpinner.start();

  if (server.id.startsWith("manual-")) {
    statusSpinner.succeed("Step 1: Manually added server — assuming running");
    result.statusCheck = true;
  } else {
    try {
      const serverStatus = await provider.getServerStatus(server.id);
      if (serverStatus !== "running") {
        statusSpinner.fail(`Server is not running (status: ${serverStatus}). Maintenance aborted.`);
        return result;
      }
      statusSpinner.succeed("Step 1: Server is running");
      result.statusCheck = true;
    } catch (error: unknown) {
      statusSpinner.fail("Step 1: Failed to check server status");
      logger.error(getErrorMessage(error));
      const hint = mapProviderError(error, server.provider);
      if (hint) logger.info(hint);
      return result;
    }
  }

  // Step 2: Platform update via adapter
  const platform = resolvePlatform(server);
  const adapter = platform ? getAdapter(platform) : null;
  const adapterDisplayName = adapter
    ? adapter.name.charAt(0).toUpperCase() + adapter.name.slice(1)
    : "Platform";

  const updateSpinner = createSpinner(`Step 2: Updating ${adapterDisplayName}...`);
  updateSpinner.start();

  if (!adapter) {
    updateSpinner.fail("Step 2: No platform adapter available");
    return result;
  }

  const updateResult = await adapter.update(server.ip);
  if (!updateResult.success) {
    updateSpinner.fail(`Step 2: Update failed`);
    if (updateResult.output) logger.error(updateResult.output.trim());
    if (updateResult.error && !updateResult.output) logger.error(updateResult.error);
    if (updateResult.hint) logger.info(updateResult.hint);
    return result;
  }
  updateSpinner.succeed(`Step 2: ${adapterDisplayName} updated`);
  result.update = true;

  // Step 3: Health check after update via adapter
  const healthSpinner = createSpinner(`Step 3: Checking ${adapterDisplayName} health...`);
  healthSpinner.start();

  const healthOk = await pollHealth(adapter, server.ip, 12, 5000, server.domain);
  if (!healthOk) {
    healthSpinner.fail(`Step 3: ${adapterDisplayName} did not respond after update`);
    return result;
  }
  healthSpinner.succeed(`Step 3: ${adapterDisplayName} is healthy`);
  result.healthCheck = true;

  // Step 4: Reboot (optional)
  if (!options.skipReboot) {
    if (server.id.startsWith("manual-")) {
      const rebootSpinner = createSpinner("Step 4: Rebooting server...");
      rebootSpinner.start();
      rebootSpinner.warn("Step 4: Cannot reboot manually added server via API — skipped");
      result.reboot = "skipped";
      result.finalCheck = "skipped";
      return result;
    }

    const rebootSpinner = createSpinner("Step 4: Rebooting server...");
    rebootSpinner.start();

    try {
      await provider.rebootServer(server.id);
      rebootSpinner.succeed("Step 4: Reboot initiated");
      result.reboot = true;
    } catch (error: unknown) {
      rebootSpinner.fail("Step 4: Reboot failed");
      logger.error(getErrorMessage(error));
      const hint = mapProviderError(error, server.provider);
      if (hint) logger.info(hint);
      return result;
    }

    // Step 5: Final check after reboot
    const finalSpinner = createSpinner("Step 5: Waiting for server to come back online...");
    finalSpinner.start();

    // Wait for reboot to initiate
    await new Promise((resolve) => setTimeout(resolve, 10000));

    // Poll provider API for server status
    try {
      let serverBack = false;
      for (let attempt = 1; attempt <= 30; attempt++) {
        try {
          const status = await provider.getServerStatus(server.id);
          if (status === "running") {
            serverBack = true;
            break;
          }
        } catch {
          // Server may be temporarily unreachable during reboot
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
        finalSpinner.text = `Step 5: Waiting for server... (${attempt}/30)`;
      }

      if (!serverBack) {
        finalSpinner.warn("Step 5: Server did not come back in time");
        return result;
      }

      // Check platform health after reboot
      const platformBack = adapter ? await pollHealth(adapter, server.ip, 12, 5000, server.domain) : false;
      if (platformBack) {
        finalSpinner.succeed(`Step 5: Server and ${adapterDisplayName} are running`);
        result.finalCheck = true;
      } else {
        finalSpinner.warn(`Step 5: Server is running but ${adapterDisplayName} did not respond`);
      }
    } catch (error: unknown) {
      finalSpinner.fail("Step 5: Final check failed");
      logger.error(getErrorMessage(error));
      return result;
    }
  }

  return result;
}

function showReport(results: MaintainResult[]): void {
  console.log();
  logger.title("Maintenance Report");

  for (const r of results) {
    const steps = [
      r.statusCheck ? "status OK" : "status FAIL",
      r.update ? "update OK" : "update FAIL",
      r.healthCheck ? "health OK" : "health FAIL",
      r.reboot === "skipped" ? "reboot SKIP" : r.reboot ? "reboot OK" : "reboot FAIL",
      r.finalCheck === "skipped" ? "final SKIP" : r.finalCheck ? "final OK" : "final FAIL",
    ];

    const allPassed =
      r.statusCheck &&
      r.update &&
      r.healthCheck &&
      (r.reboot === "skipped" || r.reboot === true) &&
      (r.finalCheck === "skipped" || r.finalCheck === true);

    if (allPassed) {
      logger.success(`${r.serverName}: ${steps.join(", ")}`);
    } else {
      logger.error(`${r.serverName}: ${steps.join(", ")}`);
    }
  }
}

async function maintainAll(options: MaintainOptions): Promise<void> {
  if (!checkSshAvailable()) {
    logger.error("SSH client not found. Required for maintenance.");
    return;
  }

  const servers = getServers();
  if (servers.length === 0) {
    logger.info("No servers found. Deploy one with: kastell init");
    return;
  }

  const tokenMap = await collectProviderTokens(servers);
  const results: MaintainResult[] = [];

  for (const server of servers) {
    if (isBareServer(server)) {
      logger.warning(
        `Skipping ${server.name}: maintain command is not available for bare servers (requires a platform adapter).`,
      );
      console.log();
      continue;
    }

    const token = tokenMap.get(server.provider);
    if (!token) {
      logger.warning(`Skipping ${server.name}: no API token available for provider "${server.provider}".`);
      console.log();
      continue;
    }

    if (options.dryRun) {
      showDryRun(server, !!options.skipReboot);
      continue;
    }

    const result = await maintainSingleServer(server, token, { ...options, skipSnapshot: true });
    results.push(result);
    console.log();
  }

  if (!options.dryRun && results.length > 0) {
    showReport(results);
  }
}

export async function maintainCommand(query?: string, options?: MaintainOptions): Promise<void> {
  if (options?.all) {
    return maintainAll(options);
  }

  if (!checkSshAvailable()) {
    logger.error("SSH client not found. Required for maintenance.");
    logger.info("Windows: Settings > Apps > Optional Features > OpenSSH Client");
    logger.info("Linux/macOS: SSH is usually pre-installed.");
    return;
  }

  const server = await resolveServer(query, "Select a server to maintain:");
  if (!server) return;

  const modeError = requireManagedMode(server, "maintain");
  if (modeError) {
    logger.error(modeError);
    return;
  }

  if (options?.dryRun) {
    showDryRun(server, !!options.skipReboot);
    return;
  }

  const apiToken = await promptApiToken(server.provider);
  const result = await maintainSingleServer(server, apiToken, options ?? {});
  showReport([result]);
}
