import { existsSync, cpSync } from "fs";
import { secureMkdirSync, secureWriteFileSync } from "./secureWrite.js";
import { homedir } from "os";
import { join } from "path";
import chalk from "chalk";
import { KASTELL_DIR } from "./paths.js";
import { getServersRaw, atomicWriteServers } from "./config.js";
import { debugLog } from "./logger.js";

const OLD_CONFIG_DIR = join(homedir(), ".quicklify");
const NEW_CONFIG_DIR = KASTELL_DIR;
const MIGRATED_FLAG = join(NEW_CONFIG_DIR, ".migrated");

/**
 * Migrate config from ~/.quicklify to ~/.kastell on first run.
 * - If ~/.kastell already exists, does nothing (no overwrite risk).
 * - If ~/.quicklify does not exist, does nothing (fresh install).
 * - Otherwise copies contents and creates .migrated flag.
 */
export function migrateConfigIfNeeded(): void {
  // Directory migration: ~/.quicklify → ~/.kastell
  if (!existsSync(NEW_CONFIG_DIR) && existsSync(OLD_CONFIG_DIR)) {
    try {
      secureMkdirSync(NEW_CONFIG_DIR, { recursive: true });
      cpSync(OLD_CONFIG_DIR, NEW_CONFIG_DIR, { recursive: true });
      secureWriteFileSync(MIGRATED_FLAG, new Date().toISOString());
      console.warn(
        chalk.yellow(
          "Migrated config from ~/.quicklify to ~/.kastell. You can safely remove ~/.quicklify.",
        ),
      );
    } catch {
      console.warn(
        chalk.yellow(
          "Warning: Could not migrate config from ~/.quicklify to ~/.kastell. You may need to copy files manually.",
        ),
      );
    }
  }

  // Mode field migration: v1.x configs may lack "mode" field
  const SERVERS_FILE_PATH = join(KASTELL_DIR, "servers.json");
  if (!existsSync(SERVERS_FILE_PATH)) return;
  try {
    const servers = getServersRaw();
    const needsMode = servers.some((s) => !s.mode);
    if (needsMode) {
      const migrated = servers.map((s) => ({ ...s, mode: s.mode || "coolify" }));
      atomicWriteServers(migrated);
      debugLog?.("migrated server mode fields to include platform mode");
    }
  } catch {
    debugLog?.("mode field migration failed");
  }
}
