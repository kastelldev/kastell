/**
 * Snapshot tests for audit report category structure (CHECK_REGISTRY).
 * Protects category names, section names, and ordering from silent regressions.
 * Any change to CHECK_REGISTRY order, names, or count will cause a test failure.
 */

import { CHECK_REGISTRY } from "../../src/core/audit/checks/index";

describe("audit report category structure", () => {
  it("CHECK_REGISTRY category names and order matches snapshot", () => {
    const structure = CHECK_REGISTRY.map(({ name, sectionName }) => ({ name, sectionName }));
    expect(structure).toMatchSnapshot();
  });

  it("CHECK_REGISTRY has expected category count", () => {
    expect(CHECK_REGISTRY.length).toMatchInlineSnapshot(`29`);
  });
});
