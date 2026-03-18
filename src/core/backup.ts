import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { sshExec, assertValidIp } from "../utils/ssh.js";
import { BACKUPS_DIR } from "../utils/config.js";
import { getErrorMessage, mapSshError, sanitizeStderr } from "../utils/errorMapper.js";
import { raw, type SshCommand } from "../utils/sshCommand.js";
import type { BackupManifest, Platform, ServerRecord } from "../types/index.js";
import { getAdapter, resolvePlatform } from "../adapters/factory.js";
import { isBareServer } from "../utils/modeGuard.js";
import { debugLog } from "../utils/logger.js";
import { formatTimestamp, getBackupDir } from "../utils/backupPath.js";
import { scpDownload, scpUpload } from "../utils/scp.js";

// Re-export from utils for backward compatibility
export { formatTimestamp, getBackupDir } from "../utils/backupPath.js";
export { scpDownload, scpUpload, assertSafePath } from "../utils/scp.js";

export function buildPgDumpCommand(): SshCommand {
  return raw("docker exec coolify-db pg_dump -U coolify -d coolify | gzip > /tmp/coolify-backup.sql.gz");
}

export function buildConfigTarCommand(): SshCommand {
  return raw("tar czf /tmp/coolify-config.tar.gz -C /data/coolify/source .env docker-compose.yml docker-compose.prod.yml 2>/dev/null || tar czf /tmp/coolify-config.tar.gz -C /data/coolify/source .env docker-compose.yml");
}

export function buildCleanupCommand(): SshCommand {
  return raw("rm -f /tmp/coolify-backup.sql.gz /tmp/coolify-config.tar.gz");
}

export function buildCoolifyVersionCommand(): SshCommand {
  return raw("docker inspect coolify --format '{{.Config.Image}}' 2>/dev/null | sed 's/.*://' || echo unknown");
}

// ─── Pure Functions (Restore) ────────────────────────────────────────────────

export function buildStopCoolifyCommand(): SshCommand {
  return raw("cd /data/coolify/source && docker compose -f docker-compose.yml -f docker-compose.prod.yml stop");
}

export function buildStartCoolifyCommand(): SshCommand {
  return raw("cd /data/coolify/source && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d");
}

export function buildStartDbCommand(): SshCommand {
  return raw("cd /data/coolify/source && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d postgres && sleep 3");
}

export function buildRestoreDbCommand(): SshCommand {
  return raw("gunzip -c /tmp/coolify-backup.sql.gz | docker exec -i coolify-db psql -U coolify -d coolify");
}

export function buildRestoreConfigCommand(): SshCommand {
  return raw("tar xzf /tmp/coolify-config.tar.gz -C /data/coolify/source");
}

// ─── Semi-Pure Functions (FS Read) ───────────────────────────────────────────

export function listBackups(serverName: string): string[] {
  const dir = getBackupDir(serverName);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((name) => existsSync(join(dir, name, "manifest.json")))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export function loadManifest(backupPath: string): BackupManifest | undefined {
  const manifestPath = join(backupPath, "manifest.json");
  if (!existsSync(manifestPath)) return undefined;
  try {
    return JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch {
    return undefined;
  }
}

export function listOrphanBackups(activeServerNames: string[]): string[] {
  if (!existsSync(BACKUPS_DIR)) return [];
  try {
    return readdirSync(BACKUPS_DIR)
      .filter((name) => {
        const fullPath = join(BACKUPS_DIR, name);
        // Only directories that are not in active server list
        return existsSync(fullPath) && !activeServerNames.includes(name);
      })
      .sort();
  } catch {
    return [];
  }
}

export function cleanupServerBackups(serverName: string): { removed: boolean; path: string } {
  const dir = getBackupDir(serverName);
  if (!existsSync(dir)) return { removed: false, path: dir };
  try {
    rmSync(dir, { recursive: true, force: true });
    return { removed: true, path: dir };
  } catch {
    return { removed: false, path: dir };
  }
}


// ─── Pure Functions (Bare Backup) ────────────────────────────────────────────

export function buildBareConfigTarCommand(): SshCommand {
  return raw(
    "tar czf /tmp/bare-config.tar.gz --ignore-failed-read " +
    "-C / " +
    "etc/nginx " +
    "etc/ssh/sshd_config " +
    "etc/ufw " +
    "etc/fail2ban " +
    "etc/crontab " +
    "etc/apt/apt.conf.d/50unattended-upgrades " +
    "2>/dev/null || tar czf /tmp/bare-config.tar.gz --ignore-failed-read -C / etc/ssh/sshd_config",
  );
}

export function buildBareRestoreConfigCommand(): SshCommand {
  return raw("tar xzf /tmp/bare-config.tar.gz -C /");
}

export function buildBareCleanupCommand(): SshCommand {
  return raw("rm -f /tmp/bare-config.tar.gz");
}

// ─── Async Wrappers (Bare) ────────────────────────────────────────────────────

export async function createBareBackup(
  ip: string,
  serverName: string,
  provider: string,
): Promise<BackupResult> {
  assertValidIp(ip);
  try {
    // Step 1: Create config archive on server
    const configResult = await sshExec(ip, buildBareConfigTarCommand());
    if (configResult.code !== 0) {
      return {
        success: false,
        error: "Config backup failed",
        hint: sanitizeStderr(configResult.stderr) || undefined,
      };
    }

    // Step 2: Download
    const timestamp = formatTimestamp(new Date());
    const backupPath = join(getBackupDir(serverName), timestamp);
    mkdirSync(backupPath, { recursive: true, mode: 0o700 });

    const dl = await scpDownload(ip, "/tmp/bare-config.tar.gz", join(backupPath, "bare-config.tar.gz"));
    if (dl.code !== 0) {
      return {
        success: false,
        error: "Failed to download config backup",
        hint: sanitizeStderr(dl.stderr) || undefined,
      };
    }

    // Step 3: Write manifest
    const manifest: BackupManifest = {
      serverName,
      provider,
      timestamp,
      coolifyVersion: "n/a",
      files: ["bare-config.tar.gz"],
      mode: "bare",
    };
    writeFileSync(join(backupPath, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });

    // Step 4: Cleanup remote
    await sshExec(ip, buildBareCleanupCommand()).catch((e) => debugLog?.("bare backup cleanup failed:", e));

    return { success: true, backupPath, manifest };
  } catch (error: unknown) {
    const hint = mapSshError(error, ip);
    return {
      success: false,
      error: getErrorMessage(error),
      ...(hint ? { hint } : {}),
    };
  }
}

export async function restoreBareBackup(
  ip: string,
  serverName: string,
  backupId: string,
): Promise<RestoreResult> {
  assertValidIp(ip);
  const baseDir = getBackupDir(serverName);
  const backupPath = join(baseDir, backupId);

  // Path traversal guard
  if (!resolve(backupPath).startsWith(resolve(baseDir))) {
    return { success: false, steps: [], error: "Invalid backupId: path traversal detected" };
  }

  const steps: Array<{ name: string; status: "success" | "failure"; error?: string }> = [];

  const manifest = loadManifest(backupPath);
  if (!manifest) {
    return { success: false, steps, error: `Backup not found or corrupt: ${backupId}` };
  }

  // Verify backup file exists
  const configFile = join(backupPath, "bare-config.tar.gz");
  if (!existsSync(configFile)) {
    return { success: false, steps, error: "Missing backup file: bare-config.tar.gz" };
  }

  try {
    // Upload config archive
    const upload = await scpUpload(ip, configFile, "/tmp/bare-config.tar.gz");
    if (upload.code !== 0) {
      return {
        success: false,
        steps: [{ name: "Upload config", status: "failure", error: sanitizeStderr(upload.stderr) }],
        error: "Upload failed",
      };
    }
    steps.push({ name: "Upload config", status: "success" });

    // Extract config
    const restoreResult = await sshExec(ip, buildBareRestoreConfigCommand());
    if (restoreResult.code !== 0) {
      steps.push({ name: "Restore config", status: "failure", error: sanitizeStderr(restoreResult.stderr) });
      return { success: false, steps, error: "Config restore failed" };
    }
    steps.push({ name: "Restore config", status: "success" });

    // Cleanup
    await sshExec(ip, buildBareCleanupCommand()).catch((e) => debugLog?.("bare restore cleanup failed:", e));

    return { success: true, steps };
  } catch (error: unknown) {
    const hint = mapSshError(error, ip);
    return {
      success: false,
      steps,
      error: getErrorMessage(error),
      ...(hint ? { hint } : {}),
    };
  }
}

// ─── Best-Effort Rollback ────────────────────────────────────────────────────

export async function tryRestartCoolify(ip: string): Promise<void> {
  try {
    await sshExec(ip, buildStartCoolifyCommand());
  } catch {
    // Best-effort — swallow errors
  }
}

// ─── Result Types ────────────────────────────────────────────────────────────

export interface BackupResult {
  success: boolean;
  backupPath?: string;
  manifest?: BackupManifest;
  error?: string;
  hint?: string;
}

export interface RestoreResult {
  success: boolean;
  steps: Array<{ name: string; status: "success" | "failure"; error?: string }>;
  error?: string;
  hint?: string;
}

// ─── Async Wrappers ─────────────────────────────────────────────────────────

export async function createBackup(
  ip: string,
  serverName: string,
  provider: string,
  platform: Platform = "coolify",
): Promise<BackupResult> {
  const adapter = getAdapter(platform);
  return adapter.createBackup(ip, serverName, provider);
}

/**
 * Single entry point for backing up any server (bare or managed).
 * No UI dependencies — returns structured BackupResult.
 * Used by both CLI command and MCP handler.
 */
export async function backupServer(server: ServerRecord): Promise<BackupResult> {
  if (isBareServer(server)) {
    return createBareBackup(server.ip, server.name, server.provider);
  }

  const platform = resolvePlatform(server);
  if (!platform) {
    return {
      success: false,
      error: `No platform detected for server ${server.name}`,
    };
  }

  return createBackup(server.ip, server.name, server.provider, platform);
}

export async function restoreBackup(
  ip: string,
  serverName: string,
  backupId: string,
): Promise<RestoreResult> {
  // Safe mode guard: prevent accidental restores in production
  const { isSafeMode } = await import("./manage.js");
  if (isSafeMode()) {
    return { success: false, steps: [], error: "Restore is blocked while KASTELL_SAFE_MODE is enabled" };
  }

  assertValidIp(ip);

  const baseDir = getBackupDir(serverName);
  const backupPath = join(baseDir, backupId);

  // Path traversal guard
  if (!resolve(backupPath).startsWith(resolve(baseDir))) {
    return { success: false, steps: [], error: "Invalid backupId: path traversal detected" };
  }

  // Validate manifest
  const manifest = loadManifest(backupPath);
  if (!manifest) {
    return {
      success: false,
      steps: [],
      error: `Backup not found or corrupt: ${backupId}`,
    };
  }

  // Verify backup files exist
  for (const file of manifest.files) {
    if (!existsSync(join(backupPath, file))) {
      return {
        success: false,
        steps: [],
        error: `Missing backup file: ${file}`,
      };
    }
  }

  // Delegate to platform adapter (default to coolify for backward compat)
  const platform = manifest.platform || "coolify";
  const adapter = getAdapter(platform);
  if (!adapter.restoreBackup) {
    return { success: false, steps: [], error: `Adapter ${platform} does not support restore` };
  }
  return adapter.restoreBackup(ip, backupPath, manifest);
}
