import { readFileSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { KASTELL_DIR } from "../utils/paths.js";
import { secureMkdirSync, secureWriteFileSync } from "../utils/secureWrite.js";
import type { DefaultsConfig } from "../types/index.js";

const DEFAULTS_FILE = join(KASTELL_DIR, "defaults.json");

const DefaultsSchema = z.object({
  threshold: z.number().int().min(0).max(100).optional(),
  framework: z
    .enum(["cis-level1", "cis-level2", "pci-dss", "hipaa"])
    .optional(),
}).strip();

export function loadDefaults(): DefaultsConfig {
  let raw: string;
  try {
    raw = readFileSync(DEFAULTS_FILE, "utf-8");
  } catch {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    const result = DefaultsSchema.safeParse(parsed);
    return result.success ? result.data : {};
  } catch {
    return {};
  }
}

export function saveDefaults(config: DefaultsConfig): void {
  secureMkdirSync(KASTELL_DIR, { recursive: true });
  secureWriteFileSync(DEFAULTS_FILE, JSON.stringify(config, null, 2));
}
