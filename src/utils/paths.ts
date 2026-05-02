import { homedir } from "os";
import { join } from "path";

/** Canonical Kastell config directory: ~/.kastell */
export const KASTELL_DIR = join(homedir(), ".kastell");

/** Backups directory: ~/.kastell/backups */
export const BACKUPS_DIR = join(KASTELL_DIR, "backups");

/** Security audit log: ~/.kastell/security.log */
export const SECURITY_LOG = join(KASTELL_DIR, "security.log");

/** Plugin registry directory: ~/.kastell/plugins */
export const PLUGINS_DIR = join(KASTELL_DIR, "plugins");

/** Plugin node_modules: ~/.kastell/plugins/node_modules */
export const PLUGINS_NODE_MODULES = join(PLUGINS_DIR, "node_modules");
