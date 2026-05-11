import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { ValidationError } from "../utils/errors.js";
import { secureWriteFileSync, secureMkdirSync } from "../utils/secureWrite.js";
import { KASTELL_DIR, PLUGINS_NODE_MODULES } from "../utils/paths.js";
import type { PluginManifest, PluginCheck, PluginCommand, PluginMcpTool, PluginFix } from "./sdk/types.js";
import { debugLog } from "../utils/logger.js";
import { PLUGIN_NAME_PREFIX, PLUGIN_TOOL_PREFIX } from "./sdk/constants.js";

const PLUGIN_CACHE_PATH = join(KASTELL_DIR, "plugin-manifests.json");

export interface PluginRegistryEntry {
  manifest: PluginManifest;
  checks: PluginCheck[];
  status: "loaded" | "failed";
  reason?: string;
  commands?: PluginCommand[];
  mcpTools?: PluginMcpTool[];
  fixes?: PluginFix[];
}

const PLUGIN_REGISTRY: Map<string, PluginRegistryEntry> = new Map();
const usedPrefixes: Map<string, string> = new Map();
const usedCheckIds: Set<string> = new Set();

export function registerPlugin(
  manifest: PluginManifest,
  checks: PluginCheck[],
): void {
  if (PLUGIN_REGISTRY.has(manifest.name)) {
    throw new ValidationError(
      `Plugin "${manifest.name}" already registered`,
    );
  }

  const prefixOwner = usedPrefixes.get(manifest.checkPrefix);
  if (prefixOwner) {
    throw new ValidationError(
      `checkPrefix "${manifest.checkPrefix}" already used by "${prefixOwner}"`,
    );
  }

  for (const check of checks) {
    if (!check.id.startsWith(`${manifest.checkPrefix}-`)) {
      throw new ValidationError(
        `Check ID "${check.id}" must start with "${manifest.checkPrefix}-"`,
      );
    }
    if (usedCheckIds.has(check.id)) {
      throw new ValidationError(
        `Check ID "${check.id}" already exists in another plugin`,
      );
    }
  }

  usedPrefixes.set(manifest.checkPrefix, manifest.name);
  for (const check of checks) {
    usedCheckIds.add(check.id);
  }

  PLUGIN_REGISTRY.set(manifest.name, {
    manifest,
    checks,
    status: "loaded",
    commands: manifest.commands,
    mcpTools: manifest.mcpTools,
    fixes: manifest.fixes,
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

export function deletePlugin(name: string): void {
  const entry = PLUGIN_REGISTRY.get(name);
  if (!entry) return;

  usedPrefixes.delete(entry.manifest.checkPrefix);
  for (const check of entry.checks) {
    usedCheckIds.delete(check.id);
  }
  PLUGIN_REGISTRY.delete(name);
}

export function mapRegistryPlugins<T>(
  callback: (name: string, entry: PluginRegistryEntry) => T,
): T[] {
  const results: T[] = [];
  for (const [name, entry] of PLUGIN_REGISTRY) {
    results.push(callback(name, entry));
  }
  return results;
}

export interface PluginCommandEntry {
  pluginShortName: string;
  command: PluginCommand;
  pluginDir: string;
}

export interface PluginMcpToolEntry {
  pluginShortName: string;
  toolName: string;
  tool: PluginMcpTool;
  pluginDir: string;
}

export function getShortName(pluginName: string): string {
  return pluginName.replace(PLUGIN_NAME_PREFIX, "");
}

export function getPluginCommands(): PluginCommandEntry[] {
  const entries: PluginCommandEntry[] = [];
  for (const [, entry] of PLUGIN_REGISTRY) {
    if (entry.status !== "loaded" || !entry.commands?.length) continue;
    const shortName = getShortName(entry.manifest.name);
    const pluginDir = join(PLUGINS_NODE_MODULES, entry.manifest.name);
    for (const cmd of entry.commands) {
      entries.push({ pluginShortName: shortName, command: cmd, pluginDir });
    }
  }
  return entries;
}

export function getPluginMcpTools(): PluginMcpToolEntry[] {
  const entries: PluginMcpToolEntry[] = [];
  for (const [, entry] of PLUGIN_REGISTRY) {
    if (entry.status !== "loaded" || !entry.mcpTools?.length) continue;
    const shortName = getShortName(entry.manifest.name);
    const pluginDir = join(PLUGINS_NODE_MODULES, entry.manifest.name);
    for (const tool of entry.mcpTools) {
      entries.push({
        pluginShortName: shortName,
        toolName: `${PLUGIN_TOOL_PREFIX}${shortName}_${tool.name}`,
        tool,
        pluginDir,
      });
    }
  }
  return entries;
}

export function clearPluginRegistry(): void {
  PLUGIN_REGISTRY.clear();
  usedPrefixes.clear();
  usedCheckIds.clear();
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
  } catch (error) {
    debugLog?.("plugin registry read failed, creating new", { cause: error });
    return [];
  }
}

export function savePluginCache(manifests: PluginManifest[]): void {
  const content = JSON.stringify(manifests, null, 2);
  if (existsSync(PLUGIN_CACHE_PATH)) {
    try {
      const existing = readFileSync(PLUGIN_CACHE_PATH, "utf-8");
      if (existing === content) return;
    } catch (error) {
      debugLog?.("plugin cache comparison failed, rewriting", { cause: error });
    }
  }
  secureMkdirSync(KASTELL_DIR);
  secureWriteFileSync(PLUGIN_CACHE_PATH, content);
}
