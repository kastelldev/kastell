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
  maintainServer,
  type MaintainResult,
  type StepResult,
} from "../core/maintain.js";
import { getAdapter, resolvePlatform } from "../adapters/factory.js";
import { adapterDisplayName } from "../adapters/shared.js";

interface MaintainOptions {
  skipReboot?: boolean;
  all?: boolean;
  dryRun?: boolean;
  skipSnapshot?: boolean;
  force?: boolean;
}

function showDryRun(server: ServerRecord, skipReboot: boolean): void {
  const platform = resolvePlatform(server);
  const displayName = platform ? adapterDisplayName(getAdapter(platform)) : "Platform";

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

async function offerSnapshot(
  server: ServerRecord,
  apiToken: string,
  skipSnapshot?: boolean,
): Promise<void> {
  if (skipSnapshot || server.id.startsWith("manual-")) {
    if (server.id.startsWith("manual-")) {
      logger.info("Step 0: Manual server — snapshot skipped");
    }
    return;
  }

  try {
    const provider = createProviderWithToken(server.provider, apiToken);
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
}

function formatStepStatus(step: StepResult): string {
  const nameMap: Record<string, string> = {
    "Status Check": "status",
    "Health Check": "health",
    "Reboot": "reboot",
    "Final Check": "final",
  };

  // For dynamic names like "Dokploy Update" or "Coolify Update"
  let label = nameMap[step.name];
  if (!label && step.name.includes("Update")) {
    label = "update";
  }
  if (!label) {
    label = step.name.toLowerCase();
  }

  switch (step.status) {
    case "success":
      return `${label} OK`;
    case "skipped":
      return `${label} SKIP`;
    case "failure":
      return `${label} FAIL`;
  }
}

function showReport(results: MaintainResult[]): void {
  console.log();
  logger.title("Maintenance Report");

  for (const r of results) {
    const stepLabels = r.steps.map(formatStepStatus);

    if (r.success) {
      logger.success(`${r.server}: ${stepLabels.join(", ")}`);
    } else {
      logger.error(`${r.server}: ${stepLabels.join(", ")}`);
    }
  }
}

async function runMaintain(
  server: ServerRecord,
  apiToken: string,
  options: MaintainOptions,
): Promise<MaintainResult> {
  logger.title(`Maintenance: ${server.name} (${server.ip})`);

  // Step 0: Offer snapshot (UI logic — stays in command)
  await offerSnapshot(server, apiToken, options.skipSnapshot || options.force);
  console.log();

  // Steps 1-5: Delegate to core
  const result = await maintainServer(server, apiToken, {
    skipReboot: options.skipReboot,
  });

  // Render step progress via spinners for CLI output
  for (const step of result.steps) {
    const spinner = createSpinner(`Step ${step.step}: ${step.name}...`);
    spinner.start();
    switch (step.status) {
      case "success":
        spinner.succeed(`Step ${step.step}: ${step.detail ?? step.name}`);
        break;
      case "failure":
        spinner.fail(`Step ${step.step}: ${step.error ?? step.name} failed`);
        if (step.hint) logger.info(step.hint);
        break;
      case "skipped":
        spinner.warn(`Step ${step.step}: ${step.detail ?? step.name} — skipped`);
        break;
    }
  }

  return result;
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
        `Bare server detected: ${server.name}. The 'maintain' command requires a platform adapter (Coolify or Dokploy).`,
      );
      logger.info(
        "  To update packages manually: apt update && apt upgrade -y",
      );
      logger.info(
        "  To apply security hardening: kastell fix --safe --server " + server.name,
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

    const result = await runMaintain(server, token, { ...options, skipSnapshot: true });
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
  const result = await runMaintain(server, apiToken, options ?? {});
  showReport([result]);
}
