import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";
import { PLUGINS_NODE_MODULES } from "../utils/paths.js";
import { validateManifest } from "./validate.js";
import {
  registerPlugin,
  registerFailedPlugin,
  clearPluginRegistry,
  getPluginRegistry,
  savePluginCache,
} from "./registry.js";
import type { PluginCheck, PluginManifest } from "./sdk/types.js";


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

      let manifestRaw: string;
      try {
        manifestRaw = readFileSync(manifestPath, "utf-8");
      } catch {
        const minimalManifest: PluginManifest = {
          name: dir.name,
          version: "0.0.0",
          apiVersion: "1",
          kastell: "*",
          capabilities: ["audit"],
          checkPrefix: "ERR",
          entry: "",
        };
        registerFailedPlugin(minimalManifest, `cannot read kastell-plugin.json`);
        throw new Error(`${dir.name}: cannot read kastell-plugin.json`);
      }

      let manifestParsed: unknown;
      try {
        manifestParsed = JSON.parse(manifestRaw);
      } catch {
        const minimalManifest: PluginManifest = {
          name: dir.name,
          version: "0.0.0",
          apiVersion: "1",
          kastell: "*",
          capabilities: ["audit"],
          checkPrefix: "ERR",
          entry: "",
        };
        registerFailedPlugin(minimalManifest, `invalid JSON in kastell-plugin.json`);
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
