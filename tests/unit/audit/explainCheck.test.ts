/**
 * Tests for src/core/audit/explainCheck.ts — focused on the describeAuditCatalog
 * helper that consolidates catalog counts (added in P147 code-review to fix the
 * 5-place "32 categories / 449 checks" hardcode drift).
 *
 * The earlier audit/findCheckById paths are covered by
 * tests/unit/audit/compliance/mapper.test.ts and existing infrastructure
 * tests — this file is scoped to the catalog summary contract.
 */
import {
  describeAuditCatalog,
  getFullCheckCatalog,
} from "../../../src/core/audit/explainCheck.js";

describe("describeAuditCatalog", () => {
  // Note: no beforeEach clearCheckCatalogCache — describeAuditCatalog() is
  // read-only and never mutates the catalog cache. The clear is dead code
  // left over from a paranoid template.

  it("returns live-derived check and category counts from the catalog", () => {
    const summary = describeAuditCatalog();
    expect(summary.checks).toBe(getFullCheckCatalog().length);
    expect(summary.checks).toBeGreaterThan(0);

    // Categories are derived from distinct catalog.category values, not
    // from the static CHECK_REGISTRY file count.
    const distinctCategories = new Set(
      getFullCheckCatalog().map((c) => c.category),
    );
    expect(summary.categories).toBe(distinctCategories.size);
  });

  // The three "stable long/short/resource form" it() blocks were deleted:
  // each asserted a template literal built from `summary.checks/categories`
  // against an identical template literal in the source. Such tests can
  // only fail when source and test diverge in lockstep — they test the
  // test, not the code. The contract is already covered above (live
  // counts) and by the "same shape on repeated calls" test below.

  it("produces the same shape on repeated calls (no mutation)", () => {
    const a = describeAuditCatalog();
    const b = describeAuditCatalog();
    expect(a).toEqual(b);
  });

  it("does not mutate the catalog across calls", () => {
    const before = getFullCheckCatalog().length;
    describeAuditCatalog();
    describeAuditCatalog();
    expect(getFullCheckCatalog().length).toBe(before);
  });
});