/**
 * Terminal formatter for audit results.
 * Default output format with grouped category output, VPS banner, and quick wins.
 * Failing categories are expanded with inline failed checks; passing categories are collapsed.
 */

import chalk from "chalk";
import type { AuditResult, Severity } from "../types.js";
import { describeCheckSkip, isSkippedCheck, isFailedCheck, isPassedCheck } from "../types.js";
import { calculateComplianceScores } from "../compliance/scoring.js";
import { scoreColor, progressBar } from "./shared.js";

/** Severity emoji indicators */
const SEVERITY_EMOJI: Record<Severity, string> = {
  critical: "\u{1F534}",  // Red circle
  warning: "\u{1F7E1}",   // Yellow circle
  info: "\u{1F535}",      // Blue circle
};

/** Status indicators */
const PASS_ICON = "\u2705";  // Green check
const FAIL_ICON = "\u274C";  // Red X

/**
 * Format audit result for terminal display.
 * Shows: header -> overall score -> compliance -> stats header -> VPS banner ->
 *        failing categories (expanded) -> passing categories (collapsed) -> quick wins
 */
export function formatTerminal(result: AuditResult, options?: { explain?: boolean }): string {
  const lines: string[] = [];

  // Header
  lines.push("");
  lines.push(chalk.bold.cyan("Kastell Security Audit"));
  lines.push(chalk.gray(`Server: ${result.serverName} (${result.serverIp})`));
  lines.push(chalk.gray(`Platform: ${result.platform} | ${result.timestamp}`));
  lines.push("");

  // Overall score
  const colorFn = scoreColor(result.overallScore);
  lines.push(
    `Overall Score: ${colorFn(chalk.bold(`${result.overallScore}/100`))} ${progressBar(result.overallScore)}`,
  );
  lines.push("");

  // Compliance summary (only if compliance data exists on checks)
  const complianceScores = calculateComplianceScores(result.categories);
  if (complianceScores.length > 0) {
    const parts = complianceScores.map((cs) => {
      const rateColor = scoreColor(cs.passRate);
      const label = cs.framework === "CIS" ? "CIS L1" : cs.framework;
      return `${label}: ${rateColor(`${cs.passedControls}/${cs.totalControls}`)}`;
    });
    lines.push(`Compliance: ${parts.join(" | ")}`);

    // Show "manual review recommended" if any framework has partial-coverage controls
    const hasPartials = complianceScores.some((cs) => cs.partialCount > 0);
    if (hasPartials) {
      const partialFrameworks = complianceScores
        .filter((cs) => cs.partialCount > 0)
        .map((cs) => `${cs.framework} (${cs.partialCount} partial)`);
      lines.push(chalk.yellow(`  manual review recommended: ${partialFrameworks.join(", ")}`));
    }
    lines.push("");
  }

  // Stats header: total / passed / failed / skipped counts, VPS-adjusted count when applicable
  const allChecks = result.categories.flatMap((c) => c.checks);
  const totalChecks = allChecks.length;
  const passedChecks = allChecks.filter(isPassedCheck).length;
  const failedChecks = allChecks.filter(isFailedCheck).length;
  const skippedChecks = allChecks.filter(isSkippedCheck).length;
  const adjusted = result.vpsAdjustedCount ?? 0;

  let statsLine = `Checks: ${totalChecks} total | ${passedChecks} passed | ${failedChecks} failed | ${skippedChecks} skipped`;
  if (adjusted > 0) statsLine += ` | ${adjusted} VPS-adjusted`;
  lines.push(chalk.gray(statsLine));

  // VPS banner (only when VPS detected and checks were adjusted)
  if (result.vpsType && adjusted > 0) {
    lines.push(chalk.dim(`VPS detected (${result.vpsType}) — ${adjusted} checks adjusted to info`));
  }
  lines.push("");

  // Separate categories into failing and passing (skipped-only categories are neither)
  const failingCats = result.categories.filter((c) => c.checks.some(isFailedCheck));
  const passingCats = result.categories.filter((c) => c.checks.length > 0 && c.checks.every((ch) => isPassedCheck(ch) || isSkippedCheck(ch)));

  // Severity sort order for failed checks within a category
  const severityOrder: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

  // Failing categories expanded with inline failed checks
  if (failingCats.length > 0) {
    lines.push(chalk.bold("Categories"));
    lines.push(chalk.gray("\u2500".repeat(50)));

    for (const category of failingCats) {
      const catFailed = category.checks.filter(isFailedCheck);
      const catPassed = category.checks.filter(isPassedCheck).length;
      const catTotal = category.checks.length;
      const catColor = scoreColor(category.score);

      lines.push(
        `${FAIL_ICON} ${category.name} ${catPassed}/${catTotal} (${catColor(`${category.score}%`)})`,
      );

      // Sort failed checks by severity: critical > warning > info
      const sortedFailed = [...catFailed].sort(
        (a, b) => severityOrder[a.severity] - severityOrder[b.severity],
      );

      for (const check of sortedFailed) {
        const emoji = SEVERITY_EMOJI[check.severity];
        lines.push(
          `  ${emoji} ${chalk.bold(check.id)} ${check.name} [${check.severity}]`,
        );
        if (check.fixCommand) {
          lines.push(chalk.gray(`     Fix: ${check.fixCommand}`));
        }
        if (options?.explain && check.explain) {
          lines.push(chalk.dim(`     Why: ${check.explain}`));
        }
      }
    }
  }

  // Passing categories collapsed (one line each at 100%)
  if (passingCats.length > 0) {
    lines.push("");
    for (const category of passingCats) {
      const allPassingOrSkipped = category.checks.every((ch) => isPassedCheck(ch) || isSkippedCheck(ch));
      const displayScore = allPassingOrSkipped ? 100 : category.score;
      lines.push(
        `${PASS_ICON} ${category.name} ${category.checks.length}/${category.checks.length} (${displayScore}%)`,
      );
      // Show skipped checks inline with helper-derived display
      const skippedInCat = category.checks.filter(isSkippedCheck);
      for (const chk of skippedInCat) {
        if (chk.skip) {
          lines.push(chalk.dim(`     ${describeCheckSkip(chk.skip)}`));
        }
      }
    }
  }

  // Connection error categories (SSH batch failed)
  const errorCats = result.categories.filter((c) => c.connectionError);
  if (errorCats.length > 0) {
    lines.push("");
    for (const cat of errorCats) {
      lines.push(chalk.yellow(`\u26A0 ${cat.name} — skipped (SSH batch failed)`));
    }
  }

  // Skipped categories display
  if (result.skippedCategories && result.skippedCategories.length > 0) {
    lines.push("");
    for (const name of result.skippedCategories) {
      lines.push(chalk.dim(`Skipped: ${name} (not installed)`));
    }
  }

  // Batch warnings
  if (result.warnings && result.warnings.length > 0) {
    lines.push("");
    for (const warn of result.warnings) {
      lines.push(chalk.yellow(`\u26A0 ${warn}`));
    }
  }

  // Quick wins
  if (result.quickWins.length > 0) {
    lines.push("");
    lines.push(chalk.bold("Quick Wins"));
    lines.push(chalk.gray("\u2500".repeat(50)));
    lines.push(
      chalk.green(
        `${result.quickWins.length} command(s) to improve score from ${result.overallScore} to ${result.quickWins[result.quickWins.length - 1].projectedScore}`,
      ),
    );
    for (const win of result.quickWins) {
      lines.push(`  ${win.description}`);
      for (const cmd of win.commands) {
        lines.push(chalk.gray(`    $ ${cmd}`));
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}
