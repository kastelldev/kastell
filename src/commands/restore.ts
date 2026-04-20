import { existsSync } from "fs";
import { join, basename } from "path";
import inquirer from "inquirer";
import { resolveServer } from "../utils/serverSelect.js";
import { checkSshAvailable } from "../utils/ssh.js";
import { isBareServer } from "../utils/modeGuard.js";
import { logger, createSpinner } from "../utils/logger.js";
import { mapSshError, classifyError } from "../utils/errorMapper.js";
import { isSafeMode } from "../core/manage.js";
import { logSafeModeBlock } from "../utils/safeMode.js";
import { getAdapter } from "../adapters/factory.js";
import { adapterDisplayName } from "../adapters/shared.js";
import {
  listBackups,
  getBackupDir,
  buildStopCoolifyCommand,
  buildStartCoolifyCommand,
  buildStartDbCommand,
  buildRestoreDbCommand,
  buildRestoreConfigCommand,
  buildCleanupCommand,
  loadManifest,
  restoreBareBackup,
} from "../core/backup.js";

// Command

export async function restoreCommand(
  query?: string,
  options?: { dryRun?: boolean; backup?: string; force?: boolean },
): Promise<void> {
  if (!checkSshAvailable()) {
    logger.error("SSH client not found. Please install OpenSSH.");
    return;
  }

  // SAFE_MODE check — applies before mode routing (blocks ALL restore operations)
  if (isSafeMode()) {
    logSafeModeBlock("restore", { category: "destructive" });
    logger.error(
      "Restore is blocked by SAFE_MODE. Set KASTELL_SAFE_MODE=false to allow restore operations.",
    );
    return;
  }

  const server = await resolveServer(query, "Select a server to restore:");
  if (!server) return;

  const dryRun = options?.dryRun || false;

  // Select backup
  let selectedBackup: string;

  if (options?.backup) {
    selectedBackup = basename(options.backup);
  } else if (options?.force) {
    const backups = listBackups(server.name);
    if (backups.length === 0) {
      logger.info(`No backups found for ${server.name}. Run 'kastell backup' first.`);
      return;
    }
    selectedBackup = backups[backups.length - 1]; // latest backup
    logger.info(`Auto-selected latest backup: ${selectedBackup}`);
  } else {
    const backups = listBackups(server.name);
    if (backups.length === 0) {
      logger.info(`No backups found for ${server.name}. Run 'kastell backup' first.`);
      return;
    }

    const { backup } = await inquirer.prompt([
      {
        type: "list",
        name: "backup",
        message: "Select a backup to restore:",
        choices: backups.map((b) => {
          const m = loadManifest(join(getBackupDir(server.name), b));
          const info = m ? ` [${m.provider}${m.mode === "bare" ? "/bare" : ""}]` : "";
          return { name: `${b}${info}`, value: b };
        }),
      },
    ]);
    selectedBackup = backup;
  }

  const backupPath = join(getBackupDir(server.name), selectedBackup);
  const manifest = loadManifest(backupPath);

  if (!manifest) {
    logger.error(`Invalid backup: manifest.json not found in ${backupPath}`);
    return;
  }

  // Cross-provider warning
  if (manifest.provider && manifest.provider !== server.provider) {
    logger.warning(
      `Backup was created on ${manifest.provider} but restoring to ${server.provider}. Proceed with caution.`,
    );
  }

  // Mode mismatch block
  const serverMode = server.mode || "coolify";
  const backupMode = manifest.mode || "coolify";
  if (serverMode !== backupMode) {
    logger.error(
      `Mode mismatch: backup is "${backupMode}" but server "${server.name}" is "${serverMode}". Cannot restore across modes.`,
    );
    return;
  }

  // Verify backup files exist
  for (const file of manifest.files) {
    if (!existsSync(join(backupPath, file))) {
      logger.error(`Missing backup file: ${file}`);
      return;
    }
  }

  // Determine platform (default to coolify for backward compat)
  const platform = manifest.platform ?? "coolify";

  if (dryRun) {
    logger.title("Dry Run - Restore");
    logger.info(`Server: ${server.name} (${server.ip})`);
    logger.info(`Backup: ${selectedBackup}`);
    const dryRunAdapter = getAdapter(platform);
    logger.info(`${adapterDisplayName(dryRunAdapter)} version: ${manifest.coolifyVersion}`);
    console.log();
    logger.info("Steps to execute:");
    logger.step("Upload backup files to server");
    if (dryRunAdapter.name === "dokploy") {
      logger.step("docker service scale dokploy=0");
      logger.step("docker service scale dokploy-postgres=1 && sleep 5");
      logger.step(
        "gunzip -c /tmp/dokploy-backup.sql.gz | docker exec -i $(docker ps -qf name=dokploy-postgres) psql -U postgres -d dokploy",
      );
      logger.step("tar xzf /tmp/dokploy-config.tar.gz -C /etc/dokploy");
      logger.step("docker service scale dokploy=1");
      logger.step("rm -f /tmp/dokploy-backup.sql.gz /tmp/dokploy-config.tar.gz");
    } else {
      logger.step(buildStopCoolifyCommand());
      logger.step(buildStartDbCommand());
      logger.step(buildRestoreDbCommand());
      logger.step(buildRestoreConfigCommand());
      logger.step(buildStartCoolifyCommand());
      logger.step(buildCleanupCommand());
    }
    console.log();
    logger.warning("No changes applied. Remove --dry-run to execute.");
    return;
  }

  if (!options?.force) {
    // Double confirmation
    const { confirm } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirm",
        message: `This will restore "${server.name}" from backup ${selectedBackup}. Current data will be OVERWRITTEN. Continue?`,
        default: false,
      },
    ]);

    if (!confirm) {
      logger.info("Restore cancelled.");
      return;
    }

    const { confirmName } = await inquirer.prompt([
      {
        type: "input",
        name: "confirmName",
        message: `Type the server name "${server.name}" to confirm:`,
      },
    ]);

    if (confirmName.trim() !== server.name) {
      logger.error("Server name does not match. Restore cancelled.");
      return;
    }
  }

  // Bare server: restore system config files (no Coolify stop/start)
  if (isBareServer(server)) {
    const result = await restoreBareBackup(server.ip, server.name, selectedBackup);
    if (result.success) {
      logger.success(`Restore complete for ${server.name}`);
      logger.info("Config files restored. Restart affected services manually (nginx, ssh, ufw, etc.)");
    } else {
      logger.error(`Restore failed: ${result.error}`);
      if (result.hint) logger.info(result.hint);
    }
    return;
  }

  // Delegate to platform adapter
  const adapter = getAdapter(platform);
  if (!adapter.restoreBackup) {
    logger.error(`Platform "${platform}" does not support restore.`);
    return;
  }

  const platformLabel = adapterDisplayName(adapter);
  const restoreSpinner = createSpinner(`Restoring ${platformLabel}...`);
  restoreSpinner.start();

  try {
    const result = await adapter.restoreBackup(server.ip, backupPath, manifest);

    if (result.success) {
      restoreSpinner.succeed(`${platformLabel} restore complete`);
      // Show step details
      for (const step of result.steps) {
        if (step.status === "success") {
          logger.success(`  ${step.name}`);
        }
      }
      console.log();
      logger.success(`Restore complete for ${server.name}`);
      logger.info(`Backup: ${selectedBackup} (${platformLabel} ${manifest.coolifyVersion})`);
      logger.info(`Access ${platformLabel}: http://${server.ip}:${adapter.port}`);
    } else {
      restoreSpinner.fail(`${platformLabel} restore failed`);
      // Show step details (successes and failures)
      for (const step of result.steps) {
        if (step.status === "success") {
          logger.success(`  ${step.name}`);
        } else {
          logger.error(`  ${step.name}: ${step.error || "failed"}`);
        }
      }
      if (result.error) logger.error(result.error);
      if (result.hint) logger.info(result.hint);
    }
  } catch (error: unknown) {
    restoreSpinner.fail(`${platformLabel} restore failed`);
    const classified = classifyError(error);
    logger.error(classified.message);
    if (classified.hint) logger.info(classified.hint);
    if (!classified.isTyped) {
      const hint = mapSshError(error, server.ip);
      if (hint) logger.info(hint);
    }
  }
}
