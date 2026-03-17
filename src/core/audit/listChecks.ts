/**
 * Static check catalog enumeration for `kastell audit --list-checks`.
 * No SSH connection required — enumerates checks from CHECK_REGISTRY using "bare" platform.
 */

import chalk from "chalk";
import { CHECK_REGISTRY } from "./checks/index.js";
import { COMPLIANCE_MAP } from "./compliance/mapper.js";
import type { Severity, ComplianceRef } from "./types.js";

export interface CheckCatalogEntry {
  id: string;
  category: string;
  name: string;
  severity: Severity;
  explain: string;
  complianceRefs: ComplianceRef[];
}

export interface ListChecksFilter {
  category?: string;
  severity?: Severity;
}

/**
 * Enumerate all checks from CHECK_REGISTRY using "bare" platform mode.
 * Optionally filter by category (case-insensitive) and/or severity.
 */
/** Synthetic input for Cloud Metadata parser so it returns all checks in catalog mode.
 *  Uses newline-separated sentinels matching actual SSH batch output format. */
const CLOUDMETA_CATALOG_INPUT = [
  "IS_VPS",
  "METADATA_BLOCKED",
  "CLOUDINIT_CLEAN",
  "CLOUDINIT_NO_SENSITIVE_ENV",
  "IMDSV2_AVAILABLE",
  "METADATA_FIREWALL_OK",
].join("\n");

export function listAllChecks(filter?: ListChecksFilter): CheckCatalogEntry[] {
  const entries: CheckCatalogEntry[] = CHECK_REGISTRY.flatMap((entry) => {
    // Cloud Metadata returns empty on bare/empty input — use synthetic VPS input for catalog
    const input = entry.sectionName === "CLOUDMETA" ? CLOUDMETA_CATALOG_INPUT : "";
    const checks = entry.parser(input, "bare");
    return checks.map((c) => ({
      id: c.id,
      category: entry.name,
      name: c.name,
      severity: c.severity,
      explain: c.explain ?? "",
      complianceRefs: COMPLIANCE_MAP[c.id] ?? [],
    }));
  });

  let result = entries;

  if (filter?.category !== undefined) {
    const cats = filter.category.split(",").map((c) => c.trim().toLowerCase());
    result = result.filter((e) => cats.includes(e.category.toLowerCase()));
  }

  if (filter?.severity !== undefined) {
    result = result.filter((e) => e.severity === filter.severity);
  }

  return result;
}

/** Severity badge for terminal display */
function severityBadge(severity: Severity): string {
  switch (severity) {
    case "critical":
      return chalk.red("CRT");
    case "warning":
      return chalk.yellow("WRN");
    case "info":
      return chalk.blue("INF");
  }
}

/** Compact compliance abbreviation: "CIS 5.2.1, PCI 6.2.4" — max 3 refs */
function complianceAbbrev(refs: ComplianceRef[]): string {
  if (refs.length === 0) return "";
  const shown = refs.slice(0, 3).map((r) => `${r.framework} ${r.controlId}`);
  return `[${shown.join(", ")}]`;
}

/**
 * Format check catalog as terminal output grouped by category.
 * Each category has a header showing check count.
 */
export function formatListChecksTerminal(checks: CheckCatalogEntry[]): string {
  const byCategory = new Map<string, CheckCatalogEntry[]>();
  for (const check of checks) {
    const list = byCategory.get(check.category) ?? [];
    list.push(check);
    byCategory.set(check.category, list);
  }

  const lines: string[] = [];

  for (const [category, categoryChecks] of byCategory) {
    lines.push(`\n${chalk.bold.cyan(category)} (${categoryChecks.length} checks)`);
    for (const check of categoryChecks) {
      const id = check.id.padEnd(35);
      const badge = severityBadge(check.severity);
      const explain = check.explain.slice(0, 50).padEnd(52);
      const compliance = complianceAbbrev(check.complianceRefs);
      lines.push(`  ${id} ${badge} ${explain} ${compliance}`);
    }
  }

  const categoryCount = byCategory.size;
  lines.push(`\nTotal: ${checks.length} checks across ${categoryCount} categories`);

  return lines.join("\n");
}

/**
 * Format check catalog as JSON array.
 */
export function formatListChecksJson(checks: CheckCatalogEntry[]): string {
  return JSON.stringify(checks, null, 2);
}
