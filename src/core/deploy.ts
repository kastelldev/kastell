import { spawnSync } from "child_process";
import type { CloudProvider } from "../providers/base.js";
import type { ServerMode, Platform } from "../types/index.js";
import { getBareCloudInit } from "../utils/cloudInit.js";
import { getAdapter } from "../adapters/factory.js";
import { logger, createSpinner } from "../utils/logger.js";
import { getErrorMessage, mapProviderError } from "../utils/errorMapper.js";
import { openBrowser } from "../utils/openBrowser.js";
import { assertValidIp, sanitizedEnv, sshExec } from "../utils/ssh.js";
import { findLocalSshKey, generateSshKey, getSshKeyName } from "../utils/sshKey.js";
import { saveServer } from "../utils/config.js";
import { waitForCoolify } from "../utils/healthCheck.js";
import {
  BACK_SIGNAL,
  getServerNameConfig,
  getLocationConfig,
  getServerTypeConfig,
} from "../utils/prompts.js";
import { firewallSetup } from "../commands/firewall.js";
import { secureSetup } from "../commands/secure.js";
import { IP_WAIT, COOLIFY_MIN_WAIT } from "../constants.js";

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

export async function deployServer(
  providerChoice: string,
  providerWithToken: CloudProvider,
  region: string,
  serverSize: string,
  serverName: string,
  fullSetup?: boolean,
  noOpen?: boolean,
  mode?: string,
): Promise<void> {
  try {
    // Upload SSH key before creating server
    const sshKeyIds = await uploadSshKeyToProvider(providerWithToken);
    const isBare = mode === "bare";
    const platform: Platform | undefined = isBare ? undefined : (mode === "dokploy" ? "dokploy" : "coolify");
    const cloudInit = platform
      ? getAdapter(platform).getCloudInit(serverName)
      : getBareCloudInit(serverName);

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
          name: serverName,
          region,
          size: serverSize,
          cloudInit,
          sshKeyIds,
        });
        serverSpinner.succeed(`Server created (ID: ${server.id})`);
      } catch (createError: unknown) {
        serverSpinner.fail("Server creation failed");
        const errorMsg = getErrorMessage(createError);

        if (errorMsg.includes("already") && errorMsg.includes("used")) {
          logger.warning(`Server name "${serverName}" is already in use`);
          logger.info("Please choose a different name:");
          let newName = BACK_SIGNAL;
          while (newName === BACK_SIGNAL) {
            newName = await getServerNameConfig(mode);
          }
          serverName = newName;
          retries++;
        } else if (errorMsg.includes("location disabled")) {
          failedLocations.push(region);
          logger.warning(`Location "${region}" is currently disabled for new servers`);
          logger.info("Please select a different region and server type:");
          let pickedSize = false;
          while (!pickedSize) {
            let newRegion = BACK_SIGNAL;
            while (newRegion === BACK_SIGNAL) {
              newRegion = await getLocationConfig(providerWithToken, failedLocations);
            }
            region = newRegion;
            const newSize = await getServerTypeConfig(providerWithToken, region, [], mode as ServerMode);
            if (newSize === BACK_SIGNAL) continue;
            serverSize = newSize;
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
            failedTypes.push(serverSize);
            logger.warning(`Server type "${serverSize}" is not available in this location`);
            logger.info("Please select a different server type:");
            let newSize = BACK_SIGNAL;
            while (newSize === BACK_SIGNAL) {
              newSize = await getServerTypeConfig(providerWithToken, region, failedTypes, mode as ServerMode);
            }
            serverSize = newSize;
            retries++;
          } else {
            throw createError;
          }
        } else {
          throw createError;
        }
      }
    }

    /* istanbul ignore next */
    if (!server) {
      logger.error("Could not create server after multiple attempts");
      process.exit(1);
    }

    // Wait for server to be running
    const statusSpinner = createSpinner("Waiting for server to boot...");
    statusSpinner.start();

    let status = await providerWithToken.getServerStatus(server.id);
    let attempts = 0;
    const maxAttempts = 30;

    while (status !== "running" && attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      status = await providerWithToken.getServerStatus(server.id);
      attempts++;
    }

    if (status !== "running") {
      statusSpinner.fail("Server failed to start");
      logger.error("Please check your cloud provider dashboard");
      return;
    }

    statusSpinner.succeed("Server is running");

    // Refresh server details to get final IP (DO/Vultr/Linode assign IP after boot)
    if (server.ip === "pending" || server.ip === "0.0.0.0" || server.ip === "") {
      const ipConfig = IP_WAIT[providerChoice] || { attempts: 10, interval: 3000 };
      const ipSpinner = createSpinner("Waiting for IP address assignment...");
      ipSpinner.start();
      let refreshAttempts = 0;
      while (refreshAttempts < ipConfig.attempts) {
        const details = await providerWithToken.getServerDetails(server.id);
        if (details.ip && details.ip !== "0.0.0.0" && details.ip !== "pending" && details.ip !== "") {
          try {
            assertValidIp(details.ip);
            server.ip = details.ip;
            break;
          } catch {
            // Invalid IP format from API — skip and retry
          }
        }
        refreshAttempts++;
        await new Promise((resolve) => setTimeout(resolve, ipConfig.interval));
      }
      if (server.ip === "pending" || server.ip === "0.0.0.0" || server.ip === "") {
        ipSpinner.fail("Could not obtain server IP address");
        logger.warning("The server was created but IP assignment timed out.");
        logger.info(`Check IP later with: kastell status ${server.id}`);
      } else {
        ipSpinner.succeed(`IP address assigned: ${server.ip}`);
      }
    }

    // Health check polling instead of blind wait (skip if no valid IP or bare mode)
    const hasValidIp = server.ip !== "0.0.0.0" && server.ip !== "pending" && server.ip !== "";
    const minWait = COOLIFY_MIN_WAIT[providerChoice] || 60000;
    const platformPort = platform === "dokploy" ? 3000 : 8000;
    const ready = !isBare && hasValidIp ? await waitForCoolify(server.ip, minWait, 5000, 60, platformPort) : false;

    // Save server record to config
    saveServer({
      id: server.id,
      name: serverName,
      provider: providerChoice,
      ip: server.ip,
      region,
      size: serverSize,
      createdAt: new Date().toISOString(),
      ...(isBare
        ? { mode: "bare" as const }
        : { mode: "coolify" as const, platform }),
    });

    // Bare mode: cloud-init wait + optional full setup + show SSH info
    if (isBare) {
      // Wait for SSH + cloud-init to finish (BUG-5)
      if (hasValidIp) {
        const cloudInitSpinner = createSpinner("Waiting for server to accept SSH...");
        cloudInitSpinner.start();

        // Step 1: Wait for SSH to become available (retry up to 60 attempts, 5s apart = 5 min max)
        let sshReady = false;
        for (let attempt = 1; attempt <= 60; attempt++) {
          try {
            await sshExec(server.ip, "echo ok");
            sshReady = true;
            break;
          } catch {
            cloudInitSpinner.text = `Waiting for server to accept SSH... (attempt ${attempt}/60)`;
            await new Promise((r) => setTimeout(r, 5000));
          }
        }

        if (sshReady) {
          // Step 2: Wait for cloud-init to finish
          cloudInitSpinner.text = "SSH ready — waiting for cloud-init to finish...";
          try {
            const ciResult = await sshExec(server.ip, "cloud-init status --wait");
            if (ciResult.code === 0) {
              cloudInitSpinner.succeed("Cloud-init completed");
            } else {
              cloudInitSpinner.warn("Cloud-init may not have finished — continuing anyway");
            }
          } catch {
            cloudInitSpinner.warn("Could not check cloud-init status — continuing anyway");
          }
        } else {
          cloudInitSpinner.warn("SSH not available after 5 min — continuing anyway");
        }
      }

      // Full setup: firewall + secure (BUG-1)
      if (fullSetup && hasValidIp) {
        try {
          assertValidIp(server.ip); // Defense-in-depth: IP validated before ssh-keygen
          spawnSync("ssh-keygen", ["-R", server.ip], { stdio: "ignore", env: sanitizedEnv() });
        } catch {
          // ssh-keygen not available or no entry — harmless
        }
        logger.title("Running full setup (firewall + security)...");
        try {
          await firewallSetup(server.ip, serverName, false, true);
        } catch (error: unknown) {
          logger.warning(`Firewall setup failed: ${getErrorMessage(error)}`);
        }
        try {
          await secureSetup(server.ip, serverName, undefined, false, true);
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
      logger.info(`SSH: ssh root@${server.ip}`);
      logger.info(`IP: ${server.ip}`);
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
      return;
    }

    // Platform display name for messages
    const platformName = platform === "dokploy" ? "Dokploy" : "Coolify";

    // Full setup: auto-configure firewall + SSH hardening
    if (fullSetup && ready) {
      // Clear stale known_hosts entry (cloud providers reuse IPs)
      try {
        assertValidIp(server.ip); // Defense-in-depth: IP validated before ssh-keygen
        spawnSync("ssh-keygen", ["-R", server.ip], { stdio: "ignore", env: sanitizedEnv() });
      } catch {
        // ssh-keygen not available or no entry — harmless
      }

      logger.title("Running full setup (firewall + security)...");
      try {
        await firewallSetup(server.ip, serverName, false);
      } catch (error: unknown) {
        logger.warning(`Firewall setup failed: ${getErrorMessage(error)}`);
      }
      try {
        await secureSetup(server.ip, serverName, undefined, false, true);
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
    logger.success(`Server IP: ${server.ip}`);
    logger.success(`Access ${platformName}: http://${server.ip}:${platformPort}`);
    console.log();
    if (ready) {
      logger.info(`${platformName} is ready! Open the URL above to get started.`);
      if (!noOpen && hasValidIp) {
        openBrowser(`http://${server.ip}:${platformPort}`);
      }
    } else {
      logger.warning(`${platformName} did not respond yet. Please check in a few minutes.`);
      logger.info(`You can check status later with: kastell status ${server.ip}`);
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
  } catch (error: unknown) {
    logger.error(`Deployment failed: ${getErrorMessage(error)}`);
    const hint = mapProviderError(error, providerChoice);
    if (hint) {
      logger.info(hint);
    }
    process.exit(1);
  }
}
