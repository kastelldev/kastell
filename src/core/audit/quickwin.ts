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

/** Compliance-blocking checks get 1.5x sort boost (calibration starting point, tune 1.3x-2.0x) */
const COMPLIANCE_BOOST = 1.5;

/**
 * Calculate the unboosted score impact of fixing a single check.
 * Impact = how much the overall score would increase if this check passed.
 */
function calculateBaseImpact(
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
 * Calculate the effective (boosted) score impact for sorting purposes.
 * Compliance-ref checks get a 1.5x boost so they sort higher.
 */
function calculateCheckImpact(
  check: AuditCheck,
  result: AuditResult,
): number {
  const baseImpact = calculateBaseImpact(check, result);
  const hasComplianceRef = (check.complianceRefs?.length ?? 0) > 0;
  return hasComplianceRef ? baseImpact * COMPLIANCE_BOOST : baseImpact;
}

/**
 * Calculate top quick wins from audit results.
 *
 * For each failed check with a fixCommand, calculates the potential score impact.
 * Compliance-ref checks are sorted higher via COMPLIANCE_BOOST.
 * Projected scores use baseImpact (not boosted) to avoid inflated projections.
 * Returns top N wins sorted by effectiveImpact (highest first), with projected scores.
 *
 * @param result - The audit result to analyze
 * @param maxWins - Maximum number of quick wins to return (default 7)
 */
export function calculateQuickWins(
  result: AuditResult,
  maxWins: number = 7,
): QuickWin[] {
  // Collect all fixable failed checks with their impact
  const candidates: Array<{
    check: AuditCheck;
    effectiveImpact: number;
    baseImpact: number;
  }> = [];

  for (const category of result.categories) {
    for (const check of category.checks) {
      if (!check.passed && check.fixCommand) {
        const baseImpact = calculateBaseImpact(check, result);
        const effectiveImpact = calculateCheckImpact(check, result);
        candidates.push({ check, effectiveImpact, baseImpact });
      }
    }
  }

  // Sort by effectiveImpact descending (compliance-ref checks sort higher)
  candidates.sort((a, b) => b.effectiveImpact - a.effectiveImpact);

  // Take top N
  const topCandidates = candidates.slice(0, maxWins);

  // Build QuickWin objects with cumulative projected scores (using baseImpact to avoid inflation)
  let cumulativeImpact = 0;
  return topCandidates.map((candidate) => {
    cumulativeImpact += candidate.baseImpact;
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
