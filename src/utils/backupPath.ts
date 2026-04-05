import { join } from "path";
import { BACKUPS_DIR } from "./paths.js";

/**
 * Formats a Date as a filesystem-safe timestamp string.
 * Example: "2026-03-15_12-30-45-123"
 */
export function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-").replace("T", "_").replace("Z", "");
}

/**
 * Returns the backup directory path for a given server.
 * Includes path traversal guard against crafted server names.
 */
export function getBackupDir(serverName: string): string {
  // Guard against path traversal via crafted server names
  if (/[/\\]|\.\./.test(serverName)) {
    throw new Error("Invalid server name: contains path separator or traversal");
  }
  return join(BACKUPS_DIR, serverName);
}
