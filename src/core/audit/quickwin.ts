/**
 * Quick win calculator for audit results.
 * Identifies the highest-impact fixes to motivate "3 commands to go from 45 to 85".
 */

import type { AuditResult, AuditCheck, QuickWin, Severity } from "./types.js";

/** Severity weights matching scoring.ts */
const SEVERITY_WEIGHTS: Record<Severity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

/**
 * Calculate the score impact of fixing a single check.
 * Impact = how much the overall score would increase if this check passed.
 */
function calculateCheckImpact(
  check: AuditCheck,
  result: AuditResult,
): number {
  const numCategories = result.categories.length || 1;

  // Find the category this check belongs to
  const category = result.categories.find((c) => c.name === check.category);
  if (!category) return 0;

  const totalCategoryWeight = category.checks.reduce(
    (sum, c) => sum + SEVERITY_WEIGHTS[c.severity],
    0,
  );
  if (totalCategoryWeight === 0) return 0;

  const checkWeight = SEVERITY_WEIGHTS[check.severity];
  // This check's contribution to category score (0-100 range)
  const categoryScoreGain = (checkWeight / totalCategoryWeight) * 100;
  // Category's contribution to overall score (equal weight per category)
  return categoryScoreGain / numCategories;
}

/**
 * Calculate top quick wins from audit results.
 *
 * For each failed check with a fixCommand, calculates the potential score impact.
 * Returns top N wins sorted by impact (highest first), with projected scores.
 *
 * @param result - The audit result to analyze
 * @param maxWins - Maximum number of quick wins to return (default 5)
 */
export function calculateQuickWins(
  result: AuditResult,
  maxWins: number = 5,
): QuickWin[] {
  // Collect all fixable failed checks with their impact
  const candidates: Array<{
    check: AuditCheck;
    impact: number;
  }> = [];

  for (const category of result.categories) {
    for (const check of category.checks) {
      if (!check.passed && check.fixCommand) {
        const impact = calculateCheckImpact(check, result);
        candidates.push({ check, impact });
      }
    }
  }

  // Sort by impact descending
  candidates.sort((a, b) => b.impact - a.impact);

  // Take top N
  const topCandidates = candidates.slice(0, maxWins);

  // Build QuickWin objects with cumulative projected scores
  let cumulativeImpact = 0;
  return topCandidates.map((candidate) => {
    cumulativeImpact += candidate.impact;
    const projectedScore = Math.min(
      100,
      Math.round(result.overallScore + cumulativeImpact),
    );

    return {
      commands: [candidate.check.fixCommand!],
      currentScore: result.overallScore,
      projectedScore,
      description: `Fix ${candidate.check.name} (${candidate.check.category})`,
    };
  });
}
