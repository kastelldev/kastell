import { debugLog } from "../../utils/logger.js";
import { getShortName } from "../../plugin/registry.js";
import type { PluginRegistryEntry } from "../../plugin/registry.js";
import type { PluginCheck, PluginFix } from "../../plugin/sdk/types.js";
import type { AuditCategory, AuditCheck, Severity, FixTier, ComplianceRef } from "./types.js";

function injectFixMetadata(check: AuditCheck, fixMap: Map<string, PluginFix>, pluginName: string): void {
  const fixDef = fixMap.get(check.id);
  if (fixDef) {
    check.safeToAutoFix = fixDef.tier as FixTier;
    check.fixCommand = `plugin:${pluginName}:${fixDef.handler}`;
  }
}

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

  for (const line of lines) {
    if (line.startsWith(SECTION_PREFIX) && line.endsWith("---")) {
      if (current) {
        sections.push({ pluginName: current.pluginName, checkId: current.checkId, body: current.bodyLines.join("\n").trim() });
      }
      // Header: ---SECTION:PLUGIN:<pluginName>:<checkId>---
      const header = line.slice(SECTION_PREFIX.length, line.length - 3);
      const colonIdx = header.lastIndexOf(":");
      if (colonIdx === -1) {
        if (current) {
          sections.push({ pluginName: current.pluginName, checkId: current.checkId, body: current.bodyLines.join("\n").trim() });
        }
        current = null;
        continue;
      }
      current = {
        pluginName: header.slice(0, colonIdx),
        checkId: header.slice(colonIdx + 1),
        bodyLines: [],
      };
    } else if (current) {
      current.bodyLines.push(line);
    }
  }
  if (current) {
    sections.push({ pluginName: current.pluginName, checkId: current.checkId, body: current.bodyLines.join("\n").trim() });
  }
  return sections;
}

function makeUndeterminedCheck(checkDef: PluginCheck): AuditCheck {
  return {
    id: checkDef.id,
    category: checkDef.category,
    name: checkDef.name,
    severity: checkDef.severity as Severity,
    passed: false,
    currentValue: "Unable to determine",
    expectedValue: checkDef.passPattern ?? "pass",
    fixCommand: checkDef.fixCommand,
    safeToAutoFix: checkDef.safeToAutoFix as FixTier | undefined,
    explain: checkDef.explain as AuditCheck["explain"],
    complianceRefs: mapPluginComplianceRefs(checkDef.complianceRefs),
  };
}

export function parsePluginBatchOutput(
  stdout: string,
  registry: ReadonlyMap<string, PluginRegistryEntry>,
): AuditCategory[] {
  const sections = stdout ? splitSections(stdout) : [];
  // Map: pluginName → AuditCheck[]
  const byPlugin = new Map<string, AuditCheck[]>();

  for (const section of sections) {
    const entry = registry.get(section.pluginName);
    if (!entry || entry.status !== "loaded") {
      debugLog?.(`Plugin batch: unknown plugin "${section.pluginName}", section ignored`);
      continue;
    }
    const checkDef = entry.checks.find((c) => c.id === section.checkId);
    if (!checkDef) {
      debugLog?.(`Plugin batch: unknown check id "${section.checkId}" for plugin "${section.pluginName}"`);
      continue;
    }

    const passed = evaluateCheck(section.body, checkDef);
    const auditCheck: AuditCheck = {
      id: checkDef.id,
      category: checkDef.category,
      name: checkDef.name,
      severity: checkDef.severity as Severity,
      passed,
      currentValue: section.body,
      expectedValue: checkDef.passPattern ?? "pass",
      fixCommand: checkDef.fixCommand,
      safeToAutoFix: checkDef.safeToAutoFix as FixTier | undefined,
      explain: checkDef.explain as AuditCheck["explain"],
      complianceRefs: mapPluginComplianceRefs(checkDef.complianceRefs),
    };

    if (!passed && entry.manifest.fixes) {
      const fixMap = new Map(entry.manifest.fixes.map((f) => [f.checkId, f]));
      injectFixMetadata(auditCheck, fixMap, entry.manifest.name);
    }

    let pluginChecks = byPlugin.get(section.pluginName);
    if (!pluginChecks) {
      pluginChecks = [];
      byPlugin.set(section.pluginName, pluginChecks);
    }
    pluginChecks.push(auditCheck);
  }

  // Fill in "Unable to determine" for every loaded plugin's checks that produced no section.
  // This ensures connectionError detection in runAudit (allUndetermined heuristic) flags
  // plugin categories when the plugin batch fails or returns partial output.
  for (const [pluginName, entry] of registry) {
    if (entry.status !== "loaded") continue;
    if (entry.checks.length === 0) continue;
    const existing = byPlugin.get(pluginName) ?? [];
    const haveIds = new Set(existing.map((c) => c.id));
    for (const checkDef of entry.checks) {
      if (!haveIds.has(checkDef.id)) {
        existing.push(makeUndeterminedCheck(checkDef));
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