/**
 * CI gate: enforces minimum total check count across all categories.
 * Phase 49-08 result: 406 bare-metal checks (412 on VPS with Cloud Metadata 6 checks). Phase 85: +8 TLS Hardening = 415 bare-metal.
 * Phase 49 gap closure complete: +57 checks across 20 categories (Waves 1-3).
 * Simplify: removed 3 duplicate SRV- checks (rpcbind/avahi/cups already in SVC-), net 403.
 * Note: Cloud Metadata returns [] on bare-metal/empty input (intentional — Phase 48-01 decision).
 * VPS environments will yield additional Cloud Metadata checks at runtime.
 */

import { CHECK_REGISTRY } from "../../src/core/audit/checks/index.js";

describe("Total check count CI gate", () => {
  it("should have at least 403 checks across all categories", () => {
    const allChecks = CHECK_REGISTRY.flatMap((entry) =>
      entry.parser("", "bare"),
    );
    expect(allChecks.length).toBeGreaterThanOrEqual(403);
  });

  it("each category should produce at least 1 check", () => {
    // Cloud Metadata intentionally returns [] on bare metal / empty input
    // (maxScore=0 excludes it from weighted score on non-VPS hosts — Phase 48-01 decision)
    const BARE_METAL_CATEGORIES = new Set(["Cloud Metadata"]);
    for (const entry of CHECK_REGISTRY) {
      if (BARE_METAL_CATEGORIES.has(entry.name)) continue;
      const checks = entry.parser("", "bare");
      expect(checks.length).toBeGreaterThan(0);
    }
  });
});
