import { existsSync } from "fs";
import { join, basename } from "path";
import inquirer from "inquirer";
import { resolveServer } from "../utils/serverSelect.js";
import { checkSshAvailable, sshExec } from "../utils/ssh.js";
import { isBareServer } from "../utils/modeGuard.js";
import { listBackups, getBackupDir } from "./backup.js";
import { logger, createSpinner } from "../utils/logger.js";
import { getErrorMessage, mapSshError } from "../utils/errorMapper.js";
import { isSafeMode } from "../core/manage.js";
import {
  buildStopCoolifyCommand,
  buildStartCoolifyCommand,
  buildStartDbCommand,
  buildRestoreDbCommand,
  buildRestoreConfigCommand,
  buildCleanupCommand,
  loadManifest,
  scpUpload,
  tryRestartCoolify,
  restoreBareBackup,
} from "../core/backup.js";

// Re-export pure functions from core/backup.ts for backward compatibility
export {
  buildStopCoolifyCommand,
  buildStartCoolifyCommand,
  buildStartDbCommand,
  buildRestoreDbCommand,
  buildRestoreConfigCommand,
  buildCleanupCommand,
  loadManifest,
  scpUpload,
  tryRestartCoolify,
};

// Command

export async function restoreCommand(
  query?: string,
  options?: { dryRun?: boolean; backup?: string },
): Promise<void> {
  if (!checkSshAvailable()) {
    logger.error("SSH client not found. Please install OpenSSH.");
    return;
  }

  // SAFE_MODE check — applies before mode routing (blocks ALL restore operations)
  if (isSafeMode()) {
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
  const platform = manifest.platform || "coolify";

  if (dryRun) {
    logger.title("Dry Run - Restore");
    logger.info(`Server: ${server.name} (${server.ip})`);
    logger.info(`Backup: ${selectedBackup}`);
    logger.info(`${platform === "dokploy" ? "Dokploy" : "Coolify"} version: ${manifest.coolifyVersion}`);
    console.log();
    logger.info("Steps to execute:");
    logger.step("Upload backup files to server");
    if (platform === "dokploy") {
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

  // Step 1: Upload backup files
  const uploadSpinner = createSpinner("Uploading backup files...");
  uploadSpinner.start();

  try {
    const dbUpload = await scpUpload(
      server.ip,
      join(backupPath, "coolify-backup.sql.gz"),
      "/tmp/coolify-backup.sql.gz",
    );
    if (dbUpload.code !== 0) {
      uploadSpinner.fail("Failed to upload database backup");
      if (dbUpload.stderr) logger.error(dbUpload.stderr);
      return;
    }

    const configUpload = await scpUpload(
      server.ip,
      join(backupPath, "coolify-config.tar.gz"),
      "/tmp/coolify-config.tar.gz",
    );
    if (configUpload.code !== 0) {
      uploadSpinner.fail("Failed to upload config backup");
      if (configUpload.stderr) logger.error(configUpload.stderr);
      return;
    }
    uploadSpinner.succeed("Backup files uploaded");
  } catch (error: unknown) {
    uploadSpinner.fail("Failed to upload backup files");
    logger.error(getErrorMessage(error));
    const hint = mapSshError(error, server.ip);
    if (hint) logger.info(hint);
    return;
  }

  // Step 2: Stop Coolify
  const stopSpinner = createSpinner("Stopping Coolify...");
  stopSpinner.start();

  try {
    const stopResult = await sshExec(server.ip, buildStopCoolifyCommand());
    if (stopResult.code !== 0) {
      stopSpinner.fail("Failed to stop Coolify");
      if (stopResult.stderr) logger.error(stopResult.stderr);
      return;
    }
    stopSpinner.succeed("Coolify stopped");
  } catch (error: unknown) {
    stopSpinner.fail("Failed to stop Coolify");
    logger.error(getErrorMessage(error));
    const hint = mapSshError(error, server.ip);
    if (hint) logger.info(hint);
    return;
  }

  // Step 3: Start DB only
  const dbStartSpinner = createSpinner("Starting database...");
  dbStartSpinner.start();

  try {
    const dbStartResult = await sshExec(server.ip, buildStartDbCommand());
    if (dbStartResult.code !== 0) {
      dbStartSpinner.fail("Failed to start database");
      if (dbStartResult.stderr) logger.error(dbStartResult.stderr);
      await tryRestartCoolify(server.ip);
      return;
    }
    dbStartSpinner.succeed("Database started");
  } catch (error: unknown) {
    dbStartSpinner.fail("Failed to start database");
    logger.error(getErrorMessage(error));
    const hint = mapSshError(error, server.ip);
    if (hint) logger.info(hint);
    await tryRestartCoolify(server.ip);
    return;
  }

  // Step 4: Restore database
  const restoreDbSpinner = createSpinner("Restoring database...");
  restoreDbSpinner.start();

  try {
    const restoreResult = await sshExec(server.ip, buildRestoreDbCommand());
    if (restoreResult.code !== 0) {
      restoreDbSpinner.fail("Database restore failed");
      if (restoreResult.stderr) logger.error(restoreResult.stderr);
      await tryRestartCoolify(server.ip);
      return;
    }
    restoreDbSpinner.succeed("Database restored");
  } catch (error: unknown) {
    restoreDbSpinner.fail("Database restore failed");
    logger.error(getErrorMessage(error));
    const hint = mapSshError(error, server.ip);
    if (hint) logger.info(hint);
    await tryRestartCoolify(server.ip);
    return;
  }

  // Step 5: Restore config
  const restoreConfigSpinner = createSpinner("Restoring config files...");
  restoreConfigSpinner.start();

  try {
    const configResult = await sshExec(server.ip, buildRestoreConfigCommand());
    if (configResult.code !== 0) {
      restoreConfigSpinner.fail("Config restore failed");
      if (configResult.stderr) logger.error(configResult.stderr);
      await tryRestartCoolify(server.ip);
      return;
    }
    restoreConfigSpinner.succeed("Config files restored");
  } catch (error: unknown) {
    restoreConfigSpinner.fail("Config restore failed");
    logger.error(getErrorMessage(error));
    const hint = mapSshError(error, server.ip);
    if (hint) logger.info(hint);
    await tryRestartCoolify(server.ip);
    return;
  }

  // Step 6: Start Coolify
  const startSpinner = createSpinner("Starting Coolify...");
  startSpinner.start();

  try {
    const startResult = await sshExec(server.ip, buildStartCoolifyCommand());
    if (startResult.code !== 0) {
      startSpinner.fail("Failed to start Coolify");
      if (startResult.stderr) logger.error(startResult.stderr);
      return;
    }
    startSpinner.succeed("Coolify started");
  } catch (error: unknown) {
    startSpinner.fail("Failed to start Coolify");
    logger.error(getErrorMessage(error));
    const hint = mapSshError(error, server.ip);
    if (hint) logger.info(hint);
    return;
  }

  // Step 7: Cleanup remote
  await sshExec(server.ip, buildCleanupCommand()).catch(() => {});

  logger.success(`Restore complete for ${server.name}`);
  logger.info(`Backup: ${selectedBackup} (Coolify ${manifest.coolifyVersion})`);
  logger.info(`Access Coolify: http://${server.ip}:8000`);
}
