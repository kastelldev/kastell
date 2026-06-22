// tests/unit/probe-session-store.test.ts
// P144 T9 — Crash-safe reservations and CAS session transitions.
//
// Each test runs against a fresh isolated KASTELL_DIR. The module is
// imported via `importWithIsolatedKastellDir` so each test sees its own
// PROBE_SESSIONS_DIR/PROBE_TARGETS_DIR. The randomUUID dependency is
// injected via the test seam `setRandomUUIDDependencyForTesting` so each
// test can deterministically control session filenames.

import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

import {
  importWithIsolatedKastellDir,
  createIsolatedKastellEnv,
  type IsolatedKastellEnv,
} from "../helpers/isolatedKastellEnv.js";

// Stub secureWriteFileSync with a plain fs.writeFileSync so tests do not
// depend on ACL/icacls behavior (which is platform-specific). The
// production store still calls atomicWriteFileSync with
// { sensitivity: "secret", allowCopyFallback: false } — verified by
// inspection and exercised in tests/unit/atomicWrite.test.ts.
jest.mock("../../src/utils/secureWrite.js", () => {
  const fs = jest.requireActual("fs") as typeof import("fs");
  return {
    __esModule: true,
    secureWriteFileSync: (path: string, data: string, options?: { encoding?: BufferEncoding }) => {
      fs.mkdirSync(join(path, ".."), { recursive: true });
      fs.writeFileSync(path, data, { encoding: options?.encoding ?? "utf8" });
    },
    secureMkdirSync: (path: string) => fs.mkdirSync(path, { recursive: true }),
    ensureSecureDir: () => {},
    clearCache: () => {},
    getCurrentWindowsIdentity: () => "DOMAIN\\user",
    resetWindowsIdentityCacheForTesting: () => {},
  };
});

interface ModuleUnderTest {
  reserveProbeTarget: typeof import("../../src/core/probe/sessionStore.js")["reserveProbeTarget"];
  transitionProbeSession: typeof import("../../src/core/probe/sessionStore.js")["transitionProbeSession"];
  releaseProbeReservation: typeof import("../../src/core/probe/sessionStore.js")["releaseProbeReservation"];
  loadProbeSession: typeof import("../../src/core/probe/sessionStore.js")["loadProbeSession"];
  listProbeSessions: typeof import("../../src/core/probe/sessionStore.js")["listProbeSessions"];
  createProbeSessionFacade: typeof import("../../src/core/probe/sessionStore.js")["createProbeSessionFacade"];
  canonicalProbeTargetKey: typeof import("../../src/core/probe/sessionStore.js")["canonicalProbeTargetKey"];
  hashProbeTarget: typeof import("../../src/core/probe/sessionStore.js")["hashProbeTarget"];
  ALLOWED_PROBE_TRANSITIONS: typeof import("../../src/core/probe/sessionStore.js")["ALLOWED_PROBE_TRANSITIONS"];
  ProbeSessionConflictError: typeof import("../../src/core/probe/sessionStore.js")["ProbeSessionConflictError"];
  ProbeSessionInvalidTransitionError: typeof import("../../src/core/probe/sessionStore.js")["ProbeSessionInvalidTransitionError"];
  ProbeSessionNotFoundError: typeof import("../../src/core/probe/sessionStore.js")["ProbeSessionNotFoundError"];
  setRandomUUIDDependencyForTesting: typeof import("../../src/core/probe/sessionStore.js")["setRandomUUIDDependencyForTesting"];
  resetRandomUUIDDependencyForTesting: typeof import("../../src/core/probe/sessionStore.js")["resetRandomUUIDDependencyForTesting"];
}

interface ModulePaths {
  PROBE_SESSIONS_DIR: string;
  PROBE_TARGETS_DIR: string;
}

const VALID_UUID_A = "00000000-0000-4000-8000-00000000000a";
const VALID_UUID_B = "00000000-0000-4000-8000-00000000000b";
const VALID_UUID_C = "00000000-0000-4000-8000-00000000000c";
const DEFAULT_FALLBACK_UUID = "00000000-0000-4000-8000-aaaaaaaaaaaa";

interface LoadedModules {
  mod: ModuleUnderTest;
  paths: ModulePaths;
  queue: UUIDQueue;
}

// A queue of UUIDs the dependency will hand out in order, like the brief's
// `mockReturnValueOnce` chaining pattern. `undefined` means "fall back to a
// fresh default UUID". Tests push UUIDs in order; once empty, the
// dependency returns a deterministic fallback UUID.
class UUIDQueue {
  private queue: Array<string | undefined> = [];

  push(value: string): this {
    this.queue.push(value);
    return this;
  }

  reset(): void {
    this.queue = [];
  }

  next(): string {
    return this.queue.shift() ?? DEFAULT_FALLBACK_UUID;
  }
}

async function loadModules(env: IsolatedKastellEnv): Promise<LoadedModules> {
  return importWithIsolatedKastellDir(env, async () => {
    const mod = (await import("../../src/core/probe/sessionStore.js")) as unknown as ModuleUnderTest;
    const paths = (await import("../../src/utils/paths.js")) as unknown as ModulePaths;
    return { mod, paths, queue: new UUIDQueue() };
  });
}

function buildInput(targetOverrides: Partial<{
  provider: string;
  serverId: string;
  cloudId: string | undefined;
  ip: string;
}> = {}): import("../../src/core/probe/sessionStore.js").NewProbeSession {
  return {
    pluginName: "probe-plugin",
    pluginVersion: "1.0.0",
    checkId: "check-active",
    handlerPath: "/abs/path/to/handler.js",
    handlerSha256: "abc123",
    risk: "safe",
    timeoutMs: 30_000,
    target: {
      serverId: targetOverrides.serverId ?? "srv-1",
      provider: targetOverrides.provider ?? "hetzner",
      cloudId: targetOverrides.cloudId,
      ip: targetOverrides.ip ?? "1.2.3.4",
    },
  };
}

function withUUID(mod: ModuleUnderTest, queue: UUIDQueue): void {
  mod.setRandomUUIDDependencyForTesting(() => queue.next());
}

describe("canonicalProbeTargetKey + hashProbeTarget", () => {
  let env: IsolatedKastellEnv;
  let mod: ModuleUnderTest;

  beforeEach(async () => {
    env = createIsolatedKastellEnv();
    ({ mod } = await loadModules(env));
  });

  afterEach(() => env.cleanup());

  it("uses provider + cloudId for cloud targets", () => {
    const key = mod.canonicalProbeTargetKey({
      serverId: "srv-1",
      provider: "hetzner",
      cloudId: "cloud-abc",
      ip: "1.2.3.4",
    });
    expect(key).toBe(
      JSON.stringify(["probe-target-v1", "hetzner", ["cloud", "cloud-abc"]]),
    );
  });

  it("uses provider + serverId for manual records (no cloudId)", () => {
    const key = mod.canonicalProbeTargetKey({
      serverId: "srv-1",
      provider: "hetzner",
      ip: "1.2.3.4",
    });
    expect(key).toBe(
      JSON.stringify(["probe-target-v1", "hetzner", ["record", "srv-1"]]),
    );
  });

  it("never participates IP in exclusion identity", () => {
    const a = mod.hashProbeTarget({
      serverId: "srv-1",
      provider: "hetzner",
      cloudId: "cloud-abc",
      ip: "1.2.3.4",
    });
    const b = mod.hashProbeTarget({
      serverId: "srv-1",
      provider: "hetzner",
      cloudId: "cloud-abc",
      ip: "9.9.9.9",
    });
    expect(a).toBe(b);
  });

  it("differs when only cloudId changes for cloud targets", () => {
    const a = mod.hashProbeTarget({
      serverId: "srv-1",
      provider: "hetzner",
      cloudId: "cloud-a",
      ip: "1.2.3.4",
    });
    const b = mod.hashProbeTarget({
      serverId: "srv-1",
      provider: "hetzner",
      cloudId: "cloud-b",
      ip: "1.2.3.4",
    });
    expect(a).not.toBe(b);
  });

  it("differs when only provider changes", () => {
    const a = mod.hashProbeTarget({
      serverId: "srv-1",
      provider: "hetzner",
      ip: "1.2.3.4",
    });
    const b = mod.hashProbeTarget({
      serverId: "srv-1",
      provider: "digitalocean",
      ip: "1.2.3.4",
    });
    expect(a).not.toBe(b);
  });

  it("is collision-resistant against delimiter-like IDs (cloudId containing 'record:')", () => {
    const cloud = mod.hashProbeTarget({
      serverId: "ignored",
      provider: "hetzner",
      cloudId: "record:srv-1",
      ip: "1.2.3.4",
    });
    const manual = mod.hashProbeTarget({
      serverId: "srv-1",
      provider: "hetzner",
      ip: "1.2.3.4",
    });
    expect(cloud).not.toBe(manual);
  });

  it("produces a 64-character hex SHA-256 digest", () => {
    const hash = mod.hashProbeTarget({
      serverId: "srv-1",
      provider: "hetzner",
      ip: "1.2.3.4",
    });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("reserveProbeTarget", () => {
  let env: IsolatedKastellEnv;
  let mod: ModuleUnderTest;
  let paths: ModulePaths;
  let queue: UUIDQueue;

  beforeEach(async () => {
    env = createIsolatedKastellEnv();
    ({ mod, paths, queue } = await loadModules(env));
    withUUID(mod, queue);
  });

  afterEach(() => {
    mod.resetRandomUUIDDependencyForTesting();
    env.cleanup();
  });

  it("writes the session under PROBE_SESSIONS_DIR/<uuid>.session.json", async () => {
    queue.push(VALID_UUID_A);
    const session = await mod.reserveProbeTarget(buildInput());
    const sessionPath = join(paths.PROBE_SESSIONS_DIR, `${VALID_UUID_A}.session.json`);
    expect(existsSync(sessionPath)).toBe(true);
    expect(session.sessionId).toBe(VALID_UUID_A);
    expect(session.state).toBe("preparing");
    expect(session.revision).toBe(1);
  });

  it("writes the reservation under PROBE_TARGETS_DIR/<hash>.reservation.json", async () => {
    queue.push(VALID_UUID_A);
    const session = await mod.reserveProbeTarget(buildInput());
    const reservationPath = join(
      paths.PROBE_TARGETS_DIR,
      `${session.targetKeyHash}.reservation.json`,
    );
    expect(existsSync(reservationPath)).toBe(true);
    const raw = JSON.parse(readFileSync(reservationPath, "utf8"));
    expect(raw).toMatchObject({
      schemaVersion: 1,
      targetKeyHash: session.targetKeyHash,
      sessionId: VALID_UUID_A,
    });
  });

  it("writes the reservation BEFORE the preparing session (durability anchor)", async () => {
    queue.push(VALID_UUID_A);
    const session = await mod.reserveProbeTarget(buildInput());
    const reservationPath = join(
      paths.PROBE_TARGETS_DIR,
      `${session.targetKeyHash}.reservation.json`,
    );
    const sessionPath = join(paths.PROBE_SESSIONS_DIR, `${VALID_UUID_A}.session.json`);
    const { statSync } = await import("fs");
    const rMtime = statSync(reservationPath).mtimeMs;
    const sMtime = statSync(sessionPath).mtimeMs;
    expect(rMtime).toBeLessThanOrEqual(sMtime);
  });

  it("rejects a second reservation for the same target (conflict, throws ProbeSessionConflictError)", async () => {
    queue.push(VALID_UUID_A);
    await mod.reserveProbeTarget(buildInput());
    queue.push(VALID_UUID_B);
    await expect(mod.reserveProbeTarget(buildInput())).rejects.toBeInstanceOf(
      mod.ProbeSessionConflictError,
    );
  });

  it("allows two reservations for two DIFFERENT targets", async () => {
    queue.push(VALID_UUID_A);
    await mod.reserveProbeTarget(buildInput({ serverId: "srv-1" }));
    queue.push(VALID_UUID_B);
    const second = await mod.reserveProbeTarget(buildInput({ serverId: "srv-2" }));
    expect(second.sessionId).toBe(VALID_UUID_B);
  });

  it("persists the canonical targetKeyHash on the session record", async () => {
    queue.push(VALID_UUID_A);
    const session = await mod.reserveProbeTarget(
      buildInput({ serverId: "srv-1", provider: "hetzner", cloudId: "cloud-abc" }),
    );
    expect(session.targetKeyHash).toBe(
      mod.hashProbeTarget({
        serverId: "srv-1",
        provider: "hetzner",
        cloudId: "cloud-abc",
        ip: "1.2.3.4",
      }),
    );
  });

  it("treats a changed IP for the same cloud target as the SAME exclusion identity", async () => {
    queue.push(VALID_UUID_A);
    await mod.reserveProbeTarget(
      buildInput({ cloudId: "cloud-abc", ip: "1.2.3.4" }),
    );
    queue.push(VALID_UUID_B);
    await expect(
      mod.reserveProbeTarget(buildInput({ cloudId: "cloud-abc", ip: "9.9.9.9" })),
    ).rejects.toBeInstanceOf(mod.ProbeSessionConflictError);
  });
});

describe("transitionProbeSession (CAS)", () => {
  let env: IsolatedKastellEnv;
  let mod: ModuleUnderTest;
  let paths: ModulePaths;
  let queue: UUIDQueue;

  beforeEach(async () => {
    env = createIsolatedKastellEnv();
    ({ mod, paths, queue } = await loadModules(env));
    withUUID(mod, queue);
  });

  afterEach(() => {
    mod.resetRandomUUIDDependencyForTesting();
    env.cleanup();
  });

  it("applies a legal transition (preparing -> prepared), increments revision, records history", async () => {
    queue.push(VALID_UUID_A);
    const initial = await mod.reserveProbeTarget(buildInput());

    const next = await mod.transitionProbeSession(
      initial.sessionId,
      { state: "preparing", revision: 1 },
      { toState: "prepared", reason: "payload written" },
    );

    expect(next.state).toBe("prepared");
    expect(next.revision).toBe(2);
    expect(next.history).toHaveLength(1);
    expect(next.history[0]).toMatchObject({
      from: "preparing",
      to: "prepared",
      reason: "payload written",
    });
    expect(typeof next.updatedAt).toBe("string");
  });

  it("rejects a stale session revision (revision mismatch -> ProbeSessionConflictError)", async () => {
    queue.push(VALID_UUID_A);
    const session = await mod.reserveProbeTarget(buildInput());

    await expect(
      mod.transitionProbeSession(
        session.sessionId,
        { state: "preparing", revision: session.revision + 1 },
        { toState: "prepared" },
      ),
    ).rejects.toBeInstanceOf(mod.ProbeSessionConflictError);
  });

  it("rejects a wrong expected state even with the correct revision", async () => {
    queue.push(VALID_UUID_A);
    const session = await mod.reserveProbeTarget(buildInput());

    await expect(
      mod.transitionProbeSession(
        session.sessionId,
        { state: "executing", revision: session.revision },
        { toState: "prepared" },
      ),
    ).rejects.toBeInstanceOf(mod.ProbeSessionConflictError);
  });

  it("rejects an illegal state-machine edge (e.g. preparing -> executed) even with matching revision", async () => {
    queue.push(VALID_UUID_A);
    const session = await mod.reserveProbeTarget(buildInput());

    await expect(
      mod.transitionProbeSession(
        session.sessionId,
        { state: "preparing", revision: session.revision },
        { toState: "executed" },
      ),
    ).rejects.toBeInstanceOf(mod.ProbeSessionInvalidTransitionError);
  });

  it("a matching revision does NOT authorize an edge absent from ALLOWED_PROBE_TRANSITIONS", async () => {
    queue.push(VALID_UUID_A);
    const session = await mod.reserveProbeTarget(buildInput());
    const state: import("../../src/core/probe/types.js").ProbeSessionState = "preparing";
    const targets = mod.ALLOWED_PROBE_TRANSITIONS[state];
    expect(targets).toContain("prepared");
    expect(targets).not.toContain("executed");
    const updated = await mod.transitionProbeSession(
      session.sessionId,
      { state, revision: 1 },
      { toState: "prepared" },
    );
    expect(updated.state).toBe("prepared");
  });

  it("rejects a transition for an unknown session id", async () => {
    await expect(
      mod.transitionProbeSession(
        VALID_UUID_C,
        { state: "preparing", revision: 1 },
        { toState: "prepared" },
      ),
    ).rejects.toBeInstanceOf(mod.ProbeSessionNotFoundError);
  });

  it("stale writer cannot overwrite: a CAS-mismatched transition leaves the durable record unchanged", async () => {
    queue.push(VALID_UUID_A);
    const session = await mod.reserveProbeTarget(buildInput());
    const v2 = await mod.transitionProbeSession(
      session.sessionId,
      { state: "preparing", revision: 1 },
      { toState: "prepared" },
    );
    expect(v2.revision).toBe(2);

    await expect(
      mod.transitionProbeSession(
        session.sessionId,
        { state: "preparing", revision: 1 },
        { toState: "unresolved" },
      ),
    ).rejects.toBeInstanceOf(mod.ProbeSessionConflictError);

    const durable = mod.loadProbeSession(session.sessionId);
    expect(durable.revision).toBe(2);
    expect(durable.state).toBe("prepared");
  });

  it("rolled-back transition removes the reservation AFTER the durable session write", async () => {
    queue.push(VALID_UUID_A);
    const initial = await mod.reserveProbeTarget(buildInput());
    const reservationPath = join(
      paths.PROBE_TARGETS_DIR,
      `${initial.targetKeyHash}.reservation.json`,
    );
    expect(existsSync(reservationPath)).toBe(true);

    let current = initial;
    const walk: Array<{ to: import("../../src/core/probe/types.js").ProbeSessionState }> = [
      { to: "prepared" },
      { to: "executing" },
      { to: "executed" },
      { to: "verifying" },
      { to: "verified" },
      { to: "rollback-pending" },
      { to: "rolling-back" },
      { to: "rolled-back" },
    ];
    for (const step of walk) {
      current = await mod.transitionProbeSession(
        current.sessionId,
        { state: current.state, revision: current.revision },
        { toState: step.to },
      );
    }

    expect(current.state).toBe("rolled-back");
    expect(existsSync(reservationPath)).toBe(false);
  });
});

describe("ALLOWED_PROBE_TRANSITIONS lifecycle graph", () => {
  let env: IsolatedKastellEnv;
  let mod: ModuleUnderTest;

  beforeEach(async () => {
    env = createIsolatedKastellEnv();
    ({ mod } = await loadModules(env));
  });

  afterEach(() => env.cleanup());

  it("contains the canonical 10-state set with terminal states having no outgoing edges", () => {
    expect(Object.keys(mod.ALLOWED_PROBE_TRANSITIONS).sort()).toEqual([
      "executing",
      "executed",
      "preparing",
      "prepared",
      "rolled-back",
      "rolling-back",
      "rollback-pending",
      "unresolved",
      "verified",
      "verifying",
    ].sort());
    expect(mod.ALLOWED_PROBE_TRANSITIONS["rolled-back"]).toEqual([]);
    expect(mod.ALLOWED_PROBE_TRANSITIONS["unresolved"]).toEqual([]);
  });

  it("allows preparing -> prepared or unresolved only", () => {
    expect(mod.ALLOWED_PROBE_TRANSITIONS["preparing"]).toEqual(["prepared", "unresolved"]);
  });

  it("allows verified -> rollback-pending or unresolved", () => {
    expect(mod.ALLOWED_PROBE_TRANSITIONS["verified"]).toEqual(["rollback-pending", "unresolved"]);
  });
});

describe("removeConfirmedPreMutationSession (preparing-only deletion)", () => {
  let env: IsolatedKastellEnv;
  let mod: ModuleUnderTest;
  let paths: ModulePaths;
  let queue: UUIDQueue;

  beforeEach(async () => {
    env = createIsolatedKastellEnv();
    ({ mod, paths, queue } = await loadModules(env));
    withUUID(mod, queue);
  });

  afterEach(() => {
    mod.resetRandomUUIDDependencyForTesting();
    env.cleanup();
  });

  it("deletes the preparing session and the reservation under the reservation lock", async () => {
    queue.push(VALID_UUID_A);
    const session = await mod.reserveProbeTarget(buildInput());
    const sessionPath = join(paths.PROBE_SESSIONS_DIR, `${VALID_UUID_A}.session.json`);
    const reservationPath = join(
      paths.PROBE_TARGETS_DIR,
      `${session.targetKeyHash}.reservation.json`,
    );
    expect(existsSync(sessionPath)).toBe(true);
    expect(existsSync(reservationPath)).toBe(true);

    const facade = mod.createProbeSessionFacade();
    await facade.removeConfirmedPreMutationSession(session);

    expect(existsSync(sessionPath)).toBe(false);
    expect(existsSync(reservationPath)).toBe(false);
  });

  it("refuses to delete a non-preparing session (state machine invariant)", async () => {
    queue.push(VALID_UUID_A);
    const session = await mod.reserveProbeTarget(buildInput());
    const prepared = await mod.transitionProbeSession(
      session.sessionId,
      { state: "preparing", revision: 1 },
      { toState: "prepared" },
    );

    const facade = mod.createProbeSessionFacade();
    await expect(facade.removeConfirmedPreMutationSession(prepared)).rejects.toBeInstanceOf(
      mod.ProbeSessionInvalidTransitionError,
    );

    const sessionPath = join(paths.PROBE_SESSIONS_DIR, `${VALID_UUID_A}.session.json`);
    expect(existsSync(sessionPath)).toBe(true);
  });

  it("prepare cleanup failure remains blocking — when the session file is gone but reservation stays, target stays excluded", async () => {
    queue.push(VALID_UUID_A);
    const session = await mod.reserveProbeTarget(buildInput());
    const sessionPath = join(paths.PROBE_SESSIONS_DIR, `${VALID_UUID_A}.session.json`);
    const reservationPath = join(
      paths.PROBE_TARGETS_DIR,
      `${session.targetKeyHash}.reservation.json`,
    );

    rmSync(sessionPath);
    expect(existsSync(reservationPath)).toBe(true);

    queue.push(VALID_UUID_B);
    await expect(mod.reserveProbeTarget(buildInput())).rejects.toBeInstanceOf(
      mod.ProbeSessionConflictError,
    );
  });

  it("deletion order: session file first, then reservation (while holding reservation lock)", async () => {
    queue.push(VALID_UUID_A);
    const session = await mod.reserveProbeTarget(buildInput());
    const sessionPath = join(paths.PROBE_SESSIONS_DIR, `${VALID_UUID_A}.session.json`);
    const reservationPath = join(
      paths.PROBE_TARGETS_DIR,
      `${session.targetKeyHash}.reservation.json`,
    );

    const facade = mod.createProbeSessionFacade();
    const order: Array<{ session: boolean; reservation: boolean }> = [];
    const sample = () => order.push({
      session: existsSync(sessionPath),
      reservation: existsSync(reservationPath),
    });

    sample();
    await facade.removeConfirmedPreMutationSession(session);
    sample();

    expect(order[0]).toEqual({ session: true, reservation: true });
    expect(order[1]).toEqual({ session: false, reservation: false });
  });
});

describe("releaseProbeReservation (low-level helper)", () => {
  let env: IsolatedKastellEnv;
  let mod: ModuleUnderTest;
  let paths: ModulePaths;
  let queue: UUIDQueue;

  beforeEach(async () => {
    env = createIsolatedKastellEnv();
    ({ mod, paths, queue } = await loadModules(env));
    withUUID(mod, queue);
  });

  afterEach(() => {
    mod.resetRandomUUIDDependencyForTesting();
    env.cleanup();
  });

  it("removes the durable reservation file when sessionId matches", async () => {
    queue.push(VALID_UUID_A);
    const session = await mod.reserveProbeTarget(buildInput());
    const reservationPath = join(
      paths.PROBE_TARGETS_DIR,
      `${session.targetKeyHash}.reservation.json`,
    );
    expect(existsSync(reservationPath)).toBe(true);
    await mod.releaseProbeReservation(session);
    expect(existsSync(reservationPath)).toBe(false);
  });

  it("leaves a foreign reservation alone (does not delete another session's marker)", async () => {
    queue.push(VALID_UUID_A);
    const first = await mod.reserveProbeTarget(buildInput({ serverId: "srv-1" }));
    const firstReservation = join(
      paths.PROBE_TARGETS_DIR,
      `${first.targetKeyHash}.reservation.json`,
    );

    const foreignSession = {
      ...first,
      sessionId: VALID_UUID_C,
      targetKeyHash: mod.hashProbeTarget({
        serverId: "srv-2",
        provider: "hetzner",
        ip: "5.6.7.8",
      }),
    };
    await mod.releaseProbeReservation(foreignSession);

    expect(existsSync(firstReservation)).toBe(true);
  });
});

describe("loadProbeSession + listProbeSessions", () => {
  let env: IsolatedKastellEnv;
  let mod: ModuleUnderTest;
  let paths: ModulePaths;
  let queue: UUIDQueue;

  beforeEach(async () => {
    env = createIsolatedKastellEnv();
    ({ mod, paths, queue } = await loadModules(env));
    withUUID(mod, queue);
  });

  afterEach(() => {
    mod.resetRandomUUIDDependencyForTesting();
    env.cleanup();
  });

  it("loadProbeSession returns the durable record", async () => {
    queue.push(VALID_UUID_A);
    const session = await mod.reserveProbeTarget(buildInput());
    const loaded = mod.loadProbeSession(session.sessionId);
    expect(loaded.sessionId).toBe(VALID_UUID_A);
    expect(loaded.state).toBe("preparing");
  });

  it("loadProbeSession throws ProbeSessionNotFoundError for missing id", () => {
    expect(() => mod.loadProbeSession(VALID_UUID_C)).toThrow(mod.ProbeSessionNotFoundError);
  });

  it("listProbeSessions enumerates every durable session", async () => {
    queue.push(VALID_UUID_A);
    await mod.reserveProbeTarget(buildInput({ serverId: "srv-1" }));
    queue.push(VALID_UUID_B);
    await mod.reserveProbeTarget(buildInput({ serverId: "srv-2" }));

    const all = mod.listProbeSessions();
    const ids = all.map((r) => r.sessionId).sort();
    expect(ids).toEqual([VALID_UUID_A, VALID_UUID_B].sort());
    for (const entry of all) {
      expect(entry.record).not.toBeNull();
    }
  });

  it("listProbeSessions returns reason='json-parse-failed' for a corrupt session file", async () => {
    const corruptPath = join(paths.PROBE_SESSIONS_DIR, "00000000-0000-4000-8000-000000000fff.session.json");
    mkdirSync(paths.PROBE_SESSIONS_DIR, { recursive: true });
    writeFileSync(corruptPath, "{ not json");
    const all = mod.listProbeSessions();
    const corrupt = all.find((r) => r.sessionId === "00000000-0000-4000-8000-000000000fff");
    expect(corrupt).toBeDefined();
    expect(corrupt!.record).toBeNull();
    expect(corrupt!.reason).toBe("json-parse-failed");
  });
});

describe("ProbeSessionFacade", () => {
  let env: IsolatedKastellEnv;
  let mod: ModuleUnderTest;
  let paths: ModulePaths;
  let queue: UUIDQueue;

  beforeEach(async () => {
    env = createIsolatedKastellEnv();
    ({ mod, paths, queue } = await loadModules(env));
    withUUID(mod, queue);
  });

  afterEach(() => {
    mod.resetRandomUUIDDependencyForTesting();
    env.cleanup();
  });

  it("exposes reserve/transition/removeConfirmedPreMutationSession/releaseRolledBackReservation", () => {
    const facade = mod.createProbeSessionFacade();
    expect(typeof facade.reserve).toBe("function");
    expect(typeof facade.transition).toBe("function");
    expect(typeof facade.removeConfirmedPreMutationSession).toBe("function");
    expect(typeof facade.releaseRolledBackReservation).toBe("function");
  });

  it("facade.transition uses the caller's current state and revision (no manual re-pass)", async () => {
    queue.push(VALID_UUID_A);
    const session = await mod.reserveProbeTarget(buildInput());
    const facade = mod.createProbeSessionFacade();

    const next = await facade.transition(session, { toState: "prepared" });
    expect(next.state).toBe("prepared");
    expect(next.revision).toBe(2);
  });

  it("facade.releaseRolledBackReservation removes the reservation file", async () => {
    queue.push(VALID_UUID_A);
    const session = await mod.reserveProbeTarget(buildInput());
    const facade = mod.createProbeSessionFacade();
    await facade.releaseRolledBackReservation(session);
    const reservationPath = join(
      paths.PROBE_TARGETS_DIR,
      `${session.targetKeyHash}.reservation.json`,
    );
    expect(existsSync(reservationPath)).toBe(false);
  });
});

describe("paths constants", () => {
  let env: IsolatedKastellEnv;
  let paths: ModulePaths;

  beforeEach(async () => {
    env = createIsolatedKastellEnv();
    ({ paths } = await loadModules(env));
  });

  afterEach(() => env.cleanup());

  it("PROBE_SESSIONS_DIR lives under KASTELL_DIR/probe-sessions", () => {
    expect(paths.PROBE_SESSIONS_DIR.endsWith("probe-sessions")).toBe(true);
    expect(paths.PROBE_SESSIONS_DIR.startsWith(env.dir)).toBe(true);
  });

  it("PROBE_TARGETS_DIR lives under PROBE_SESSIONS_DIR/targets", () => {
    expect(paths.PROBE_TARGETS_DIR).toBe(join(paths.PROBE_SESSIONS_DIR, "targets"));
  });
});

describe("transitionProbeSession — lastError message redaction (review P144 Important #1)", () => {
  let env: IsolatedKastellEnv;
  let mod: ModuleUnderTest;
  let paths: ModulePaths;
  let queue: UUIDQueue;

  beforeEach(async () => {
    env = createIsolatedKastellEnv();
    ({ mod, paths, queue } = await loadModules(env));
    withUUID(mod, queue);
  });

  afterEach(() => {
    mod.resetRandomUUIDDependencyForTesting();
    env.cleanup();
  });

  const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZWNyZXQifQ.signature_part_here";

  it("redacts JWTs from the persisted lastError.message before encryption", async () => {
    queue.push(VALID_UUID_A);
    const session = await mod.reserveProbeTarget(buildInput());
    const next = await mod.transitionProbeSession(
      session.sessionId,
      { state: "preparing", revision: session.revision },
      { toState: "prepared", reason: `probe-startup failed: token=${JWT}` },
    );
    // The JWT must not survive into lastError.message verbatim.
    expect(next.lastError?.message).toBeDefined();
    expect(next.lastError?.message).not.toContain(JWT);
    expect(next.lastError?.message).toContain("[REDACTED]");
    expect(next.lastError?.message).toContain("probe-startup failed");
  });

  it("redacts JWT-prefixed strings embedded in a longer reason (substring match)", async () => {
    queue.push(VALID_UUID_B);
    const session = await mod.reserveProbeTarget(buildInput());
    const inner = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyMSJ9.signature_part_two";
    const next = await mod.transitionProbeSession(
      session.sessionId,
      { state: "preparing", revision: session.revision },
      { toState: "prepared", reason: `embedded credential: ${inner} end` },
    );
    expect(next.lastError?.message).not.toContain(inner);
    expect(next.lastError?.message).toContain("[REDACTED]");
    expect(next.lastError?.message).toContain("embedded credential:");
    expect(next.lastError?.message).toContain("end");
  });

  it("preserves plain reason strings (no false positives)", async () => {
    queue.push(VALID_UUID_C);
    const session = await mod.reserveProbeTarget(buildInput());
    const next = await mod.transitionProbeSession(
      session.sessionId,
      { state: "preparing", revision: session.revision },
      { toState: "prepared", reason: "payload written" },
    );
    expect(next.lastError?.message).toBe("payload written");
  });
});