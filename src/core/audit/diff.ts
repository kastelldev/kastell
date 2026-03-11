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
