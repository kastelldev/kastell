/**
 * Quick win calculator for audit results.
 * Identifies the highest-impact fixes to motivate "3 commands to go from 45 to 85".
 */

import type { AuditResult, AuditCheck, QuickWin } from "./types.js";
import { SEVERITY_WEIGHTS, CATEGORY_WEIGHTS, DEFAULT_CATEGORY_WEIGHT, buildImpactContext } from "./scoring.js";

/** Compliance-blocking checks get 1.5x sort boost (calibration starting point, tune 1.3x-2.0x) */
const COMPLIANCE_BOOST = 1.5;

/**
 * Calculate top quick wins from audit results.
 *
 * For each failed check with a fixCommand, calculates the potential score impact
 * using the same CATEGORY_WEIGHTS as the scoring engine for accurate projections.
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
  // Use shared impact context (matches scoring.ts logic)
  const { totalOverallWeight } = buildImpactContext(result.categories);
  if (totalOverallWeight === 0) return [];

  // Collect all fixable failed checks with their impact in a single pass
  const candidates: Array<{
    check: AuditCheck;
    effectiveImpact: number;
    baseImpact: number;
  }> = [];

  for (const category of result.categories) {
    // Pre-compute category severity weight sum once per category
    const totalCategoryWeight = category.checks.reduce(
      (sum, c) => sum + SEVERITY_WEIGHTS[c.severity],
      0,
    );
    if (totalCategoryWeight === 0) continue;

    const catWeight = CATEGORY_WEIGHTS[category.name] ?? DEFAULT_CATEGORY_WEIGHT;

    for (const check of category.checks) {
      if (!check.passed && check.fixCommand) {
        const checkWeight = SEVERITY_WEIGHTS[check.severity];
        // This check's contribution to category score (0-100 range)
        const categoryScoreGain = (checkWeight / totalCategoryWeight) * 100;
        // Category's weighted contribution to overall score
        const baseImpact = (categoryScoreGain * catWeight) / totalOverallWeight;
        const hasComplianceRef = (check.complianceRefs?.length ?? 0) > 0;
        const effectiveImpact = hasComplianceRef ? baseImpact * COMPLIANCE_BOOST : baseImpact;
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
      id: candidate.check.id,
      severity: candidate.check.severity,
      commands: [candidate.check.fixCommand!],
      currentScore: result.overallScore,
      projectedScore,
      description: `Fix ${candidate.check.name} (${candidate.check.category})`,
    };
  });
}
