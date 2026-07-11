import type { PluginRegistryEntry } from "../../src/plugin/registry.js";
import type { LoadedPluginCheck, PluginFix, PluginManifest } from "../../src/plugin/sdk/types.js";

export function makeLoadedPluginCheck(
  id = "PLUG-001",
  overrides: Partial<LoadedPluginCheck> = {},
): LoadedPluginCheck {
  return {
    id,
    category: "Plugin",
    name: id,
    severity: "warning",
    description: "",
    sourceApiVersion: "2",
    checkCommand: { kind: "read", cmd: "echo ok" },
    ...overrides,
  };
}

export function makePluginRegistryEntry(
  name = "kastell-plugin-test",
  checks: LoadedPluginCheck[] = [makeLoadedPluginCheck()],
  options: { fixes?: PluginFix[]; apiVersion?: PluginManifest["apiVersion"]; checkPrefix?: string } = {},
): PluginRegistryEntry {
  const fixes = options.fixes ?? [];
  const manifest: PluginManifest = {
    name,
    version: "1.0.0",
    apiVersion: options.apiVersion ?? "2",
    kastell: "*",
    capabilities: fixes.length > 0 ? ["audit", "fix"] : ["audit"],
    checkPrefix: options.checkPrefix ?? "PLUG",
    entry: "./index.js",
    ...(fixes.length > 0 ? { fixes } : {}),
  };
  return {
    manifest,
    checks,
    readChecks: checks.filter((check): check is LoadedPluginCheck & { read: NonNullable<LoadedPluginCheck["read"]> } => check.read !== undefined),
    status: "loaded",
    checksById: new Map(checks.map((check) => [check.id, check])),
    fixesByCheckId: new Map(fixes.map((fix) => [fix.checkId, fix])),
    activeProbesByCheckId: new Map<string, never>(),
  };
}
