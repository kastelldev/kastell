import { writeFileSync, appendFileSync, mkdirSync, chmodSync } from "fs";
import { isWindows } from "./platform.js";

export interface WriteFileOptions {
  encoding?: BufferEncoding;
  flag?: string;
}

const securedDirs = new Set<string>();

export function clearCache(): void {
  securedDirs.clear();
}

function applyPermissions(targetPath: string, mode: 0o600 | 0o700): void {
  if (isWindows()) return; // ACL hardening → v2.4 backlog
  chmodSync(targetPath, mode);
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

export function secureAppendFileSync(
  filePath: string,
  data: string,
  options?: WriteFileOptions
): void {
  appendFileSync(filePath, data, options);
  applyPermissions(filePath, 0o600);
}

export function secureMkdirSync(
  dirPath: string,
  options?: { recursive?: boolean }
): void {
  mkdirSync(dirPath, { recursive: options?.recursive ?? true });
  ensureSecureDir(dirPath);
}
