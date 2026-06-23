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
  toPluginCacheEntry,
} from "./registry.js";
import type { LoadedPluginCheck, PluginManifest, PluginCommand, PluginMcpTool, PluginFix, PluginCheckV2, PluginCheckV3 } from "./sdk/types.js";
import { toFailedPluginDescriptor } from "./failedDescriptor.js";
import { validateAndNormalizeChecks } from "./normalize.js";
import { loadActiveProbeModule } from "./activeProbeLoader.js";

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

      const failedDescriptor = (parsed?: unknown) =>
        toFailedPluginDescriptor(dir.name, parsed);

      let manifestRaw: string;
      try {
        manifestRaw = readFileSync(manifestPath, "utf-8");
      } catch {
        registerFailedPlugin(failedDescriptor(), `cannot read kastell-plugin.json`);
        throw new Error(`${dir.name}: cannot read kastell-plugin.json`);
      }

      let manifestParsed: unknown;
      try {
        manifestParsed = JSON.parse(manifestRaw);
      } catch {
        registerFailedPlugin(failedDescriptor(), `invalid JSON in kastell-plugin.json`);
        throw new Error(`${dir.name}: invalid JSON in kastell-plugin.json`);
      }

      const manifest = validateManifest(manifestParsed);

      const resolvedDir = resolve(pluginDir);
      const resolvedEntry = resolve(resolvedDir, manifest.entry);
      if (!resolvedEntry.startsWith(resolvedDir + sep) && resolvedEntry !== resolvedDir) {
        registerFailedPlugin(failedDescriptor(manifest), `entry escapes plugin directory: ${manifest.entry}`);
        throw new Error(`${dir.name}: entry escapes plugin directory: ${manifest.entry}`);
      }

      const entryUrl = pathToFileURL(resolvedEntry).href;

      let mod: unknown;
      try {
        mod = await importer(entryUrl);
      } catch (err: unknown) {
        const msg = extractReason(err);
        registerFailedPlugin(failedDescriptor(manifest), msg);
        throw new Error(`${dir.name}: import failed — ${msg}`, { cause: err });
      }

      const ns = mod as Record<string, unknown>;
      // ESM CJS interop: namespace has .default = module.exports, plus .module.exports = module.exports
      const moduleObj = (ns.default ?? ns["module.exports"] ?? ns) as Record<string, unknown>;
      if (!Array.isArray(moduleObj.checks)) {
        registerFailedPlugin(
          failedDescriptor(manifest),
          "module does not export checks array",
        );
        throw new Error(
          `${dir.name}: module does not export checks array`,
        );
      }

      let parsedChecks: (PluginCheckV2 | PluginCheckV3)[];
      try {
        parsedChecks = validateChecks(
          moduleObj.checks,
          manifest.checkPrefix,
          manifest.apiVersion,
          manifest.name,
        );
      } catch (err: unknown) {
        const msg = extractReason(err);
        registerFailedPlugin(failedDescriptor(manifest), msg);
        throw new Error(`${dir.name}: check validation failed — ${msg}`, { cause: err });
      }

      const checks: LoadedPluginCheck[] = validateAndNormalizeChecks(
        parsedChecks,
        manifest.apiVersion,
      );

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

      // Resolve and validate any Active Probe modules declared by the plugin's
      // checks. The loader discovers the realpath-resolved handler file,
      // rejects traversal/escape, computes a SHA-256, and type-checks the
      // lifecycle exports. The map is consumed by registerPlugin to build
      // the activeProbesByCheckId runtime index.
      const activeProbeModulesByCheckId = new Map<
        string,
        Awaited<ReturnType<typeof loadActiveProbeModule>>
      >();
      for (const check of checks) {
        if (!check.activeProbe) continue;
        try {
          const validated = await loadActiveProbeModule(
            resolvedDir,
            check.activeProbe.handler,
          );
          activeProbeModulesByCheckId.set(check.id, validated);
        } catch (err: unknown) {
          const msg = extractReason(err);
          registerFailedPlugin(failedDescriptor(manifest), msg);
          throw new Error(
            `${dir.name}: active probe validation failed — ${msg}`,
            { cause: err },
          );
        }
      }

      registerPlugin(enrichedManifest, checks, activeProbeModulesByCheckId);
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
  savePluginCache(manifests.map(toPluginCacheEntry));

  return { loaded, errors };
}
