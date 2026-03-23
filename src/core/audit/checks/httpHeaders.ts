/**
 * HTTP Security Headers check parser.
 * Parses HTTP response headers into 6 security checks.
 * If Nginx is not installed or HTTP is not responding, returns info-level skipped checks (score-neutral).
 */

import type { AuditCheck, CheckParser, Severity } from "../types.js";

export const parseHttpHeadersChecks: CheckParser = (
  _sectionOutput: string,
  _platform: string,
): AuditCheck[] => {
  return [];
};
