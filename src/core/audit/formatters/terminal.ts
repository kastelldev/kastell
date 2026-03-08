/**
 * Terminal formatter for audit results.
 * Default output format with colored category scores, emoji severity, and quick wins.
 */

import chalk from "chalk";
import type { AuditResult, AuditCheck, Severity } from "../types.js";

/** Severity emoji indicators */
const SEVERITY_EMOJI: Record<Severity, string> = {
  critical: "\u{1F534}",  // Red circle
  warning: "\u{1F7E1}",   // Yellow circle
  info: "\u{1F535}",      // Blue circle
};

/** Status indicators */
const PASS_ICON = "\u2705";  // Green check
const FAIL_ICON = "\u274C";  // Red X

/** Score color based on value */
function scoreColor(score: number): (text: string) => string {
  if (score >= 80) return chalk.green;
  if (score >= 60) return chalk.yellow;
  return chalk.red;
}

/** Build a simple progress bar */
function progressBar(score: number, width: number = 10): string {
  const filled = Math.round((score / 100) * width);
  const empty = width - filled;
  return "\u2588".repeat(filled) + "\u2591".repeat(empty);
}

/**
 * Format audit result for terminal display.
 * Shows: header -> category table -> failed checks -> quick wins
 */
export function formatTerminal(result: AuditResult): string {
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

  // Category table
  lines.push(chalk.bold("Categories"));
  lines.push(chalk.gray("\u2500".repeat(50)));

  for (const category of result.categories) {
    const catColor = scoreColor(category.score);
    const failedCount = category.checks.filter((c) => !c.passed).length;
    const statusIcon = failedCount === 0 ? PASS_ICON : FAIL_ICON;

    lines.push(
      `${statusIcon} ${category.name.padEnd(14)} ${catColor(progressBar(category.score))} ${catColor(`${category.score}/${category.maxScore}`)}${failedCount > 0 ? chalk.red(` (${failedCount} failed)`) : ""}`,
    );
  }

  // Failed checks detail
  const failedChecks: AuditCheck[] = [];
  for (const category of result.categories) {
    for (const check of category.checks) {
      if (!check.passed) {
        failedChecks.push(check);
      }
    }
  }

  if (failedChecks.length > 0) {
    lines.push("");
    lines.push(chalk.bold("Failed Checks"));
    lines.push(chalk.gray("\u2500".repeat(50)));

    for (const check of failedChecks) {
      const emoji = SEVERITY_EMOJI[check.severity];
      lines.push(
        `${emoji} ${chalk.bold(check.id)} ${check.name} [${check.severity}]`,
      );
      lines.push(
        chalk.gray(`   Current: ${check.currentValue} | Expected: ${check.expectedValue}`),
      );
      if (check.fixCommand) {
        lines.push(chalk.gray(`   Fix: ${check.fixCommand}`));
      }
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
