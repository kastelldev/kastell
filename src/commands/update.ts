import { getServers } from "../utils/config.js";
import { resolveServer, promptApiToken, collectProviderTokens } from "../utils/serverSelect.js";
import { checkSshAvailable } from "../utils/ssh.js";
import { logger, createSpinner } from "../utils/logger.js";
import { isBareServer, requireManagedMode } from "../utils/modeGuard.js";
import { markCommandFailed } from "../utils/exitCode.js";
import { getAdapter, resolvePlatform } from "../adapters/factory.js";
import { adapterDisplayName } from "../adapters/shared.js";
import { updateServer } from "../core/update.js";
import { confirmOrCancel } from "../utils/prompts.js";
import type { ServerRecord, Platform } from "../types/index.js";

interface UpdateOptions {
  all?: boolean;
  dryRun?: boolean;
  force?: boolean;
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
  server: ServerRecord,
  apiToken: string,
  platform: Platform,
): Promise<boolean> {
  const spinner = createSpinner(`Validating ${server.name}...`);
  spinner.start();

  const result = await updateServer(server, apiToken, platform);
  const displayName = result.displayName ?? "Platform";

  if (!result.success) {
    spinner.fail(`${server.name}: ${result.error ?? "Failed to verify server"}`);
    if (result.hint) logger.info(result.hint);
    return false;
  }

  spinner.succeed(`${server.name}: Server verified`);

  logger.info(`Updating ${displayName} on ${server.name} (${server.ip})...`);
  if (result.output) console.log(result.output);
  logger.success(`${server.name}: ${displayName} update completed!`);
  return true;
}

async function updateAll(options?: UpdateOptions): Promise<void> {
  if (!checkSshAvailable()) {
    logger.error("SSH client not found. Required for platform update.");
    markCommandFailed();
    return;
  }

  const servers = getServers();
  if (servers.length === 0) {
    logger.info("No servers found. Deploy one with: kastell init");
    return;
  }

  if (options?.dryRun) {
    let failed = 0;
    for (const server of servers) {
      if (isBareServer(server)) {
        logger.warning(
          `Skipping ${server.name}: update command is not available for bare servers.`,
        );
        console.log();
        failed += 1;
        continue;
      }
      const serverPlatform = resolvePlatform(server);
      if (!serverPlatform) {
        logger.warning(`Skipping ${server.name}: no platform detected.`);
        console.log();
        failed += 1;
        continue;
      }
      const adapter = getAdapter(serverPlatform);
      const displayName = adapterDisplayName(adapter);
      showDryRun(server, displayName);
      console.log();
    }
    if (failed > 0) markCommandFailed();
    return;
  }

  if (!options?.force) {
    // Destructive guard: refuse before mutation in non-TTY mode without --force (P142 Task 9)
    const decision = await confirmOrCancel(
      `Update platform on all ${servers.length} server(s)? This may cause brief downtime.`,
      false,
      "Use --force to update all in non-interactive mode.",
    );
    if (!decision.confirmed) {
      logger.info(decision.message);
      if (decision.reason === "non-tty") {
        markCommandFailed();
      }
      return;
    }
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
      failed += 1;
      continue;
    }
    const serverPlatform = resolvePlatform(server);
    if (!serverPlatform) {
      logger.warning(`Skipping ${server.name}: no platform detected.`);
      console.log();
      failed += 1;
      continue;
    }
    const token = tokenMap.get(server.provider)!;
    const ok = await updateSingleServer(server, token, serverPlatform);
    if (ok) succeeded++;
    else failed++;
    console.log();
  }

  if (failed === 0) {
    logger.success(`All ${succeeded} server(s) updated successfully!`);
  } else {
    logger.warning(`${succeeded} succeeded, ${failed} failed`);
    markCommandFailed();
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
    markCommandFailed();
    return;
  }

  const server = await resolveServer(query, "Select a server to update:");
  if (!server) return;

  const modeError = requireManagedMode(server, "update");
  if (modeError) {
    logger.error(modeError);
    markCommandFailed();
    return;
  }

  const platform = resolvePlatform(server);
  if (!platform) {
    logger.error("No platform detected for this server.");
    markCommandFailed();
    return;
  }

  const adapter = getAdapter(platform);
  const displayName = adapterDisplayName(adapter);

  if (options?.dryRun) {
    showDryRun(server, displayName);
    return;
  }

  if (!options?.force) {
    // Destructive guard: refuse before mutation in non-TTY mode without --force (P142 Task 9)
    const decision = await confirmOrCancel(
      `Update ${displayName} on "${server.name}" (${server.ip})? This may cause brief downtime.`,
      false,
      "Use --force to update in non-interactive mode.",
    );
    if (!decision.confirmed) {
      logger.info(decision.message);
      if (decision.reason === "non-tty") {
        markCommandFailed();
      }
      return;
    }
  }

  const apiToken = server.id.startsWith("manual-") ? "" : await promptApiToken(server.provider);

  const spinner = createSpinner("Validating access...");
  spinner.start();

  if (server.id.startsWith("manual-")) {
    spinner.succeed("Manually added server — skipping API check");
  } else {
    spinner.succeed("Validating...");
  }

  logger.info(`Running ${displayName} update script...`);
  logger.info("This may take several minutes. Please wait.");
  console.log();

  try {
    const result = await updateServer(server, apiToken, platform);

    if (result.output) console.log(result.output);

    if (result.success) {
      logger.success(`${displayName} update completed successfully!`);
    } else {
      logger.error(`Update failed${result.error ? `: ${result.error}` : ""}`);
      if (result.hint) logger.info(result.hint);
      logger.info("Check the output above for details.");
      markCommandFailed();
    }
  } catch (error: unknown) {
    logger.error(`Update failed: ${(error as Error).message ?? "Unknown error"}`);
    markCommandFailed();
  }
}
