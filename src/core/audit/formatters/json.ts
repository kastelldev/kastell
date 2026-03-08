/**
 * JSON formatter for audit results.
 * Stub — implemented in Task 2.
 */

import type { AuditResult } from "../types.js";

/** Format audit result as JSON string */
export function formatJson(result: AuditResult): string {
  return JSON.stringify(result, null, 2);
}
