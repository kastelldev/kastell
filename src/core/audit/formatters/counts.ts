/**
 * Pure check-count helper for audit formatters.
 *
 * Returns passed/failed/skipped counts for a list of AuditCheck values.
 * The structured-skip field (defined in src/core/audit/types.ts) takes
 * precedence over the `passed` boolean — a check that is structured-skipped
 * is counted as `skipped`, not as `failed` even when passed=false.
 *
 * Used by the terminal, summary, and report formatters to avoid duplicating
 * the same three-array-filter+length pattern in each formatter.
 */

import type { AuditCheck } from "../types.js";
import { isSkippedCheck, isPassedCheck, isFailedCheck } from "../types.js";

export interface CheckCounts {
  passed: number;
  failed: number;
  skipped: number;
}

/**
 * Aggregate counts for an iterable of AuditCheck values.
 * Pure function — does not mutate the input.
 */
export function getCheckCounts(checks: readonly AuditCheck[]): CheckCounts {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const check of checks) {
    if (isSkippedCheck(check)) skipped++;
    else if (isPassedCheck(check)) passed++;
    else if (isFailedCheck(check)) failed++;
  }
  return { passed, failed, skipped };
}
