/**
 * Smoke test for auditFixtures helper.
 */

import { makeAuditResult } from "../auditFixtures.js";
import type { AuditResult } from "../../../src/core/audit/types.js";

describe("auditFixtures smoke", () => {
  it("makeAuditResult() output satisfies AuditResult", () => {
    const result = makeAuditResult() satisfies AuditResult;
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.categories)).toBe(true);
  });

  it("makeAuditResult({ overallScore: 75 }) override works", () => {
    const result = makeAuditResult({ overallScore: 75 });
    expect(result.overallScore).toBe(75);
  });
});