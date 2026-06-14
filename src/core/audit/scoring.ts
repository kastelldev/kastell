/**
 * Audit scoring engine.
 * Calculates per-category and overall scores with severity weighting.
 */

import type { AuditCheck, AuditCategory, Severity } from "./types.js";
import { isSkippedCheck } from "./types.js";

/** Severity weights: critical checks matter more than info checks */
export const SEVERITY_WEIGHTS: Record<Severity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

/**
 * Calculate score for a single category based on its checks.
 * Score = (sum of passed check weights / sum of all check weights) * 100
 *
 * Skipped checks (P142 Task 2: structured skip metadata) are excluded from
 * both numerator and denominator — they signal "audit never runs this" and
 * should not affect scoring. If every check is skipped, returns
 * { score: 0, maxScore: 0 } to signal "no scoring info available" (and
 * to align with detectSkippedCategories which inspects currentValue).
 *
 * @returns score (0-100) and maxScore (always 100 if non-skipped checks exist, 0 if all skipped or empty)
 */
export function calculateCategoryScore(
  checks: AuditCheck[],
): { score: number; maxScore: number } {
  let totalWeight = 0;
  let passedWeight = 0;

  for (const check of checks) {
    if (isSkippedCheck(check)) continue;
    const weight = SEVERITY_WEIGHTS[check.severity];
    totalWeight += weight;
    if (check.passed) {
      passedWeight += weight;
    }
  }

  if (totalWeight === 0) {
    return { score: 0, maxScore: 0 };
  }

  const score = Math.round((passedWeight / totalWeight) * 100);
  return { score, maxScore: 100 };
}

/**
 * Category weights for overall score calculation.
 * Higher weight = more impact on overall score.
 * SSH/Firewall/Auth: most security-critical (weight 3)
 * Docker/TLS: important but narrower scope (weight 2)
 * All others: default weight 1
 */
export const CATEGORY_WEIGHTS: Record<string, number> = {
  SSH: 3,
  Firewall: 3,
  Auth: 3,
  Docker: 2,
  TLS: 2,
  Secrets: 3,
  "Supply Chain": 3,
  "Cloud Metadata": 2,
  "Backup Hygiene": 2,
  "Resource Limits": 2,
  "Incident Readiness": 2,
  "DNS Security": 2,
};

export const DEFAULT_CATEGORY_WEIGHT = 1;

/**
 * Calculate overall audit score from category scores.
 * Uses weighted average — critical categories (SSH, Firewall, Auth) count more.
 */
export function calculateOverallScore(categories: AuditCategory[]): number {
  const active = categories.filter((c) => c.maxScore > 0);
  if (active.length === 0) return 0;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const cat of active) {
    const weight = CATEGORY_WEIGHTS[cat.name] ?? DEFAULT_CATEGORY_WEIGHT;
    weightedSum += cat.score * weight;
    totalWeight += weight;
  }

  return Math.round(weightedSum / totalWeight);
}

/** Pre-computed weight context for impact calculations (shared by quickwin + fix) */
export interface ImpactContext {
  totalOverallWeight: number;
  catWeightMap: Map<string, number>;
}

/** Build impact context from audit categories (compute once, reuse in quickwin + fix) */
export function buildImpactContext(categories: AuditCategory[]): ImpactContext {
  let totalOverallWeight = 0;
  const catWeightMap = new Map<string, number>();

  for (const cat of categories) {
    if (cat.maxScore > 0) {
      totalOverallWeight += CATEGORY_WEIGHTS[cat.name] ?? DEFAULT_CATEGORY_WEIGHT;
    }
    catWeightMap.set(
      cat.name,
      cat.checks.reduce(
        (sum, c) => sum + (isSkippedCheck(c) ? 0 : SEVERITY_WEIGHTS[c.severity]),
        0,
      ),
    );
  }

  return { totalOverallWeight, catWeightMap };
}
