import {
  resolveTier,
  previewSafeFixes,
  FORBIDDEN_CATEGORIES,
} from "../../src/core/audit/fix.js";
import type {
  AuditResult,
  AuditCheck,
  AuditCategory,
  FixTier,
} from "../../src/core/audit/types.js";
import { CHECK_REGISTRY } from "../../src/core/audit/checks/index.js";

// ── Test helpers (same pattern as audit-fix.test.ts) ──────────────────────────

function makeCheck(overrides: Partial<AuditCheck> = {}): AuditCheck {
  return {
    id: "TEST-01",
    category: "Test",
    name: "Test Check",
    severity: "warning",
    passed: true,
    currentValue: "good",
    expectedValue: "good",
    ...overrides,
  };
}

function makeCategory(name: string, checks: AuditCheck[]): AuditCategory {
  const totalWeight = checks.reduce((sum, c) => {
    const w = c.severity === "critical" ? 3 : c.severity === "warning" ? 2 : 1;
    return sum + w;
  }, 0);
  const passedWeight = checks
    .filter((c) => c.passed)
    .reduce((sum, c) => {
      const w =
        c.severity === "critical" ? 3 : c.severity === "warning" ? 2 : 1;
      return sum + w;
    }, 0);
  const score =
    totalWeight > 0 ? Math.round((passedWeight / totalWeight) * 100) : 0;
  return { name, checks, score, maxScore: totalWeight > 0 ? 100 : 0 };
}

function makeResult(categories: AuditCategory[]): AuditResult {
  const sum = categories.reduce((acc, c) => acc + c.score, 0);
  const overallScore =
    categories.length > 0 ? Math.round(sum / categories.length) : 0;
  return {
    serverName: "test-server",
    serverIp: "1.2.3.4",
    platform: "bare",
    timestamp: new Date().toISOString(),
    auditVersion: "1.0.0",
    categories,
    overallScore,
    quickWins: [],
  };
}

// ── resolveTier tests ─────────────────────────────────────────────────────────

describe("resolveTier", () => {
  it("returns FORBIDDEN for SSH category regardless of check-level safeToAutoFix", () => {
    const check = makeCheck({ safeToAutoFix: "SAFE" });
    expect(resolveTier(check, "SSH")).toBe("FORBIDDEN");
  });

  it("returns FORBIDDEN for Firewall category regardless of check-level safeToAutoFix", () => {
    const check = makeCheck({ safeToAutoFix: "SAFE" });
    expect(resolveTier(check, "Firewall")).toBe("FORBIDDEN");
  });

  it("returns FORBIDDEN for Docker category regardless of check-level safeToAutoFix", () => {
    const check = makeCheck({ safeToAutoFix: "SAFE" });
    expect(resolveTier(check, "Docker")).toBe("FORBIDDEN");
  });

  it("returns FORBIDDEN for FORBIDDEN categories even when safeToAutoFix is GUARDED", () => {
    const check = makeCheck({ safeToAutoFix: "GUARDED" });
    expect(resolveTier(check, "SSH")).toBe("FORBIDDEN");
    expect(resolveTier(check, "Firewall")).toBe("FORBIDDEN");
    expect(resolveTier(check, "Docker")).toBe("FORBIDDEN");
  });

  it("returns GUARDED when safeToAutoFix is undefined (D-04 default)", () => {
    const check = makeCheck({ safeToAutoFix: undefined });
    expect(resolveTier(check, "Kernel")).toBe("GUARDED");
  });

  it("returns SAFE when category is non-forbidden and safeToAutoFix is SAFE", () => {
    const check = makeCheck({ safeToAutoFix: "SAFE" });
    expect(resolveTier(check, "Kernel")).toBe("SAFE");
  });

  it("returns GUARDED when category is non-forbidden and safeToAutoFix is GUARDED", () => {
    const check = makeCheck({ safeToAutoFix: "GUARDED" });
    expect(resolveTier(check, "Logging")).toBe("GUARDED");
  });
});

// ── previewSafeFixes tests ────────────────────────────────────────────────────

describe("previewSafeFixes", () => {
  it("returns only SAFE tier checks in safePlan", () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({
          id: "SSH-01",
          category: "SSH",
          passed: false,
          fixCommand: "sed -i ...",
          safeToAutoFix: "FORBIDDEN",
        }),
      ]),
      makeCategory("Kernel", [
        makeCheck({
          id: "KERN-01",
          category: "Kernel",
          passed: false,
          fixCommand: "sysctl -w ...",
          safeToAutoFix: "SAFE",
        }),
      ]),
      makeCategory("Logging", [
        makeCheck({
          id: "LOG-01",
          category: "Logging",
          passed: false,
          fixCommand: "systemctl restart rsyslog",
          safeToAutoFix: "GUARDED",
        }),
      ]),
    ]);

    const { safePlan, guardedCount, forbiddenCount, guardedIds } =
      previewSafeFixes(result);

    // Only the Kernel check is SAFE
    const allChecks = safePlan.groups.flatMap((g) => g.checks);
    expect(allChecks).toHaveLength(1);
    expect(allChecks[0].id).toBe("KERN-01");
  });

  it("returns correct guardedCount and forbiddenCount", () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({
          id: "SSH-01",
          category: "SSH",
          passed: false,
          fixCommand: "sed -i ...",
          safeToAutoFix: "FORBIDDEN",
        }),
      ]),
      makeCategory("Kernel", [
        makeCheck({
          id: "KERN-01",
          category: "Kernel",
          passed: false,
          fixCommand: "sysctl -w ...",
          safeToAutoFix: "SAFE",
        }),
      ]),
      makeCategory("Logging", [
        makeCheck({
          id: "LOG-01",
          category: "Logging",
          passed: false,
          fixCommand: "systemctl restart rsyslog",
          safeToAutoFix: "GUARDED",
        }),
      ]),
    ]);

    const { guardedCount, forbiddenCount, guardedIds } =
      previewSafeFixes(result);

    expect(guardedCount).toBe(1);
    expect(forbiddenCount).toBe(1);
    expect(guardedIds).toContain("LOG-01");
  });

  it("returns empty safePlan when no SAFE fixes exist", () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({
          id: "SSH-01",
          category: "SSH",
          passed: false,
          fixCommand: "sed -i ...",
          safeToAutoFix: "FORBIDDEN",
        }),
      ]),
    ]);

    const { safePlan, guardedCount, forbiddenCount } =
      previewSafeFixes(result);

    expect(safePlan.groups).toHaveLength(0);
    expect(forbiddenCount).toBe(1);
    expect(guardedCount).toBe(0);
  });

  it("skips passed checks even with fixCommand", () => {
    const result = makeResult([
      makeCategory("Kernel", [
        makeCheck({
          id: "KERN-01",
          category: "Kernel",
          passed: true,
          fixCommand: "sysctl -w ...",
          safeToAutoFix: "SAFE",
        }),
      ]),
    ]);

    const { safePlan } = previewSafeFixes(result);
    expect(safePlan.groups).toHaveLength(0);
  });

  it("skips checks without fixCommand", () => {
    const result = makeResult([
      makeCategory("Kernel", [
        makeCheck({
          id: "KERN-01",
          category: "Kernel",
          passed: false,
          safeToAutoFix: "SAFE",
        }),
      ]),
    ]);

    const { safePlan } = previewSafeFixes(result);
    expect(safePlan.groups).toHaveLength(0);
  });
});

// ── FORBIDDEN_CATEGORIES constant ─────────────────────────────────────────────

describe("FORBIDDEN_CATEGORIES", () => {
  it("contains SSH, Firewall, and Docker", () => {
    expect(FORBIDDEN_CATEGORIES.has("SSH")).toBe(true);
    expect(FORBIDDEN_CATEGORIES.has("Firewall")).toBe(true);
    expect(FORBIDDEN_CATEGORIES.has("Docker")).toBe(true);
  });

  it("does not contain non-forbidden categories", () => {
    expect(FORBIDDEN_CATEGORIES.has("Kernel")).toBe(false);
    expect(FORBIDDEN_CATEGORIES.has("Network")).toBe(false);
    expect(FORBIDDEN_CATEGORIES.has("Logging")).toBe(false);
  });
});

// ── FORBIDDEN guarantee integration test ──────────────────────────────────────

describe("FORBIDDEN guarantee — no SAFE tier in SSH/Firewall/Docker categories", () => {
  const forbiddenEntries = CHECK_REGISTRY.filter((entry) =>
    FORBIDDEN_CATEGORIES.has(entry.name),
  );

  it("CHECK_REGISTRY contains SSH, Firewall, and Docker entries", () => {
    const names = forbiddenEntries.map((e) => e.name);
    expect(names).toContain("SSH");
    expect(names).toContain("Firewall");
    expect(names).toContain("Docker");
  });

  for (const entry of forbiddenEntries) {
    it(`${entry.name} category has zero SAFE-tier checks`, () => {
      // Run the parser with empty/minimal output to get check objects
      const checks = entry.parser("", "bare");

      const safeChecks = checks.filter(
        (c) => c.fixCommand && c.safeToAutoFix === "SAFE",
      );

      expect(safeChecks).toHaveLength(0);

      // Also verify all checks with fixCommand have safeToAutoFix set
      const fixableChecks = checks.filter((c) => c.fixCommand);
      for (const check of fixableChecks) {
        expect(check.safeToAutoFix).toBeDefined();
        expect(check.safeToAutoFix).not.toBe("SAFE");
      }
    });
  }
});
