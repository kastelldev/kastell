import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";
import { KASTELL_DIR } from "../utils/paths.js";
import { validateManifest } from "./validate.js";
import {
  registerPlugin,
  registerFailedPlugin,
  clearPluginRegistry,
  getPluginRegistry,
  savePluginCache,
} from "./registry.js";
import type { PluginCheck } from "./sdk/types.js";

const PLUGINS_DIR = join(KASTELL_DIR, "plugins", "node_modules");

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

  if (!existsSync(PLUGINS_DIR)) {
    return { loaded, errors };
  }

  const entries = readdirSync(PLUGINS_DIR, { withFileTypes: true });
  const pluginDirs = entries.filter(
    (e) => e.isDirectory() && e.name.startsWith("kastell-plugin-"),
  );

  if (pluginDirs.length === 0) {
    return { loaded, errors };
  }

  const results = await Promise.allSettled(
    pluginDirs.map(async (dir) => {
      const pluginDir = join(PLUGINS_DIR, dir.name);
      const manifestPath = join(pluginDir, "kastell-plugin.json");

      let manifestRaw: string;
      try {
        manifestRaw = readFileSync(manifestPath, "utf-8");
      } catch {
        throw new Error(`${dir.name}: cannot read kastell-plugin.json`);
      }

      let manifestParsed: unknown;
      try {
        manifestParsed = JSON.parse(manifestRaw);
      } catch {
        throw new Error(`${dir.name}: invalid JSON in kastell-plugin.json`);
      }

      const manifest = validateManifest(manifestParsed);

      const entryPath = join(pluginDir, manifest.entry);
      const entryUrl = pathToFileURL(entryPath).href;

      let mod: unknown;
      try {
        mod = await importer(entryUrl);
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : String(err);
        registerFailedPlugin(manifest, msg);
        throw new Error(`${dir.name}: import failed — ${msg}`, { cause: err });
      }

      const moduleObj = mod as Record<string, unknown>;
      if (!Array.isArray(moduleObj.checks)) {
        registerFailedPlugin(
          manifest,
          "module does not export checks array",
        );
        throw new Error(
          `${dir.name}: module does not export checks array`,
        );
      }

      const checks = moduleObj.checks as PluginCheck[];
      registerPlugin(manifest, checks);
      return manifest.name;
    }),
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      loaded.push(result.value);
    } else {
      const reason =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      errors.push(reason);
    }
  }

  const manifests = Array.from(getPluginRegistry().values())
    .filter((e) => e.status === "loaded")
    .map((e) => e.manifest);
  savePluginCache(manifests);

  return { loaded, errors };
}
