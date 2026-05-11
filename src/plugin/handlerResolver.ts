import { resolve } from "path";
import { pathToFileURL } from "url";
import type { PluginModuleExport } from "./sdk/types.js";

export async function resolvePluginHandler(
  pluginDir: string,
  handlerPath: string,
): Promise<(...args: unknown[]) => unknown> {
  const absPath = resolve(pluginDir, handlerPath);
  const url = pathToFileURL(absPath).href;
  const mod = (await import(url)) as PluginModuleExport;
  const handler =
    (typeof mod.default === "function" ? mod.default : mod.default?.handler) ??
    mod.handler ??
    mod.fix ??
    mod.run;
  if (typeof handler !== "function") {
    throw new Error(`Plugin handler not found: ${handlerPath}`);
  }
  return handler as (...args: unknown[]) => unknown;
}
