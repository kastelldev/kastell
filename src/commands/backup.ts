import { join } from "path";
import inquirer from "inquirer";
import { getServers } from "../utils/config.js";
import { resolveServer } from "../utils/serverSelect.js";
import { checkSshAvailable } from "../utils/ssh.js";
import { logger, createSpinner } from "../utils/logger.js";
import { mapSshError, classifyError } from "../utils/errorMapper.js";
import { resolvePlatform } from "../adapters/factory.js";
import type { ServerRecord } from "../types/index.js";
import {
  formatTimestamp,
  getBackupDir,
  listBackups,
  backupServer,
  listOrphanBackups,
  cleanupServerBackups,
} from "../core/backup.js";
import {
  scheduleBackup,
  listBackupSchedule,
  removeBackupSchedule,
  validateCronExpr,
} from "../core/backupSchedule.js";

// Single server backup (extracted for reuse)

async function backupSingleServer(server: ServerRecord, dryRun: boolean): Promise<boolean> {
  const timestamp = formatTimestamp(new Date());
  const backupPath = join(getBackupDir(server.name), timestamp);

  if (dryRun) {
    logger.info(`[${server.name}] Dry run - would backup to: ${backupPath}`);
    return true;
  }

  const platform = resolvePlatform(server);
  const label = platform ? `${platform} adapter` : "system config";
  const spinner = createSpinner(`[${server.name}] Backing up via ${label}...`);
  spinner.start();
  try {
    const result = await backupServer(server);
    if (result.success) {
      spinner.succeed(`[${server.name}] Backup saved to ${result.backupPath}`);
      return true;
    } else {
      spinner.fail(`[${server.name}] Backup failed: ${result.error}`);
      if (result.hint) logger.info(result.hint);
      return false;
    }
  } catch (error: unknown) {
    spinner.fail(`[${server.name}] Backup failed`);
    const classified = classifyError(error);
    logger.error(classified.message);
    if (classified.hint) logger.info(classified.hint);
    if (!classified.isTyped) {
      const hint = mapSshError(error, server.ip);
      if (hint) logger.info(hint);
    }
    return false;
  }
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

async function backupCleanupCommand(force?: boolean): Promise<void> {
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

  if (!force) {
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

// Schedule option handler

async function handleScheduleOption(query: string | undefined, scheduleValue: string): Promise<void> {
  if (!checkSshAvailable()) {
    logger.error("SSH client not found. Please install OpenSSH.");
    return;
  }

  const server = await resolveServer(query, "Select a server to manage schedule:");
  if (!server) return;

  if (scheduleValue === "list") {
    const result = await listBackupSchedule(server.ip, server.name);
    if (!result.success) {
      logger.error(result.error ?? "Failed to list backup schedule");
      return;
    }
    if (result.cronExpr) {
      logger.info(`Backup schedule: ${result.cronExpr}`);
      if (result.localCronExpr && result.localCronExpr !== result.cronExpr) {
        logger.info(`Local record: ${result.localCronExpr}`);
      }
    } else {
      logger.info("No backup schedule installed on this server.");
    }
    return;
  }

  if (scheduleValue === "remove") {
    const spinner = createSpinner("Removing backup schedule...");
    spinner.start();
    const result = await removeBackupSchedule(server.ip, server.name);
    if (result.success) {
      spinner.succeed("Backup schedule removed");
    } else {
      spinner.fail(result.error ?? "Failed to remove backup schedule");
      if (result.hint) logger.info(result.hint);
    }
    return;
  }

  // Treat as cron expression
  const validation = validateCronExpr(scheduleValue);
  if (!validation.valid) {
    logger.error(`Invalid cron expression: ${validation.error}`);
    return;
  }

  const spinner = createSpinner(`Scheduling backup with cron: ${scheduleValue}`);
  spinner.start();
  const result = await scheduleBackup(server.ip, server.name, scheduleValue);
  if (result.success) {
    spinner.succeed(`Backup scheduled: ${scheduleValue}`);
  } else {
    spinner.fail(result.error ?? "Failed to schedule backup");
    if (result.hint) logger.info(result.hint);
  }
}

async function backupListCommand(): Promise<void> {
  const servers = getServers();
  if (servers.length === 0) {
    logger.warning("No servers registered. Add a server first.");
    return;
  }

  logger.title("Backup List");
  let hasBackups = false;

  for (const server of servers) {
    const backups = listBackups(server.name);
    if (backups.length > 0) {
      hasBackups = true;
      logger.info(`${server.name} (${server.ip}):`);
      for (const backup of backups) {
        logger.step(backup);
      }
      console.log();
    }
  }

  if (!hasBackups) {
    logger.info("No backups found for any server.");
    logger.info("Run: kastell backup <server> to create a backup");
  }
}

// Command

export async function backupCommand(
  query?: string,
  options?: { dryRun?: boolean; all?: boolean; schedule?: string; force?: boolean },
): Promise<void> {
  // Handle schedule option
  if (options?.schedule !== undefined) {
    return handleScheduleOption(query, options.schedule);
  }

  // Handle cleanup subcommand
  if (query === "cleanup") {
    return backupCleanupCommand(options?.force);
  }

  // Handle list subcommand
  if (query === "list") {
    return backupListCommand();
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
    const dryPlatform = resolvePlatform(server);
    if (!dryPlatform) {
      logger.step("tar czf /tmp/bare-config.tar.gz --ignore-failed-read -C / etc/nginx etc/ssh/sshd_config etc/ufw etc/fail2ban etc/crontab");
      logger.step(`scp root@${server.ip}:/tmp/bare-config.tar.gz ${backupPath}/`);
    } else {
      logger.step(`Platform backup via ${dryPlatform} adapter`);
      logger.step(`Commands executed remotely via SSH to ${server.ip}`);
    }
    console.log();
    logger.warning("No changes applied. Remove --dry-run to execute.");
    return;
  }

  const platform = resolvePlatform(server);
  const spinner = createSpinner("Creating backup...");
  spinner.start();
  try {
    const result = await backupServer(server);
    if (result.success) {
      spinner.succeed("Backup created");
      logger.success(`Backup saved to ${result.backupPath}`);
      if (result.manifest) {
        logger.info(`Platform version: ${result.manifest.coolifyVersion}`);
        if (platform) {
          logger.info(`Provider: ${server.provider} | IP: ${server.ip} | Platform: ${platform}`);
        }
        logger.info(`Files: ${result.manifest.files.join(", ")}, manifest.json`);
      }
    } else {
      spinner.fail("Backup failed");
      logger.error(result.error ?? "Backup failed");
      if (result.hint) logger.info(result.hint);
    }
  } catch (error: unknown) {
    spinner.fail("Backup failed");
    const classified = classifyError(error);
    logger.error(classified.message);
    if (classified.hint) logger.info(classified.hint);
    if (!classified.isTyped) {
      const hint = mapSshError(error, server.ip);
      if (hint) logger.info(hint);
    }
  }
}
