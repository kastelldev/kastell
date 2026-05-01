import { spawn } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getPluginRegistry } from "../plugin/registry.js";
import { loadPlugins } from "../plugin/loader.js";
import { PLUGINS_DIR, PLUGINS_NODE_MODULES } from "../utils/paths.js";

const PLUGIN_NAME_PATTERN = /^kastell-plugin-[a-z0-9-]+$/;
const ERROR_STDERR_MAX = 200;

export interface PluginInstallResult {
  success: boolean;
  name: string;
  error?: string;
}

function runNpm(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn("npm", args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let stderr = "";
    if (proc.stderr) {
      proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
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
): Promise<PluginInstallResult> {
  if (!PLUGIN_NAME_PATTERN.test(name)) {
    throw new Error("Plugin name must match pattern: kastell-plugin-<name>");
  }

  if (!existsSync(PLUGINS_DIR)) {
    mkdirSync(PLUGINS_DIR, { recursive: true });
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

export interface PluginRemoveResult {
  success: boolean;
  name: string;
  error?: string;
}

export async function removePlugin(name: string): Promise<PluginRemoveResult> {
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

  await loadPlugins();
  return { success: true, name };
}

export interface PluginListEntry {
  name: string;
  version: string;
  prefix: string;
  checks: number;
  status: "loaded" | "failed";
  reason?: string;
}

export function listPlugins(): PluginListEntry[] {
  const registry = getPluginRegistry();
  const entries: PluginListEntry[] = [];

  for (const [, entry] of registry) {
    entries.push({
      name: entry.manifest.name,
      version: entry.manifest.version,
      prefix: entry.manifest.checkPrefix,
      checks: entry.checks.length,
      status: entry.status,
      ...(entry.reason ? { reason: entry.reason } : {}),
    });
  }

  return entries;
}

export interface PluginValidationResult {
  name: string;
  valid: boolean;
  reason?: string;
}

export function validatePlugins(name?: string): PluginValidationResult[] {
  const registry = getPluginRegistry();

  if (name) {
    const entry = registry.get(name);
    if (!entry) {
      return [{ name, valid: false, reason: "Plugin not found in registry" }];
    }
    return [{
      name: entry.manifest.name,
      valid: entry.status === "loaded",
      ...(entry.reason ? { reason: entry.reason } : {}),
    }];
  }

  const results: PluginValidationResult[] = [];
  for (const [, entry] of registry) {
    results.push({
      name: entry.manifest.name,
      valid: entry.status === "loaded",
      ...(entry.reason ? { reason: entry.reason } : {}),
    });
  }
  return results;
}