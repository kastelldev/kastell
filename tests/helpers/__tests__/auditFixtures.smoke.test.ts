/**
 * Smoke test for auditFixtures helper.
 */

import { auditFixtures } from "../auditFixtures.js";
import type { AuditResult } from "../../../src/core/audit/types.js";

describe("auditFixtures smoke", () => {
  it("makeAudit() output satisfies AuditResult", () => {
    const result = auditFixtures.makeAuditResult() satisfies AuditResult;
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.categories)).toBe(true);
  });

  it("makeAudit({ score: 75 }) override works", () => {
    const result = auditFixtures.makeAuditResult({ score: 75 });
    expect(result.score).toBe(75);
  });
});