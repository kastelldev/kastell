import { debugLog } from "../../utils/logger.js";
import { PLUGIN_STATUS_LOADED } from "../../plugin/registry.js";
import { getShortName } from "../../plugin/registry.js";
import type { PluginRegistryEntry } from "../../plugin/registry.js";
import type { PluginCheck } from "../../plugin/sdk/types.js";
import type { AuditCategory, AuditCheck, Severity, FixTier, ComplianceRef } from "./types.js";

// Single source of truth for the "skipped mutating" sentinel. The producer
// (`mutatingPluginAuditCurrentValue`) and the consumer
// (`isMutatingPluginAuditCurrentValue`) must agree on the exact prefix+
// suffix — drift here would silently break the connectionError heuristic.
const MUTATING_SKIP_PREFIX = "Not run by kastell audit (mutating kind: ";
const MUTATING_SKIP_SUFFIX = ")";

export function mapPluginComplianceRefs(refs?: Array<{ framework: string; ref: string }>): ComplianceRef[] {
  if (!refs || refs.length === 0) return [];
  return refs.map((r) => ({
    framework: r.framework,
    controlId: r.ref,
    version: "1.0",
    description: r.ref,
    coverage: "partial" as const,
  }));
}

export function mutatingPluginAuditCurrentValue(kind: PluginCheck["checkCommand"]["kind"]): string {
  return `${MUTATING_SKIP_PREFIX}${kind}${MUTATING_SKIP_SUFFIX}`;
}

export function isMutatingPluginAuditCurrentValue(value: string): boolean {
  return value.startsWith(MUTATING_SKIP_PREFIX) && value.endsWith(MUTATING_SKIP_SUFFIX);
}

export function getSkippedMutatingPluginWarnings(
  registry: ReadonlyMap<string, PluginRegistryEntry>,
): string[] {
  const warnings: string[] = [];
  for (const [pluginName, entry] of registry) {
    if (entry.status !== PLUGIN_STATUS_LOADED) continue;
    for (const check of entry.checks) {
      if (check.checkCommand.kind !== "read") {
        warnings.push(`Plugin ${pluginName} check ${check.id} is ${check.checkCommand.kind} and is not run by kastell audit`);
      }
    }
  }
  return warnings;
}

/**
 * Does the registry have at least one loaded entry with non-empty checks?
 * Gates the plugin batch parse — without this, a mutating-only plugin would
 * produce no batch (buildPluginBatchSection returns null), but parsePluginBatchOutput
 * should still surface the skipped checks for visibility.
 */
export function hasLoadedPluginChecks(
  registry: ReadonlyMap<string, PluginRegistryEntry>,
): boolean {
  for (const entry of registry.values()) {
    if (entry.status === PLUGIN_STATUS_LOADED && entry.checks.length > 0) return true;
  }
  return false;
}

function evaluateCheck(output: string, check: PluginCheck): boolean {
  if (check.failPattern && new RegExp(check.failPattern).test(output)) return false;
  if (check.passPattern) return new RegExp(check.passPattern).test(output);
  return true;
}

function buildAuditCheck(
  checkDef: PluginCheck,
  state: { passed: boolean; currentValue: string },
  entry?: PluginRegistryEntry,
): AuditCheck {
  const check: AuditCheck = {
    id: checkDef.id,
    category: checkDef.category,
    name: checkDef.name,
    severity: checkDef.severity as Severity,
    passed: state.passed,
    currentValue: state.currentValue,
    expectedValue: checkDef.passPattern ?? "pass",
    fixCommand: checkDef.fixCommand,
    safeToAutoFix: checkDef.safeToAutoFix as FixTier | undefined,
    explain: checkDef.explain as AuditCheck["explain"],
    complianceRefs: mapPluginComplianceRefs(checkDef.complianceRefs),
  };

  if (!state.passed && entry) {
    const fixDef = entry.fixesByCheckId.get(checkDef.id);
    if (fixDef) {
      check.safeToAutoFix = fixDef.tier as FixTier;
      check.fixCommand = `plugin:${entry.manifest.name}:${fixDef.handler}`;
    }
  }
  return check;
}

const SECTION_PREFIX = "---SECTION:PLUGIN:";

interface ParsedSection {
  pluginName: string;
  checkId: string;
  body: string;
}

function splitSections(stdout: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  const lines = stdout.split("\n");
  let current: { pluginName: string; checkId: string; bodyLines: string[] } | null = null;

  const flush = (): void => {
    if (current) {
      sections.push({
        pluginName: current.pluginName,
        checkId: current.checkId,
        body: current.bodyLines.join("\n").trim(),
      });
    }
  };

  for (const line of lines) {
    if (line.startsWith(SECTION_PREFIX) && line.endsWith("---")) {
      const header = line.slice(SECTION_PREFIX.length, line.length - 3);
      const colonIdx = header.lastIndexOf(":");
      if (colonIdx === -1) {
        flush();
        current = null;
        continue;
      }
      flush();
      current = {
        pluginName: header.slice(0, colonIdx),
        checkId: header.slice(colonIdx + 1),
        bodyLines: [],
      };
    } else if (current) {
      current.bodyLines.push(line);
    }
  }
  flush();
  return sections;
}

export function parsePluginBatchOutput(
  stdout: string,
  registry: ReadonlyMap<string, PluginRegistryEntry>,
): AuditCategory[] {
  const sections = stdout ? splitSections(stdout) : [];

  // Index known sections by key, drop unknowns (legacy v1 behavior).
  const sectionsByPluginCheck = new Map<string, ParsedSection>();
  for (const section of sections) {
    const entry = registry.get(section.pluginName);
    if (!entry || entry.status !== PLUGIN_STATUS_LOADED) {
      debugLog?.(`Plugin batch: unknown plugin "${section.pluginName}", section ignored`);
      continue;
    }
    const checkDef = entry.checksById.get(section.checkId);
    if (!checkDef) {
      debugLog?.(`Plugin batch: unknown check id "${section.checkId}" for plugin "${section.pluginName}"`);
      continue;
    }
    sectionsByPluginCheck.set(`${section.pluginName}:${section.checkId}`, section);
  }

  // Registry is the source of truth — missing sections get the "Unable to
  // determine" fallback, mutating checks get the skip sentinel.
  const byPlugin = new Map<string, AuditCheck[]>();
  for (const [pluginName, entry] of registry) {
    if (entry.status !== PLUGIN_STATUS_LOADED) continue;
    if (entry.checks.length === 0) continue;

    const checks: AuditCheck[] = [];
    for (const checkDef of entry.checks) {
      const section = sectionsByPluginCheck.get(`${pluginName}:${checkDef.id}`);
      if (section) {
        const passed = evaluateCheck(section.body, checkDef);
        checks.push(buildAuditCheck(checkDef, { passed, currentValue: section.body }, entry));
      } else if (checkDef.checkCommand.kind !== "read") {
        checks.push(
          buildAuditCheck(checkDef, {
            passed: false,
            currentValue: mutatingPluginAuditCurrentValue(checkDef.checkCommand.kind),
          }),
        );
      } else {
        // Missing section for a read check — runAudit's allUndetermined
        // heuristic will flag this plugin category as a batch failure.
        checks.push(
          buildAuditCheck(checkDef, { passed: false, currentValue: "Unable to determine" }),
        );
      }
    }
    byPlugin.set(pluginName, checks);
  }

  const categories: AuditCategory[] = [];
  for (const [pluginName, checks] of byPlugin) {
    if (checks.length === 0) continue;
    const entry = registry.get(pluginName)!;
    categories.push({
      name: `Plugin: ${getShortName(entry.manifest.name)}`,
      checks,
      score: 0,
      maxScore: 0,
    });
  }
  return categories;
}
