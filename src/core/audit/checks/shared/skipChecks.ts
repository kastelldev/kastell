import type { AuditCheck } from "../../types.js";

interface SkippableCheckDef {
  id: string;
  name: string;
  expectedValue: string;
  fixCommand: string;
  explain: string;
}

export function makeSkippedChecks(
  checks: SkippableCheckDef[],
  category: string,
  reason: string,
): AuditCheck[] {
  return checks.map((def) => ({
    id: def.id,
    category,
    name: def.name,
    severity: "info" as const,
    passed: true,
    currentValue: reason,
    expectedValue: def.expectedValue,
    fixCommand: def.fixCommand,
    explain: def.explain,
  }));
}
