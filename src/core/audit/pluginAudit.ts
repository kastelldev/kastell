import { debugLog } from "../../utils/logger.js";
import { getShortName } from "../../plugin/registry.js";
import type { PluginRegistryEntry } from "../../plugin/registry.js";
import type { PluginCheck } from "../../plugin/sdk/types.js";
import type { AuditCategory, AuditCheck, Severity, FixTier, ComplianceRef } from "./types.js";

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
  const byPlugin = new Map<string, AuditCheck[]>();

  for (const section of sections) {
    const entry = registry.get(section.pluginName);
    if (!entry || entry.status !== "loaded") {
      debugLog?.(`Plugin batch: unknown plugin "${section.pluginName}", section ignored`);
      continue;
    }
    const checkDef = entry.checksById.get(section.checkId);
    if (!checkDef) {
      debugLog?.(`Plugin batch: unknown check id "${section.checkId}" for plugin "${section.pluginName}"`);
      continue;
    }

    const passed = evaluateCheck(section.body, checkDef);
    const auditCheck = buildAuditCheck(checkDef, { passed, currentValue: section.body }, entry);

    let pluginChecks = byPlugin.get(section.pluginName);
    if (!pluginChecks) {
      pluginChecks = [];
      byPlugin.set(section.pluginName, pluginChecks);
    }
    pluginChecks.push(auditCheck);
  }

  // "Unable to determine" fills every loaded plugin's missing check so runAudit's
  // allUndetermined heuristic can flag plugin categories on batch failure.
  for (const [pluginName, entry] of registry) {
    if (entry.status !== "loaded") continue;
    if (entry.checks.length === 0) continue;
    const existing = byPlugin.get(pluginName) ?? [];
    const haveIds = new Set(existing.map((c) => c.id));
    for (const checkDef of entry.checks) {
      if (!haveIds.has(checkDef.id)) {
        existing.push(buildAuditCheck(checkDef, { passed: false, currentValue: "Unable to determine" }));
      }
    }
    byPlugin.set(pluginName, existing);
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
