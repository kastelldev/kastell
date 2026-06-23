import { spawn } from "child_process";
import { PLUGIN_STATUS_LOADED } from "../plugin/registry.js";
import { existsSync } from "fs";
import { join } from "path";
import { getPluginRegistry, mapRegistryPlugins, deletePlugin as deletePluginFromRegistry, savePluginCache, toPluginCacheEntry } from "../plugin/registry.js";
import type { PluginRegistryEntry } from "../plugin/registry.js";
import type { PluginManifest } from "../plugin/sdk/types.js";
import { PLUGIN_NAME_PATTERN } from "../plugin/sdk/constants.js";
import { loadPlugins } from "../plugin/loader.js";
import { PLUGINS_DIR, PLUGINS_NODE_MODULES } from "../utils/paths.js";

const VERSION_PATTERN = /^[a-z0-9.\-+~^*x>=<| ]+$/i;
const STDERR_CAP = 4096;
const ERROR_STDERR_MAX = 200;

export interface PluginOperationResult {
  success: boolean;
  name: string;
  error?: string;
}

function runNpm(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const command = ["npm", ...args].join(" ");
    const proc = spawn(command, [], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });
    let stderr = "";
    if (proc.stderr) {
      proc.stderr.on("data", (data: Buffer) => {
        if (stderr.length < STDERR_CAP) stderr += data.toString();
      });
    }
    proc.on("close", (code) => {
      resolve({ code: code ?? 1, stderr });
    });
    proc.on("error", (err: Error) => {
      resolve({ code: 1, stderr: err.message });
    });
  });
}

export async function installPlugin(
  name: string,
  version?: string,
): Promise<PluginOperationResult> {
  if (!PLUGIN_NAME_PATTERN.test(name)) {
    return { success: false, name, error: "Plugin name must match pattern: kastell-plugin-<name>" };
  }

  if (version && !VERSION_PATTERN.test(version)) {
    return { success: false, name, error: "Invalid version specifier" };
  }

  const pkgSpec = version ? `${name}@${version}` : name;
  const installResult = await runNpm(["install", pkgSpec, "--prefix", PLUGINS_DIR]);

  if (installResult.code !== 0) {
    return {
      success: false,
      name,
      error: `npm install failed (exit ${installResult.code}): ${installResult.stderr.slice(0, ERROR_STDERR_MAX)}`,
    };
  }

  const loadResult = await loadPlugins();

  const loadError = loadResult.errors.find((e) => e.includes(name));
  if (loadError) {
    await runNpm(["uninstall", name, "--prefix", PLUGINS_DIR]);
    return { success: false, name, error: loadError };
  }

  return { success: true, name };
}

export async function removePlugin(name: string): Promise<PluginOperationResult> {
  if (!PLUGIN_NAME_PATTERN.test(name)) {
    return { success: false, name, error: "Plugin name must match pattern: kastell-plugin-<name>" };
  }

  const pluginPath = join(PLUGINS_NODE_MODULES, name);
  if (!existsSync(pluginPath)) {
    return { success: false, name, error: `Plugin "${name}" not installed` };
  }

  const result = await runNpm(["uninstall", name, "--prefix", PLUGINS_DIR]);

  if (result.code !== 0) {
    return {
      success: false,
      name,
      error: `npm uninstall failed (exit ${result.code}): ${result.stderr.slice(0, ERROR_STDERR_MAX)}`,
    };
  }

  deletePluginFromRegistry(name);

  const manifests = mapRegistryPlugins((_, entry) =>
    entry.status === PLUGIN_STATUS_LOADED ? entry.manifest : null,
  ).filter((m): m is PluginManifest => m !== null);
  savePluginCache(manifests.map(toPluginCacheEntry));

  return { success: true, name };
}

// PluginListEntry — discriminated union (A12). Status narrows what other fields
// are guaranteed: loaded variant carries commands/mcpTools, failed adds reason,
// disabled has neither. Mirrors PluginRegistryEntry's shape (registry.ts).
// Narrow once at the call site (`if (entry.status === "failed") entry.reason ...`).

interface PluginListEntryBase {
  name: string;
  version: string;
  prefix: string;
}

export type PluginListEntry =
  | (PluginListEntryBase & {
      status: "loaded";
      checks: number;
      commands: { name: string }[];
      mcpTools: { name: string }[];
    })
  | (PluginListEntryBase & {
      status: "failed";
      checks: 0;
      commands: [];
      mcpTools: [];
      reason: string;
    })
  | (PluginListEntryBase & {
      status: "disabled";
      checks: 0;
      commands: [];
      mcpTools: [];
    });

// Discriminator-narrowing helpers — P139 simplify C3/A12: replace
// `entry.status === PLUGIN_STATUS_LOADED ? ... : ...` ternaries with structural narrowing.
function toListEntry(_: string, entry: PluginRegistryEntry): PluginListEntry {
  if (entry.status === PLUGIN_STATUS_LOADED) {
    return {
      name: entry.manifest.name,
      version: entry.manifest.version,
      prefix: entry.manifest.checkPrefix,
      status: "loaded",
      checks: entry.checks.length,
      commands: entry.commands ?? [],
      mcpTools: entry.mcpTools ?? [],
    };
  }
  if (entry.status === "failed") {
    return {
      name: entry.descriptor.name,
      version: entry.descriptor.version ?? "unknown",
      prefix: entry.descriptor.checkPrefix ?? "unknown",
      status: "failed",
      checks: 0,
      commands: [],
      mcpTools: [],
      reason: entry.reason,
    };
  }
  // disabled
  return {
    name: entry.manifest.name,
    version: entry.manifest.version,
    prefix: entry.manifest.checkPrefix,
    status: "disabled",
    checks: 0,
    commands: [],
    mcpTools: [],
  };
}

export function listPlugins(): PluginListEntry[] {
  return mapRegistryPlugins(toListEntry);
}

export interface PluginValidationResult {
  name: string;
  valid: boolean;
  reason?: string;
}

function toValidationResult(name: string, entry: PluginRegistryEntry): PluginValidationResult {
  const resolvedName =
    entry.status === "failed" ? entry.descriptor.name : entry.manifest.name;
  return {
    name: resolvedName,
    valid: entry.status === PLUGIN_STATUS_LOADED,
    ...(entry.status === "failed" ? { reason: entry.reason } : {}),
  };
}

export function validatePlugins(name?: string): PluginValidationResult[] {
  const registry = getPluginRegistry();

  if (name) {
    const entry = registry.get(name);
    if (!entry) {
      return [{ name, valid: false, reason: "Plugin not found in registry" }];
    }
    return [toValidationResult(name, entry)];
  }

  return mapRegistryPlugins(toValidationResult);
}
