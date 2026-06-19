import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { ValidationError } from "../utils/errors.js";
import { secureWriteFileSync, secureMkdirSync } from "../utils/secureWrite.js";
import { KASTELL_DIR, PLUGINS_NODE_MODULES } from "../utils/paths.js";
import type { PluginManifest, PluginCheck, PluginCommand, PluginMcpTool, PluginFix } from "./sdk/types.js";
import { debugLog } from "../utils/logger.js";
import { PLUGIN_NAME_PREFIX, PLUGIN_TOOL_PREFIX } from "./sdk/constants.js";
import type { FailedPluginDescriptor } from "./failedDescriptor.js";

const PLUGIN_CACHE_PATH = join(KASTELL_DIR, "plugin-manifests.json");

/**
 * Status string-literal constants. CQS-08: prefer these over `"loaded"` magic
 * strings at call sites. `as const` preserves the literal type so discriminated
 * union narrowing (`entry.status === PLUGIN_STATUS_LOADED`) still narrows
 * correctly to the loaded variant.
 */
export const PLUGIN_STATUS_LOADED = "loaded" as const;
export const PLUGIN_STATUS_FAILED = "failed" as const;
export const PLUGIN_STATUS_DISABLED = "disabled" as const;

// ─── PluginRegistryEntry discriminated union ───────────────────────────────────
// Each variant shares `manifest`; status narrows what else is accessible.

export type PluginRegistryEntry =
  | ({
      status: "loaded";
      manifest: PluginManifest;
      checks: PluginCheck[];
      commands?: PluginCommand[];
      mcpTools?: PluginMcpTool[];
      checksById: ReadonlyMap<string, PluginCheck>;
      fixesByCheckId: ReadonlyMap<string, PluginFix>;
      activeProbesByCheckId: ReadonlyMap<string, never>;
    })
  | ({
      status: "failed";
      descriptor: FailedPluginDescriptor;
      reason: string;
      checks: [];
      checksById: ReadonlyMap<string, never>;
      activeProbesByCheckId: ReadonlyMap<string, never>;
      fixesByCheckId: ReadonlyMap<string, never>;
    })
  | ({
      status: "disabled";
      manifest: PluginManifest;
      checks: [];
      checksById: ReadonlyMap<string, never>;
      activeProbesByCheckId: ReadonlyMap<string, never>;
      fixesByCheckId: ReadonlyMap<string, never>;
    });

type LoadedEntry = Extract<PluginRegistryEntry, { status: "loaded" }>;
type FailedEntry = Extract<PluginRegistryEntry, { status: "failed" }>;
type DisabledEntry = Extract<PluginRegistryEntry, { status: "disabled" }>;

// Typed builders — return the discriminated variant directly so call sites
// don't need `as unknown as PluginRegistryEntry` (P139 simplify C3).
function createLoadedEntry(
  manifest: PluginManifest,
  checks: PluginCheck[],
  checksById: ReadonlyMap<string, PluginCheck>,
  fixesById: ReadonlyMap<string, PluginFix>,
): LoadedEntry {
  return {
    status: "loaded",
    manifest,
    checks,
    checksById,
    fixesByCheckId: fixesById,
    activeProbesByCheckId: new Map<string, never>(),
    commands: manifest.commands,
    mcpTools: manifest.mcpTools,
  };
}

function createFailedEntry(descriptor: FailedPluginDescriptor, reason: string): FailedEntry {
  return {
    status: "failed",
    descriptor,
    reason,
    checks: [],
    checksById: new Map<string, never>(),
    activeProbesByCheckId: new Map<string, never>(),
    fixesByCheckId: new Map<string, never>(),
  };
}

function createDisabledEntry(manifest: PluginManifest): DisabledEntry {
  return {
    status: "disabled",
    manifest,
    checks: [],
    checksById: new Map<string, never>(),
    activeProbesByCheckId: new Map<string, never>(),
    fixesByCheckId: new Map<string, never>(),
  };
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

  const checksById = new Map<string, PluginCheck>();
  for (const check of checks) checksById.set(check.id, check);

  const fixesByCheckId = new Map<string, PluginFix>();
  if (manifest.fixes) {
    for (const fix of manifest.fixes) fixesByCheckId.set(fix.checkId, fix);
  }

  PLUGIN_REGISTRY.set(manifest.name, createLoadedEntry(manifest, checks, checksById, fixesByCheckId));
}

export function registerFailedPlugin(
  descriptor: FailedPluginDescriptor,
  reason: string,
): void {
  PLUGIN_REGISTRY.set(descriptor.name, createFailedEntry(descriptor, reason));
}

export function registerDisabledPlugin(
  manifest: PluginManifest,
): void {
  PLUGIN_REGISTRY.set(manifest.name, createDisabledEntry(manifest));
}

export function deletePlugin(name: string): void {
  const entry = PLUGIN_REGISTRY.get(name);
  if (!entry) return;

  if (entry.status === PLUGIN_STATUS_LOADED || entry.status === PLUGIN_STATUS_DISABLED) {
    usedPrefixes.delete(entry.manifest.checkPrefix);
  } else if (entry.status === PLUGIN_STATUS_FAILED && entry.descriptor.checkPrefix) {
    usedPrefixes.delete(entry.descriptor.checkPrefix);
  }
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

// Strict cache schema — only discovery metadata. Executable fields
// (commands, mcpTools, fixes, checks, activeProbe definitions) MUST NOT
// appear in plugin-manifests.json — they belong to plugin source code.
export const PluginCacheEntrySchema = z
  .object({
    name: z.string().regex(/^kastell-plugin-[a-z0-9-]+$/),
    version: z.string().min(1),
    apiVersion: z.union([z.literal("2"), z.literal("3")]),
    kastell: z.string().min(1),
    capabilities: z.array(z.enum(["audit", "command", "mcp-tool", "fix"])).min(1),
    checkPrefix: z.string().regex(/^[A-Z]{2,6}$/),
    entry: z.string().min(1),
  })
  .strict();

export type PluginCacheEntry = z.infer<typeof PluginCacheEntrySchema>;

export function toPluginCacheEntry(manifest: PluginManifest): PluginCacheEntry {
  return {
    name: manifest.name,
    version: manifest.version,
    apiVersion: manifest.apiVersion,
    kastell: manifest.kastell,
    capabilities: manifest.capabilities,
    checkPrefix: manifest.checkPrefix,
    entry: manifest.entry,
  };
}

export function loadPluginCache(): PluginCacheEntry[] {
  if (!existsSync(PLUGIN_CACHE_PATH)) {
    return [];
  }
  let raw: string;
  try {
    raw = readFileSync(PLUGIN_CACHE_PATH, "utf-8");
  } catch (error) {
    debugLog?.("plugin cache read failed, creating new", { cause: error });
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    debugLog?.("plugin cache JSON parse failed, creating new", { cause: error });
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const valid: PluginCacheEntry[] = [];
  for (const item of parsed) {
    // Strip executable fields before strict schema validation -- these
    // should never have been written by savePluginCache but legacy caches
    // or hand-edited files may contain them.
    const sanitized = sanitizeCacheItem(item);
    const result = PluginCacheEntrySchema.safeParse(sanitized);
    if (result.success) {
      valid.push(result.data);
    }
  }
  return valid;
}

function sanitizeCacheItem(item: unknown): unknown {
  if (item === null || typeof item !== "object") return item;
  const value = item as Record<string, unknown>;
  const allowed: Record<string, unknown> = {};
  for (const key of [
    "name",
    "version",
    "apiVersion",
    "kastell",
    "capabilities",
    "checkPrefix",
    "entry",
  ]) {
    if (key in value) allowed[key] = value[key];
  }
  return allowed;
}

export function savePluginCache(entries: PluginCacheEntry[]): void {
  const content = JSON.stringify(entries, null, 2);
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
