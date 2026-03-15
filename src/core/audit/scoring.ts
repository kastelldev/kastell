/**
 * Audit scoring engine.
 * Calculates per-category and overall scores with severity weighting.
 */

import type { AuditCheck, AuditCategory, Severity } from "./types.js";

/** Severity weights: critical checks matter more than info checks */
const SEVERITY_WEIGHTS: Record<Severity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

/**
 * Calculate score for a single category based on its checks.
 * Score = (sum of passed check weights / sum of all check weights) * 100
 *
 * @returns score (0-100) and maxScore (always 100 if checks exist, 0 if empty)
 */
export function calculateCategoryScore(
  checks: AuditCheck[],
): { score: number; maxScore: number } {
  if (checks.length === 0) {
    return { score: 0, maxScore: 0 };
  }

  let totalWeight = 0;
  let passedWeight = 0;

  for (const check of checks) {
    const weight = SEVERITY_WEIGHTS[check.severity];
    totalWeight += weight;
    if (check.passed) {
      passedWeight += weight;
    }
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

const DEFAULT_CATEGORY_WEIGHT = 1;

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
