import { spawnSync } from "child_process";
import { writeFileSync, mkdirSync, chmodSync } from "fs";
import { userInfo } from "os";
import { SecurityLogger } from "./securityLogger.js";
import { extractReason } from "./errors.js";

export interface WriteFileOptions {
  encoding?: BufferEncoding;
  flag?: string;
}

let cachedUsername: string | undefined;
function getUsername(): string {
  if (!cachedUsername) cachedUsername = userInfo().username;
  return cachedUsername;
}

const securedDirs = new Set<string>();

export function clearCache(): void {
  securedDirs.clear();
  cachedUsername = undefined;
}

function applyPermissions(targetPath: string, mode: 0o600 | 0o700): void {
  if (process.platform === "win32") {
    const result = spawnSync("icacls", [
      targetPath,
      "/inheritance:r",
      "/grant:r",
      `${getUsername()}:F`,
    ]);
    if (result.status !== 0) {
      SecurityLogger.warn("ACL operation failed", {
        path: targetPath,
        platform: process.platform,
        error: result.stderr?.toString() ?? "unknown",
      });
    }
  } else {
    try {
      chmodSync(targetPath, mode);
    } catch (error) {
      SecurityLogger.warn("chmod operation failed", {
        path: targetPath,
        platform: process.platform,
        error: extractReason(error),
      });
    }
  }
}

export function ensureSecureDir(dirPath: string): void {
  if (securedDirs.has(dirPath)) {
    return;
  }
  applyPermissions(dirPath, 0o700);
  securedDirs.add(dirPath);
}

export function secureWriteFileSync(
  filePath: string,
  data: string,
  options?: WriteFileOptions
): void {
  writeFileSync(filePath, data, options);
  applyPermissions(filePath, 0o600);
}

export function secureMkdirSync(
  dirPath: string,
  options?: { recursive?: boolean }
): void {
  mkdirSync(dirPath, { recursive: options?.recursive ?? true });
  ensureSecureDir(dirPath);
}
