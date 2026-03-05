import { existsSync, mkdirSync, cpSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import chalk from "chalk";

const OLD_CONFIG_DIR = join(homedir(), ".quicklify");
const NEW_CONFIG_DIR = join(homedir(), ".kastell");
const MIGRATED_FLAG = join(NEW_CONFIG_DIR, ".migrated");

/**
 * Migrate config from ~/.quicklify to ~/.kastell on first run.
 * - If ~/.kastell already exists, does nothing (no overwrite risk).
 * - If ~/.quicklify does not exist, does nothing (fresh install).
 * - Otherwise copies contents and creates .migrated flag.
 */
export function migrateConfigIfNeeded(): void {
  // If new config dir already exists, skip (no overwrite risk)
  if (existsSync(NEW_CONFIG_DIR)) {
    return;
  }

  // If old config dir doesn't exist, skip (fresh install)
  if (!existsSync(OLD_CONFIG_DIR)) {
    return;
  }

  try {
    mkdirSync(NEW_CONFIG_DIR, { recursive: true, mode: 0o700 });
    cpSync(OLD_CONFIG_DIR, NEW_CONFIG_DIR, { recursive: true });
    writeFileSync(MIGRATED_FLAG, new Date().toISOString(), { mode: 0o600 });
    console.warn(
      chalk.yellow(
        "Migrated config from ~/.quicklify to ~/.kastell. You can safely remove ~/.quicklify.",
      ),
    );
  } catch {
    // If copy fails, log warning and continue -- don't crash the CLI
    console.warn(
      chalk.yellow(
        "Warning: Could not migrate config from ~/.quicklify to ~/.kastell. You may need to copy files manually.",
      ),
    );
  }
}
