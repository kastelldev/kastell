import { homedir } from "os";
import { join } from "path";

/** Canonical Kastell config directory: ~/.kastell */
export const KASTELL_DIR = join(homedir(), ".kastell");
