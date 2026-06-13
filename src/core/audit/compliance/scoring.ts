/**
 * Compliance scoring — computes per-framework pass rates from audit categories.
 * A compliance "control" passes when ALL checks mapped to it pass.
 * Pass rate = (passed controls / total mapped controls) * 100.
 */

import type { AuditCategory, AuditResult } from "../types.js";
import { isSkippedCheck, isPassedCheck, isFailedCheck } from "../types.js";
import { FRAMEWORK_VERSIONS, type FrameworkKey } from "./mapper.js";
import type { ComplianceControlDetail, ComplianceDetailScore, ProfileName } from "./types.js";
import { PROFILE_MAP } from "./types.js";

export interface ComplianceScore {
  framework: FrameworkKey;
  version: string;
  passRate: number;
  totalControls: number;
  passedControls: number;
  partiallyPassed: number;
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
      // Skip-check guard: compliance refs from a skipped check must NOT
      // contribute to pass/fail aggregation. Collect them separately so
      // we can omit controls whose ONLY checks are skipped.
      if (isSkippedCheck(check)) continue;
      for (const ref of check.complianceRefs) {
        if (!controlMap.has(ref.framework)) {
          controlMap.set(ref.framework, new Map());
        }
        const frameworkControls = controlMap.get(ref.framework)!;
        const existing = frameworkControls.get(ref.controlId);
        if (existing) {
          if (isFailedCheck(check)) existing.allPassed = false;
          if (ref.coverage === "partial") existing.hasPartial = true;
        } else {
          frameworkControls.set(ref.controlId, {
            allPassed: isPassedCheck(check),
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
    let partiallyPassed = 0;
    let partialCount = 0;

    for (const ctrl of controls.values()) {
      if (ctrl.allPassed && !ctrl.hasPartial) passed++;
      else if (ctrl.allPassed && ctrl.hasPartial) partiallyPassed++;
      if (ctrl.hasPartial) partialCount++;
    }

    scores.push({
      framework: framework as FrameworkKey,
      version,
      passRate: controls.size > 0 ? Math.round(((passed + partiallyPassed * 0.5) / controls.size) * 100) : 0,
      totalControls: controls.size,
      passedControls: passed,
      partiallyPassed,
      partialCount,
    });
  }

  // Sort: CIS first, then PCI-DSS, then HIPAA (consistent order)
  const order: Record<string, number> = { CIS: 0, "PCI-DSS": 1, HIPAA: 2 };
  scores.sort((a, b) => (order[a.framework] ?? 99) - (order[b.framework] ?? 99));

  return scores;
}

/**
 * Calculate per-framework compliance detail scores with per-control check lists.
 * Same algorithm as calculateComplianceScores but includes full control breakdown.
 */
export function calculateComplianceDetail(categories: AuditCategory[]): ComplianceDetailScore[] {
  // Map: framework -> controlId -> { allPassed, hasPartial, checks, description }
  const controlMap = new Map<
    string,
    Map<string, { allPassed: boolean; hasPartial: boolean; checks: Array<{ id: string; name: string; passed: boolean }>; description: string }>
  >();

  for (const cat of categories) {
    for (const check of cat.checks) {
      if (!check.complianceRefs) continue;
      // Skip-check guard: compliance refs from a skipped check must NOT
      // contribute to per-control detail aggregation.
      if (isSkippedCheck(check)) continue;
      for (const ref of check.complianceRefs) {
        if (!controlMap.has(ref.framework)) {
          controlMap.set(ref.framework, new Map());
        }
        const frameworkControls = controlMap.get(ref.framework)!;
        const existing = frameworkControls.get(ref.controlId);
        if (existing) {
          if (isFailedCheck(check)) existing.allPassed = false;
          if (ref.coverage === "partial") existing.hasPartial = true;
          existing.checks.push({ id: check.id, name: check.name, passed: isPassedCheck(check) });
        } else {
          frameworkControls.set(ref.controlId, {
            allPassed: isPassedCheck(check),
            hasPartial: ref.coverage === "partial",
            checks: [{ id: check.id, name: check.name, passed: isPassedCheck(check) }],
            description: ref.description,
          });
        }
      }
    }
  }

  const scores: ComplianceDetailScore[] = [];

  for (const [framework, controls] of controlMap) {
    const version = FRAMEWORK_VERSIONS[framework as FrameworkKey] ?? framework;
    let passed = 0;
    let partiallyPassed = 0;
    let partialCount = 0;
    const controlDetails: ComplianceControlDetail[] = [];

    for (const [controlId, ctrl] of controls) {
      if (ctrl.allPassed && !ctrl.hasPartial) passed++;
      else if (ctrl.allPassed && ctrl.hasPartial) partiallyPassed++;
      if (ctrl.hasPartial) partialCount++;
      controlDetails.push({
        controlId,
        description: ctrl.description,
        passed: ctrl.allPassed,
        hasPartial: ctrl.hasPartial,
        checks: ctrl.checks,
      });
    }

    scores.push({
      framework: framework as FrameworkKey,
      version,
      passRate: controls.size > 0 ? Math.round(((passed + partiallyPassed * 0.5) / controls.size) * 100) : 0,
      totalControls: controls.size,
      passedControls: passed,
      partiallyPassed,
      partialCount,
      controls: controlDetails,
    });
  }

  // Sort: CIS first, then PCI-DSS, then HIPAA (consistent order)
  const order: Record<string, number> = { CIS: 0, "PCI-DSS": 1, HIPAA: 2 };
  scores.sort((a, b) => (order[a.framework] ?? 99) - (order[b.framework] ?? 99));

  return scores;
}

/**
 * Filter an AuditResult to only show checks mapped to a compliance profile.
 * Does NOT change overallScore — profile only filters the display/categories view.
 */
export function filterByProfile(result: AuditResult, profileName: ProfileName): AuditResult {
  const profile = PROFILE_MAP[profileName];
  const filteredCategories = result.categories
    .map((cat) => {
      const filteredChecks = cat.checks.filter((check) => {
        if (!check.complianceRefs) return false;
        return check.complianceRefs.some((ref) => {
          if (ref.framework !== profile.framework) return false;
          if (profile.level && ref.level && ref.level !== profile.level) return false;
          return true;
        });
      });
      return { ...cat, checks: filteredChecks, score: cat.score, maxScore: cat.maxScore };
    })
    .filter((cat) => cat.checks.length > 0);

  // IMPORTANT: overallScore stays unchanged — profile only filters display
  return { ...result, categories: filteredCategories };
}
