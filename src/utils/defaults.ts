import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import type { KastellConfig } from "../types/index.js";
import { SUPPORTED_PROVIDERS, invalidProviderError } from "../constants.js";
import { KASTELL_DIR } from "./paths.js";

const DEFAULTS_FILE = join(KASTELL_DIR, "config.json");

const VALID_KEYS = ["provider", "region", "size", "name"];

function ensureConfigDir(): void {
  mkdirSync(KASTELL_DIR, { recursive: true, mode: 0o700 });
}

export function getDefaults(): KastellConfig {
  try {
    const data = readFileSync(DEFAULTS_FILE, "utf-8");
    const parsed = JSON.parse(data);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as KastellConfig;
  } catch {
    return {};
  }
}

export function setDefault(key: string, value: string): void {
  if (!VALID_KEYS.includes(key)) {
    throw new Error(`Invalid config key: ${key}. Valid keys: ${VALID_KEYS.join(", ")}`);
  }
  if (key === "provider" && !(SUPPORTED_PROVIDERS as readonly string[]).includes(value)) {
    throw new Error(invalidProviderError(value));
  }
  ensureConfigDir();
  const config = getDefaults();
  (config as Record<string, string>)[key] = value;
  writeFileSync(DEFAULTS_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function getDefault(key: string): string | undefined {
  const config = getDefaults();
  return (config as Record<string, string | undefined>)[key];
}

export function resetDefaults(): void {
  ensureConfigDir();
  writeFileSync(DEFAULTS_FILE, JSON.stringify({}, null, 2), { mode: 0o600 });
}

/** @deprecated Use KASTELL_DIR from ./paths.js — kept for backward compat */
const CONFIG_DIR = KASTELL_DIR;
export { CONFIG_DIR, DEFAULTS_FILE, VALID_KEYS };
