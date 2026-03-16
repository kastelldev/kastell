/**
 * Compliance scoring — computes per-framework pass rates from audit categories.
 * A compliance "control" passes when ALL checks mapped to it pass.
 * Pass rate = (passed controls / total mapped controls) * 100.
 */

import type { AuditCategory } from "../types.js";
import { FRAMEWORK_VERSIONS, type FrameworkKey } from "./mapper.js";

export interface ComplianceScore {
  framework: FrameworkKey;
  version: string;
  passRate: number;
  totalControls: number;
  passedControls: number;
  partialCount: number;
}

/**
 * Calculate per-framework compliance pass rates from compliance-enriched categories.
 *
 * Algorithm:
 * 1. Collect all unique (framework, controlId) pairs from check complianceRefs
 * 2. Group checks by (framework, controlId)
 * 3. A control passes if ALL its mapped checks pass
 * 4. Pass rate = passedControls / totalControls * 100
 *
 * Returns one ComplianceScore per framework found in the data.
 */
export function calculateComplianceScores(categories: AuditCategory[]): ComplianceScore[] {
  // Map: framework -> controlId -> { allPassed: boolean, hasPartial: boolean }
  const controlMap = new Map<string, Map<string, { allPassed: boolean; hasPartial: boolean }>>();

  for (const cat of categories) {
    for (const check of cat.checks) {
      if (!check.complianceRefs) continue;
      for (const ref of check.complianceRefs) {
        if (!controlMap.has(ref.framework)) {
          controlMap.set(ref.framework, new Map());
        }
        const frameworkControls = controlMap.get(ref.framework)!;
        const existing = frameworkControls.get(ref.controlId);
        if (existing) {
          if (!check.passed) existing.allPassed = false;
          if (ref.coverage === "partial") existing.hasPartial = true;
        } else {
          frameworkControls.set(ref.controlId, {
            allPassed: check.passed,
            hasPartial: ref.coverage === "partial",
          });
        }
      }
    }
  }

  const scores: ComplianceScore[] = [];

  for (const [framework, controls] of controlMap) {
    const version = FRAMEWORK_VERSIONS[framework as FrameworkKey] ?? framework;
    let passed = 0;
    let partialCount = 0;

    for (const ctrl of controls.values()) {
      if (ctrl.allPassed) passed++;
      if (ctrl.hasPartial) partialCount++;
    }

    scores.push({
      framework: framework as FrameworkKey,
      version,
      passRate: controls.size > 0 ? Math.round((passed / controls.size) * 100) : 0,
      totalControls: controls.size,
      passedControls: passed,
      partialCount,
    });
  }

  // Sort: CIS first, then PCI-DSS, then HIPAA (consistent order)
  const order: Record<string, number> = { CIS: 0, "PCI-DSS": 1, HIPAA: 2 };
  scores.sort((a, b) => (order[a.framework] ?? 99) - (order[b.framework] ?? 99));

  return scores;
}
