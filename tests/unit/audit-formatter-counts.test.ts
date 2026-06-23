/**
 * Unit tests for the pure check-count helper used by audit formatters.
 *
 * The shape of AuditCheck.skip is defined in src/core/audit/types.ts:
 *   skip?: PluginCheckSkipReason
 *   PluginCheckSkipReason = { code: "legacy-mutating"; apiVersion: "2"; kind: "mutate-local" | "mutate-global" }
 *
 * getCheckCounts() must:
 *   - count a check as `passed` when !skip && check.passed === true
 *   - count a check as `failed` when !skip && check.passed === false
 *   - count a check as `skipped` when check.skip is defined (structured skip takes precedence)
 *   - leave the AuditCheck shape unchanged (no mutation)
 */

import type { AuditCheck, PluginCheckSkipReason } from "../../src/core/audit/types.js";
import { getCheckCounts, type CheckCounts } from "../../src/core/audit/formatters/counts.js";

const SKIP_FIXTURE: PluginCheckSkipReason = { code: "legacy-mutating", apiVersion: "2", kind: "mutate-local" };
const ACTIVE_PROBE_FIXTURE: PluginCheckSkipReason = { code: "active-probe", apiVersion: "3" };

function makeCheck(overrides: Partial<AuditCheck> & { id: string }): AuditCheck {
  const base: AuditCheck = {
    id: overrides.id,
    category: overrides.category ?? "Test",
    name: overrides.name ?? `Check ${overrides.id}`,
    severity: overrides.severity ?? "warning",
    passed: overrides.passed ?? false,
    currentValue: overrides.currentValue ?? "actual",
    expectedValue: overrides.expectedValue ?? "expected",
  };
  return { ...base, ...overrides };
}

describe("getCheckCounts", () => {
  it("returns all zeros for an empty array", () => {
    expect(getCheckCounts([])).toEqual({ passed: 0, failed: 0, skipped: 0 });
  });

  it("counts a single passed check", () => {
    const checks = [makeCheck({ id: "C1", passed: true })];
    expect(getCheckCounts(checks)).toEqual({ passed: 1, failed: 0, skipped: 0 });
  });

  it("counts a single failed check", () => {
    const checks = [makeCheck({ id: "C1", passed: false })];
    expect(getCheckCounts(checks)).toEqual({ passed: 0, failed: 1, skipped: 0 });
  });

  it("counts a single skipped check (structured skip takes precedence over passed:false)", () => {
    const checks = [makeCheck({ id: "C1", passed: false, skip: SKIP_FIXTURE })];
    expect(getCheckCounts(checks)).toEqual({ passed: 0, failed: 0, skipped: 1 });
  });

  it("counts a passed check that ALSO has a skip field as skipped (skip wins)", () => {
    const checks = [makeCheck({ id: "C1", passed: true, skip: SKIP_FIXTURE })];
    expect(getCheckCounts(checks)).toEqual({ passed: 0, failed: 0, skipped: 1 });
  });

  it("counts passed/failed/skipped separately in a mixed array", () => {
    const checks: AuditCheck[] = [
      makeCheck({ id: "P1", passed: true }),
      makeCheck({ id: "P2", passed: true }),
      makeCheck({ id: "F1", passed: false }),
      makeCheck({ id: "F2", passed: false }),
      makeCheck({ id: "S1", passed: false, skip: SKIP_FIXTURE }),
      makeCheck({ id: "S2", passed: true, skip: SKIP_FIXTURE }),
    ];
    expect(getCheckCounts(checks)).toEqual({ passed: 2, failed: 2, skipped: 2 });
  });

  it("does not mutate the input array or check objects", () => {
    const checks: AuditCheck[] = [
      makeCheck({ id: "P1", passed: true }),
      makeCheck({ id: "F1", passed: false }),
      makeCheck({ id: "S1", passed: false, skip: SKIP_FIXTURE }),
    ];
    const snapshot = JSON.parse(JSON.stringify(checks)) as AuditCheck[];
    getCheckCounts(checks);
    expect(checks).toEqual(snapshot);
  });

  it("result is a fresh object each call (no shared mutation risk)", () => {
    const a: CheckCounts = getCheckCounts([]);
    const b: CheckCounts = getCheckCounts([]);
    expect(a).not.toBe(b);
    a.passed = 999;
    expect(b.passed).toBe(0);
  });

  it("accepts readonly arrays (type contract)", () => {
    const readonly: readonly AuditCheck[] = [makeCheck({ id: "P1", passed: true })];
    // TypeScript compile-time check; runtime call:
    expect(getCheckCounts(readonly)).toEqual({ passed: 1, failed: 0, skipped: 0 });
  });

  // P144 T6: active-probe skip is also counted as skipped (variant-agnostic)
  it("P144 T6: counts a single active-probe skipped check as skipped", () => {
    const checks = [makeCheck({ id: "AP1", passed: false, skip: ACTIVE_PROBE_FIXTURE })];
    expect(getCheckCounts(checks)).toEqual({ passed: 0, failed: 0, skipped: 1 });
  });

  it("P144 T6: counts passed active-probe skipped check as skipped (skip wins)", () => {
    const checks = [makeCheck({ id: "AP1", passed: true, skip: ACTIVE_PROBE_FIXTURE })];
    expect(getCheckCounts(checks)).toEqual({ passed: 0, failed: 0, skipped: 1 });
  });

  it("P144 T6: counts mixed legacy-mutating and active-probe skipped checks together", () => {
    const checks: AuditCheck[] = [
      makeCheck({ id: "P1", passed: true }),
      makeCheck({ id: "F1", passed: false }),
      makeCheck({ id: "LM1", passed: false, skip: SKIP_FIXTURE }),
      makeCheck({ id: "AP1", passed: false, skip: ACTIVE_PROBE_FIXTURE }),
    ];
    expect(getCheckCounts(checks)).toEqual({ passed: 1, failed: 1, skipped: 2 });
  });
});
