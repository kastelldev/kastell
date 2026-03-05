import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import inquirer from "inquirer";
import { getServers } from "../utils/config.js";
import { resolveServer } from "../utils/serverSelect.js";
import { checkSshAvailable, sshExec } from "../utils/ssh.js";
import { logger, createSpinner } from "../utils/logger.js";
import { getErrorMessage, mapSshError } from "../utils/errorMapper.js";
import { isBareServer } from "../utils/modeGuard.js";
import type { BackupManifest, ServerRecord } from "../types/index.js";
import {
  formatTimestamp,
  getBackupDir,
  buildPgDumpCommand,
  buildConfigTarCommand,
  buildCleanupCommand,
  buildCoolifyVersionCommand,
  listBackups,
  scpDownload,
  createBareBackup,
  listOrphanBackups,
  cleanupServerBackups,
} from "../core/backup.js";

// Re-export pure functions from core/backup.ts for backward compatibility
export {
  formatTimestamp,
  getBackupDir,
  buildPgDumpCommand,
  buildConfigTarCommand,
  buildCleanupCommand,
  buildCoolifyVersionCommand,
  listBackups,
  scpDownload,
  listOrphanBackups,
  cleanupServerBackups,
};

// Single server backup (extracted for reuse)

async function backupSingleServer(server: ServerRecord, dryRun: boolean): Promise<boolean> {
  const timestamp = formatTimestamp(new Date());
  const backupPath = join(getBackupDir(server.name), timestamp);

  if (dryRun) {
    logger.info(`[${server.name}] Dry run - would backup to: ${backupPath}`);
    return true;
  }

  // Bare server: backup system config files instead of Coolify DB
  if (isBareServer(server)) {
    const spinner = createSpinner(`[${server.name}] Backing up system config...`);
    spinner.start();
    try {
      const result = await createBareBackup(server.ip, server.name, server.provider);
      if (result.success) {
        spinner.succeed(`[${server.name}] System config backup saved to ${result.backupPath}`);
        return true;
      } else {
        spinner.fail(`[${server.name}] Backup failed: ${result.error}`);
        if (result.hint) logger.info(result.hint);
        return false;
      }
    } catch (error: unknown) {
      spinner.fail(`[${server.name}] Backup failed`);
      logger.error(getErrorMessage(error));
      return false;
    }
  }

  const versionResult = await sshExec(server.ip, buildCoolifyVersionCommand());
  const coolifyVersion = versionResult.code === 0 ? versionResult.stdout.trim() : "unknown";

  const dbSpinner = createSpinner(`[${server.name}] Creating database backup...`);
  dbSpinner.start();
  try {
    const dbResult = await sshExec(server.ip, buildPgDumpCommand());
    if (dbResult.code !== 0) {
      dbSpinner.fail(`[${server.name}] Database backup failed`);
      return false;
    }
    dbSpinner.succeed(`[${server.name}] Database backup created`);
  } catch (error: unknown) {
    dbSpinner.fail(`[${server.name}] Database backup failed`);
    logger.error(getErrorMessage(error));
    const hint = mapSshError(error, server.ip);
    if (hint) logger.info(hint);
    return false;
  }

  const configSpinner = createSpinner(`[${server.name}] Creating config backup...`);
  configSpinner.start();
  try {
    const configResult = await sshExec(server.ip, buildConfigTarCommand());
    if (configResult.code !== 0) {
      configSpinner.fail(`[${server.name}] Config backup failed`);
      return false;
    }
    configSpinner.succeed(`[${server.name}] Config backup created`);
  } catch (error: unknown) {
    configSpinner.fail(`[${server.name}] Config backup failed`);
    logger.error(getErrorMessage(error));
    const hint = mapSshError(error, server.ip);
    if (hint) logger.info(hint);
    return false;
  }

  mkdirSync(backupPath, { recursive: true, mode: 0o700 });

  const dlSpinner = createSpinner(`[${server.name}] Downloading backup files...`);
  dlSpinner.start();
  try {
    const dbDl = await scpDownload(
      server.ip,
      "/tmp/coolify-backup.sql.gz",
      join(backupPath, "coolify-backup.sql.gz"),
    );
    if (dbDl.code !== 0) {
      dlSpinner.fail(`[${server.name}] Download failed`);
      return false;
    }
    const configDl = await scpDownload(
      server.ip,
      "/tmp/coolify-config.tar.gz",
      join(backupPath, "coolify-config.tar.gz"),
    );
    if (configDl.code !== 0) {
      dlSpinner.fail(`[${server.name}] Download failed`);
      return false;
    }
    dlSpinner.succeed(`[${server.name}] Backup files downloaded`);
  } catch (error: unknown) {
    dlSpinner.fail(`[${server.name}] Download failed`);
    logger.error(getErrorMessage(error));
    const hint = mapSshError(error, server.ip);
    if (hint) logger.info(hint);
    return false;
  }

  const manifest: BackupManifest = {
    serverName: server.name,
    provider: server.provider,
    timestamp,
    coolifyVersion,
    files: ["coolify-backup.sql.gz", "coolify-config.tar.gz"],
  };
  writeFileSync(join(backupPath, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  await sshExec(server.ip, buildCleanupCommand()).catch(() => {});

  logger.success(`[${server.name}] Backup saved to ${backupPath}`);
  logger.info(`Provider: ${server.provider} | IP: ${server.ip} | Mode: ${server.mode || "coolify"}`);
  return true;
}

async function backupAll(dryRun: boolean): Promise<void> {
  if (!checkSshAvailable()) {
    logger.error("SSH client not found. Please install OpenSSH.");
    return;
  }

  const servers = getServers();
  if (servers.length === 0) {
    logger.info("No servers found. Deploy one with: kastell init");
    return;
  }

  logger.title(`Backing up ${servers.length} server(s)...`);

  let succeeded = 0;
  let failed = 0;

  for (const server of servers) {
    const ok = await backupSingleServer(server, dryRun);
    if (ok) succeeded++;
    else failed++;
    console.log();
  }

  if (failed === 0) {
    logger.success(`All ${succeeded} server(s) backed up successfully!`);
  } else {
    logger.warning(`${succeeded} succeeded, ${failed} failed`);
  }
}

// Backup cleanup command

async function backupCleanupCommand(): Promise<void> {
  const servers = getServers();
  const activeNames = servers.map((s) => s.name);
  const orphans = listOrphanBackups(activeNames);

  if (orphans.length === 0) {
    logger.success("No orphan backups found. All backups belong to active servers.");
    return;
  }

  logger.title(`Found ${orphans.length} orphan backup(s):`);
  for (const name of orphans) {
    const backupCount = listBackups(name).length;
    logger.step(`${name} (${backupCount} backup${backupCount !== 1 ? "s" : ""})`);
  }
  console.log();

  const { confirm } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: `Remove all ${orphans.length} orphan backup folder(s)?`,
      default: false,
    },
  ]);

  if (!confirm) {
    logger.info("Cleanup cancelled.");
    return;
  }

  let removed = 0;
  for (const name of orphans) {
    const result = cleanupServerBackups(name);
    if (result.removed) {
      logger.success(`Removed backups for "${name}"`);
      removed++;
    } else {
      logger.warning(`Failed to remove backups for "${name}"`);
    }
  }
  logger.success(`Cleaned up ${removed}/${orphans.length} orphan backup(s).`);
}

// Command

export async function backupCommand(
  query?: string,
  options?: { dryRun?: boolean; all?: boolean },
): Promise<void> {
  // Handle cleanup subcommand
  if (query === "cleanup") {
    return backupCleanupCommand();
  }

  if (options?.all) {
    return backupAll(options?.dryRun || false);
  }

  if (!checkSshAvailable()) {
    logger.error("SSH client not found. Please install OpenSSH.");
    return;
  }

  const server = await resolveServer(query, "Select a server to backup:");
  if (!server) return;

  const dryRun = options?.dryRun || false;
  const timestamp = formatTimestamp(new Date());
  const backupPath = join(getBackupDir(server.name), timestamp);

  if (dryRun) {
    logger.title("Dry Run - Backup");
    logger.info(`Server: ${server.name} (${server.ip})`);
    logger.info(`Backup path: ${backupPath}`);
    console.log();
    logger.info("Commands to execute:");
    if (isBareServer(server)) {
      logger.step("tar czf /tmp/bare-config.tar.gz --ignore-failed-read -C / etc/nginx etc/ssh/sshd_config etc/ufw etc/fail2ban etc/crontab");
      logger.step(`scp root@${server.ip}:/tmp/bare-config.tar.gz ${backupPath}/`);
    } else {
      logger.step(buildPgDumpCommand());
      logger.step(buildConfigTarCommand());
      logger.step(`scp root@${server.ip}:/tmp/coolify-backup.sql.gz ${backupPath}/`);
      logger.step(`scp root@${server.ip}:/tmp/coolify-config.tar.gz ${backupPath}/`);
      logger.step(buildCleanupCommand());
    }
    console.log();
    logger.warning("No changes applied. Remove --dry-run to execute.");
    return;
  }

  // Bare server: backup system config files instead of Coolify DB
  if (isBareServer(server)) {
    const spinner = createSpinner("Backing up system config...");
    spinner.start();
    try {
      const result = await createBareBackup(server.ip, server.name, server.provider);
      if (result.success) {
        spinner.succeed("System config backup created");
        logger.success(`Backup saved to ${result.backupPath}`);
        logger.info("Files: bare-config.tar.gz, manifest.json");
      } else {
        spinner.fail("System config backup failed");
        logger.error(result.error ?? "Backup failed");
        if (result.hint) logger.info(result.hint);
      }
    } catch (error: unknown) {
      spinner.fail("System config backup failed");
      logger.error(getErrorMessage(error));
    }
    return;
  }

  // Step 1: Get Coolify version
  const versionResult = await sshExec(server.ip, buildCoolifyVersionCommand());
  const coolifyVersion = versionResult.code === 0 ? versionResult.stdout.trim() : "unknown";

  // Step 2: Database backup
  const dbSpinner = createSpinner("Creating database backup...");
  dbSpinner.start();

  try {
    const dbResult = await sshExec(server.ip, buildPgDumpCommand());
    if (dbResult.code !== 0) {
      dbSpinner.fail("Database backup failed");
      if (dbResult.stderr) logger.error(dbResult.stderr);
      return;
    }
    dbSpinner.succeed("Database backup created");
  } catch (error: unknown) {
    dbSpinner.fail("Database backup failed");
    logger.error(getErrorMessage(error));
    const hint = mapSshError(error, server.ip);
    if (hint) logger.info(hint);
    return;
  }

  // Step 3: Config backup
  const configSpinner = createSpinner("Creating config backup...");
  configSpinner.start();

  try {
    const configResult = await sshExec(server.ip, buildConfigTarCommand());
    if (configResult.code !== 0) {
      configSpinner.fail("Config backup failed");
      if (configResult.stderr) logger.error(configResult.stderr);
      return;
    }
    configSpinner.succeed("Config backup created");
  } catch (error: unknown) {
    configSpinner.fail("Config backup failed");
    logger.error(getErrorMessage(error));
    const hint = mapSshError(error, server.ip);
    if (hint) logger.info(hint);
    return;
  }

  // Step 4: Download to local
  mkdirSync(backupPath, { recursive: true, mode: 0o700 });

  const dlSpinner = createSpinner("Downloading backup files...");
  dlSpinner.start();

  try {
    const dbDl = await scpDownload(
      server.ip,
      "/tmp/coolify-backup.sql.gz",
      join(backupPath, "coolify-backup.sql.gz"),
    );
    if (dbDl.code !== 0) {
      dlSpinner.fail("Failed to download database backup");
      if (dbDl.stderr) logger.error(dbDl.stderr);
      return;
    }

    const configDl = await scpDownload(
      server.ip,
      "/tmp/coolify-config.tar.gz",
      join(backupPath, "coolify-config.tar.gz"),
    );
    if (configDl.code !== 0) {
      dlSpinner.fail("Failed to download config backup");
      if (configDl.stderr) logger.error(configDl.stderr);
      return;
    }
    dlSpinner.succeed("Backup files downloaded");
  } catch (error: unknown) {
    dlSpinner.fail("Failed to download backup files");
    logger.error(getErrorMessage(error));
    const hint = mapSshError(error, server.ip);
    if (hint) logger.info(hint);
    return;
  }

  // Step 5: Write manifest
  const manifest: BackupManifest = {
    serverName: server.name,
    provider: server.provider,
    timestamp,
    coolifyVersion,
    files: ["coolify-backup.sql.gz", "coolify-config.tar.gz"],
  };

  writeFileSync(join(backupPath, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });

  // Step 6: Cleanup remote
  await sshExec(server.ip, buildCleanupCommand()).catch(() => {});

  logger.success(`Backup saved to ${backupPath}`);
  logger.info(`Coolify version: ${coolifyVersion}`);
  logger.info(`Provider: ${server.provider} | IP: ${server.ip} | Mode: ${server.mode || "coolify"}`);
  logger.info("Files: coolify-backup.sql.gz, coolify-config.tar.gz, manifest.json");
}
