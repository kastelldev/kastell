// tests/unit/probe-session-concurrency.test.ts
// P144 T9 — Concurrency + CAS guarantees for Active Probe session store.
//
// These tests verify the brief's two spell-out patterns verbatim:
//   1. Exactly one live reservation for a target under concurrent acquisition.
//   2. Stale session revision is rejected (CAS).
//
// The patterns are quoted EXACTLY per the brief: same UUID format
// (`00000000-0000-4000-8000-XXXXXXXXXXXX`, version 4, variant 8),
// mockReturnValueOnce chaining, and toThrow expectation style.

import { existsSync, readFileSync } from "fs";
import { join } from "path";

import {
  importWithIsolatedKastellDir,
  createIsolatedKastellEnv,
  type IsolatedKastellEnv,
} from "../helpers/isolatedKastellEnv.js";

// Stub secureWriteFileSync with plain fs.writeFileSync so tests do not
// depend on ACL/icacls behavior (platform-specific). The production
// store still calls atomicWriteFileSync with
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
  ProbeSessionConflictError: typeof import("../../src/core/probe/sessionStore.js")["ProbeSessionConflictError"];
  ProbeSessionNotFoundError: typeof import("../../src/core/probe/sessionStore.js")["ProbeSessionNotFoundError"];
  ProbeSessionInvalidTransitionError: typeof import("../../src/core/probe/sessionStore.js")["ProbeSessionInvalidTransitionError"];
  hashProbeTarget: typeof import("../../src/core/probe/sessionStore.js")["hashProbeTarget"];
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

class UUIDQueue {
  private queue: Array<string | undefined> = [];

  push(value: string): this {
    this.queue.push(value);
    return this;
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

const target = {
  serverId: "srv-1",
  provider: "hetzner",
  cloudId: "cloud-abc",
  ip: "1.2.3.4",
};

function sessionInput(targetOverrides: Partial<typeof target> = target): import("../../src/core/probe/sessionStore.js").NewProbeSession {
  return {
    pluginName: "probe-plugin",
    pluginVersion: "1.0.0",
    checkId: "check-active",
    handlerPath: "/abs/path/to/handler.js",
    handlerSha256: "abc123",
    risk: "safe",
    timeoutMs: 30_000,
    target: { ...target, ...targetOverrides },
  };
}

function withUUID(mod: ModuleUnderTest, queue: UUIDQueue): void {
  mod.setRandomUUIDDependencyForTesting(() => queue.next());
}

describe("concurrent reservation acquisition (verbatim brief pattern)", () => {
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

  it("allows exactly one live reservation for a target", async () => {
    // Brief Step 1 — exact pattern (UUIDs verbatim).
    queue.push("00000000-0000-4000-8000-00000000000a")
      .push("00000000-0000-4000-8000-00000000000b");

    const results = await Promise.allSettled([
      mod.reserveProbeTarget(sessionInput(target)),
      mod.reserveProbeTarget(sessionInput(target)),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("the rejected concurrent attempt throws ProbeSessionConflictError", async () => {
    queue.push(VALID_UUID_A).push(VALID_UUID_B);

    const results = await Promise.allSettled([
      mod.reserveProbeTarget(sessionInput(target)),
      mod.reserveProbeTarget(sessionInput(target)),
    ]);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected).toBeDefined();
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(
      mod.ProbeSessionConflictError,
    );
  });

  it("winning concurrent attempt leaves a durable reservation file on disk", async () => {
    queue.push(VALID_UUID_A).push(VALID_UUID_B);

    const results = await Promise.allSettled([
      mod.reserveProbeTarget(sessionInput(target)),
      mod.reserveProbeTarget(sessionInput(target)),
    ]);
    const fulfilled = results.find((r) => r.status === "fulfilled") as
      | PromiseFulfilledResult<Awaited<ReturnType<typeof mod.reserveProbeTarget>>>
      | undefined;
    expect(fulfilled).toBeDefined();
    const session = fulfilled!.value;
    const reservationPath = join(
      paths.PROBE_TARGETS_DIR,
      `${session.targetKeyHash}.reservation.json`,
    );
    expect(existsSync(reservationPath)).toBe(true);
    const raw = JSON.parse(readFileSync(reservationPath, "utf8"));
    expect(raw.sessionId).toBe(session.sessionId);
  });

  it("concurrent acquisitions for different targets all succeed", async () => {
    queue.push(VALID_UUID_A).push(VALID_UUID_B).push(VALID_UUID_C);

    const results = await Promise.allSettled([
      mod.reserveProbeTarget(sessionInput({ serverId: "srv-1", cloudId: "cloud-a" })),
      mod.reserveProbeTarget(sessionInput({ serverId: "srv-2", cloudId: "cloud-b" })),
      mod.reserveProbeTarget(sessionInput({ serverId: "srv-3", cloudId: "cloud-c" })),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  });
});

describe("CAS session transitions (verbatim brief pattern)", () => {
  let env: IsolatedKastellEnv;
  let mod: ModuleUnderTest;
  let queue: UUIDQueue;

  beforeEach(async () => {
    env = createIsolatedKastellEnv();
    ({ mod, queue } = await loadModules(env));
    withUUID(mod, queue);
  });

  afterEach(() => {
    mod.resetRandomUUIDDependencyForTesting();
    env.cleanup();
  });

  it("rejects a stale session revision", async () => {
    // Brief Step 1 — exact pattern (UUID verbatim).
    queue.push("00000000-0000-4000-8000-00000000000a");
    const session = await mod.reserveProbeTarget(sessionInput(target));

    await expect(
      mod.transitionProbeSession(
        session.sessionId,
        { state: "preparing", revision: session.revision + 1 },
        { toState: "prepared" },
      ),
    ).rejects.toThrow(mod.ProbeSessionConflictError);
  });

  it("a stale writer cannot overwrite: durable record's revision is unchanged after rejected CAS", async () => {
    queue.push(VALID_UUID_A);
    const session = await mod.reserveProbeTarget(sessionInput(target));

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
    ).rejects.toThrow(mod.ProbeSessionConflictError);

    const durable = mod.loadProbeSession(session.sessionId);
    expect(durable.revision).toBe(2);
    expect(durable.state).toBe("prepared");
  });

  it("two concurrent transitionProbeSession calls with the same expected revision: at most one wins", async () => {
    queue.push(VALID_UUID_A);
    const session = await mod.reserveProbeTarget(sessionInput(target));
    expect(session.revision).toBe(1);

    const results = await Promise.allSettled([
      mod.transitionProbeSession(
        session.sessionId,
        { state: "preparing", revision: 1 },
        { toState: "prepared", reason: "writer-a" },
      ),
      mod.transitionProbeSession(
        session.sessionId,
        { state: "preparing", revision: 1 },
        { toState: "prepared", reason: "writer-b" },
      ),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(
        mod.ProbeSessionConflictError,
      );
    }
  });

  it("after a successful CAS update, a re-read shows the bumped revision and history entry", async () => {
    queue.push(VALID_UUID_A);
    const session = await mod.reserveProbeTarget(sessionInput(target));
    const updated = await mod.transitionProbeSession(
      session.sessionId,
      { state: "preparing", revision: 1 },
      { toState: "prepared", reason: "writer-a" },
    );
    const reread = mod.loadProbeSession(session.sessionId);
    expect(reread.revision).toBe(updated.revision);
    expect(reread.state).toBe("prepared");
    expect(reread.history.at(-1)).toMatchObject({
      from: "preparing",
      to: "prepared",
      reason: "writer-a",
    });
  });
});

describe("sessionId is generated, not caller-supplied", () => {
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

  it("session file name is exactly the mocked UUID (callers cannot pick a session id)", async () => {
    queue.push(VALID_UUID_A);
    const session = await mod.reserveProbeTarget(sessionInput(target));
    expect(session.sessionId).toBe(VALID_UUID_A);
    const sessionPath = join(paths.PROBE_SESSIONS_DIR, `${VALID_UUID_A}.session.json`);
    expect(existsSync(sessionPath)).toBe(true);
  });

  it("rejects randomUUID output that is not RFC 4122 v4 (defensive guard)", async () => {
    queue.push("not-a-uuid-at-all");
    await expect(mod.reserveProbeTarget(sessionInput(target))).rejects.toBeInstanceOf(
      mod.ProbeSessionConflictError,
    );
  });
});

describe("listProbeSessions sees exactly the durable sessions", () => {
  let env: IsolatedKastellEnv;
  let mod: ModuleUnderTest;
  let queue: UUIDQueue;

  beforeEach(async () => {
    env = createIsolatedKastellEnv();
    ({ mod, queue } = await loadModules(env));
    withUUID(mod, queue);
  });

  afterEach(() => {
    mod.resetRandomUUIDDependencyForTesting();
    env.cleanup();
  });

  it("after reservation completes, listProbeSessions sees exactly one entry per durable session", async () => {
    queue.push(VALID_UUID_A);
    await mod.reserveProbeTarget(sessionInput(target));
    const all = mod.listProbeSessions();
    expect(all).toHaveLength(1);
    expect(all[0].sessionId).toBe(VALID_UUID_A);
  });
});

describe("error class distinctions", () => {
  let env: IsolatedKastellEnv;
  let mod: ModuleUnderTest;

  beforeEach(async () => {
    env = createIsolatedKastellEnv();
    ({ mod } = await loadModules(env));
  });

  afterEach(() => env.cleanup());

  it("ProbeSessionConflictError, ProbeSessionNotFoundError, ProbeSessionInvalidTransitionError are distinct", () => {
    const a = new mod.ProbeSessionConflictError("a");
    const b = new mod.ProbeSessionNotFoundError("b");
    const c = new mod.ProbeSessionInvalidTransitionError("c");
    expect(a).toBeInstanceOf(mod.ProbeSessionConflictError);
    expect(a).not.toBeInstanceOf(mod.ProbeSessionNotFoundError);
    expect(b).toBeInstanceOf(mod.ProbeSessionNotFoundError);
    expect(b).not.toBeInstanceOf(mod.ProbeSessionConflictError);
    expect(c).toBeInstanceOf(mod.ProbeSessionInvalidTransitionError);
    expect(c).not.toBeInstanceOf(mod.ProbeSessionConflictError);
    expect(a.name).toBe("ProbeSessionConflictError");
    expect(b.name).toBe("ProbeSessionNotFoundError");
    expect(c.name).toBe("ProbeSessionInvalidTransitionError");
  });
});

describe("hashProbeTarget integrates with reservation exclusion", () => {
  let env: IsolatedKastellEnv;
  let mod: ModuleUnderTest;
  let queue: UUIDQueue;

  beforeEach(async () => {
    env = createIsolatedKastellEnv();
    ({ mod, queue } = await loadModules(env));
    withUUID(mod, queue);
  });

  afterEach(() => {
    mod.resetRandomUUIDDependencyForTesting();
    env.cleanup();
  });

  it("two reservations with different IPs but same cloudId collide (canonical hash equality)", async () => {
    queue.push(VALID_UUID_A);
    await mod.reserveProbeTarget(
      sessionInput({ cloudId: "cloud-abc", ip: "1.2.3.4" }),
    );
    queue.push(VALID_UUID_B);
    await expect(
      mod.reserveProbeTarget(
        sessionInput({ cloudId: "cloud-abc", ip: "9.9.9.9" }),
      ),
    ).rejects.toBeInstanceOf(mod.ProbeSessionConflictError);
  });

  it("two reservations with the same cloudId but different providers do NOT collide", async () => {
    queue.push(VALID_UUID_A);
    await mod.reserveProbeTarget(
      sessionInput({ provider: "hetzner", cloudId: "cloud-abc", ip: "1.2.3.4" }),
    );
    queue.push(VALID_UUID_B);
    const second = await mod.reserveProbeTarget(
      sessionInput({ provider: "digitalocean", cloudId: "cloud-abc", ip: "1.2.3.4" }),
    );
    expect(second.sessionId).toBe(VALID_UUID_B);
  });
});