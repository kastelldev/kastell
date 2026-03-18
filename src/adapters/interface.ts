import type { BackupManifest } from "../types/index.js";

/**
 * Result of a platform health check.
 *
 * `status` is "running" when the platform's web UI is reachable,
 * or "not reachable" when all HTTP/HTTPS attempts fail.
 */
export interface HealthResult {
  status: "running" | "not reachable";
}

/**
 * Result of a platform status query combining version and health.
 *
 * `platformVersion` is "unknown" when the SSH version command fails.
 * `status` mirrors HealthResult.status.
 */
export interface PlatformStatusResult {
  platformVersion: string;
  status: "running" | "not reachable";
}

/**
 * Result of a platform backup operation.
 *
 * On success: `success` is true, `backupPath` contains the local directory,
 * and `manifest` is the written manifest object.
 *
 * On failure: `success` is false, `error` contains the human-readable reason,
 * and `hint` may contain a recovery suggestion. `backupPath` and `manifest`
 * are absent.
 */
export interface PlatformBackupResult {
  success: boolean;
  backupPath?: string;
  manifest?: BackupManifest;
  error?: string;
  hint?: string;
}

/**
 * Result of a platform self-update operation.
 *
 * On success: `success` is true, `output` may contain the command stdout.
 *
 * On failure: `success` is false, `error` contains the reason,
 * and `hint` may contain a recovery suggestion.
 */
export interface UpdateResult {
  success: boolean;
  output?: string;
  error?: string;
  hint?: string;
}

/**
 * Result of a platform backup restore operation.
 *
 * `steps` is always present — each entry records the name, status, and optional
 * error for every restore step attempted (stop, restore DB, restore config, start).
 *
 * On failure: `success` is false, `error` states which step failed,
 * and `hint` may contain a recovery suggestion.
 */
export interface PlatformRestoreResult {
  success: boolean;
  steps: Array<{ name: string; status: "success" | "failure"; error?: string }>;
  error?: string;
  hint?: string;
}

/**
 * Contract that every platform adapter must satisfy.
 *
 * A platform adapter encapsulates all platform-specific behavior for a single
 * self-hosted deployment platform (e.g., Coolify, Dokploy). Commands in the
 * `src/commands/` layer call adapter methods without knowing which platform
 * is running on the target server.
 *
 * @example
 * ```typescript
 * const adapter = getAdapter("coolify");
 * const health = await adapter.healthCheck("1.2.3.4");
 * ```
 */
export interface PlatformAdapter {
  /**
   * Human-readable platform identifier (lowercase). Used in manifests,
   * CLI output, and MCP tool responses.
   * @example "coolify" | "dokploy"
   */
  readonly name: string;

  /**
   * Default HTTP port for the platform's web UI.
   * Used by commands that need the platform port without importing constants directly.
   * @example 8000 (Coolify) | 3000 (Dokploy)
   */
  readonly port: number;

  /**
   * Default log service name for `kastell logs` when no `--service` is specified.
   * Matches the platform name (lowercase).
   * @example "coolify" | "dokploy"
   */
  readonly defaultLogService: string;

  /**
   * Ports required by this platform that should be protected from firewall removal.
   * Includes HTTP (80), HTTPS (443), the platform port, and any additional service ports.
   */
  readonly platformPorts: readonly number[];

  /**
   * Returns a cloud-init bash script that installs the platform on a fresh
   * Ubuntu/Debian server. Executed once during `kastell init`.
   *
   * @param serverName - Server name used inside the script for logging.
   *   Sanitized to `[a-z0-9-]` before insertion.
   * @returns A bash script string starting with `#!/bin/bash`.
   */
  getCloudInit(serverName: string): string;

  /**
   * Checks whether the platform's web UI is reachable.
   * Tries HTTPS via domain first (if provided), then falls back to HTTP on
   * the platform's default port.
   *
   * Never throws — network errors produce `{ status: "not reachable" }`.
   *
   * @param ip - Server IP address (validated with assertValidIp before use).
   * @param domain - Optional custom domain for HTTPS check.
   * @returns HealthResult with status "running" or "not reachable".
   */
  healthCheck(ip: string, domain?: string): Promise<HealthResult>;

  /**
   * Creates a full platform backup: database dump + config files.
   * Downloads backup artifacts to `~/.kastell/backups/<serverName>/` and
   * writes a manifest.json. Cleans up remote temp files (best-effort).
   *
   * Never throws — all errors are returned as `{ success: false, error }`.
   *
   * @param ip - Server IP address.
   * @param serverName - Used to name the local backup directory.
   * @param provider - Cloud provider name recorded in the manifest.
   * @returns PlatformBackupResult with backupPath + manifest on success.
   */
  createBackup(
    ip: string,
    serverName: string,
    provider: string,
  ): Promise<PlatformBackupResult>;

  /**
   * Restores a previously created backup. Stops the platform, restores DB
   * and config, then restarts. Attempts to restart the platform on failure
   * (best-effort recovery).
   *
   * Optional — implementations that do not support restore may omit this method.
   * Never throws — all errors are returned as `{ success: false, steps, error }`.
   *
   * @param ip - Server IP address.
   * @param backupPath - Local path to the backup directory.
   * @param manifest - Backup manifest for metadata reference.
   * @returns PlatformRestoreResult with a step-by-step execution log.
   */
  restoreBackup?(
    ip: string,
    backupPath: string,
    manifest: BackupManifest,
  ): Promise<PlatformRestoreResult>;

  /**
   * Returns the platform's installed version and health status via SSH + HTTP.
   * platformVersion is "unknown" if the SSH version command fails.
   *
   * Never throws — SSH and network errors surface in the returned status.
   *
   * @param ip - Server IP address.
   * @returns PlatformStatusResult with platformVersion and running/not-reachable status.
   */
  getStatus(ip: string): Promise<PlatformStatusResult>;

  /**
   * Runs the platform's self-update command over SSH. Uses a 3-minute timeout
   * to accommodate download + install time.
   *
   * Never throws — all errors are returned as `{ success: false, error }`.
   *
   * @param ip - Server IP address.
   * @returns UpdateResult with optional output on success or error/hint on failure.
   */
  update(ip: string): Promise<UpdateResult>;
}
