/**
 * CI gate: enforces minimum total check count across all categories.
 * Phase 46 target: >= 90 checks (46 existing + ~62 new from 6 categories).
 */

import { CHECK_REGISTRY } from "../../src/core/audit/checks/index.js";

describe("Total check count CI gate", () => {
  it("should have at least 90 checks across all categories", () => {
    const allChecks = CHECK_REGISTRY.flatMap((entry) =>
      entry.parser("", "bare"),
    );
    expect(allChecks.length).toBeGreaterThanOrEqual(90);
  });

  it("each category should produce at least 1 check", () => {
    for (const entry of CHECK_REGISTRY) {
      const checks = entry.parser("", "bare");
      expect(checks.length).toBeGreaterThan(0);
    }
  });
});
