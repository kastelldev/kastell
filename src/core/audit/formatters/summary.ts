/**
 * Summary formatter for audit results.
 * Compact dashboard with progress bars per category.
 */

import chalk from "chalk";
import type { AuditResult } from "../types.js";
import { calculateComplianceScores } from "../compliance/scoring.js";

/** Score color */
function scoreColor(score: number): (text: string) => string {
  if (score >= 80) return chalk.green;
  if (score >= 60) return chalk.yellow;
  return chalk.red;
}

/** Build a progress bar */
function progressBar(score: number, width: number = 10): string {
  const filled = Math.round((score / 100) * width);
  const empty = width - filled;
  return "\u2588".repeat(filled) + "\u2591".repeat(empty);
}

/**
 * Format audit result as compact dashboard summary.
 */
export function formatSummary(result: AuditResult): string {
  const lines: string[] = [];

  const colorFn = scoreColor(result.overallScore);

  lines.push(
    chalk.bold.cyan(`Kastell Security Audit`) +
      chalk.gray(` \u2014 ${result.serverName} (${result.serverIp})`),
  );
  lines.push(
    `Overall: ${colorFn(chalk.bold(`${result.overallScore}/100`))} ${progressBar(result.overallScore, 14)}`,
  );
  lines.push("");

  // Compliance summary
  const complianceScores = calculateComplianceScores(result.categories);
  if (complianceScores.length > 0) {
    const parts = complianceScores.map((cs) => {
      const catColor = scoreColor(cs.passRate);
      const label = cs.framework === "CIS" ? "CIS L1" : cs.framework;
      return `${label}: ${catColor(`${cs.passRate}%`)}`;
    });
    lines.push(`Compliance: ${parts.join(" | ")}`);

    const hasPartials = complianceScores.some((cs) => cs.partialCount > 0);
    if (hasPartials) {
      lines.push(chalk.yellow("  * partial mappings — manual review recommended"));
    }
    lines.push("");
  }

  // Category bars
  for (const category of result.categories) {
    const catColor = scoreColor(category.score);
    const name = category.name.padEnd(12);
    lines.push(
      `${name} ${catColor(progressBar(category.score))}  ${catColor(`${category.score}/${category.maxScore}`)}`,
    );
  }

  // Quick wins
  if (result.quickWins.length > 0) {
    lines.push("");
    const lastWin = result.quickWins[result.quickWins.length - 1];
    lines.push(
      chalk.green(
        `Quick wins: ${result.quickWins.length} command(s) to reach ${lastWin.projectedScore}/100`,
      ),
    );
  }

  lines.push("");
  return lines.join("\n");
}
