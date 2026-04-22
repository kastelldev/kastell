/**
 * Audit check deep-dive: lookup + fuzzy match + formatters.
 * No SSH connection required — purely static catalog data.
 */

import chalk from "chalk";
import { listAllChecks, CLOUDMETA_CATALOG_INPUT } from "./listChecks.js";
import { CHECK_REGISTRY } from "./checks/index.js";
import { resolveTier } from "./fix.js";
import type { ComplianceRef, Severity, FixTier } from "./types.js";

export interface ExplainResult {
  id: string;
  name: string;
  category: string;
  severity: Severity;
  explain: string;
  fixCommand?: string;
  fixTier: FixTier;
  complianceRefs: ComplianceRef[];
}

export interface FindCheckResult {
  match: ExplainResult | null;
  suggestions: string[];
}

// Module-level cache — catalog is static data, rebuilt only when explicitly cleared
let _catalogCache: ExplainResult[] | null = null;

export function clearCheckCatalogCache(): void {
  _catalogCache = null;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  // Length cap prevents DoS via pathological input (max 200 chars)
  if (m > 200 || n > 200) return Math.abs(m - n) + Math.min(m, n);
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function buildCheckCatalog(): ExplainResult[] {
  const catalogEntries = listAllChecks();
  const fullChecksById = new Map<string, ExplainResult>();

  // First pass: build full checks from CHECK_REGISTRY
  for (const entry of CHECK_REGISTRY) {
    const input = entry.sectionName === "CLOUDMETA" ? CLOUDMETA_CATALOG_INPUT : "";
    const checks = entry.parser(input, "bare");
    for (const fc of checks) {
      fullChecksById.set(fc.id, {
        id: fc.id,
        name: fc.name,
        category: entry.name,
        severity: fc.severity,
        explain: fc.explain ?? "",
        fixCommand: fc.fixCommand,
        fixTier: resolveTier(fc, entry.name),
        complianceRefs: fc.complianceRefs ?? [],
      });
    }
  }

  // Second pass: build catalog with compliance refs from listAllChecks (COMPLIANCE_MAP)
  return catalogEntries.map((ce) => {
    const full = fullChecksById.get(ce.id);
    if (full) {
      // Enrich with compliance refs from catalog (COMPLIANCE_MAP)
      return { ...full, complianceRefs: ce.complianceRefs };
    }
    return {
      id: ce.id,
      name: ce.name,
      category: ce.category,
      severity: ce.severity,
      explain: ce.explain,
      fixTier: "GUARDED" as FixTier,
      complianceRefs: ce.complianceRefs,
    };
  });
}

export function findCheckById(checkId: string): FindCheckResult {
  const catalog = getFullCheckCatalog();

  // 1. Exact match — O(n) scan on 457 items is fast enough
  const exact = catalog.find((c) => c.id === checkId);
  if (exact) return { match: exact, suggestions: [] };

  // 2. Case-insensitive match
  const upper = checkId.toUpperCase();
  const ci = catalog.find((c) => c.id.toUpperCase() === upper);
  if (ci) return { match: ci, suggestions: [] };

  // 3. Levenshtein ≤ 3
  const scored = catalog
    .map((c) => ({ id: c.id, dist: levenshtein(upper, c.id.toUpperCase()) }))
    .filter((s) => s.dist <= 3)
    .sort((a, b) => a.dist - b.dist);

  return {
    match: null,
    suggestions: scored.slice(0, 3).map((s) => s.id),
  };
}

function getFullCheckCatalog(): ExplainResult[] {
  if (_catalogCache) return _catalogCache;
  _catalogCache = buildCheckCatalog();
  return _catalogCache;
}

function severityLabel(severity: Severity): string {
  switch (severity) {
    case "critical": return chalk.red.bold("CRITICAL");
    case "warning": return chalk.yellow.bold("WARNING");
    case "info": return chalk.blue.bold("INFO");
  }
}

function tierLabel(tier: FixTier): string {
  switch (tier) {
    case "SAFE": return chalk.green("SAFE");
    case "GUARDED": return chalk.yellow("GUARDED");
    case "FORBIDDEN": return chalk.red("FORBIDDEN");
  }
}

export function formatExplainTerminal(check: ExplainResult): string {
  const lines: string[] = [];

  lines.push(chalk.bold.cyan(`${check.id}`) + chalk.dim(` — ${check.category}`));
  lines.push(`${chalk.bold("Name:")}      ${check.name}`);
  lines.push(`${chalk.bold("Severity:")}  ${severityLabel(check.severity)}`);
  lines.push(`${chalk.bold("Fix Tier:")} ${tierLabel(check.fixTier)}`);
  lines.push("");
  lines.push(chalk.bold("Why This Matters:"));
  lines.push(`  ${check.explain || chalk.dim("No explanation available.")}`);

  if (check.fixCommand) {
    lines.push("");
    lines.push(chalk.bold("Fix Command:"));
    lines.push(chalk.green(`  $ ${check.fixCommand}`));
  }

  if (check.complianceRefs.length > 0) {
    lines.push("");
    lines.push(chalk.bold("Compliance References:"));
    for (const ref of check.complianceRefs) {
      const coverage = ref.coverage === "full" ? chalk.green("full") : chalk.yellow("partial");
      lines.push(`  ${chalk.bold(ref.framework)} ${ref.controlId} — ${ref.description} (${coverage})`);
    }
  }

  return lines.join("\n");
}

export function formatExplainJson(check: ExplainResult): string {
  return JSON.stringify(check, null, 2);
}

export function formatExplainMarkdown(check: ExplainResult): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push(`id: ${check.id}`);
  lines.push(`category: ${check.category}`);
  lines.push(`severity: ${check.severity}`);
  lines.push(`fixTier: ${check.fixTier}`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${check.id}: ${check.name}`);
  lines.push("");
  lines.push(`**Category:** ${check.category} | **Severity:** ${check.severity}`);
  lines.push("");
  lines.push("## Why This Matters");
  lines.push("");
  lines.push(check.explain || "No explanation available.");

  if (check.fixCommand) {
    lines.push("");
    lines.push("## Fix");
    lines.push("");
    lines.push("```bash");
    lines.push(check.fixCommand);
    lines.push("```");
  }

  if (check.complianceRefs.length > 0) {
    lines.push("");
    lines.push("## Compliance");
    lines.push("");
    lines.push("| Framework | Control | Description | Coverage |");
    lines.push("|-----------|---------|-------------|----------|");
    for (const ref of check.complianceRefs) {
      lines.push(`| ${ref.framework} | ${ref.controlId} | ${ref.description} | ${ref.coverage} |`);
    }
  }

  return lines.join("\n");
}
