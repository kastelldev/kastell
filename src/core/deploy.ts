import type { CloudProvider } from "../providers/base.js";
import { isServerMode } from "../types/index.js";
import type { Platform, KastellResult } from "../types/index.js";
import { getBareCloudInit } from "../utils/cloudInit.js";
import { getAdapter } from "../adapters/factory.js";
import { logger, debugLog, createSpinner } from "../utils/logger.js";
import { getErrorMessage, mapProviderError } from "../utils/errorMapper.js";
import { openBrowser } from "../utils/openBrowser.js";
import { assertValidIp, removeStaleHostKey, sshExec } from "../utils/ssh.js";
import { raw } from "../utils/sshCommand.js";
import { findLocalSshKey, generateSshKey, getSshKeyName } from "../utils/sshKey.js";
import { saveServer } from "../utils/config.js";
import { waitForCoolify } from "../utils/healthCheck.js";
import {
  BACK_SIGNAL,
  getServerNameConfig,
  getLocationConfig,
  getServerTypeConfig,
} from "../utils/prompts.js";
import { firewallSetup } from "./firewall.js";
import { secureSetup } from "./secure.js";
import { IP_WAIT, COOLIFY_MIN_WAIT, COOLIFY_PORT, DOKPLOY_PORT, DEPLOY_STEP_DELAY_MS, POLL_DELAY_MS } from "../constants.js";

/** Check if an IP address has been assigned (not placeholder) */
function isValidAssignedIp(ip: string): boolean {
  return ip !== "0.0.0.0" && ip !== "pending" && ip !== "";
}

/** Data returned on successful deployment */
interface DeployData {
  serverId: string;
  serverIp: string;
  serverName: string;
  platform?: string;
}

export async function uploadSshKeyToProvider(provider: CloudProvider): Promise<string[]> {
  let publicKey = findLocalSshKey();
  if (!publicKey) {
    logger.info("No SSH key found. Generating one...");
    publicKey = generateSshKey();
    if (publicKey) {
      logger.success("SSH key generated (~/.ssh/id_ed25519)");
    } else {
      logger.warning("Could not generate SSH key — falling back to password auth");
      logger.info("Server will require password change on first SSH login");
      logger.warning("Run 'kastell secure setup' after deployment to harden SSH access");
      return [];
    }
  }

  const spinner = createSpinner("Uploading SSH key to provider...");
  spinner.start();
  try {
    const keyId = await provider.uploadSshKey(getSshKeyName(), publicKey);
    spinner.succeed("SSH key uploaded — password-free access enabled");
    return [keyId];
  } catch (error: unknown) {
    spinner.fail("SSH key upload failed — falling back to password auth");
    logger.warning(getErrorMessage(error));
    logger.warning("Run 'kastell secure setup' after deployment to harden SSH access");
    return [];
  }
}

// ── Phase 1: Create server with retry logic ──────────────────────────

async function createServerWithRetry(
  providerWithToken: CloudProvider,
  serverName: string,
  region: string,
  serverSize: string,
  cloudInit: string,
  sshKeyIds: string[],
  mode?: string,
): Promise<KastellResult<{ id: string; ip: string; name: string; region: string; size: string }>> {
  let currentName = serverName;
  let currentRegion = region;
  let currentSize = serverSize;
  let server: { id: string; ip: string; status: string } | undefined;
  let retries = 0;
  const maxRetries = 2;
  const failedTypes: string[] = [];
  const failedLocations: string[] = [];

  while (!server && retries <= maxRetries) {
    const serverSpinner = createSpinner("Creating VPS server...");
    serverSpinner.start();

    try {
      server = await providerWithToken.createServer({
        name: currentName,
        region: currentRegion,
        size: currentSize,
        cloudInit,
        sshKeyIds,
      });
      serverSpinner.succeed(`Server created (ID: ${server.id})`);
    } catch (createError: unknown) {
      serverSpinner.fail("Server creation failed");
      const errorMsg = getErrorMessage(createError);

      if (errorMsg.includes("already") && errorMsg.includes("used")) {
        logger.warning(`Server name "${currentName}" is already in use`);
        logger.info("Please choose a different name:");
        let newName = BACK_SIGNAL;
        while (newName === BACK_SIGNAL) {
          newName = await getServerNameConfig(mode);
        }
        currentName = newName;
        retries++;
      } else if (errorMsg.includes("location disabled")) {
        failedLocations.push(currentRegion);
        logger.warning(`Location "${currentRegion}" is currently disabled for new servers`);
        logger.info("Please select a different region and server type:");
        let pickedSize = false;
        while (!pickedSize) {
          let newRegion = BACK_SIGNAL;
          while (newRegion === BACK_SIGNAL) {
            newRegion = await getLocationConfig(providerWithToken, failedLocations);
          }
          currentRegion = newRegion;
          const newSize = await getServerTypeConfig(providerWithToken, currentRegion, [], isServerMode(mode) ? mode : undefined);
          if (newSize === BACK_SIGNAL) continue;
          currentSize = newSize;
          pickedSize = true;
        }
        retries++;
      } else if (
        errorMsg.includes("unavailable") ||
        errorMsg.includes("not available") ||
        errorMsg.includes("sold out") ||
        errorMsg.includes("unsupported")
      ) {
        if (retries < maxRetries) {
          failedTypes.push(currentSize);
          logger.warning(`Server type "${currentSize}" is not available in this location`);
          logger.info("Please select a different server type:");
          let newSize = BACK_SIGNAL;
          while (newSize === BACK_SIGNAL) {
            newSize = await getServerTypeConfig(providerWithToken, currentRegion, failedTypes, isServerMode(mode) ? mode : undefined);
          }
          currentSize = newSize;
          retries++;
        } else {
          throw createError;
        }
      } else {
        throw createError;
      }
    }
  }

  if (!server) {
    logger.error("Could not create server after multiple attempts");
    return { success: false, error: "Could not create server after multiple attempts" };
  }

  return {
    success: true,
    data: { id: server.id, ip: server.ip, name: currentName, region: currentRegion, size: currentSize },
  };
}

// ── Phase 2: Wait for server to be ready ─────────────────────────────

async function waitForReady(
  providerWithToken: CloudProvider,
  server: { id: string; ip: string },
  providerChoice: string,
  platform: Platform | undefined,
): Promise<{ ip: string; ready: boolean }> {
  // Wait for server to be running
  const statusSpinner = createSpinner("Waiting for server to boot...");
  statusSpinner.start();

  let status = await providerWithToken.getServerStatus(server.id);
  let attempts = 0;
  const maxAttempts = 30;

  while (status !== "running" && attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, DEPLOY_STEP_DELAY_MS));
    status = await providerWithToken.getServerStatus(server.id);
    attempts++;
  }

  if (status !== "running") {
    statusSpinner.fail("Server failed to start");
    logger.error("Please check your cloud provider dashboard");
    return { ip: server.ip, ready: false };
  }

  statusSpinner.succeed("Server is running");

  let currentIp = server.ip;

  // Refresh server details to get final IP (DO/Vultr/Linode assign IP after boot)
  if (!isValidAssignedIp(currentIp)) {
    const ipConfig = IP_WAIT[providerChoice] || { attempts: 10, interval: 3000 };
    const ipSpinner = createSpinner("Waiting for IP address assignment...");
    ipSpinner.start();
    let refreshAttempts = 0;
    while (refreshAttempts < ipConfig.attempts) {
      const details = await providerWithToken.getServerDetails(server.id);
      if (details.ip && isValidAssignedIp(details.ip)) {
        try {
          assertValidIp(details.ip);
          currentIp = details.ip;
          break;
        } catch (error) {
          // Invalid IP format from API — skip and retry
          debugLog?.("invalid IP format from provider API", { cause: error });
        }
      }
      refreshAttempts++;
      await new Promise((resolve) => setTimeout(resolve, ipConfig.interval));
    }
    if (!isValidAssignedIp(currentIp)) {
      ipSpinner.fail("Could not obtain server IP address");
      logger.warning("The server was created but IP assignment timed out.");
      logger.info(`Check IP later with: kastell status ${server.id}`);
    } else {
      ipSpinner.succeed(`IP address assigned: ${currentIp}`);
    }
  }

  // Health check polling instead of blind wait (skip if no valid IP or bare mode)
  const isBare = !platform;
  const hasValidIp = currentIp !== "0.0.0.0" && currentIp !== "pending" && currentIp !== "";
  const minWait = COOLIFY_MIN_WAIT[providerChoice] || 60000;
  const platformPort = platform === "dokploy" ? DOKPLOY_PORT : COOLIFY_PORT;
  const ready = !isBare && hasValidIp ? await waitForCoolify(currentIp, minWait, POLL_DELAY_MS, 60, platformPort) : false;

  return { ip: currentIp, ready };
}

// ── Phase 3: Post-setup (save, configure, messaging) ─────────────────

async function barePostSetup(
  serverId: string,
  serverName: string,
  serverIp: string,
  fullSetup?: boolean,
): Promise<KastellResult<DeployData>> {
  const hasValidIp = isValidAssignedIp(serverIp);

  // Wait for SSH + cloud-init to finish (BUG-5)
  if (hasValidIp) {
    // Proactively clear stale known_hosts entry (cloud providers reuse IPs)
    removeStaleHostKey(serverIp);

    const cloudInitSpinner = createSpinner("Waiting for server to accept SSH...");
    cloudInitSpinner.start();

    // Step 1: Wait for SSH to become available (retry up to 60 attempts, 5s apart = 5 min max)
    let sshReady = false;
    for (let attempt = 1; attempt <= 60; attempt++) {
      try {
        await sshExec(serverIp, raw("echo ok"));
        sshReady = true;
        break;
      } catch (error) {
        cloudInitSpinner.text = `Waiting for server to accept SSH... (attempt ${attempt}/60)`;
        debugLog?.("SSH not ready during cloud-init", { cause: error });
        await new Promise((r) => setTimeout(r, POLL_DELAY_MS));
      }
    }

    if (sshReady) {
      // Step 2: Wait for cloud-init to finish
      cloudInitSpinner.text = "SSH ready — waiting for cloud-init to finish...";
      try {
        const ciResult = await sshExec(serverIp, raw("cloud-init status --wait"));
        if (ciResult.code === 0) {
          cloudInitSpinner.succeed("Cloud-init completed");
        } else {
          cloudInitSpinner.warn("Cloud-init may not have finished — continuing anyway");
        }
      } catch (error) {
        cloudInitSpinner.warn("Could not check cloud-init status — continuing anyway");
        debugLog?.("cloud-init status check failed", { cause: error });
      }
    } else {
      cloudInitSpinner.warn("SSH not available after 5 min — continuing anyway");
    }
  }

  // Full setup: firewall + secure (BUG-1)
  if (fullSetup && hasValidIp) {
    logger.title("Running full setup (firewall + security)...");
    try {
      await firewallSetup(serverIp, serverName, false, true);
    } catch (error: unknown) {
      logger.warning(`Firewall setup failed: ${getErrorMessage(error)}`);
    }
    try {
      await secureSetup(serverIp, serverName, undefined, false, true);
    } catch (error: unknown) {
      logger.warning(`Security setup failed: ${getErrorMessage(error)}`);
    }
  } else if (fullSetup && !hasValidIp) {
    logger.warning("Skipping full setup: server IP not available.");
  }

  // Show bare server info
  logger.title("Bare Server Ready!");
  console.log();
  logger.success(`Bare server ready!`);
  logger.info(`SSH: ssh root@${serverIp}`);
  logger.info(`IP: ${serverIp}`);
  logger.info("Mode: bare (no platform installed)");
  console.log();
  if (!fullSetup) {
    logger.info("  Secure your server:");
    logger.step(`     kastell firewall setup ${serverName}`);
    logger.step(`     kastell secure setup ${serverName}`);
    console.log();
  }
  logger.info("  Server saved to local config. Use 'kastell list' to see all servers.");
  console.log();
  return { success: true, data: { serverId, serverIp, serverName } };
}

async function platformPostSetup(
  serverId: string,
  serverName: string,
  serverIp: string,
  platform: Platform,
  ready: boolean,
  fullSetup?: boolean,
  noOpen?: boolean,
): Promise<KastellResult<DeployData>> {
  const hasValidIp = isValidAssignedIp(serverIp);
  const platformPort = platform === "dokploy" ? DOKPLOY_PORT : COOLIFY_PORT;
  const platformName = platform === "dokploy" ? "Dokploy" : "Coolify";

  // Full setup: auto-configure firewall + SSH hardening
  if (fullSetup && ready) {
    // Clear stale known_hosts entry (cloud providers reuse IPs)
    removeStaleHostKey(serverIp);

    logger.title("Running full setup (firewall + security)...");
    try {
      await firewallSetup(serverIp, serverName, false);
    } catch (error: unknown) {
      logger.warning(`Firewall setup failed: ${getErrorMessage(error)}`);
    }
    try {
      await secureSetup(serverIp, serverName, undefined, false, true);
    } catch (error: unknown) {
      logger.warning(`Security setup failed: ${getErrorMessage(error)}`);
    }
  } else if (fullSetup && !ready) {
    logger.warning(`Skipping full setup: ${platformName} is not ready yet.`);
    logger.info("Run manually later: kastell firewall setup && kastell secure setup");
  }

  // Success message
  logger.title("Deployment Successful!");
  console.log();
  logger.success(`Server IP: ${serverIp}`);
  logger.success(`Access ${platformName}: http://${serverIp}:${platformPort}`);
  console.log();
  if (ready) {
    logger.info(`${platformName} is ready! Open the URL above to get started.`);
    if (!noOpen && hasValidIp) {
      openBrowser(`http://${serverIp}:${platformPort}`);
    }
  } else {
    logger.warning(`${platformName} did not respond yet. Please check in a few minutes.`);
    logger.info(`You can check status later with: kastell status ${serverIp}`);
  }

  // Onboarding: next steps
  console.log();
  logger.title("What's Next?");
  if (!fullSetup) {
    logger.info("  1. Secure your server:");
    logger.step(`     kastell firewall setup ${serverName}`);
    logger.step(`     kastell secure setup ${serverName}`);
    console.log();
    logger.info("  2. Add a domain with SSL:");
    logger.step(`     kastell domain add ${serverName} --domain example.com`);
    console.log();
    logger.info("  3. Create your first backup:");
    logger.step(`     kastell backup ${serverName}`);
    console.log();
    logger.info("  Tip: Do steps 1-3 automatically next time:");
    logger.step("     kastell init --full-setup");
  } else {
    logger.info("  1. Add a domain with SSL:");
    logger.step(`     kastell domain add ${serverName} --domain example.com`);
    console.log();
    logger.info("  2. Create your first backup:");
    logger.step(`     kastell backup ${serverName}`);
  }
  console.log();
  logger.info("  Check your environment anytime:");
  logger.step("     kastell doctor");
  console.log();
  logger.info("  Server saved to local config. Use 'kastell list' to see all servers.");
  console.log();
  logger.info("  Docs: https://github.com/kastelldev/kastell");
  console.log(
    "  \u2b50 Love Kastell? Give us a star: https://github.com/kastelldev/kastell \u2b50",
  );
  console.log();

  return {
    success: true,
    data: { serverId, serverIp, serverName, platform },
  };
}

async function postSetup(
  providerChoice: string,
  serverId: string,
  serverName: string,
  serverIp: string,
  region: string,
  serverSize: string,
  platform: Platform | undefined,
  ready: boolean,
  fullSetup?: boolean,
  noOpen?: boolean,
): Promise<KastellResult<DeployData>> {
  const isBare = !platform;

  // Save server record to config (shared by both paths)
  await saveServer({
    id: serverId,
    name: serverName,
    provider: providerChoice,
    ip: serverIp,
    region,
    size: serverSize,
    createdAt: new Date().toISOString(),
    ...(isBare
      ? { mode: "bare" as const }
      : { mode: "coolify" as const, platform }),
  });

  if (isBare) {
    return barePostSetup(serverId, serverName, serverIp, fullSetup);
  }
  return platformPostSetup(serverId, serverName, serverIp, platform!, ready, fullSetup, noOpen);
}

// ── Orchestrator ─────────────────────────────────────────────────────

export async function deployServer(
  providerChoice: string,
  providerWithToken: CloudProvider,
  region: string,
  serverSize: string,
  serverName: string,
  fullSetup?: boolean,
  noOpen?: boolean,
  mode?: string,
): Promise<KastellResult<DeployData>> {
  try {
    // Upload SSH key before creating server
    const sshKeyIds = await uploadSshKeyToProvider(providerWithToken);
    const isBare = mode === "bare";
    const platform: Platform | undefined = isBare ? undefined : (mode === "dokploy" ? "dokploy" : "coolify");
    const cloudInit = platform
      ? getAdapter(platform).getCloudInit(serverName)
      : getBareCloudInit(serverName);

    // Phase 1: Create server with retry
    const createResult = await createServerWithRetry(
      providerWithToken, serverName, region, serverSize, cloudInit, sshKeyIds, mode,
    );
    if (!createResult.success || !createResult.data) {
      return { success: false, error: createResult.error ?? "Server creation failed" };
    }

    const { id, ip, name, region: finalRegion, size: finalSize } = createResult.data;

    // Phase 2: Wait for ready
    const readyResult = await waitForReady(
      providerWithToken, { id, ip }, providerChoice, platform,
    );

    // Phase 3: Post-setup (save, configure, messaging)
    return await postSetup(
      providerChoice, id, name, readyResult.ip, finalRegion, finalSize,
      platform, readyResult.ready, fullSetup, noOpen,
    );
  } catch (error: unknown) {
    logger.error(`Deployment failed: ${getErrorMessage(error)}`);
    const hint = mapProviderError(error, providerChoice);
    if (hint) {
      logger.info(hint);
    }
    return { success: false, error: `Deployment failed: ${getErrorMessage(error)}`, hint: hint ?? undefined };
  }
}
