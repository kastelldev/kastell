/**
 * Audit diff engine.
 * Pure functions for comparing two AuditResult objects and rendering the diff.
 */

import chalk from "chalk";
import type {
  AuditCheck,
  AuditResult,
  AuditDiffResult,
  CheckDiffEntry,
  CheckDiffStatus,
  SnapshotFile,
  CategoryDiffEntry,
  AuditCompareSummary,
} from "./types.js";
import { loadSnapshot, listSnapshots } from "./snapshot.js";

// ─── diffAudits ───────────────────────────────────────────────────────────────

/**
 * Compare two audit results check-by-check.
 * Each check is classified as improved, regressed, unchanged, added, or removed.
 */
export function diffAudits(
  before: AuditResult,
  after: AuditResult,
  labels?: { before?: string; after?: string },
): AuditDiffResult {
  const beforeMap = buildCheckMap(before);
  const afterMap = buildCheckMap(after);

  const allIds = new Set([...beforeMap.keys(), ...afterMap.keys()]);

  const improvements: CheckDiffEntry[] = [];
  const regressions: CheckDiffEntry[] = [];
  const unchanged: CheckDiffEntry[] = [];
  const added: CheckDiffEntry[] = [];
  const removed: CheckDiffEntry[] = [];

  for (const id of allIds) {
    const b = beforeMap.get(id) ?? null;
    const a = afterMap.get(id) ?? null;

    // Use whichever side exists for metadata (prefer after)
    const source = a ?? b!;
    const status = classifyStatus(b, a);

    const entry: CheckDiffEntry = {
      id,
      name: source.name,
      category: source.category,
      severity: source.severity,
      status,
      before: b ? b.passed : null,
      after: a ? a.passed : null,
    };

    if (status === "improved") improvements.push(entry);
    else if (status === "regressed") regressions.push(entry);
    else if (status === "unchanged") unchanged.push(entry);
    else if (status === "added") added.push(entry);
    else removed.push(entry);
  }

  return {
    beforeLabel: labels?.before ?? before.timestamp,
    afterLabel: labels?.after ?? after.timestamp,
    scoreBefore: before.overallScore,
    scoreAfter: after.overallScore,
    scoreDelta: after.overallScore - before.overallScore,
    improvements,
    regressions,
    unchanged,
    added,
    removed,
  };
}

function buildCheckMap(audit: AuditResult): Map<string, AuditCheck> {
  const map = new Map<string, AuditCheck>();
  for (const category of audit.categories) {
    for (const check of category.checks) {
      map.set(check.id, check);
    }
  }
  return map;
}

function classifyStatus(
  before: AuditCheck | null,
  after: AuditCheck | null,
): CheckDiffStatus {
  if (before === null) return "added";
  if (after === null) return "removed";
  if (!before.passed && after.passed) return "improved";
  if (before.passed && !after.passed) return "regressed";
  return "unchanged";
}

// ─── resolveSnapshotRef ───────────────────────────────────────────────────────

/**
 * Resolve a snapshot reference to a SnapshotFile.
 * Supports:
 *   - "latest"  → most recent snapshot for serverIp
 *   - filename  → direct file load
 *   - name      → scans listSnapshots for matching name field
 */
export async function resolveSnapshotRef(
  serverIp: string,
  ref: string,
): Promise<SnapshotFile | null> {
  if (ref === "latest") {
    const entries = await listSnapshots(serverIp);
    if (entries.length === 0) return null;
    const last = entries[entries.length - 1];
    return loadSnapshot(serverIp, last.filename);
  }

  // Try direct filename load first
  const byFilename = await loadSnapshot(serverIp, ref);
  if (byFilename !== null) return byFilename;

  // Fall back to name scan
  const entries = await listSnapshots(serverIp);
  const match = entries.find((e) => e.name === ref);
  if (!match) return null;

  return loadSnapshot(serverIp, match.filename);
}

// ─── formatDiffTerminal ───────────────────────────────────────────────────────

/**
 * Render an AuditDiffResult as a colour-coded terminal string.
 * Regressions appear first (most important), then improvements.
 */
export function formatDiffTerminal(diff: AuditDiffResult): string {
  const lines: string[] = [];

  const deltaStr =
    diff.scoreDelta >= 0 ? `+${diff.scoreDelta}` : String(diff.scoreDelta);

  lines.push(chalk.cyan.bold("── Kastell Audit Diff ──────────────────────────────────"));
  lines.push(`  Before : ${diff.beforeLabel}  (score: ${diff.scoreBefore})`);
  lines.push(`  After  : ${diff.afterLabel}  (score: ${diff.scoreAfter})`);
  lines.push(`  Delta  : ${diff.scoreDelta >= 0 ? chalk.green(deltaStr) : chalk.red(deltaStr)}`);
  lines.push("");

  const rCount = diff.regressions.length;
  const iCount = diff.improvements.length;
  lines.push(
    `  ${chalk.red(`${rCount} regression${rCount !== 1 ? "s" : ""}`)}` +
      `  ${chalk.green(`${iCount} improvement${iCount !== 1 ? "s" : ""}`)}` +
      `  ${diff.unchanged.length} unchanged`,
  );

  if (diff.regressions.length > 0) {
    lines.push("");
    lines.push(chalk.red.bold("Regressions:"));
    for (const entry of diff.regressions) {
      lines.push(chalk.red(`  ✗ [${entry.id}] ${entry.name}`));
    }
  }

  if (diff.improvements.length > 0) {
    lines.push("");
    lines.push(chalk.green.bold("Improvements:"));
    for (const entry of diff.improvements) {
      lines.push(chalk.green(`  ✓ [${entry.id}] ${entry.name}`));
    }
  }

  if (diff.added.length > 0) {
    lines.push("");
    lines.push(chalk.yellow.bold("Added checks:"));
    for (const entry of diff.added) {
      lines.push(chalk.yellow(`  + [${entry.id}] ${entry.name}`));
    }
  }

  if (diff.removed.length > 0) {
    lines.push("");
    lines.push(chalk.gray.bold("Removed checks:"));
    for (const entry of diff.removed) {
      lines.push(chalk.gray(`  - [${entry.id}] ${entry.name}`));
    }
  }

  lines.push(chalk.cyan("────────────────────────────────────────────────────────"));

  return lines.join("\n");
}

// ─── formatDiffJson ───────────────────────────────────────────────────────────

/**
 * Render an AuditDiffResult as an indented JSON string.
 * Suitable for CI pipelines and machine consumption.
 */
export function formatDiffJson(diff: AuditDiffResult): string {
  return JSON.stringify(diff, null, 2);
}

// ─── buildCategorySummary ────────────────────────────────────────────────────

export function buildCategorySummary(
  before: AuditResult,
  after: AuditResult,
  labels?: { before?: string; after?: string },
): AuditCompareSummary {
  const beforeMap = new Map(before.categories.map((c) => [c.name, c]));
  const afterMap = new Map(after.categories.map((c) => [c.name, c]));
  const allNames = new Set([...beforeMap.keys(), ...afterMap.keys()]);

  const categories: CategoryDiffEntry[] = [];
  for (const name of allNames) {
    const b = beforeMap.get(name);
    const a = afterMap.get(name);
    categories.push({
      category: name,
      scoreBefore: b?.score ?? 0,
      scoreAfter: a?.score ?? 0,
      delta: (a?.score ?? 0) - (b?.score ?? 0),
      passedBefore: b ? b.checks.filter((c) => c.passed).length : 0,
      passedAfter: a ? a.checks.filter((c) => c.passed).length : 0,
      totalBefore: b?.checks.length ?? 0,
      totalAfter: a?.checks.length ?? 0,
    });
  }

  categories.sort((a, b) => a.category.localeCompare(b.category));

  const beforeLabel = labels?.before ?? before.serverName;
  const afterLabel = labels?.after ?? after.serverName;

  let weakestCategory: AuditCompareSummary["weakestCategory"] = null;
  for (const cat of categories) {
    const minScore = Math.min(cat.scoreBefore, cat.scoreAfter);
    const minLabel = cat.scoreBefore <= cat.scoreAfter ? beforeLabel : afterLabel;
    if (weakestCategory === null || minScore < weakestCategory.score) {
      weakestCategory = { label: minLabel, category: cat.category, score: minScore };
    }
  }

  return {
    beforeLabel,
    afterLabel,
    scoreBefore: before.overallScore,
    scoreAfter: after.overallScore,
    scoreDelta: after.overallScore - before.overallScore,
    categories,
    weakestCategory,
  };
}

// ─── formatCompareSummaryTerminal ────────────────────────────────────────────

export function formatCompareSummaryTerminal(summary: AuditCompareSummary): string {
  const lines: string[] = [];
  const { beforeLabel, afterLabel } = summary;

  const deltaStr = summary.scoreDelta >= 0 ? `+${summary.scoreDelta}` : String(summary.scoreDelta);
  const deltaColor = summary.scoreDelta >= 0 ? chalk.green : chalk.red;

  lines.push(chalk.cyan.bold("── Kastell Server Compare ──────────────────────────────"));
  lines.push(`  ${beforeLabel.padEnd(20)} score: ${summary.scoreBefore}`);
  lines.push(`  ${afterLabel.padEnd(20)} score: ${summary.scoreAfter}`);
  lines.push(`  ${"Delta".padEnd(20)} ${deltaColor(deltaStr)}`);
  lines.push("");

  const colW = 12;
  const header = `  ${"Category".padEnd(22)} ${beforeLabel.padEnd(colW)} ${afterLabel.padEnd(colW)} Delta`;
  lines.push(chalk.dim(header));
  lines.push(chalk.dim("  " + "─".repeat(header.length - 2)));

  for (const cat of summary.categories) {
    const dStr = cat.delta === 0 ? "=" : cat.delta > 0 ? chalk.green(`+${cat.delta}`) : chalk.red(String(cat.delta));
    const bScore = cat.totalBefore === 0 ? "--" : String(cat.scoreBefore);
    const aScore = cat.totalAfter === 0 ? "--" : String(cat.scoreAfter);
    lines.push(`  ${cat.category.padEnd(22)} ${bScore.padEnd(colW)} ${aScore.padEnd(colW)} ${dStr}`);
  }

  lines.push(chalk.dim("  " + "─".repeat(header.length - 2)));
  lines.push(
    `  ${"Overall".padEnd(22)} ${String(summary.scoreBefore).padEnd(colW)} ${String(summary.scoreAfter).padEnd(colW)} ${deltaColor(deltaStr)}`,
  );

  if (summary.weakestCategory) {
    lines.push("");
    lines.push(
      chalk.yellow(`  Weakest: ${summary.weakestCategory.category} on ${summary.weakestCategory.label} (${summary.weakestCategory.score})`),
    );
  }

  lines.push(chalk.cyan("────────────────────────────────────────────────────────"));
  return lines.join("\n");
}

// ─── formatCompareSummaryJson ────────────────────────────────────────────────

export function formatCompareSummaryJson(summary: AuditCompareSummary): string {
  return JSON.stringify(summary, null, 2);
}
