import { spawn } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { getPluginRegistry, forEachRegistryPlugin } from "../plugin/registry.js";
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
  return forEachRegistryPlugin((_, entry) => ({
    name: entry.manifest.name,
    version: entry.manifest.version,
    prefix: entry.manifest.checkPrefix,
    checks: entry.checks.length,
    status: entry.status,
    ...(entry.reason ? { reason: entry.reason } : {}),
  }));
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

  return forEachRegistryPlugin((_, entry) => ({
    name: entry.manifest.name,
    valid: entry.status === "loaded",
    ...(entry.reason ? { reason: entry.reason } : {}),
  }));
}
