import { spawnSync } from "child_process";
import { writeFileSync, mkdirSync, chmodSync } from "fs";
import { userInfo } from "os";
import { SecurityLogger } from "./securityLogger.js";

export interface WriteFileOptions {
  encoding?: BufferEncoding;
  mode?: number;
  flag?: string;
}

// Track whether secure dir has been initialized (lazy init)
let secureDirInitialized = false;

export function clearCache(): void {
  secureDirInitialized = false;
}

export function ensureSecureDir(dirPath: string): void {
  if (secureDirInitialized) {
    return;
  }

  const username = userInfo().username;
  const platform = process.platform;

  if (platform === "win32") {
    const result = spawnSync("icacls", [
      dirPath,
      "/inheritance:r",
      "/grant:r",
      `${username}:F`,
    ]);
    if (result.status !== 0) {
      SecurityLogger.warn("ACL operation failed", {
        dirPath,
        platform,
        error: result.stderr?.toString() ?? "unknown",
      });
    }
  } else {
    try {
      chmodSync(dirPath, 0o700);
    } catch (error) {
      SecurityLogger.warn("chmod operation failed", {
        dirPath,
        platform,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  secureDirInitialized = true;
}

export function secureWriteFileSync(
  filePath: string,
  data: string,
  options?: WriteFileOptions
): void {
  writeFileSync(filePath, data, options);

  const username = userInfo().username;
  const platform = process.platform;

  if (platform === "win32") {
    const result = spawnSync("icacls", [
      filePath,
      "/inheritance:r",
      "/grant:r",
      `${username}:F`,
    ]);
    if (result.status !== 0) {
      SecurityLogger.warn("ACL operation failed", {
        filePath,
        platform,
        error: result.stderr?.toString() ?? "unknown",
      });
    }
  } else {
    try {
      chmodSync(filePath, 0o600);
    } catch (error) {
      SecurityLogger.warn("chmod operation failed", {
        filePath,
        platform,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function secureMkdirSync(
  dirPath: string,
  options?: { recursive?: boolean }
): void {
  mkdirSync(dirPath, { recursive: options?.recursive ?? true });

  const username = userInfo().username;
  const platform = process.platform;

  if (platform === "win32") {
    const result = spawnSync("icacls", [
      dirPath,
      "/inheritance:r",
      "/grant:r",
      `${username}:F`,
    ]);
    if (result.status !== 0) {
      SecurityLogger.warn("ACL operation failed", {
        dirPath,
        platform,
        error: result.stderr?.toString() ?? "unknown",
      });
    }
  } else {
    try {
      chmodSync(dirPath, 0o700);
    } catch (error) {
      SecurityLogger.warn("chmod operation failed", {
        dirPath,
        platform,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
