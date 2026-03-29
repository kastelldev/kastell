/**
 * Fix report generator.
 * Produces a 7-section markdown report summarizing fix run results.
 * Per D-10: Summary, Server Info, Score Change, Applied Fixes, Diff Details, Skipped Fixes, Profile.
 */

import type { DiffLine } from "../core/audit/handlers/index.js";

export interface FixReportParams {
  server: { name: string; ip: string };
  scoreBefore: number;
  scoreAfter: number | null; // null when dry-run (no re-audit)
  applied: Array<{ id: string; category: string; severity: string; diff?: DiffLine }>;
  failed: Array<{ id: string; error: string }>;
  skipped: Array<{ id: string; category: string; reason: string }>;
  profile?: string;
  dryRun: boolean;
  timestamp: string; // ISO string
}

/** Returns the fix report filename: kastell-fix-report-{serverName}-{date}.md */
export function fixReportFilename(serverName: string, date: string): string {
  return `kastell-fix-report-${serverName}-${date}.md`;
}

/** Generates a markdown fix report string with 7 sections. */
export function generateFixReport(params: FixReportParams): string {
  const {
    server,
    scoreBefore,
    scoreAfter,
    applied,
    failed,
    skipped,
    profile,
    dryRun,
    timestamp,
  } = params;

  const lines: string[] = [];

  // Title
  if (dryRun) {
    lines.push("# DRY RUN — Kastell Fix Report");
  } else {
    lines.push("# Kastell Fix Report");
  }
  lines.push("");

  // Section 1: Summary
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Applied: ${applied.length} fix${applied.length !== 1 ? "es" : ""}`);
  lines.push(`- Failed: ${failed.length}`);
  lines.push(`- Skipped: ${skipped.length}`);
  const scoreDelta =
    scoreAfter !== null ? ` (${scoreAfter >= scoreBefore ? "+" : ""}${scoreAfter - scoreBefore})` : "";
  lines.push(`- Score change: ${scoreBefore} → ${scoreAfter !== null ? scoreAfter : "N/A"}${scoreDelta}`);
  lines.push("");

  // Section 2: Server Info
  lines.push("## Server Info");
  lines.push("");
  lines.push(`| Field | Value |`);
  lines.push(`| ----- | ----- |`);
  lines.push(`| Name | ${server.name} |`);
  lines.push(`| IP | ${server.ip} |`);
  lines.push(`| Timestamp | ${timestamp} |`);
  lines.push("");

  // Section 3: Score Change
  lines.push("## Score Change");
  lines.push("");
  if (scoreAfter !== null) {
    lines.push(`${scoreBefore} → ${scoreAfter} (${scoreAfter >= scoreBefore ? "+" : ""}${scoreAfter - scoreBefore} points)`);
  } else {
    lines.push(`${scoreBefore} → N/A — dry run (no re-audit performed)`);
  }
  lines.push("");

  // Section 4: Applied Fixes
  lines.push("## Applied Fixes");
  lines.push("");
  if (applied.length === 0) {
    lines.push("No fixes applied.");
  } else {
    lines.push("| ID | Category | Severity | Status |");
    lines.push("| -- | -------- | -------- | ------ |");
    for (const fix of applied) {
      lines.push(`| ${fix.id} | ${fix.category} | ${fix.severity} | applied |`);
    }
  }
  lines.push("");

  // Section 5: Diff Details
  lines.push("## Diff Details");
  lines.push("");
  if (applied.length === 0) {
    lines.push("No fixes applied.");
  } else {
    for (const fix of applied) {
      lines.push(`**${fix.id}**`);
      if (fix.diff !== undefined) {
        lines.push(
          `[${fix.diff.handlerType}] ${fix.diff.key}: ${fix.diff.before} → ${fix.diff.after}`,
        );
      } else {
        lines.push("Shell command — diff not available");
      }
      lines.push("");
    }
  }

  // Section 6: Skipped Fixes
  lines.push("## Skipped Fixes");
  lines.push("");
  if (skipped.length === 0) {
    lines.push("None.");
  } else {
    lines.push("| ID | Category | Reason |");
    lines.push("| -- | -------- | ------ |");
    for (const fix of skipped) {
      lines.push(`| ${fix.id} | ${fix.category} | ${fix.reason} |`);
    }
  }
  lines.push("");

  // Section 7: Profile (only if profile provided)
  if (profile !== undefined) {
    lines.push("## Profile");
    lines.push("");
    lines.push(`Profile: **${profile}**`);
    lines.push("");
  }

  return lines.join("\n");
}
