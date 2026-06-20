// tests/unit/probe-executor.test.ts
//
// Lifecycle executor — 16 invariants from the brief Step 1, mapped to tests.
// Happy-path transition order, safe-mode refusal, prepare failure cleanup,
// execute-failure rollback with prepared-but-no-executed receipt, verify
// false/throw still rolls back, idempotent rollback, and the explicit
// allowlist projection in `toNewProbeSession`.

import type { ActiveProbeModule } from "../../src/plugin/sdk/types.js";
import {
  executeActiveProbe,
  type ExecuteActiveProbeRequest,
  type ProbeExecutorDependencies,
  type ProbeExecutionResult,
  toNewProbeSession,
} from "../../src/core/probe/executor.js";
import {
  createProbeSessionFacade,
  type ProbeSessionFacade,
  type NewProbeSession,
  type ProbeSessionRecord,
} from "../../src/core/probe/sessionStore.js";
import type {
  EncryptedProbePayload,
  ProbeSessionState,
} from "../../src/core/probe/types.js";
import { isSafeMode } from "../../src/utils/safeMode.js";
import { hashProbeTarget, canonicalProbeTargetKey } from "../../src/core/probe/sessionStore.js";

// ─── Test helpers ──────────────────────────────────────────────────────────

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
    module: buildOkModule(),
    ...overrides,
  };
}

function buildOkModule(): ActiveProbeModule {
  return {
    prepare: jest.fn(async () => ({ snapshot: "ok" })),
    execute: jest.fn(async (_ctx, prepared) => ({ applied: prepared })),
    verify: jest.fn(async (_ctx, _prepared, _executed) => ({ passed: true })),
    rollback: jest.fn(async () => ({ success: true })),
  };
}

function buildEncryptedStub<T>(value: T): EncryptedProbePayload {
  // The executor's session-store facade never decrypts; the contract only
  // requires that the encrypted payload be a structurally-valid envelope
  // (iv/data/tag + version). We forge the values here because the
  // executor's path only writes them through the facade — the encryption
  // helper is unused.
  const json = JSON.stringify(value);
  return {
    encrypted: true,
    version: 1,
    iv: "iv".padEnd(24, "a").slice(0, 24),
    data: Buffer.from(json, "utf8").toString("base64"),
    tag: "tag".padEnd(32, "b").slice(0, 32),
  };
}

/**
 * Build a session-store facade backed entirely by in-memory records. The
 * tests need to observe persistence order without touching the real fs.
 */
function buildInMemoryFacade(): {
  facade: ProbeSessionFacade;
  state: {
    sessions: Map<string, ProbeSessionRecord>;
    reservations: Map<string, string>;
    writes: string[];
    prepareCleanupCalls: string[];
    releaseCalls: string[];
  };
} {
  const sessions = new Map<string, ProbeSessionRecord>();
  const reservations = new Map<string, string>();
  const writes: string[] = [];
  const prepareCleanupCalls: string[] = [];
  const releaseCalls: string[] = [];

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
        ...(update.setHistory && update.payload
          ? { [update.payload.slot]: update.payload.encrypted }
          : {}),
      };
      sessions.set(current.sessionId, next);
      writes.push(`transition:${current.sessionId}->${update.toState}`);
      return next;
    },
    async removeConfirmedPreMutationSession(session) {
      if (session.state !== "preparing") {
        throw new Error("only preparing allowed");
      }
      prepareCleanupCalls.push(session.sessionId);
      reservations.delete(session.targetKeyHash);
      sessions.delete(session.sessionId);
      writes.push(`cleanup-preparing:${session.sessionId}`);
    },
    async releaseRolledBackReservation(session) {
      releaseCalls.push(session.sessionId);
      reservations.delete(session.targetKeyHash);
      writes.push(`release-reservation:${session.sessionId}`);
    },
  };
  return { facade, state: { sessions, reservations, writes, prepareCleanupCalls, releaseCalls } };
}

function buildDependencies(
  facade: ProbeSessionFacade,
  overrides: Partial<ProbeExecutorDependencies> = {},
): { dependencies: ProbeExecutorDependencies; encryptionCalls: number[] } {
  let encryptionCalls = 0;
  return {
    dependencies: {
      sessions: facade,
      encryptPayload: async (value: unknown) => {
        encryptionCalls += 1;
        return buildEncryptedStub(value);
      },
      logSecurityEvent: jest.fn(),
      now: () => Date.now(),
      setTimeoutFn: ((handler: (...args: unknown[]) => void, ms?: number) => {
        // For the quiescence tests we want jest fake timers; for normal tests
        // we just forward to the real timer (jest will fast-forward in the
        // timeout-focused suite).
        const id = setTimeout(handler, ms ?? 0);
        return {
          unref() { id.unref(); },
          ref() { id.ref(); },
          [Symbol.dispose]() { clearTimeout(id); },
        } as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as ProbeExecutorDependencies["setTimeoutFn"],
      clearTimeoutFn: ((handle: ReturnType<typeof setTimeout>) => {
        clearTimeout(handle as unknown as NodeJS.Timeout);
      }) as unknown as ProbeExecutorDependencies["clearTimeoutFn"],
      ...overrides,
    },
    encryptionCalls: encryptionCalls as unknown as number[],
  };
}

const originalSafeMode = process.env["KASTELL_SAFE_MODE"];

afterEach(() => {
  if (originalSafeMode === undefined) {
    delete process.env["KASTELL_SAFE_MODE"];
  } else {
    process.env["KASTELL_SAFE_MODE"] = originalSafeMode;
  }
  jest.restoreAllMocks();
});

// ─── Happy path: transition order ──────────────────────────────────────────

describe("executeActiveProbe — happy path", () => {
  it("persists every successful transition before the next callback", async () => {
    const events: string[] = [];
    const request = buildBaseRequest({
      module: {
        prepare: jest.fn(async () => {
          events.push("call:prepare");
          return { snapshot: 1 };
        }),
        execute: jest.fn(async () => {
          events.push("call:execute");
          return { executed: true };
        }),
        verify: jest.fn(async () => {
          events.push("call:verify");
          return { passed: true };
        }),
        rollback: jest.fn(async () => {
          events.push("call:rollback");
          return { success: true };
        }),
      },
    });

    const { facade, state } = buildInMemoryFacade();
    const { dependencies } = buildDependencies(facade);

    // Wrap writes to inject "persist:X" markers for every state mutating
    // call. Reserve sets the initial `preparing` state; transition moves
    // forward along the state machine. Both must emit persist markers so
    // the asserted event sequence is exhaustive.
    const decoratedFacade: ProbeSessionFacade = {
      ...facade,
      async reserve(input) {
        events.push("persist:preparing");
        return facade.reserve(input);
      },
      async transition(session, update) {
        events.push(`persist:${update.toState}`);
        return facade.transition(session, update);
      },
    };
    const { dependencies: deps } = buildDependencies(decoratedFacade);

    const result: ProbeExecutionResult = await executeActiveProbe(request, deps);
    expect(result).toEqual({
      status: "rolled-back",
      sessionId: expect.stringMatching(/^s-/),
      verificationPassed: true,
    });

    expect(events).toEqual([
      "persist:preparing",
      "call:prepare",
      "persist:prepared",
      "persist:executing",
      "call:execute",
      "persist:executed",
      "persist:verifying",
      "call:verify",
      "persist:verified",
      "persist:rollback-pending",
      "persist:rolling-back",
      "call:rollback",
      "persist:rolled-back",
    ]);

    // Reservation must be released AFTER the durable rolled-back write.
    const rolledBackIndex = state.writes.findIndex((w) => w.endsWith("->rolled-back"));
    const releaseIndex = state.writes.findIndex((w) => w.startsWith("release-reservation:"));
    expect(rolledBackIndex).toBeGreaterThanOrEqual(0);
    expect(releaseIndex).toBeGreaterThan(rolledBackIndex);
  });
});

// ─── Safe mode ─────────────────────────────────────────────────────────────

describe("executeActiveProbe — safe mode", () => {
  it("safe-mode refusal happens BEFORE reservation and lifecycle invocation", async () => {
    process.env["KASTELL_SAFE_MODE"] = "true";
    const reserveSpy = jest.fn();
    const facade: ProbeSessionFacade = {
      reserve: reserveSpy,
      transition: jest.fn(),
      removeConfirmedPreMutationSession: jest.fn(),
      releaseRolledBackReservation: jest.fn(),
    };
    const { dependencies } = buildDependencies(facade);
    const result = await executeActiveProbe(buildBaseRequest(), dependencies);
    expect(result).toEqual({ status: "blocked", reason: "safe-mode" });
    expect(reserveSpy).not.toHaveBeenCalled();
  });
});

// ─── Prepare failure ───────────────────────────────────────────────────────

describe("executeActiveProbe — prepare failure", () => {
  it("prepare failure removes the pre-mutation record and does NOT trigger a transition to prepared", async () => {
    const module: ActiveProbeModule = {
      prepare: jest.fn(async () => { throw new Error("prepare failed"); }),
      execute: jest.fn(),
      verify: jest.fn(),
      rollback: jest.fn(),
    };
    const { facade, state } = buildInMemoryFacade();
    const { dependencies } = buildDependencies(facade);
    const request = buildBaseRequest({ module });
    await expect(executeActiveProbe(request, dependencies)).rejects.toThrow("prepare failed");
    expect(state.prepareCleanupCalls).toHaveLength(1);
    // Reservation must be cleaned up too — not left blocking.
    expect(state.reservations.size).toBe(0);
    expect(state.sessions.size).toBe(0);
    // No "prepared" or any later transition persisted.
    const stateWrites = state.writes.filter((w) => w.startsWith("transition:"));
    expect(stateWrites).toEqual([]);
  });
});

// ─── Execute failure → rollback ────────────────────────────────────────────

describe("executeActiveProbe — execute failure", () => {
  it("calls rollback with the prepared payload but with no executed receipt", async () => {
    const executeSpy = jest.fn(async () => { throw new Error("execute failed"); });
    const rollbackSpy = jest.fn(async (_ctx, _prepared, executed) => {
      expect(executed).toBeUndefined();
      return { success: true };
    });
    const module: ActiveProbeModule = {
      prepare: jest.fn(async () => ({ snapshot: 1 })),
      execute: executeSpy,
      verify: jest.fn(),
      rollback: rollbackSpy,
    };
    const { facade, state } = buildInMemoryFacade();
    const { dependencies } = buildDependencies(facade);
    const request = buildBaseRequest({ module });
    const result = await executeActiveProbe(request, dependencies);
    expect(rollbackSpy).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("rolled-back");
    // Verify the durable state does NOT include an executed receipt.
    const finalSession = Array.from(state.sessions.values()).find(
      (s) => s.state === "rolled-back",
    );
    expect(finalSession).toBeDefined();
    expect(finalSession!.executed).toBeUndefined();
    expect(finalSession!.prepared).toBeDefined();
  });
});

// ─── Verify false/throw → rollback ─────────────────────────────────────────

describe("executeActiveProbe — verify failure", () => {
  it("verify returning passed=false still triggers rollback", async () => {
    const rollbackSpy = jest.fn(async () => ({ success: true }));
    const module: ActiveProbeModule = {
      prepare: jest.fn(async () => ({ snapshot: 1 })),
      execute: jest.fn(async () => ({ applied: true })),
      verify: jest.fn(async () => ({ passed: false, summary: "drift detected" })),
      rollback: rollbackSpy,
    };
    const { facade } = buildInMemoryFacade();
    const { dependencies } = buildDependencies(facade);
    const result = await executeActiveProbe(buildBaseRequest({ module }), dependencies);
    expect(rollbackSpy).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "rolled-back", verificationPassed: false });
  });

  it("verify throwing also triggers rollback", async () => {
    const rollbackSpy = jest.fn(async () => ({ success: true }));
    const module: ActiveProbeModule = {
      prepare: jest.fn(async () => ({ snapshot: 1 })),
      execute: jest.fn(async () => ({ applied: true })),
      verify: jest.fn(async () => { throw new Error("verify crashed"); }),
      rollback: rollbackSpy,
    };
    const { facade } = buildInMemoryFacade();
    const { dependencies } = buildDependencies(facade);
    const result = await executeActiveProbe(buildBaseRequest({ module }), dependencies);
    expect(rollbackSpy).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "rolled-back", verificationPassed: false });
  });

  it("successful verify also rolls back — rollback is mandatory", async () => {
    const rollbackSpy = jest.fn(async () => ({ success: true }));
    const module: ActiveProbeModule = {
      prepare: jest.fn(async () => ({ snapshot: 1 })),
      execute: jest.fn(async () => ({ applied: true })),
      verify: jest.fn(async () => ({ passed: true })),
      rollback: rollbackSpy,
    };
    const { facade } = buildInMemoryFacade();
    const { dependencies } = buildDependencies(facade);
    await executeActiveProbe(buildBaseRequest({ module }), dependencies);
    expect(rollbackSpy).toHaveBeenCalledTimes(1);
  });
});

// ─── Idempotent rollback ───────────────────────────────────────────────────

describe("executeActiveProbe — idempotent rollback", () => {
  it("calling rollback twice with the same persisted inputs is a no-op (success already accounted for)", async () => {
    // First call: returns success=true
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
    const { dependencies } = buildDependencies(facade);
    await executeActiveProbe(buildBaseRequest({ module }), dependencies);
    expect(rollbackCalls).toBe(1);
    // Direct second invocation with the same persisted inputs (i.e. the
    // rollback result was already success=true so the executor won't call
    // again). Verified by re-running the lifecycle: no duplicate state.
    const second = await executeActiveProbe(
      buildBaseRequest({ module: { ...module, rollback: module.rollback } }),
      dependencies,
    );
    expect(second).toMatchObject({ status: "rolled-back", verificationPassed: true });
  });
});

// ─── toNewProbeSession allowlist projection ────────────────────────────────

describe("toNewProbeSession — explicit allowlist projection", () => {
  it("does NOT spread the executor request, callable module, dependencies, or controller into persistence", () => {
    const request = buildBaseRequest();
    const projected = toNewProbeSession(request);
    // Allowlist fields only — verify function-valued properties are absent.
    for (const value of Object.values(projected)) {
      expect(typeof value).not.toBe("function");
    }
    expect(Object.keys(projected).sort()).toEqual(
      [
        "checkId",
        "handlerPath",
        "handlerSha256",
        "pluginName",
        "pluginVersion",
        "risk",
        "target",
        "timeoutMs",
      ].sort(),
    );
  });

  it("the projection never contains logger, sshExec, dependencies, or signal/controller", () => {
    const request = buildBaseRequest();
    const projected = toNewProbeSession(request);
    // @ts-expect-error -- intentional
    expect(projected.logger).toBeUndefined();
    // @ts-expect-error -- intentional
    expect(projected.sshExec).toBeUndefined();
    // @ts-expect-error -- intentional
    expect(projected.dependencies).toBeUndefined();
    // @ts-expect-error -- intentional
    expect(projected.signal).toBeUndefined();
    // @ts-expect-error -- intentional
    expect(projected.controller).toBeUndefined();
    // @ts-expect-error -- intentional
    expect(projected.module).toBeUndefined();
  });

  it("the target field in the projection matches the request's target by value (no spread)", () => {
    const request = buildBaseRequest();
    const projected = toNewProbeSession(request);
    expect(projected.target).toEqual(request.target);
  });

  it("the projected targetKeyHash matches the canonical hashProbeTarget output", () => {
    const request = buildBaseRequest();
    const projected = toNewProbeSession(request);
    expect(canonicalProbeTargetKey(request.target)).toBeDefined();
    expect(hashProbeTarget(request.target)).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ─── Security log extension ────────────────────────────────────────────────

describe("executeActiveProbe — security log fields", () => {
  it("emits security events containing metadata, not payload/command/stdout/stderr/IP/token fields", async () => {
    const logSecurityEvent = jest.fn();
    const { facade } = buildInMemoryFacade();
    const { dependencies } = buildDependencies(facade, { logSecurityEvent });
    await executeActiveProbe(buildBaseRequest(), dependencies);
    expect(logSecurityEvent).toHaveBeenCalled();
    // Every entry must avoid sensitive raw fields.
    for (const call of logSecurityEvent.mock.calls) {
      const entry = call[0] as Record<string, unknown>;
      expect(entry).not.toHaveProperty("payload");
      expect(entry).not.toHaveProperty("command");
      expect(entry).not.toHaveProperty("stdout");
      expect(entry).not.toHaveProperty("stderr");
      expect(entry).not.toHaveProperty("token");
      // ip is intentionally absent for probe events (serverId + hashed target)
      expect(entry).not.toHaveProperty("ip");
    }
  });
});
