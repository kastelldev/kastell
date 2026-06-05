import { FAILED_PLUGIN_PREFIX } from "./sdk/constants.js";
import { PLUGIN_STATUS_LOADED } from "./registry.js";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join, resolve, sep } from "path";
import { pathToFileURL } from "url";
import { PLUGINS_NODE_MODULES } from "../utils/paths.js";
import { validateManifest, validateChecks } from "./validate.js";
import { extractReason } from "../utils/errors.js";
import {
  registerPlugin,
  registerFailedPlugin,
  clearPluginRegistry,
  mapRegistryPlugins,
  savePluginCache,
} from "./registry.js";
import type { PluginCheck, PluginManifest, PluginCommand, PluginMcpTool, PluginFix } from "./sdk/types.js";

const PARALLEL_BLACKLIST: RegExp[] = [
  /\brm\b/, /\bmv\b/, /\bcp\s+-f\b/,
  /\bdd\b/, /\btruncate\b/, /\bmkfs\b/, /\bmount\b/, /\bumount\b/,
  />/,      // output redirection (single > or >>)
  /\btee\b/,
  /\bchmod\b/, /\bchown\b/,
  /\bsed\s+-i\b/,
  /\bsystemctl\s+(restart|stop|start|enable|disable)\b/,
  /\bservice\s+\S+\s+restart\b/,
  /\bapt(-get)?\s+(install|remove|upgrade|update)\b/,
  /\bdnf\s+(install|remove)\b/,
  /\byum\s+(install|remove)\b/,
  /\bpkg\s+(install|remove)\b/,
];

function isCommandReadOnly(command: string): { safe: boolean; matched?: string } {
  for (const pattern of PARALLEL_BLACKLIST) {
    if (pattern.test(command)) {
      return { safe: false, matched: pattern.source };
    }
  }
  return { safe: true };
}

/**
 * Check a manifest's checks against the mutating-command blacklist.
 * Returns an error string describing the first violation, or null if all
 * checks pass (or if the manifest opts out via `safeToParallel: false`).
 */
function enforceReadOnlyChecks(manifest: PluginManifest, checks: PluginCheck[]): string | null {
  if (manifest.safeToParallel === false) return null;
  for (const check of checks) {
    const result = isCommandReadOnly(check.checkCommand);
    if (!result.safe) {
      return `Plugin "${manifest.name}" check "${check.id}" has forbidden token in checkCommand ` +
        `(matched: ${result.matched}). checkCommand MUST be read-only. ` +
        `Set "safeToParallel: false" in manifest if mutation is intentional.`;
    }
  }
  return null;
}

interface LoadPluginsOptions {
  importer?: (path: string) => Promise<unknown>;
}

interface LoadPluginsResult {
  loaded: string[];
  errors: string[];
}

export async function loadPlugins(
  options?: LoadPluginsOptions,
): Promise<LoadPluginsResult> {
  const importer = options?.importer ?? ((p: string) => import(p));
  const loaded: string[] = [];
  const errors: string[] = [];

  clearPluginRegistry();

  if (!existsSync(PLUGINS_NODE_MODULES)) {
    return { loaded, errors };
  }

  const entries = readdirSync(PLUGINS_NODE_MODULES, { withFileTypes: true });
  const pluginDirs = entries.filter(
    (e) => e.isDirectory() && e.name.startsWith("kastell-plugin-"),
  );

  if (pluginDirs.length === 0) {
    return { loaded, errors };
  }

  const results = await Promise.allSettled(
    pluginDirs.map(async (dir) => {
      const pluginDir = join(PLUGINS_NODE_MODULES, dir.name);
      const manifestPath = join(pluginDir, "kastell-plugin.json");

      const failedManifest = (): PluginManifest => ({
        name: dir.name,
        version: "0.0.0",
        apiVersion: "1",
        kastell: "*",
        capabilities: ["audit"],
        checkPrefix: FAILED_PLUGIN_PREFIX,
        entry: "",
      });

      let manifestRaw: string;
      try {
        manifestRaw = readFileSync(manifestPath, "utf-8");
      } catch {
        registerFailedPlugin(failedManifest(), `cannot read kastell-plugin.json`);
        throw new Error(`${dir.name}: cannot read kastell-plugin.json`);
      }

      let manifestParsed: unknown;
      try {
        manifestParsed = JSON.parse(manifestRaw);
      } catch {
        registerFailedPlugin(failedManifest(), `invalid JSON in kastell-plugin.json`);
        throw new Error(`${dir.name}: invalid JSON in kastell-plugin.json`);
      }

      const manifest = validateManifest(manifestParsed);

      const resolvedDir = resolve(pluginDir);
      const resolvedEntry = resolve(resolvedDir, manifest.entry);
      if (!resolvedEntry.startsWith(resolvedDir + sep) && resolvedEntry !== resolvedDir) {
        registerFailedPlugin(manifest, `entry escapes plugin directory: ${manifest.entry}`);
        throw new Error(`${dir.name}: entry escapes plugin directory: ${manifest.entry}`);
      }

      const entryUrl = pathToFileURL(resolvedEntry).href;

      let mod: unknown;
      try {
        mod = await importer(entryUrl);
      } catch (err: unknown) {
        const msg = extractReason(err);
        registerFailedPlugin(manifest, msg);
        throw new Error(`${dir.name}: import failed — ${msg}`, { cause: err });
      }

      const ns = mod as Record<string, unknown>;
      // ESM CJS interop: namespace has .default = module.exports, plus .module.exports = module.exports
      const moduleObj = (ns.default ?? ns["module.exports"] ?? ns) as Record<string, unknown>;
      if (!Array.isArray(moduleObj.checks)) {
        registerFailedPlugin(
          manifest,
          "module does not export checks array",
        );
        throw new Error(
          `${dir.name}: module does not export checks array`,
        );
      }

      let checks: PluginCheck[];
      try {
        checks = validateChecks(moduleObj.checks, manifest.checkPrefix);
      } catch (err: unknown) {
        const msg = extractReason(err);
        registerFailedPlugin(manifest, msg);
        throw new Error(`${dir.name}: check validation failed — ${msg}`, { cause: err });
      }

      // Blacklist check — reject mutating checkCommand unless safeToParallel: false
      const blacklistErr = enforceReadOnlyChecks(manifest, checks);
      if (blacklistErr) {
        registerFailedPlugin(manifest, blacklistErr);
        throw new Error(blacklistErr);
      }

      const enrichedManifest: PluginManifest = {
        ...manifest,
        commands: (moduleObj.commands as PluginCommand[] | undefined) ?? manifest.commands,
        mcpTools: (moduleObj.mcpTools as PluginMcpTool[] | undefined) ?? manifest.mcpTools,
        fixes: (moduleObj.fixes as PluginFix[] | undefined) ?? manifest.fixes,
      };

      function guardHandlerPath(
        pluginDir: string,
        handler: string,
        type: string,
      ): void {
        const resolved = resolve(pluginDir, handler);
        if (!resolved.startsWith(pluginDir + sep) && resolved !== pluginDir) {
          throw new Error(`${type} handler escapes plugin directory: ${handler}`);
        }
      }

      if (enrichedManifest.fixes) {
        for (const fix of enrichedManifest.fixes) {
          guardHandlerPath(resolvedDir, fix.handler, "fix");
        }
      }

      if (enrichedManifest.commands) {
        for (const cmd of enrichedManifest.commands) {
          guardHandlerPath(resolvedDir, cmd.handler, "command");
        }
      }

      if (enrichedManifest.mcpTools) {
        for (const tool of enrichedManifest.mcpTools) {
          guardHandlerPath(resolvedDir, tool.handler, "mcpTool");
        }
      }

      registerPlugin(enrichedManifest, checks);
      return manifest.name;
    }),
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      loaded.push(result.value);
    } else {
      errors.push(extractReason(result.reason));
    }
  }

  const manifests = mapRegistryPlugins((_, entry) =>
    entry.status === PLUGIN_STATUS_LOADED ? entry.manifest : null,
  ).filter((m): m is PluginManifest => m !== null);
  savePluginCache(manifests);

  return { loaded, errors };
}
