import type { AuditCheck, CheckParser } from "../../types.js";

interface __NAME_PASCAL__CheckDef {
  id: string;
  name: string;
  severity: "critical" | "warning" | "info";
  check: (output: string) => { passed: boolean; currentValue: string };
  expectedValue: string;
  fixCommand: string;
  explain: string;
}

const __NAME_UPPER___CHECKS: __NAME_PASCAL__CheckDef[] = [
  {
    id: "__NAME_UPPER__-01",
    name: "TODO: check description",
    severity: "warning",
    check: (output) => {
      const match = output.includes("TODO_SENTINEL");
      return { passed: match, currentValue: match ? "configured" : "not found" };
    },
    expectedValue: "configured",
    fixCommand: "TODO: fix command",
    explain: "TODO: why this matters",
  },
];

export const parse__NAME_PASCAL__Checks: CheckParser = (
  sectionOutput: string,
  _platform: string,
): AuditCheck[] => {
  if (!sectionOutput || sectionOutput.includes("SKIP_MARKER")) {
    return [];
  }

  return __NAME_UPPER___CHECKS.map((def) => {
    const { passed, currentValue } = def.check(sectionOutput);
    return {
      id: def.id,
      category: "__NAME_PASCAL__",
      name: def.name,
      severity: def.severity,
      passed,
      currentValue,
      expectedValue: def.expectedValue,
      fixCommand: def.fixCommand,
      explain: def.explain,
    };
  });
};
