import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { ValidationError } from "../utils/errors.js";
import { secureWriteFileSync, secureMkdirSync } from "../utils/secureWrite.js";
import { KASTELL_DIR } from "../utils/paths.js";
import type { PluginManifest, PluginCheck } from "./sdk/types.js";

const PLUGIN_CACHE_PATH = join(KASTELL_DIR, "plugin-manifests.json");

export interface PluginRegistryEntry {
  manifest: PluginManifest;
  checks: PluginCheck[];
  status: "loaded" | "failed";
  reason?: string;
}

const PLUGIN_REGISTRY: Map<string, PluginRegistryEntry> = new Map();

export function registerPlugin(
  manifest: PluginManifest,
  checks: PluginCheck[],
): void {
  if (PLUGIN_REGISTRY.has(manifest.name)) {
    throw new ValidationError(
      `Plugin "${manifest.name}" already registered`,
    );
  }

  for (const [, entry] of PLUGIN_REGISTRY) {
    if (entry.manifest.checkPrefix === manifest.checkPrefix) {
      throw new ValidationError(
        `checkPrefix "${manifest.checkPrefix}" already used by "${entry.manifest.name}"`,
      );
    }
  }

  for (const check of checks) {
    if (!check.id.startsWith(`${manifest.checkPrefix}-`)) {
      throw new ValidationError(
        `Check ID "${check.id}" must start with "${manifest.checkPrefix}-"`,
      );
    }
  }

  const allCheckIds = new Set<string>();
  for (const [, entry] of PLUGIN_REGISTRY) {
    for (const c of entry.checks) {
      allCheckIds.add(c.id);
    }
  }
  for (const check of checks) {
    if (allCheckIds.has(check.id)) {
      throw new ValidationError(
        `Check ID "${check.id}" already exists in another plugin`,
      );
    }
  }

  PLUGIN_REGISTRY.set(manifest.name, {
    manifest,
    checks,
    status: "loaded",
  });
}

export function registerFailedPlugin(
  manifest: PluginManifest,
  reason: string,
): void {
  PLUGIN_REGISTRY.set(manifest.name, {
    manifest,
    checks: [],
    status: "failed",
    reason,
  });
}

export function clearPluginRegistry(): void {
  PLUGIN_REGISTRY.clear();
}

export function getPluginRegistry(): ReadonlyMap<string, PluginRegistryEntry> {
  return PLUGIN_REGISTRY;
}

export function loadPluginCache(): PluginManifest[] {
  if (!existsSync(PLUGIN_CACHE_PATH)) {
    return [];
  }
  try {
    const raw = readFileSync(PLUGIN_CACHE_PATH, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as PluginManifest[];
  } catch {
    return [];
  }
}

export function savePluginCache(manifests: PluginManifest[]): void {
  secureMkdirSync(KASTELL_DIR);
  secureWriteFileSync(
    PLUGIN_CACHE_PATH,
    JSON.stringify(manifests, null, 2),
  );
}