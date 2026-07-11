import { debugLog } from "../../utils/logger.js";
import { PLUGIN_STATUS_LOADED } from "../../plugin/registry.js";
import { getShortName } from "../../plugin/registry.js";
import type { PluginRegistryEntry } from "../../plugin/registry.js";
import type { LoadedPluginCheck } from "../../plugin/sdk/types.js";
import type { AuditCategory, AuditCheck, Severity, FixTier, PluginCheckSkipReason, ComplianceRef } from "./types.js";

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

export function getPluginBatchSkipReason(check: LoadedPluginCheck): PluginCheckSkipReason | undefined {
  if (check.sourceApiVersion === "2" && check.checkCommand && check.checkCommand.kind !== "read") {
    return {
      code: "legacy-mutating",
      apiVersion: "2",
      kind: check.checkCommand.kind,
    };
  }

  if (check.sourceApiVersion === "3" && !check.read && check.activeProbe) {
    return {
      code: "active-probe",
      apiVersion: "3",
    };
  }

  return undefined;
}

export function getPluginBatchSkipWarning(pluginName: string, check: LoadedPluginCheck): string | undefined {
  const skip = getPluginBatchSkipReason(check);
  if (!skip) return undefined;
  if (skip.code === "legacy-mutating") {
    return `Plugin ${pluginName} check ${check.id} is ${skip.kind} and is not run by kastell audit`;
  }
  return `Plugin ${pluginName} check ${check.id} is probe-only and is not run by kastell audit`;
}

/**
 * Collect human-readable warnings for v2 mutating checks (legacy), v3
 * probe-only checks. Walks the registry in iteration order so the warning
 * stream matches the audit category order (P144 T5).
 */
export function getSkippedMutatingPluginWarnings(
  registry: ReadonlyMap<string, PluginRegistryEntry>,
): string[] {
  const warnings: string[] = [];
  for (const [pluginName, entry] of registry) {
    if (entry.status !== PLUGIN_STATUS_LOADED) continue;
    for (const check of entry.checks) {
      const warning = getPluginBatchSkipWarning(pluginName, check);
      if (warning) warnings.push(warning);
    }
  }
  return warnings;
}

/**
 * Gates runAudit's plugin-batch parse: a mutating-only or probe-only
 * plugin produces no batch (buildPluginBatchSection returns null) but
 * parsePluginBatchOutput must still surface its skipped checks for
 * visibility.
 */
export function hasLoadedPluginChecks(
  registry: ReadonlyMap<string, PluginRegistryEntry>,
): boolean {
  for (const entry of registry.values()) {
    if (entry.status === PLUGIN_STATUS_LOADED && entry.checks.length > 0) return true;
  }
  return false;
}

function evaluateCheck(output: string, check: LoadedPluginCheck): boolean {
  if (check.failPattern && new RegExp(check.failPattern).test(output)) return false;
  if (check.passPattern) return new RegExp(check.passPattern).test(output);
  return true;
}

function buildAuditCheck(
  checkDef: LoadedPluginCheck,
  state: { passed: boolean; currentValue: string; skip?: PluginCheckSkipReason },
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
    ...(state.skip ? { skip: state.skip } : {}),
  };

  if (!state.passed && entry && entry.status === PLUGIN_STATUS_LOADED) {
    const fixDef = entry.fixesByCheckId.get(checkDef.id);
    if (fixDef) {
      check.safeToAutoFix = fixDef.tier as FixTier;
      check.fixCommand = `plugin:${entry.manifest.name}:${fixDef.handler}`;
    }
  }
  return check;
}

// Plugin batch sections use the same `---SECTION:<prefix>:<name>:<id>---`
// header convention as the generic audit batch parser
// (src/core/audit/checks/index.ts: SECTION_PATTERN). The regex captures
// pluginName + checkId as separate groups; split with capturing groups
// produces alternating name/checkId/content triples.
const PLUGIN_SECTION_PATTERN = /^---SECTION:PLUGIN:([^:\n]+):([^:\n]+)---$/gm;

interface ParsedSection {
  pluginName: string;
  checkId: string;
  body: string;
}

function splitSections(stdout: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  // parts: [ text-before-first-sep, NAME1, CHECKID1, content1, NAME2, CHECKID2, content2, ... ]
  const parts = stdout.split(PLUGIN_SECTION_PATTERN);
  for (let i = 1; i + 2 < parts.length; i += 3) {
    sections.push({
      pluginName: parts[i]!,
      checkId: parts[i + 1]!,
      body: parts[i + 2]!.trim(),
    });
  }
  return sections;
}

export function parsePluginBatchOutput(
  stdout: string,
  registry: ReadonlyMap<string, PluginRegistryEntry>,
): AuditCategory[] {
  const sections = stdout ? splitSections(stdout) : [];

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

  const categories: AuditCategory[] = [];
  // Single ordered registry traversal: preserve Map iteration order so
  // categories surface in registration order (P144 T5).
  for (const [pluginName, entry] of registry) {
    if (entry.status !== PLUGIN_STATUS_LOADED) continue;
    if (entry.checks.length === 0) continue;

    const checks: AuditCheck[] = [];
    for (const checkDef of entry.checks) {
      const section = sectionsByPluginCheck.get(`${pluginName}:${checkDef.id}`);
      if (section) {
        const passed = evaluateCheck(section.body, checkDef);
        checks.push(buildAuditCheck(checkDef, { passed, currentValue: section.body }, entry));
      } else {
        const skip = getPluginBatchSkipReason(checkDef);
        if (skip) {
          checks.push(
            buildAuditCheck(checkDef, { passed: false, currentValue: "", skip }, entry),
          );
        } else {
          // Missing read section — runAudit's allUndetermined heuristic flags
          // this plugin category as a batch failure.
          checks.push(
            buildAuditCheck(checkDef, { passed: false, currentValue: "Unable to determine" }),
          );
        }
      }
    }
    categories.push({
      name: `Plugin: ${getShortName(entry.manifest.name)}`,
      checks,
      score: 0,
      maxScore: 0,
    });
  }
  return categories;
}