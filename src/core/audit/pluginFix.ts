import { sshExec } from "../../utils/ssh.js";
import { raw } from "../../utils/sshCommand.js";
import { debugLog } from "../../utils/logger.js";
import { isSafeMode } from "../../utils/safeMode.js";
import { PLUGINS_NODE_MODULES } from "../../utils/paths.js";
import type { PluginFixHandler, PluginFixContext, PluginFixResult } from "../../plugin/sdk/types.js";
import type { FixExecutionLogEntry } from "./types.js";
import { getPluginRegistry } from "../../plugin/registry.js";
import { pathToFileURL } from "url";
import { join } from "path";

const PLUGIN_FIX_PREFIX = "plugin:";

export function isPluginFixCommand(fixCommand: string | undefined): boolean {
  return typeof fixCommand === "string" && fixCommand.startsWith(PLUGIN_FIX_PREFIX);
}

export function parsePluginFixCommand(fixCommand: string): { pluginName: string; handlerPath: string } | null {
  if (!fixCommand.startsWith(PLUGIN_FIX_PREFIX)) return null;
  const parts = fixCommand.split(":");
  if (parts.length < 3) return null;
  const pluginName = parts[1];
  const handlerPath = parts.slice(2).join(":");
  if (!pluginName || !handlerPath) return null;
  return { pluginName, handlerPath };
}

export function getPluginFixMetadata(failedCheckIds: string[], appliedCheckIds: string[]): { backupPaths: string[]; pluginNames: string[] } {
  const registry = getPluginRegistry();
  const backupPaths: string[] = [];
  const pluginNames = new Set<string>();
  for (const [, entry] of registry) {
    if (entry.status !== "loaded" || !entry.manifest.fixes) continue;
    for (const fix of entry.manifest.fixes) {
      if (failedCheckIds.includes(fix.checkId) && fix.backupPaths) {
        backupPaths.push(...fix.backupPaths);
      }
      if (appliedCheckIds.includes(fix.checkId)) {
        pluginNames.add(entry.manifest.name);
      }
    }
  }
  return { backupPaths, pluginNames: [...pluginNames] };
}

export function getPluginBackupPaths(failedCheckIds: string[]): string[] {
  return getPluginFixMetadata(failedCheckIds, []).backupPaths;
}

export function getAppliedPluginNames(appliedCheckIds: string[]): string[] {
  return getPluginFixMetadata([], appliedCheckIds).pluginNames;
}

export async function executePluginFix(
  ip: string,
  checkId: string,
  pluginName: string,
  handlerPath: string,
  dryRun: boolean,
): Promise<{ success: boolean; error?: string; modifiedFiles?: string[]; executionLog?: FixExecutionLogEntry }> {
  const startMs = Date.now();

  if (isSafeMode()) {
    return { success: false, error: "SAFE_MODE active — plugin fix blocked" };
  }

  if (dryRun) {
    return { success: true };
  }

  const registry = getPluginRegistry();
  const entry = registry.get(pluginName);
  if (!entry || entry.status !== "loaded") {
    return { success: false, error: `Plugin "${pluginName}" not found or failed to load` };
  }

  const pluginDir = join(PLUGINS_NODE_MODULES, pluginName);
  const handlerAbsPath = join(pluginDir, handlerPath);
  const handlerUrl = pathToFileURL(handlerAbsPath).href;

  let handlerFn: PluginFixHandler;
  try {
    const handlerModule = await import(handlerUrl);
    handlerFn = handlerModule.default ?? handlerModule.fix ?? handlerModule.handler;
    if (typeof handlerFn !== "function") {
      return { success: false, error: `Plugin fix handler "${handlerPath}" does not export a function (default/fix/handler)` };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to import fix handler: ${msg}` };
  }

  const ctx: PluginFixContext = {
    ip,
    ssh: async (command: string, options?: { timeoutMs?: number }) => {
      return sshExec(ip, raw(command), options);
    },
    logger: {
      info: (msg: string) => { if (debugLog) console.log(`[plugin-fix:${pluginName}] ${msg}`); },
      warn: (msg: string) => { if (debugLog) console.log(`[plugin-fix:${pluginName}] WARN: ${msg}`); },
      error: (msg: string) => console.error(`[plugin-fix:${pluginName}] ERROR: ${msg}`),
    },
    dryRun,
    manifest: entry.manifest,
  };

  try {
    const result: PluginFixResult = await handlerFn(checkId, ctx);
    const durationMs = Date.now() - startMs;

    return {
      success: result.success,
      error: result.error,
      modifiedFiles: result.modifiedFiles,
      executionLog: {
        checkId,
        command: `plugin:${pluginName}:${handlerPath}`,
        stdout: result.success ? "plugin fix applied" : "",
        stderr: result.error ?? "",
        durationMs,
        success: result.success,
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - startMs;
    return {
      success: false,
      error: `Plugin fix handler threw: ${msg}`,
      executionLog: {
        checkId,
        command: `plugin:${pluginName}:${handlerPath}`,
        stdout: "",
        stderr: msg,
        durationMs,
        success: false,
      },
    };
  }
}