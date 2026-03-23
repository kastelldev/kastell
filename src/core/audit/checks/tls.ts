/**
 * TLS Hardening check parser — stub (RED phase).
 */

import type { AuditCheck, CheckParser } from "../types.js";

export const parseTlsChecks: CheckParser = (
  _sectionOutput: string,
  _platform: string,
): AuditCheck[] => {
  return [];
};
