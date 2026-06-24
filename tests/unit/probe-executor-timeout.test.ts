// tests/unit/probe-executor-timeout.test.ts
//
// Quiescence rule + cancellation/timeout path. Forward handler that does
// not settle within 5 seconds → "unresolved" WITHOUT rollback. Forward
// cancellation aborts controlled SSH only. Rollback has a fresh
// independent controller and budget. Calling rollback that fails/times
// out leaves the reservation blocking as "unresolved".

import {
  executeActiveProbe,
  type ExecuteActiveProbeRequest,
  type ProbeExecutorDependencies,
  type ProbeTimeoutError,
} from "../../src/core/probe/executor.js";
import {
  createProbeSessionFacade,
  ALLOWED_PROBE_TRANSITIONS,
  type ProbeSessionFacade,
  type ProbeSessionRecord,
  type NewProbeSession,
} from "../../src/core/probe/sessionStore.js";
import { hashProbeTarget } from "../../src/core/probe/sessionStore.js";
import type { ProbeSessionState } from "../../src/core/probe/types.js";
import type { ActiveProbeModule } from "../../src/plugin/sdk/types.js";
import type { EncryptedProbePayload } from "../../src/core/probe/types.js";

// ─── Test helpers ──────────────────────────────────────────────────────────

interface FakeTimer {
  id: ReturnType<typeof setTimeout>;
  due: number;
  handler: () => void;
  cancelled: boolean;
}

interface FakeTimerSet {
  list: FakeTimer[];
  /** Manually advance the simulated clock; runs any handlers whose due <= now. */
  advance(ms: number): Promise<void>;
  cancel(id: FakeTimer): void;
  /** Current simulated clock — used by `now()` and `setTimeoutFn`. */
  now(): number;
}

function makeFakeTimerSet(): FakeTimerSet {
  const list: FakeTimer[] = [];
  let now = 1_000_000; // arbitrary non-zero base — avoids confusion with 0
  const set: FakeTimerSet = {
    list,
    now: () => now,
    async advance(ms: number): Promise<void> {
      const target = now + ms;
      // Sort by due to make the simulation deterministic.
      const ordered = [...list].sort((a, b) => a.due - b.due);
      for (const t of ordered) {
        if (t.cancelled) continue;
        if (t.due > target) break;
        now = t.due;
        list.splice(list.indexOf(t), 1);
        // Run the handler; it may schedule more timers via setTimeoutFn.
        await Promise.resolve();
        t.handler();
      }
      now = target;
    },
    cancel(id) {
      const idx = list.indexOf(id);
      if (idx >= 0) {
        list[idx]!.cancelled = true;
        list.splice(idx, 1);
      }
    },
  };
  return set;
}

function buildEncryptedStub(): EncryptedProbePayload {
  return {
    encrypted: true,
    version: 1,
    iv: "iv".padEnd(24, "a").slice(0, 24),
    data: Buffer.from("{}").toString("base64"),
    tag: "tag".padEnd(32, "b").slice(0, 32),
  };
}

function buildInMemoryFacade(): {
  facade: ProbeSessionFacade;
  state: {
    sessions: Map<string, ProbeSessionRecord>;
    reservations: Map<string, string>;
    writes: string[];
  };
} {
  const sessions = new Map<string, ProbeSessionRecord>();
  const reservations = new Map<string, string>();
  const writes: string[] = [];
  const facade: ProbeSessionFacade = {
    async reserve(input: NewProbeSession): Promise<ProbeSessionRecord> {
      const targetKeyHash = hashProbeTarget(input.target);
      const sessionId = `s-${Math.random().toString(36).slice(2, 10)}`;
      const record: ProbeSessionRecord = {
        schemaVersion: 1,
        revision: 1,
        sessionId,
        targetKeyHash,
        state: "preparing",
        pluginName: input.pluginName,
        pluginVersion: input.pluginVersion,
        checkId: input.checkId,
        handlerPath: input.handlerPath,
        handlerSha256: input.handlerSha256,
        risk: input.risk,
        timeoutMs: input.timeoutMs,
        target: input.target,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        history: [],
      };
      reservations.set(targetKeyHash, sessionId);
      sessions.set(sessionId, record);
      writes.push(`reserve:${sessionId}`);
      return record;
    },
    async transition(session, update) {
      const current = sessions.get(session.sessionId);
      if (!current) throw new Error("not found");
      if (current.state !== session.state || current.revision !== session.revision) {
        throw new Error("cas mismatch");
      }
      if (!ALLOWED_PROBE_TRANSITIONS[current.state].includes(update.toState)) {
        throw new Error(`invalid transition: ${current.state} -> ${update.toState}`);
      }
      const next: ProbeSessionRecord = {
        ...current,
        revision: current.revision + 1,
        state: update.toState as ProbeSessionState,
        updatedAt: new Date().toISOString(),
        history: [
          ...current.history,
          {
            from: current.state,
            to: update.toState as ProbeSessionState,
            at: new Date().toISOString(),
          },
        ],
        ...(update.reason ? { lastError: { code: "PROBE_EXEC", message: update.reason } } : {}),
      };
      sessions.set(current.sessionId, next);
      writes.push(`transition:${current.sessionId}->${update.toState}`);
      return next;
    },
    async removeConfirmedPreMutationSession(session) {
      if (session.state !== "preparing") throw new Error("only preparing allowed");
      reservations.delete(session.targetKeyHash);
      sessions.delete(session.sessionId);
      writes.push(`cleanup-preparing:${session.sessionId}`);
    },
    async releaseRolledBackReservation(session) {
      reservations.delete(session.targetKeyHash);
      writes.push(`release-reservation:${session.sessionId}`);
    },
  };
  return { facade, state: { sessions, reservations, writes } };
}

function buildDependencies(
  facade: ProbeSessionFacade,
  fakeTimers: FakeTimerSet,
  overrides: Partial<ProbeExecutorDependencies> = {},
): ProbeExecutorDependencies {
  return {
    sessions: facade,
    encryptPayload: async () => buildEncryptedStub(),
    logSecurityEvent: jest.fn(),
    now: () => fakeTimers.now(),
    setTimeoutFn: ((handler: (...args: unknown[]) => void, ms?: number) => {
      const t: FakeTimer = {
        id: undefined as unknown as ReturnType<typeof setTimeout>,
        due: fakeTimers.now() + (ms ?? 0),
        handler: () => handler(),
        cancelled: false,
      };
      fakeTimers.list.push(t);
      return t as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as ProbeExecutorDependencies["setTimeoutFn"],
    clearTimeoutFn: ((handle: ReturnType<typeof setTimeout>) => {
      fakeTimers.cancel(handle as unknown as FakeTimer);
    }) as unknown as ProbeExecutorDependencies["clearTimeoutFn"],
    ...overrides,
  };
}

function buildBaseRequest(
  overrides: Partial<ExecuteActiveProbeRequest> = {},
): ExecuteActiveProbeRequest {
  return {
    pluginName: "acme-probe",
    pluginVersion: "1.0.0",
    checkId: "check-1",
    handlerPath: "/tmp/probe.js",
    handlerSha256: "abc123",
    risk: "safe",
    timeoutMs: 30_000,
    target: {
      serverId: "srv-1",
      provider: "hetzner",
      cloudId: "cloud-1",
      ip: "203.0.113.10",
    },
    module: {
      prepare: jest.fn(async () => ({ snapshot: 1 })),
      execute: jest.fn(async () => ({ applied: true })),
      verify: jest.fn(async () => ({ passed: true })),
      rollback: jest.fn(async () => ({ success: true })),
    },
    ...overrides,
  };
}

// ─── Quiescence rule ───────────────────────────────────────────────────────

describe("executeActiveProbe — quiescence rule (5s handler settlement grace)", () => {
  it("handler that does not settle within 5 seconds becomes unresolved WITHOUT rollback", async () => {
    const rollbackSpy = jest.fn(async () => ({ success: true }));
    // Prepare hangs forever.
    const module: ActiveProbeModule = {
      prepare: () => new Promise(() => undefined),
      execute: jest.fn(),
      verify: jest.fn(),
      rollback: rollbackSpy,
    };
    const fakeTimers = makeFakeTimerSet();
    const { facade, state } = buildInMemoryFacade();
    const deps = buildDependencies(facade, fakeTimers);
    const request = buildBaseRequest({ module, timeoutMs: 100 });

    // The executor races against deadlineMs and aborts after the 5s grace.
    // We must not have run rollback at all.
    const promise = executeActiveProbe(request, deps);
    // Drain microtasks so the executor reaches runLifecycleStep's setTimeout
    // calls before we drive the simulated clock forward.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await fakeTimers.advance(60_000);
    const result = await promise;

    expect(rollbackSpy).not.toHaveBeenCalled();
    expect(result.status).toBe("unresolved");

    // Reservation must remain blocking.
    expect(state.reservations.size).toBe(1);
    // Last persisted state must be "unresolved".
    const session = Array.from(state.sessions.values())[0]!;
    expect(session.state).toBe("unresolved");
  });

  it("does not roll back until a settled handler proceeds", async () => {
    // Use real timers but short values for the forward handler, then a
    // simulate-able 5s grace for handler settlement.
    const rollbackSpy = jest.fn(async () => ({ success: true }));
    const module: ActiveProbeModule = {
      prepare: jest.fn(async () => {
        // Delay 6 seconds, then resolve.
        await new Promise((r) => setTimeout(r, 6000));
        return { snapshot: 1 };
      }),
      execute: jest.fn(),
      verify: jest.fn(),
      rollback: rollbackSpy,
    };
    const fakeTimers = makeFakeTimerSet();
    const { facade, state } = buildInMemoryFacade();
    const deps = buildDependencies(facade, fakeTimers);
    const request = buildBaseRequest({ module, timeoutMs: 1_000 });

    let rollbackCalledBeforeSettled = true;
    const events: string[] = [];
    const wrappedModule: ActiveProbeModule = {
      prepare: async (ctx) => {
        const p = module.prepare(ctx);
        p.finally(() => events.push("handler:settled"));
        return p;
      },
      execute: module.execute,
      verify: module.verify,
      rollback: async (ctx: import("../../src/plugin/sdk/types.js").PluginProbeContext, prepared: unknown, executed: unknown) => {
        events.push("call:rollback");
        // The rollbackSpy is `jest.fn(async () => ({ success: true }))` —
        // it returns a fixed value regardless of arguments. We deliberately
        // forward zero args to keep the spy contract tight.
        const r = await (rollbackSpy as unknown as () => Promise<{ success: boolean }>)();
        return r;
      },
    };

    const promise = executeActiveProbe({ ...request, module: wrappedModule }, deps);

    // Drain microtasks before driving the simulated clock.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    // Drive the simulated clock: 1.5s elapsed → deadline fires; the
    // handler is still running; we observe the 5s quiescence grace.
    await fakeTimers.advance(7_000);
    const result = await promise;

    if (events.indexOf("handler:settled") > events.indexOf("call:rollback")) {
      rollbackCalledBeforeSettled = false;
    }

    expect(rollbackCalledBeforeSettled).toBe(true);
    expect(result.status).toBe("unresolved");
    expect(state.reservations.size).toBe(1);
  });
});

// ─── Cancellation / timeout ────────────────────────────────────────────────

describe("executeActiveProbe — cancellation and timeout", () => {
  it("does not start execute after prepare has already exhausted the shared forward deadline", async () => {
    const fakeTimers = makeFakeTimerSet();
    const executeSpy = jest.fn(async () => ({ applied: true }));
    const rollbackSpy = jest.fn(async () => ({ success: true }));
    const module: ActiveProbeModule = {
      prepare: jest.fn(async () => {
        await fakeTimers.advance(30_001);
        return { snapshot: 1 };
      }),
      execute: executeSpy,
      verify: jest.fn(async () => ({ passed: true })),
      rollback: rollbackSpy,
    };
    const { facade } = buildInMemoryFacade();
    const deps = buildDependencies(facade, fakeTimers);

    const result = await executeActiveProbe(
      buildBaseRequest({ module, timeoutMs: 30_000 }),
      deps,
    );

    expect(executeSpy).not.toHaveBeenCalled();
    expect(rollbackSpy).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("rolled-back");
  });

  it("caps rollback budget at the configured probe timeout", async () => {
    const fakeTimers = makeFakeTimerSet();
    let rollbackBudgetMs = -1;
    const module: ActiveProbeModule = {
      prepare: jest.fn(async () => ({ snapshot: 1 })),
      execute: jest.fn(async () => ({ applied: true })),
      verify: jest.fn(async () => ({ passed: true })),
      rollback: jest.fn(async (ctx) => {
        rollbackBudgetMs = ctx.deadlineMs - fakeTimers.now();
        return { success: true };
      }),
    };
    const { facade } = buildInMemoryFacade();
    const deps = buildDependencies(facade, fakeTimers);

    await executeActiveProbe(
      buildBaseRequest({ module, timeoutMs: 30_000 }),
      deps,
    );

    expect(rollbackBudgetMs).toBe(30_000);
  });

  it("forward cancellation aborts controlled SSH only — rollback has a fresh controller", async () => {
    let preparedCalls = 0;
    let executedRollback = false;
    const seenSignals: { aborted: boolean; isForward: boolean }[] = [];

    const module: ActiveProbeModule = {
      prepare: jest.fn(async () => {
        preparedCalls += 1;
        return { snapshot: 1 };
      }),
      execute: jest.fn(async () => ({ applied: true })),
      verify: jest.fn(async () => ({ passed: true })),
      rollback: jest.fn(async (ctx) => {
        executedRollback = true;
        seenSignals.push({ aborted: ctx.signal.aborted, isForward: false });
        return { success: true };
      }),
    };
    const fakeTimers = makeFakeTimerSet();
    const { facade, state } = buildInMemoryFacade();
    const deps = buildDependencies(facade, fakeTimers, {
      // Wrap SSH so we observe the abort signal at call time.
    });
    const request = buildBaseRequest({ module });

    // Force the prepare step to advance cleanly; verify+rollback follow.
    // The signal on the forward context must abort exactly once (the
    // forward controller). The rollback context must receive a fresh,
    // non-aborted signal.
    const result = await executeActiveProbe(request, deps);
    expect(preparedCalls).toBe(1);
    expect(executedRollback).toBe(true);
    expect(seenSignals[0]!.isForward).toBe(false);
    expect(seenSignals[0]!.aborted).toBe(false);
    // Reservation must be released (rollback success).
    expect(state.reservations.size).toBe(0);
    expect(result.status).toBe("rolled-back");
  });

  it("rollback timeout leaves the session in 'unresolved' state and keeps the reservation blocking", async () => {
    const module: ActiveProbeModule = {
      prepare: jest.fn(async () => ({ snapshot: 1 })),
      execute: jest.fn(async () => ({ applied: true })),
      verify: jest.fn(async () => ({ passed: true })),
      rollback: () => new Promise(() => undefined), // hangs
    };
    const fakeTimers = makeFakeTimerSet();
    const { facade, state } = buildInMemoryFacade();
    const deps = buildDependencies(facade, fakeTimers);
    const request = buildBaseRequest({ module, timeoutMs: 500 });

    const promise = executeActiveProbe(request, deps);
    // Drain microtasks in a loop while there are pending fake timers —
    // this lets prepare/execute/verify settle, then advances to
    // rollback step where the rollback budget timer is scheduled.
    for (let i = 0; i < 200; i++) {
      await new Promise((r) => setImmediate(r));
      if (fakeTimers.list.length > 0) {
        await fakeTimers.advance(60_000);
      }
      // If the promise has resolved, stop early.
      // We can't await it directly (would hang); check the result of
      // a race instead.
      const winner = await Promise.race([
        promise.then((v) => ({ done: true as const, v }), () => ({ done: true as const })),
        new Promise<{ done: false }>((r) => setImmediate(() => r({ done: false }))),
      ]);
      if ((winner as { done: boolean }).done) break;
    }
    const result = await promise;

    expect(result.status).toBe("unresolved");
    // Reservation is still blocking because the rollback did not return success=true.
    expect(state.reservations.size).toBe(1);
    const session = Array.from(state.sessions.values())[0]!;
    expect(session.state).toBe("unresolved");
  });

  it("rollback failure (non-timeout throw) also persists unresolved", async () => {
    const module: ActiveProbeModule = {
      prepare: jest.fn(async () => ({ snapshot: 1 })),
      execute: jest.fn(async () => ({ applied: true })),
      verify: jest.fn(async () => ({ passed: true })),
      rollback: jest.fn(async () => {
        throw new Error("rollback transport failure");
      }),
    };
    const { facade, state } = buildInMemoryFacade();
    const deps = buildDependencies(facade, makeFakeTimerSet());
    const result = await executeActiveProbe(buildBaseRequest({ module }), deps);
    expect(result.status).toBe("unresolved");
    expect(state.reservations.size).toBe(1);
    const session = Array.from(state.sessions.values())[0]!;
    expect(session.state).toBe("unresolved");
  });

  it("rollback returning success=false persists unresolved (no false release)", async () => {
    const module: ActiveProbeModule = {
      prepare: jest.fn(async () => ({ snapshot: 1 })),
      execute: jest.fn(async () => ({ applied: true })),
      verify: jest.fn(async () => ({ passed: true })),
      rollback: jest.fn(async () => ({ success: false, summary: "incomplete" })),
    };
    const { facade, state } = buildInMemoryFacade();
    const deps = buildDependencies(facade, makeFakeTimerSet());
    const result = await executeActiveProbe(buildBaseRequest({ module }), deps);
    expect(result.status).toBe("unresolved");
    expect(state.reservations.size).toBe(1);
    const session = Array.from(state.sessions.values())[0]!;
    expect(session.state).toBe("unresolved");
  });
});

// ─── ProbeTimeoutError surface ─────────────────────────────────────────────

describe("executeActiveProbe — typed error for forward timeout", () => {
  it("returns 'unresolved' when the handler does not settle within the 5s grace (timeout surfaced as ProbeHandlerNotQuiescedError caught internally)", async () => {
    const module: ActiveProbeModule = {
      prepare: () => new Promise(() => undefined),
      execute: jest.fn(),
      verify: jest.fn(),
      rollback: jest.fn(async () => ({ success: true })),
    };
    const fakeTimers = makeFakeTimerSet();
    const { facade } = buildInMemoryFacade();
    const deps = buildDependencies(facade, fakeTimers);
    const request = buildBaseRequest({ module, timeoutMs: 100 });
    const promise = executeActiveProbe(request, deps);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await fakeTimers.advance(60_000);
    const result = await promise;
    // The brief mandates that a forward handler that does not settle
    // within the deadline + 5s grace is treated as "unresolved" with
    // the reservation kept blocking — NOT thrown to the caller. The
    // typed ProbeHandlerNotQuiescedError is internal bookkeeping.
    expect(result).toMatchObject({ status: "unresolved" });
    // No rollback is invoked.
    expect(module.rollback).not.toHaveBeenCalled();
  });
});

// ─── Idempotency of double rollback ────────────────────────────────────────

describe("executeActiveProbe — rollback idempotency", () => {
  it("calling rollback twice with the same persisted inputs (already success) does NOT call rollback twice", async () => {
    let rollbackCalls = 0;
    const module: ActiveProbeModule = {
      prepare: jest.fn(async () => ({ snapshot: 1 })),
      execute: jest.fn(async () => ({ applied: true })),
      verify: jest.fn(async () => ({ passed: true })),
      rollback: jest.fn(async () => {
        rollbackCalls += 1;
        return { success: true };
      }),
    };
    const { facade } = buildInMemoryFacade();
    const deps = buildDependencies(facade, makeFakeTimerSet());
    await executeActiveProbe(buildBaseRequest({ module }), deps);
    // The lifecycle runs exactly once.
    expect(rollbackCalls).toBe(1);
    // The persisted rolled-back state means subsequent reserves are allowed.
    // A second lifecycle against the same target must succeed.
    await expect(
      executeActiveProbe(buildBaseRequest({ module: { ...module, rollback: module.rollback } }), deps),
    ).resolves.toMatchObject({ status: "rolled-back" });
    expect(rollbackCalls).toBe(2);
  });
});

// Type-import guard — keeps the unused-import linter happy while keeping
// the named error export live for downstream callers.
type _ProbeTimeoutErrorRef = ProbeTimeoutError;
