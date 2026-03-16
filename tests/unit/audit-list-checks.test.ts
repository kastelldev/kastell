/**
 * Unit tests for listChecks core module.
 * Tests static check catalog enumeration without SSH connection.
 */

import { listAllChecks, formatListChecksTerminal, formatListChecksJson } from "../../src/core/audit/listChecks.js";

describe("listAllChecks", () => {
  it("returns at least 406 entries total", () => {
    const checks = listAllChecks();
    expect(checks.length).toBeGreaterThanOrEqual(406);
  });

  it("filters to only SSH checks when category='SSH'", () => {
    const checks = listAllChecks({ category: "SSH" });
    expect(checks.length).toBeGreaterThan(0);
    for (const check of checks) {
      expect(check.category).toBe("SSH");
    }
  });

  it("filters to only critical checks when severity='critical'", () => {
    const checks = listAllChecks({ severity: "critical" });
    expect(checks.length).toBeGreaterThan(0);
    for (const check of checks) {
      expect(check.severity).toBe("critical");
    }
  });

  it("applies AND logic when both category and severity are specified", () => {
    const checks = listAllChecks({ category: "SSH", severity: "critical" });
    for (const check of checks) {
      expect(check.category).toBe("SSH");
      expect(check.severity).toBe("critical");
    }
  });

  it("every entry has non-empty id, category, name, severity", () => {
    const checks = listAllChecks();
    for (const check of checks) {
      expect(check.id).toBeTruthy();
      expect(check.category).toBeTruthy();
      expect(check.name).toBeTruthy();
      expect(check.severity).toBeTruthy();
    }
  });

  it("every entry has complianceRefs as an array", () => {
    const checks = listAllChecks();
    for (const check of checks) {
      expect(Array.isArray(check.complianceRefs)).toBe(true);
    }
  });

  it("case-insensitive category filter works", () => {
    const lower = listAllChecks({ category: "ssh" });
    const upper = listAllChecks({ category: "SSH" });
    expect(lower.length).toBe(upper.length);
    expect(lower.length).toBeGreaterThan(0);
  });
});

describe("formatListChecksJson", () => {
  it("returns valid JSON array", () => {
    const checks = listAllChecks();
    const json = formatListChecksJson(checks);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(checks.length);
  });

  it("JSON entries contain expected fields", () => {
    const checks = listAllChecks({ category: "SSH" });
    const parsed = JSON.parse(formatListChecksJson(checks)) as Array<Record<string, unknown>>;
    for (const entry of parsed) {
      expect(entry).toHaveProperty("id");
      expect(entry).toHaveProperty("category");
      expect(entry).toHaveProperty("name");
      expect(entry).toHaveProperty("severity");
      expect(entry).toHaveProperty("explain");
      expect(entry).toHaveProperty("complianceRefs");
    }
  });
});

describe("formatListChecksTerminal", () => {
  it("output contains 'Total:' footer line", () => {
    const checks = listAllChecks();
    const output = formatListChecksTerminal(checks);
    expect(output).toContain("Total:");
  });

  it("output contains category headers for known categories", () => {
    const checks = listAllChecks({ category: "SSH" });
    const output = formatListChecksTerminal(checks);
    expect(output).toContain("SSH");
  });

  it("footer shows correct check count", () => {
    const checks = listAllChecks({ category: "SSH" });
    const output = formatListChecksTerminal(checks);
    expect(output).toContain(`Total: ${checks.length} checks`);
  });
});
