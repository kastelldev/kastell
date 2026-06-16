import inquirer from "inquirer";
import { getServers } from "../utils/config.js";
import { resolveServer, promptApiToken, collectProviderTokens } from "../utils/serverSelect.js";
import { logger, createSpinner } from "../utils/logger.js";
import { markCommandFailed } from "../utils/exitCode.js";
import { createSnapshot, listSnapshots, deleteSnapshot, restoreSnapshot } from "../core/snapshot.js";
import { isSafeMode } from "../core/manage.js";
import { logSafeModeBlock } from "../utils/safeMode.js";
import { createProviderWithToken } from "../utils/providerFactory.js";
import { confirmOrCancel, enforceOrCancel } from "../utils/prompts.js";

interface SnapshotOptions {
  all?: boolean;
  dryRun?: boolean;
  force?: boolean;
}

async function snapshotCreate(
  query?: string,
  options?: SnapshotOptions,
): Promise<void> {
  if (isSafeMode()) {
    logSafeModeBlock("snapshot-create", { category: "destructive" });
    logger.error("Snapshot creation is blocked in SAFE_MODE (billable operation). Set KASTELL_SAFE_MODE=false to allow.");
    markCommandFailed();
    return;
  }

  const server = await resolveServer(query, "Select a server to snapshot:");
  if (!server) return;

  const apiToken = await promptApiToken(server.provider);
  const provider = createProviderWithToken(server.provider, apiToken);

  // Get cost estimate
  const costSpinner = createSpinner("Estimating snapshot cost...");
  costSpinner.start();
  let costEstimate = "unknown";
  try {
    costEstimate = await provider.getSnapshotCostEstimate(server.id);
    costSpinner.succeed(`Estimated cost: ${costEstimate}`);
  } catch {
    costSpinner.warn("Could not estimate cost");
  }

  if (options?.dryRun) {
    logger.title("Dry Run - Create Snapshot");
    logger.info(`Server: ${server.name} (${server.ip})`);
    logger.info(`Estimated cost: ${costEstimate}`);
    logger.info(`Snapshot name: kastell-${Date.now()}`);
    console.log();
    logger.warning("No changes applied. Remove --dry-run to execute.");
    return;
  }

  if (!options?.force) {
    // Destructive guard: refuse before mutation in non-TTY mode without --force (P142 Task 9)
    const decision = await confirmOrCancel(
      `Create snapshot of ${server.name}? (Estimated cost: ${costEstimate})`,
      false,
      "Use --force to create snapshot in non-interactive mode.",
    );
    if (!enforceOrCancel(decision)) return;
  }

  const spinner = createSpinner(`Creating snapshot...`);
  spinner.start();

  const result = await createSnapshot(server, apiToken);
  if (result.success && result.snapshot) {
    spinner.succeed(`Snapshot created: ${result.snapshot.name} (${result.snapshot.id})`);
    logger.info(`Status: ${result.snapshot.status}`);
    logger.info(`Cost: ${result.snapshot.costPerMonth}`);
  } else {
    spinner.fail("Failed to create snapshot");
    if (result.error) logger.error(result.error);
    if (result.hint) logger.info(result.hint);
    markCommandFailed();
  }
}

async function snapshotList(query?: string): Promise<void> {
  const server = await resolveServer(query, "Select a server to list snapshots:");
  if (!server) return;

  const apiToken = await promptApiToken(server.provider);

  const spinner = createSpinner(`Fetching snapshots for ${server.name}...`);
  spinner.start();

  const result = await listSnapshots(server, apiToken);
  if (result.error) {
    spinner.fail("Failed to list snapshots");
    logger.error(result.error);
    if (result.hint) logger.info(result.hint);
    markCommandFailed();
    return;
  }

  if (result.snapshots.length === 0) {
    spinner.succeed(`No snapshots found for ${server.name}`);
    return;
  }

  spinner.succeed(`${result.snapshots.length} snapshot(s) found for ${server.name}`);
  console.log();

  for (const snap of result.snapshots) {
    logger.step(
      `${snap.name} | ID: ${snap.id} | Size: ${snap.sizeGb.toFixed(1)} GB | Cost: ${snap.costPerMonth} | Created: ${snap.createdAt}`,
    );
  }
}

async function snapshotListAll(): Promise<void> {
  const servers = getServers();
  if (servers.length === 0) {
    logger.info("No servers found. Deploy one with: kastell init");
    return;
  }

  const tokenMap = await collectProviderTokens(servers);
  let failed = 0;

  for (const server of servers) {
    const token = tokenMap.get(server.provider);
    if (!token) {
      logger.warning(`${server.name}: No API token for ${server.provider}, skipped`);
      console.log();
      failed += 1;
      continue;
    }

    const spinner = createSpinner(`Fetching snapshots for ${server.name}...`);
    spinner.start();

    const result = await listSnapshots(server, token);
    if (result.error) {
      spinner.fail(`${server.name}: Failed to list snapshots`);
      logger.error(result.error);
      if (result.hint) logger.info(result.hint);
      failed += 1;
    } else if (result.snapshots.length === 0) {
      spinner.succeed(`${server.name}: No snapshots`);
    } else {
      spinner.succeed(`${server.name}: ${result.snapshots.length} snapshot(s)`);
      for (const snap of result.snapshots) {
        logger.step(
          `  ${snap.name} | ID: ${snap.id} | Size: ${snap.sizeGb.toFixed(1)} GB | Cost: ${snap.costPerMonth} | Created: ${snap.createdAt}`,
        );
      }
    }
    console.log();
  }

  if (failed > 0) markCommandFailed();
}

async function snapshotDelete(
  query?: string,
  options?: SnapshotOptions,
): Promise<void> {
  const server = await resolveServer(query, "Select a server:");
  if (!server) return;

  const apiToken = await promptApiToken(server.provider);

  // List snapshots to select from
  const listSpinner = createSpinner("Fetching snapshots...");
  listSpinner.start();

  const listResult = await listSnapshots(server, apiToken);
  if (listResult.error) {
    listSpinner.fail("Failed to list snapshots");
    logger.error(listResult.error);
    if (listResult.hint) logger.info(listResult.hint);
    markCommandFailed();
    return;
  }

  const snapshots = listResult.snapshots;
  if (snapshots.length === 0) {
    listSpinner.succeed("No snapshots to delete");
    return;
  }

  listSpinner.succeed(`${snapshots.length} snapshot(s) found`);

  const { selectedId } = await inquirer.prompt([
    {
      type: "list",
      name: "selectedId",
      message: "Select a snapshot to delete:",
      choices: snapshots.map((s) => ({
        name: `${s.name} (${s.sizeGb.toFixed(1)} GB, ${s.costPerMonth}, ${s.createdAt})`,
        value: s.id,
      })),
    },
  ]);

  if (!options?.force) {
    // Destructive guard: refuse before mutation in non-TTY mode without --force (P142 Task 9)
    const decision = await confirmOrCancel(
      `Delete snapshot ${selectedId}? This cannot be undone.`,
      false,
      "Use --force to delete snapshot in non-interactive mode.",
    );
    if (!enforceOrCancel(decision)) return;
  }

  const deleteSpinner = createSpinner("Deleting snapshot...");
  deleteSpinner.start();

  const deleteResult = await deleteSnapshot(server, apiToken, selectedId);
  if (deleteResult.success) {
    deleteSpinner.succeed("Snapshot deleted");
  } else {
    deleteSpinner.fail("Failed to delete snapshot");
    if (deleteResult.error) logger.error(deleteResult.error);
    if (deleteResult.hint) logger.info(deleteResult.hint);
    markCommandFailed();
  }
}

async function snapshotRestore(
  query?: string,
  options?: SnapshotOptions,
): Promise<void> {
  if (isSafeMode()) {
    logSafeModeBlock("snapshot-restore", { category: "destructive" });
    logger.error(
      "Snapshot restore is blocked by SAFE_MODE. Set KASTELL_SAFE_MODE=false to allow restore operations.",
    );
    markCommandFailed();
    return;
  }

  const server = await resolveServer(query, "Select a server to restore from snapshot:");
  if (!server) return;

  const apiToken = await promptApiToken(server.provider);

  const listSpinner = createSpinner("Fetching snapshots...");
  listSpinner.start();

  const listResult = await listSnapshots(server, apiToken);
  if (listResult.error) {
    listSpinner.fail("Failed to list snapshots");
    logger.error(listResult.error);
    if (listResult.hint) logger.info(listResult.hint);
    markCommandFailed();
    return;
  }

  const snapshots = listResult.snapshots;
  if (snapshots.length === 0) {
    listSpinner.succeed("No snapshots available for restore");
    return;
  }

  listSpinner.succeed(`${snapshots.length} snapshot(s) found`);

  const { selectedId } = await inquirer.prompt([
    {
      type: "list",
      name: "selectedId",
      message: "Select a snapshot to restore:",
      choices: snapshots.map((s) => ({
        name: `${s.name} (${s.sizeGb.toFixed(1)} GB, ${s.costPerMonth}, ${s.createdAt})`,
        value: s.id,
      })),
    },
  ]);

  if (!options?.force) {
    // Destructive guard: refuse before mutation in non-TTY mode without --force (P142 Task 9)
    const decision = await confirmOrCancel(
      `This will restore "${server.name}" from snapshot ${selectedId}. Current data will be OVERWRITTEN. Continue?`,
      false,
      "Use --force to restore snapshot in non-interactive mode.",
    );
    if (!enforceOrCancel(decision)) return;

    // TTY-only typed-name second confirmation (preserves snapshot restore UX)
    const { confirmName } = await inquirer.prompt([
      {
        type: "input",
        name: "confirmName",
        message: `Type the server name "${server.name}" to confirm:`,
      },
    ]);
    if (confirmName.trim() !== server.name) {
      logger.error("Server name does not match. Restore cancelled.");
      markCommandFailed();
      return;
    }
  }

  const spinner = createSpinner("Restoring from snapshot...");
  spinner.start();

  const result = await restoreSnapshot(server, apiToken, selectedId);
  if (result.success) {
    spinner.succeed("Snapshot restore initiated");
    logger.info("Server will be unavailable for several minutes during restore.");
    logger.info(`Verify with: kastell health ${server.name}`);
  } else {
    spinner.fail("Failed to restore from snapshot");
    if (result.error) logger.error(result.error);
    if (result.hint) logger.info(result.hint);
    markCommandFailed();
  }
}

export async function snapshotCommand(
  subcommand?: string,
  query?: string,
  options?: SnapshotOptions,
): Promise<void> {
  const sub = subcommand || "list";
  const validSubcommands = ["create", "list", "delete", "restore"];

  if (!validSubcommands.includes(sub)) {
    logger.error(
      `Invalid subcommand: ${sub}. Choose from: ${validSubcommands.join(", ")}`,
    );
    markCommandFailed();
    return;
  }

  switch (sub) {
    case "create":
      await snapshotCreate(query, options);
      break;
    case "list":
      if (options?.all) {
        await snapshotListAll();
      } else {
        await snapshotList(query);
      }
      break;
    case "delete":
      await snapshotDelete(query, options);
      break;
    case "restore":
      await snapshotRestore(query, options);
      break;
  }
}
