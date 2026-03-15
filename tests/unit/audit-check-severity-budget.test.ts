/**
 * CI gate: enforces severity budget across the entire CHECK_REGISTRY.
 * No category may have more than 40% critical checks.
 * Prevents any single category from being overwhelmingly critical as the
 * registry grows from 46 to 400+ checks in Phases 46-49.
 *
 * Baseline exceptions (acknowledged overrides at initial v1.10 launch):
 * - SSH: 3/6 critical (50%) — password-auth, root-login, empty-passwords are
 *   genuinely the most critical SSH misconfigs. Budget set to 55% for SSH.
 */

import { CHECK_REGISTRY } from "../../src/core/audit/checks/index.js";

/** Per-category critical budget overrides. Default budget is 40%. */
const CATEGORY_BUDGET_OVERRIDES: Record<string, number> = {
  SSH: 0.55, // SSH has 3 truly critical baseline checks (password-auth, root-login, empty-passwords)
};

const DEFAULT_BUDGET = 0.4;

describe("CHECK_REGISTRY severity budget", () => {
  it("no category has more than 40% critical checks (SSH: 55% override)", () => {
    const violations: string[] = [];

    for (const entry of CHECK_REGISTRY) {
      const checks = entry.parser("", "bare");
      if (checks.length === 0) continue;

      const criticalCount = checks.filter((c) => c.severity === "critical").length;
      const ratio = criticalCount / checks.length;
      const budget = CATEGORY_BUDGET_OVERRIDES[entry.name] ?? DEFAULT_BUDGET;

      if (ratio > budget) {
        violations.push(
          `${entry.name}: ${criticalCount}/${checks.length} critical (${(ratio * 100).toFixed(0)}% > ${(budget * 100).toFixed(0)}%)`,
        );
      }
    }

    expect(violations).toEqual([]);
  });
});
