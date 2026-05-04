import { writeFileSync } from "fs";
import { join } from "path";
import axios from "axios";
import { assertValidIp, sshExec } from "../utils/ssh.js";
import { raw } from "../utils/sshCommand.js";
import { debugLog } from "../utils/logger.js";
import { HTTP_TIMEOUT_MS } from "../constants.js";
import { formatTimestamp, getBackupDir } from "../utils/backupPath.js";
import { scpDownload, scpUpload } from "../utils/scp.js";
import { getErrorMessage, mapSshError, sanitizeStderr } from "../utils/errorMapper.js";
import { secureMkdirSync } from "../utils/secureWrite.js";
import type { BackupManifest, Platform } from "../types/index.js";
import type {
  HealthResult,
  PlatformBackupResult,
  PlatformRestoreResult,
  PlatformStatusResult,
  UpdateResult,
} from "./interface.js";

/**
 * Shared health check for platform adapters.
 * Tries HTTPS via domain first (if provided), then falls back to HTTP on the given port.
 */
export async function sharedHealthCheck(
  ip: string,
  port: number,
  domain?: string,
): Promise<HealthResult> {
  assertValidIp(ip);
  if (domain) {
    try {
      await axios.get(`https://${domain}`, {
        timeout: HTTP_TIMEOUT_MS,
        validateStatus: () => true,
      });
      return { status: "running" };
    } catch (error) {
      // HTTPS failed, fall back to HTTP
      debugLog?.("HTTPS health check failed, falling back to HTTP", { cause: error });
    }
  }
  try {
    await axios.get(`http://${ip}:${port}`, {
      timeout: HTTP_TIMEOUT_MS,
      validateStatus: () => true,
    });
    return { status: "running" };
  } catch (error) {
    debugLog?.("HTTP health check failed", { cause: error });
    return { status: "not reachable" };
  }
}

/**
 * Shared update for platform adapters.
 * Executes the update command via SSH and maps errors.
 */
/** 3 minutes timeout for platform update commands (download + install) */
const UPDATE_TIMEOUT_MS = 180_000;

export async function sharedUpdate(
  ip: string,
  updateCmd: string,
): Promise<UpdateResult> {
  assertValidIp(ip);
  try {
    const result = await sshExec(ip, raw(updateCmd), { timeoutMs: UPDATE_TIMEOUT_MS });
    if (result.code === 0) {
      return { success: true, output: result.stdout || undefined };
    }
    return {
      success: false,
      error: `Update failed (exit code ${result.code})`,
      output: result.stderr || result.stdout || undefined,
    };
  } catch (error: unknown) {
    const hint = mapSshError(error, ip);
    return {
      success: false,
      error: getErrorMessage(error),
      ...(hint ? { hint } : {}),
    };
  }
}

/**
 * Shared getStatus for platform adapters.
 * Gets version via SSH, runs health check, and combines results.
 */
export async function sharedGetStatus(
  ip: string,
  versionCmd: string,
  port: number,
  domain?: string,
): Promise<PlatformStatusResult> {
  assertValidIp(ip);
  const versionResult = await sshExec(ip, raw(versionCmd));
  const platformVersion = versionResult.code === 0 ? versionResult.stdout.trim() : "unknown";
  const health = await sharedHealthCheck(ip, port, domain);
  return {
    platformVersion,
    status: health.status,
  };
}

// ─── Backup / Restore Config Types ──────────────────────────────────────────

export interface AdapterBackupConfig {
  /** Platform name, e.g. "coolify" | "dokploy" */
  platform: Platform;
  /** SSH command: dump DB to /tmp/{dbFileName} */
  pgDumpCmd: string;
  /** SSH command: tar config to /tmp/{configFileName} */
  configTarCmd: string;
  /** SSH command: get platform version string */
  versionCmd: string;
  /** SSH command: cleanup temp files */
  cleanupCmd: string;
  /** Remote + local filename for DB backup, e.g. "coolify-backup.sql.gz" */
  dbFileName: string;
  /** Remote + local filename for config backup, e.g. "coolify-config.tar.gz" */
  configFileName: string;
}

export interface AdapterRestoreConfig {
  /** Platform name, e.g. "coolify" | "dokploy" */
  platform: Platform;
  /** SSH command: stop the platform service */
  stopCmd: string;
  /** SSH command: start the database only */
  startDbCmd: string;
  /** SSH command: restore DB from /tmp/{dbFileName} */
  restoreDbCmd: string;
  /** SSH command: restore config from /tmp/{configFileName} */
  restoreConfigCmd: string;
  /** SSH command: start the platform service */
  startCmd: string;
  /** SSH command: cleanup temp files */
  cleanupCmd: string;
  /** SSH command: best-effort platform restart after failure */
  tryRestartCmd: string;
  dbFileName: string;
  configFileName: string;
}

// ─── Shared Backup / Restore ─────────────────────────────────────────────────

/**
 * Shared createBackup for platform adapters.
 * Control flow is identical across adapters; only the command strings and file names differ.
 */
export async function sharedCreateBackup(
  ip: string,
  serverName: string,
  provider: string,
  config: AdapterBackupConfig,
): Promise<PlatformBackupResult> {
  assertValidIp(ip);

  try {
    // Step 1: Get platform version (best-effort)
    const versionResult = await sshExec(ip, raw(config.versionCmd));
    const platformVersion = versionResult.code === 0 ? versionResult.stdout.trim() : "unknown";

    // Step 2: Database backup
    const dbResult = await sshExec(ip, raw(config.pgDumpCmd));
    if (dbResult.code !== 0) {
      return {
        success: false,
        error: "Database backup failed",
        hint: sanitizeStderr(dbResult.stderr) || undefined,
      };
    }

    // Step 3: Config backup
    const configResult = await sshExec(ip, raw(config.configTarCmd));
    if (configResult.code !== 0) {
      return {
        success: false,
        error: "Config backup failed",
        hint: sanitizeStderr(configResult.stderr) || undefined,
      };
    }

    // Step 4: Create local directory and download
    const timestamp = formatTimestamp(new Date());
    const backupPath = join(getBackupDir(serverName), timestamp);
    secureMkdirSync(backupPath, { recursive: true });

    const dbDl = await scpDownload(
      ip,
      `/tmp/${config.dbFileName}`,
      join(backupPath, config.dbFileName),
    );
    if (dbDl.code !== 0) {
      return {
        success: false,
        error: "Failed to download database backup",
        hint: sanitizeStderr(dbDl.stderr) || undefined,
      };
    }

    const configDl = await scpDownload(
      ip,
      `/tmp/${config.configFileName}`,
      join(backupPath, config.configFileName),
    );
    if (configDl.code !== 0) {
      return {
        success: false,
        error: "Failed to download config backup",
        hint: sanitizeStderr(configDl.stderr) || undefined,
      };
    }

    // Step 5: Write manifest
    // coolifyVersion field is preserved for backward compatibility regardless of platform
    const manifest: BackupManifest = {
      serverName,
      provider,
      timestamp,
      coolifyVersion: platformVersion,
      files: [config.dbFileName, config.configFileName],
      platform: config.platform,
    };
    writeFileSync(
      join(backupPath, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      { mode: 0o600 },
    );

    // Step 6: Cleanup remote (best-effort)
    await sshExec(ip, raw(config.cleanupCmd)).catch((e) => debugLog?.("backup cleanup failed:", e));

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

/**
 * Shared restoreBackup for platform adapters.
 * Control flow is identical across adapters; only the command strings and file names differ.
 */
export async function sharedRestoreBackup(
  ip: string,
  backupPath: string,
  _manifest: BackupManifest,
  config: AdapterRestoreConfig,
  _options?: { force?: boolean },
): Promise<PlatformRestoreResult> {
  assertValidIp(ip);

  const steps: Array<{
    name: string;
    status: "success" | "failure";
    error?: string;
  }> = [];

  try {
    // Upload backup files (before stopping platform -- safe to fail here)
    const dbUpload = await scpUpload(
      ip,
      join(backupPath, config.dbFileName),
      `/tmp/${config.dbFileName}`,
    );
    if (dbUpload.code !== 0) {
      return {
        success: false,
        steps: [
          {
            name: "Upload database backup",
            status: "failure",
            error: sanitizeStderr(dbUpload.stderr),
          },
        ],
        error: "Failed to upload database backup",
      };
    }
    steps.push({ name: "Upload database backup", status: "success" });

    const configUpload = await scpUpload(
      ip,
      join(backupPath, config.configFileName),
      `/tmp/${config.configFileName}`,
    );
    if (configUpload.code !== 0) {
      return {
        success: false,
        steps: [
          ...steps,
          {
            name: "Upload config backup",
            status: "failure",
            error: sanitizeStderr(configUpload.stderr),
          },
        ],
        error: "Failed to upload config backup",
      };
    }
    steps.push({ name: "Upload config backup", status: "success" });

    // Step 1: Stop platform
    const platformLabel = adapterDisplayName({ name: config.platform });
    const stopResult = await sshExec(ip, raw(config.stopCmd));
    if (stopResult.code !== 0) {
      steps.push({
        name: `Stop ${platformLabel}`,
        status: "failure",
        error: sanitizeStderr(stopResult.stderr),
      });
      return { success: false, steps, error: `Failed to stop ${platformLabel}` };
    }
    steps.push({ name: `Stop ${platformLabel}`, status: "success" });

    // Step 2: Start DB only
    const dbStartResult = await sshExec(ip, raw(config.startDbCmd));
    if (dbStartResult.code !== 0) {
      steps.push({
        name: "Start database",
        status: "failure",
        error: sanitizeStderr(dbStartResult.stderr),
      });
      await sshExec(ip, raw(config.tryRestartCmd)).catch((e) => debugLog?.("restart after db start failure:", e));
      return { success: false, steps, error: "Failed to start database" };
    }
    steps.push({ name: "Start database", status: "success" });

    // Step 3: Restore database
    const restoreDbResult = await sshExec(ip, raw(config.restoreDbCmd));
    if (restoreDbResult.code !== 0) {
      steps.push({
        name: "Restore database",
        status: "failure",
        error: sanitizeStderr(restoreDbResult.stderr),
      });
      await sshExec(ip, raw(config.tryRestartCmd)).catch((e) => debugLog?.("restart after db restore failure:", e));
      return { success: false, steps, error: "Database restore failed" };
    }
    steps.push({ name: "Restore database", status: "success" });

    // Step 4: Restore config
    const restoreConfigResult = await sshExec(ip, raw(config.restoreConfigCmd));
    if (restoreConfigResult.code !== 0) {
      steps.push({
        name: "Restore config",
        status: "failure",
        error: sanitizeStderr(restoreConfigResult.stderr),
      });
      await sshExec(ip, raw(config.tryRestartCmd)).catch((e) => debugLog?.("restart after config restore failure:", e));
      return { success: false, steps, error: "Config restore failed" };
    }
    steps.push({ name: "Restore config", status: "success" });

    // Step 5: Start platform
    const startResult = await sshExec(ip, raw(config.startCmd));
    if (startResult.code !== 0) {
      steps.push({
        name: `Start ${platformLabel}`,
        status: "failure",
        error: sanitizeStderr(startResult.stderr),
      });
      return { success: false, steps, error: `Failed to start ${platformLabel}` };
    }
    steps.push({ name: `Start ${platformLabel}`, status: "success" });

    // Cleanup remote (best-effort)
    await sshExec(ip, raw(config.cleanupCmd)).catch((e) => debugLog?.("restore cleanup failed:", e));

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

/**
 * Returns a capitalized display name for a platform adapter.
 * @example adapterDisplayName(coolifyAdapter) => "Coolify"
 */
export function adapterDisplayName(adapter: { readonly name: string }): string {
  return adapter.name.charAt(0).toUpperCase() + adapter.name.slice(1);
}
