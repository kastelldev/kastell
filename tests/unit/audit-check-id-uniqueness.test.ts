/**
 * CI gate: enforces semantic ID uniqueness and format across the entire CHECK_REGISTRY.
 * Prevents accidental duplicates as the registry grows from 46 to 400+ checks.
 */

import { CHECK_REGISTRY } from "../../src/core/audit/checks/index.js";

describe("CHECK_REGISTRY ID invariants", () => {
  let allIds: string[];

  beforeAll(() => {
    allIds = CHECK_REGISTRY.flatMap((entry) =>
      entry.parser("", "bare").map((check) => check.id),
    );
  });

  it("all check IDs across registry are unique", () => {
    const uniqueIds = new Set(allIds);
    const duplicates = allIds.filter((id, index) => allIds.indexOf(id) !== index);
    expect(duplicates).toEqual([]);
    expect(uniqueIds.size).toBe(allIds.length);
  });

  it("all check IDs match semantic CATEGORY-DESCRIPTION format", () => {
    const semanticPattern = /^[A-Z][A-Z0-9]*(-[A-Z][A-Z0-9]*)+$/;
    const nonSemantic = allIds.filter((id) => !semanticPattern.test(id));
    expect(nonSemantic).toEqual([]);
  });
});
