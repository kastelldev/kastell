import type {
  PluginCheckV2,
  PluginCheckV3,
  LoadedPluginCheck,
} from "./sdk/types.js";
import type { PluginApiVersion } from "./sdk/constants.js";

/**
 * Convert a per-version PluginCheckV2[] or PluginCheckV3[] (already validated
 * via validateChecks) into the unified LoadedPluginCheck[] runtime shape.
 *
 * This is the canonical entry point for plugin check loading after the
 * manifest and prefix have been validated.
 */
export function validateAndNormalizeChecks(
  checks: unknown,
  apiVersion: PluginApiVersion = "2",
): LoadedPluginCheck[] {
  if (apiVersion === "2") {
    return (checks as PluginCheckV2[]).map(normalizeV2Check);
  }
  return (checks as PluginCheckV3[]).map(normalizeV3Check);
}

function normalizeV2Check(check: PluginCheckV2): LoadedPluginCheck {
  return {
    id: check.id,
    name: check.name,
    category: check.category,
    severity: check.severity,
    description: check.description ?? "",
    sourceApiVersion: "2",
    read: {
      cmd: check.checkCommand.cmd,
      ...(check.passPattern !== undefined ? { passPattern: check.passPattern } : {}),
      ...(check.failPattern !== undefined ? { failPattern: check.failPattern } : {}),
    },
    ...(check.explain !== undefined ? { explain: check.explain } : {}),
    ...(check.complianceRefs !== undefined ? { complianceRefs: check.complianceRefs } : {}),
  };
}

function normalizeV3Check(check: PluginCheckV3): LoadedPluginCheck {
  return {
    id: check.id,
    name: check.name,
    category: check.category,
    severity: check.severity,
    description: check.description,
    sourceApiVersion: "3",
    ...(check.read !== undefined ? { read: check.read } : {}),
    ...(check.activeProbe !== undefined ? { activeProbe: check.activeProbe } : {}),
    ...(check.explain !== undefined ? { explain: check.explain } : {}),
    ...(check.complianceRefs !== undefined ? { complianceRefs: check.complianceRefs } : {}),
  };
}