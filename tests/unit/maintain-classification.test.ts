/**
 * Unit tests for canMaintain(): pure classification function for the
 * server/maintain command.
 *
 * canMaintain() must produce a stable decision object per server, with the
 * following branches:
 *   - bare server (no platform adapter) -> "skip-bare" with bare-help detail
 *   - mode is "bare" -> "skip-bare" with bare-help detail
 *   - no resolvable platform from server record -> "skip-no-platform"
 *   - supported platform (coolify/dokploy) with non-dry-run -> "run"
 *   - supported platform with dryRun=true -> "dry-run"
 *   - force flag does NOT change classification (only affects prompt bypass)
 *
 * The function is pure — no I/O, no network, no filesystem.
 */

import type { ServerRecord } from "../../src/types/index.js";
import { canMaintain, type MaintainDecision, type MaintainDecisionKind } from "../../src/core/maintain.js";

const coolifyServer: ServerRecord = {
  id: "c-1",
  name: "coolify-prod",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00.000Z",
  mode: "coolify",
  platform: "coolify",
};

const dokployServer: ServerRecord = {
  id: "d-1",
  name: "dokploy-prod",
  provider: "hetzner",
  ip: "5.6.7.8",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00.000Z",
  mode: "coolify",
  platform: "dokploy",
};

const bareServer: ServerRecord = {
  id: "b-1",
  name: "bare-prod",
  provider: "hetzner",
  ip: "9.9.9.9",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00.000Z",
  mode: "bare",
};

const barePlatformOnlyServer: ServerRecord = {
  id: "b-2",
  name: "bare-mode-only",
  provider: "hetzner",
  ip: "9.9.9.10",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00.000Z",
  mode: "bare",
  // platform intentionally undefined
};

const manualServer: ServerRecord = {
  id: "manual-c-1",
  name: "manual-coolify",
  provider: "hetzner",
  ip: "10.0.0.1",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00.000Z",
  mode: "coolify",
  platform: "coolify",
};

describe("canMaintain", () => {
  describe("bare servers", () => {
    it("returns skip-bare for mode=bare, platform=bare", () => {
      const decision: MaintainDecision = canMaintain(bareServer);
      expect(decision.kind).toBe("skip-bare");
    });

    it("returns skip-bare for mode=bare, no platform", () => {
      const decision = canMaintain(barePlatformOnlyServer);
      expect(decision.kind).toBe("skip-bare");
    });

    it("includes bare-help detail text in skip-bare decisions", () => {
      const decision = canMaintain(bareServer);
      expect(decision.detail).toBeDefined();
      expect(decision.detail).toMatch(/apt|kastell fix/i);
    });

    it("skip-bare decision has a non-empty reason", () => {
      const decision = canMaintain(bareServer);
      expect(decision.reason).toBeDefined();
      expect(decision.reason?.length ?? 0).toBeGreaterThan(0);
    });
  });

  describe("managed servers with platform", () => {
    it("returns run for coolify server in non-dry-run mode", () => {
      const decision = canMaintain(coolifyServer, { dryRun: false, force: false });
      expect(decision.kind).toBe("run");
      expect(decision.platform).toBe("coolify");
    });

    it("returns run for dokploy server in non-dry-run mode", () => {
      const decision = canMaintain(dokployServer, { dryRun: false, force: false });
      expect(decision.kind).toBe("run");
      expect(decision.platform).toBe("dokploy");
    });

    it("returns dry-run for coolify server when dryRun=true", () => {
      const decision = canMaintain(coolifyServer, { dryRun: true, force: false });
      expect(decision.kind).toBe("dry-run");
      expect(decision.platform).toBe("coolify");
    });

    it("returns dry-run for dokploy server when dryRun=true", () => {
      const decision = canMaintain(dokployServer, { dryRun: true, force: false });
      expect(decision.kind).toBe("dry-run");
      expect(decision.platform).toBe("dokploy");
    });

    it("force flag does not change the kind (only bypasses prompt)", () => {
      const withForce = canMaintain(coolifyServer, { dryRun: false, force: true });
      const withoutForce = canMaintain(coolifyServer, { dryRun: false, force: false });
      expect(withForce.kind).toBe(withoutForce.kind);
    });

    it("manual-* ID is treated as run (not bare)", () => {
      // manual- prefix means user-registered without cloud ID, but platform
      // is still valid — should be maintainable
      const decision = canMaintain(manualServer, { dryRun: false, force: false });
      expect(decision.kind).toBe("run");
      expect(decision.platform).toBe("coolify");
    });
  });

  describe("servers without resolvable platform", () => {
    it("managed server with no platform field defaults to coolify (run)", () => {
      // resolvePlatform semantics: server.platform || (mode === "bare" ? undefined : "coolify")
      // A server with platform undefined and mode="coolify" resolves to "coolify" and is runnable.
      const noPlatform: ServerRecord = {
        ...coolifyServer,
        platform: undefined,
      };
      const decision = canMaintain(noPlatform, { dryRun: false, force: false });
      expect(decision.kind).toBe("run");
      expect(decision.platform).toBe("coolify");
    });

    it("decision kinds cover the documented set", () => {
      // canMaintain can return one of: run | dry-run | skip-bare
      const seenKinds = new Set<MaintainDecisionKind>();
      const samples: ServerRecord[] = [coolifyServer, bareServer, dokployServer, manualServer];
      for (const s of samples) {
        for (const dryRun of [true, false]) {
          seenKinds.add(canMaintain(s, { dryRun, force: false }).kind);
        }
      }
      expect(seenKinds.has("run")).toBe(true);
      expect(seenKinds.has("dry-run")).toBe(true);
      expect(seenKinds.has("skip-bare")).toBe(true);
    });
  });

  describe("determinism", () => {
    it("returns the same decision for the same input across calls", () => {
      const a = canMaintain(coolifyServer, { dryRun: false, force: false });
      const b = canMaintain(coolifyServer, { dryRun: false, force: false });
      expect(a).toEqual(b);
    });

    it("classifies every server in a list into exactly one kind", () => {
      const servers: ServerRecord[] = [
        coolifyServer,
        dokployServer,
        bareServer,
        manualServer,
        barePlatformOnlyServer,
      ];
      for (const s of servers) {
        const d = canMaintain(s, { dryRun: false, force: false });
        expect(["run", "dry-run", "skip-bare", "skip-no-platform"]).toContain(d.kind);
      }
    });
  });
});
