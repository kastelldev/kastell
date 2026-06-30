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
  clearCheckCatalogCache,
} from "../../../src/core/audit/explainCheck.js";

describe("describeAuditCatalog", () => {
  beforeEach(() => {
    clearCheckCatalogCache();
  });

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

  it("returns stable long-form description string", () => {
    const summary = describeAuditCatalog();
    expect(summary.description).toBe(
      `Scans ${summary.categories} categories with ${summary.checks} checks`,
    );
  });

  it("returns stable short-form summary", () => {
    const summary = describeAuditCatalog();
    expect(summary.short).toBe(
      `${summary.checks}-check security scan, ${summary.categories} categories`,
    );
  });

  it("returns stable resource-form description", () => {
    const summary = describeAuditCatalog();
    expect(summary.resource).toBe(
      `${summary.checks} checks with id, name, category, severity`,
    );
  });

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