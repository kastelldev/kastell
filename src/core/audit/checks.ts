/**
 * Check classification helpers — pure functions over AuditResult.
 *
 * Sibling of `formatters/counts.ts` (aggregate counts) and `types.ts` (type
 * guards). These extractors live here because they depend on the type guards
 * but are independent of regression baseline persistence logic.
 */

import type { AuditResult } from "./types.js";
import { isPassedCheck, isFailedCheck, isSkippedCheck } from "./types.js";

export function extractPassedCheckIds(audit: AuditResult): string[] {
  const ids: string[] = [];
  for (const category of audit.categories) {
    for (const check of category.checks) {
      if (isPassedCheck(check)) ids.push(check.id);
    }
  }
  return ids.sort();
}

export function extractFailedCheckIds(result: AuditResult): string[] {
  return result.categories.flatMap((c) => c.checks.filter(isFailedCheck).map((ch) => ch.id));
}

export function extractSkippedCheckIds(result: AuditResult): string[] {
  return result.categories.flatMap((c) => c.checks.filter(isSkippedCheck).map((ch) => ch.id));
}
