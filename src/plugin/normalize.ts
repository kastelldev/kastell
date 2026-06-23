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

/** Spread `key: value` only when value !== undefined — avoids `key: undefined` JSON. */
function pickOptional<V extends Record<string, unknown>>(obj: V): Partial<V> {
  const out: Partial<V> = {};
  for (const key of Object.keys(obj) as (keyof V)[]) {
    const value = obj[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
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
      ...pickOptional({ passPattern: check.passPattern, failPattern: check.failPattern }),
    },
    ...pickOptional({ explain: check.explain, complianceRefs: check.complianceRefs }),
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
    ...pickOptional({
      read: check.read,
      activeProbe: check.activeProbe,
      explain: check.explain,
      complianceRefs: check.complianceRefs,
    }),
  };
}