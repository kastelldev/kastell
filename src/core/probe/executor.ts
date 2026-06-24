// src/core/probe/executor.ts
//
// Active Probe lifecycle executor.
//
// This module brings the lifecycle together. It owns:
//
//  1. Safe-mode refusal — the executor returns `{ status: "blocked",
//     reason: "safe-mode" }` BEFORE the reservation is taken and BEFORE
//     any lifecycle callback fires. The block is recorded as a security
//     event using the typed `plugin-probe` category.
//
//  2. Reservation → preparing → prepared → executing → executed →
//     verifying → verified → rollback-pending → rolling-back → rolled-back.
//     Every state transition is persisted BEFORE the next handler
//     callback is invoked (the durability-before-callback rule).
//
//  3. Quiescence: a handler that does not settle within 5 seconds of the
//     deadline is treated as `unresolved` WITHOUT a rollback. Forward
//     cancellation aborts the controlled SSH only. Rollback receives a
//     FRESH independent AbortController and budget of
//     `min(60_000, request.timeoutMs)` — forward state cannot cancel
//     rollback.
//
//  4. `toNewProbeSession` is an explicit allowlist projection. It must
//     NOT spread the executor request, callable module, dependencies, or
//     abort controller into persistence; only plugin/check IDs, plugin
//     version, normalized handler path/digest, risk, timeout, and the
//     immutable target identity.
//
//  5. `rollbackAfterQuiescence` persists `rollback-pending` and
//     `rolling-back` BEFORE invoking rollback. It only persists
//     `rolled-back` and releases the reservation when `result.success
//     === true`. A false / throw / timeout / non-quiescing forward
//     handler persists `unresolved` and keeps the reservation blocking.
//
// See `tests/unit/probe-executor.test.ts` and
// `tests/unit/probe-executor-timeout.test.ts` for the invariants.

import { isSafeMode, logSafeModeBlock } from "../../utils/safeMode.js";
import { logSecurityEvent } from "../../utils/securityLogger.js";
import { hashProbeTarget, type NewProbeSession } from "./sessionStore.js";
import type { EncryptedProbePayload } from "./types.js";
import type { ActiveProbeModule, PluginProbeVerification, PluginProbeRollbackResult, PluginProbeTarget } from "../../plugin/sdk/types.js";
import { createProbeContext, type ProbeBaseLogger, type ProbeSshExecFn } from "./context.js";
import { assertValidIp } from "../../utils/ssh.js";

// ─── Public types ──────────────────────────────────────────────────────────

export interface ExecuteActiveProbeRequest {
  pluginName: string;
  pluginVersion: string;
  checkId: string;
  handlerPath: string;
  handlerSha256: string;
  risk: "safe" | "caution" | "dangerous";
  timeoutMs: number;
  target: PluginProbeTarget;
  module: ActiveProbeModule;
  /** Optional override for the base logger — tests inject a capture sink. */
  baseLogger?: ProbeBaseLogger;
  /** Optional override for the SSH exec primitive — tests inject a fake. */
  sshExec?: ProbeSshExecFn;
}

export type ProbeExecutionResult =
  | { status: "blocked"; reason: "safe-mode" }
  | { status: "rolled-back"; sessionId: string; verificationPassed: boolean }
  | { status: "unresolved"; sessionId: string };

export interface ProbeExecutorDependencies {
  sessions: import("./sessionStore.js").ProbeSessionFacade;
  encryptPayload: (value: unknown) => Promise<EncryptedProbePayload>;
  logSecurityEvent: typeof logSecurityEvent;
  /** Override for `Date.now()` — tests use it to drive quiescence timers. */
  now?: () => number;
  /** Override for `setTimeout` — tests inject a virtual scheduler. */
  setTimeoutFn?: (handler: (...args: unknown[]) => void, ms?: number) => unknown;
  /** Override for `clearTimeout` — paired with `setTimeoutFn`. */
  clearTimeoutFn?: (handle: unknown) => void;
  /** Override for the base logger passed through to the handler. */
  baseLogger?: ProbeBaseLogger;
  /** Override for the SSH exec primitive — tests inject a fake. */
  sshExec?: ProbeSshExecFn;
}

// ─── Typed errors ──────────────────────────────────────────────────────────

export class ProbeTimeoutError extends Error {
  constructor(
    message: string,
    public readonly sessionId?: string,
  ) {
    super(message);
    this.name = "ProbeTimeoutError";
  }
}

export class ProbeHandlerNotQuiescedError extends Error {
  constructor(
    message: string,
    public readonly sessionId?: string,
  ) {
    super(message);
    this.name = "ProbeHandlerNotQuiescedError";
  }
}

// ─── Internal helpers ──────────────────────────────────────────────────────

const QUIESCENCE_GRACE_MS = 5_000;
const ROLLBACK_BUDGET_CAP_MS = 60_000;

/** Convert an unknown error into a safe string for persistence and logs. */
function sanitizeProbeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") return error;
  return "Unknown probe error";
}

function remainingForwardBudgetMs(deadlineMs: number, now: () => number): number {
  return Math.max(0, deadlineMs - now());
}

function assertForwardBudgetAvailable(
  deadlineMs: number,
  now: () => number,
  sessionId: string,
  step: "prepare" | "execute" | "verify",
): number {
  const remainingMs = remainingForwardBudgetMs(deadlineMs, now);
  if (remainingMs <= 0) {
    throw new ProbeTimeoutError(`Active probe ${step} skipped because the shared deadline was already exhausted`, sessionId);
  }
  return remainingMs;
}

/**
 * The allowlist projection passed to `sessions.reserve`. It contains ONLY
 * plugin/check IDs, plugin version, normalized handler path/digest, risk,
 * timeout, and the immutable target identity. NO request, module,
 * dependencies, controller, or logger crosses into persistence.
 */
export function toNewProbeSession(request: ExecuteActiveProbeRequest): NewProbeSession {
  return {
    pluginName: request.pluginName,
    pluginVersion: request.pluginVersion,
    checkId: request.checkId,
    handlerPath: request.handlerPath,
    handlerSha256: request.handlerSha256,
    risk: request.risk,
    timeoutMs: request.timeoutMs,
    target: {
      serverId: request.target.serverId,
      provider: request.target.provider,
      cloudId: request.target.cloudId,
      ip: request.target.ip,
    },
  };
}

// ─── Main executor ─────────────────────────────────────────────────────────

/**
 * Execute an Active Probe end-to-end. The shape of the returned result
 * is closed: either the lifecycle was blocked (safe-mode), the probe
 * successfully ran and rolled back, or the probe terminated as
 * `unresolved` (rollback could not complete cleanly).
 *
 * Concurrency: this function does NOT take a lock of its own. The
 * underlying session-store facade is responsible for serializing state
 * transitions per session/per target. Forward cancellation aborts the
 * forward controller only; rollback has a fresh independent controller.
 */
export async function executeActiveProbe(
  request: ExecuteActiveProbeRequest,
  deps: ProbeExecutorDependencies,
): Promise<ProbeExecutionResult> {
  // 1) Safe-mode refusal BEFORE reservation and BEFORE any lifecycle call.
  if (isSafeMode()) {
    logSafeModeBlock("plugin-probe.execute", {
      category: "plugin-probe",
      targetHash: hashProbeTarget(request.target),
      plugin: request.pluginName,
      checkId: request.checkId,
    });
    return { status: "blocked", reason: "safe-mode" };
  }

  // Emit a structured security event describing the lifecycle start. The
  // brief mandates that probe security logs contain metadata, not raw
  // payload/command/stdout/stderr/IP/token fields. Only IDs, hashed
  // target, transition name, and risk are forwarded.
  const targetHash = hashProbeTarget(request.target);
  const emitTransition = (transition: string) => {
    try {
      deps.logSecurityEvent({
        level: "info",
        action: "probe_session_transition",
        category: "plugin-probe",
        result: "success",
        plugin: request.pluginName,
        check_id: request.checkId,
        target_hash: targetHash,
        transition,
        risk: request.risk === "safe" ? "low" : request.risk === "caution" ? "medium" : "high",
      });
    } catch {
      // Security log failures must never abort the lifecycle.
    }
  };

  // 2) Validate the target IP before any SSH can run. A bad IP must not
  //    reach the subprocess layer — the controlled SSH will re-validate,
  //    but a defensive check here keeps audit trails honest.
  assertValidIp(request.target.ip);

  // 3) Reserve the target. The reservation is the durable anchor that
  //    blocks concurrent reservations for the same target identity.
  emitTransition("preparing");
  let session = await deps.sessions.reserve(toNewProbeSession(request));

  // 4) Set up the forward AbortController + deadline. The deadline is an
  //    absolute epoch timestamp; the controlled SSH clamps each call.
  const nowFn = deps.now ?? Date.now;
  const deadlineMs = nowFn() + request.timeoutMs;
  const forwardController = new AbortController();
  const baseLogger = deps.baseLogger ?? defaultBaseLogger();
  const context = createProbeContext({
    target: request.target,
    sessionId: session.sessionId,
    pluginName: request.pluginName,
    checkId: request.checkId,
    signal: forwardController.signal,
    deadlineMs,
    sshExec: deps.sshExec ?? defaultSshExec,
    baseLogger,
    now: nowFn,
  });

  // 5) Prepare step. A failure here is a clean pre-mutation cleanup —
  //    remove the preparing session record AND its reservation. The
  //    state machine does NOT transition away from `preparing` for this
  //    path; cleanup is a separate concern.
  let prepared: unknown;
  try {
    prepared = await runLifecycleStep({
      label: "prepare",
      context,
      run: () => request.module.prepare(context),
      controller: forwardController,
      timeoutMs: assertForwardBudgetAvailable(deadlineMs, nowFn, session.sessionId, "prepare"),
      deps,
    });
    session = await deps.sessions.transition(session, {
      toState: "prepared",
      setHistory: true,
      payload: { slot: "prepared", encrypted: await deps.encryptPayload(prepared) },
    });
    emitTransition("prepared");
  } catch (error) {
    if (error instanceof ProbeHandlerNotQuiescedError) {
      session = await deps.sessions.transition(session, {
        toState: "unresolved",
        reason: `handler-not-quiesced: ${sanitizeProbeError(error)}`,
      });
      return { status: "unresolved", sessionId: session.sessionId };
    }
    await deps.sessions.removeConfirmedPreMutationSession(session);
    throw error;
  }

  // 6) Execute step. A throw here skips the executed receipt entirely
  //    (rollback is called with the prepared payload and no executed
  //    argument). Verify is skipped; the rollbackAfterQuiescence path
  //    handles the rest.
  let durableExecuted: unknown;
  let verificationPassed: boolean;
  let rollbackReason: string | undefined;
  try {
    session = await deps.sessions.transition(session, {
      toState: "executing",
      setHistory: true,
    });
    emitTransition("executing");
    const executedCandidate = await runLifecycleStep({
      label: "execute",
      context,
      run: () => request.module.execute(context, prepared),
      controller: forwardController,
      timeoutMs: assertForwardBudgetAvailable(deadlineMs, nowFn, session.sessionId, "execute"),
      deps,
    });
    session = await deps.sessions.transition(session, {
      toState: "executed",
      setHistory: true,
      payload: { slot: "executed", encrypted: await deps.encryptPayload(executedCandidate) },
    });
    emitTransition("executed");
    durableExecuted = executedCandidate;

    // 7) Verify step. A throw OR `passed === false` still triggers
    //    rollback (verification failure is not a clean termination).
    session = await deps.sessions.transition(session, {
      toState: "verifying",
      setHistory: true,
    });
    emitTransition("verifying");
    const verification = await runLifecycleStep({
      label: "verify",
      context,
      run: () => request.module.verify(context, prepared, durableExecuted),
      controller: forwardController,
      timeoutMs: assertForwardBudgetAvailable(deadlineMs, nowFn, session.sessionId, "verify"),
      deps,
    });
    const verifyPassed = verification.passed === true;
    verificationPassed = verifyPassed;
    session = await deps.sessions.transition(session, {
      toState: "verified",
      setHistory: true,
      payload: { slot: "verification", encrypted: await deps.encryptPayload(verification) },
    });
    emitTransition("verified");
    if (!verifyPassed) {
      // Verification failure still rolls back, but the canonical rollback
      // helper owns the single transition into rollback-pending.
      rollbackReason = `verify-failed: ${verification.summary ?? "no summary"}`;
    }
  } catch (error) {
    if (error instanceof ProbeHandlerNotQuiescedError) {
      session = await deps.sessions.transition(session, {
        toState: "unresolved",
        reason: `handler-not-quiesced: ${sanitizeProbeError(error)}`,
      });
      return { status: "unresolved", sessionId: session.sessionId };
    }
    return rollbackAfterQuiescence({
      session,
      context,
      forwardController,
      module: request.module,
      prepared,
      executed: durableExecuted,
      verification: undefined,
      verificationPassed: false,
      dependencies: deps,
      rollbackReason: sanitizeProbeError(error),
    });
  }

  // 8) Forward succeeded → rollback is mandatory. Always roll back even
  //    on a successful verify.
  return rollbackAfterQuiescence({
    session,
    context,
    forwardController,
    module: request.module,
    prepared,
    executed: durableExecuted,
    verification: undefined,
    verificationPassed,
    dependencies: deps,
    rollbackReason,
  });
}

// ─── Lifecycle step runner ─────────────────────────────────────────────────

/**
 * Generic lifecycle step runner shared by forward (`prepare` / `execute` /
 * `verify`) and rollback phases. Races the handler against `timeoutMs`,
 * aborts the controller on deadline, and surfaces
 * `ProbeHandlerNotQuiescedError` if the handler does not settle within
 * `QUIESCENCE_GRACE_MS` after the deadline. The handler's own promise
 * rejection propagates to the caller.
 *
 * Scope of responsibility:
 *
 * - This helper OWNS the timeout race (deadline + quiescence grace),
 *   controller abort on deadline, and label-aware error messages.
 *
 * - This helper does NOT take `persistSuccess` / `persistFailure` callbacks
 *   or a `receipt: ProbeReceiptSink` parameter, and it does NOT write
 *   receipt/payload records (`prepared`, `executed`, `verification`,
 *   `rollback`) or state transitions. Those stay inline in the callers
 *   (`executeActiveProbe`, `rollbackAfterQuiescence`).
 *
 * This is a deliberate faithful read of brief Step 3's audit-trail rule:
 * receipt/payload persistence must not be moved outside the helper in a
 * way that can drop audit-trail fields. Keeping the writes in the callers
 * preserves every state transition and every `prepared` / `executed` /
 * `verification` / `rollback` write at its original call site.
 */
async function runLifecycleStep<T>(
  args: {
    label: "prepare" | "execute" | "verify" | "rollback";
    context: ReturnType<typeof createProbeContext>;
    run: () => Promise<T>;
    controller: AbortController;
    timeoutMs: number;
    deps: ProbeExecutorDependencies;
  },
): Promise<T> {
  const { label, context, run, controller, timeoutMs, deps } = args;
  const setTimeoutFn = deps.setTimeoutFn ?? ((h: (...args: unknown[]) => void, ms?: number) => setTimeout(h, ms ?? 0));
  const clearTimeoutFn = deps.clearTimeoutFn ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));

  // Settle-sentinel: whoever wins the race updates this first.
  let settled = false;
  const settle = () => { settled = true; };

  // Track the handler's outcome. We do NOT abort the handler on deadline —
  // a still-running handler that has not returned yet gets a fresh
  // QUIESCENCE_GRACE_MS window to settle.
  let handlerResolve: ((value: T) => void) | null = null;
  let handlerReject: ((reason: unknown) => void) | null = null;
  const handlerPromise: Promise<T> = new Promise<T>((resolve, reject) => {
    handlerResolve = resolve;
    handlerReject = reject;
    run().then(
      (value) => { settle(); handlerResolve!(value); },
      (err) => { settle(); handlerReject!(err); },
    );
  });

  // Deadline elapsing → abort the controller so any in-flight SSH is killed.
  const deadlineHandle = setTimeoutFn(() => {
    if (settled) return;
    controller.abort();
  }, timeoutMs);

  // Deadline + grace elapsing without settlement → quiescence error.
  const graceHandle = setTimeoutFn(() => {
    if (settled) return;
    settle();
    const err = new ProbeHandlerNotQuiescedError(
      label === "rollback"
        ? `Active probe rollback did not settle within ${QUIESCENCE_GRACE_MS}ms after deadline`
        : `Active probe ${label} handler did not settle within ${QUIESCENCE_GRACE_MS}ms after deadline`,
      context.sessionId,
    );
    // Reject the handler's own promise so awaiting code sees the error.
    handlerReject?.(err);
  }, timeoutMs + QUIESCENCE_GRACE_MS);

  try {
    return await handlerPromise;
  } finally {
    clearTimeoutFn(deadlineHandle);
    clearTimeoutFn(graceHandle);
  }
}

// ─── Rollback after quiescence ─────────────────────────────────────────────

interface RollbackInput {
  session: import("./sessionStore.js").ProbeSessionRecord;
  context: ReturnType<typeof createProbeContext>;
  forwardController: AbortController;
  module: ActiveProbeModule;
  prepared: unknown;
  executed?: unknown;
  verification: PluginProbeVerification | undefined;
  verificationPassed: boolean;
  dependencies: ProbeExecutorDependencies;
  rollbackReason?: string;
}

/**
 * The canonical rollback path. Persists `rollback-pending` and
 * `rolling-back` BEFORE invoking rollback (the durability-before-
 * callback rule). Only when the rollback result's `success === true`
 * do we persist `rolled-back` AND release the reservation. Every other
 * outcome (false / throw / timeout / non-quiescing) persists
 * `unresolved` and KEEPS the reservation blocking — that is the
 * desired safety behavior.
 *
 * Rollback runs with a fresh AbortController and budget of
 * `min(60_000, request.timeoutMs)`. The forward controller's state
 * cannot cancel rollback.
 */
async function rollbackAfterQuiescence(
  input: RollbackInput,
): Promise<ProbeExecutionResult> {
  const { session: inputSession, dependencies: deps } = input;
  const rollbackController = new AbortController();
  const nowFn = deps.now ?? Date.now;
  // Rollback budget is capped at ROLLBACK_BUDGET_CAP_MS. We do not
  // re-derive it from the forward deadline because the forward deadline
  // is an absolute epoch timestamp (Date.now() at the start of the
  // forward step) and has no meaningful relationship to the rollback
  // wall-clock budget. boundedBudgetMs is the only budget used for
  // the rollback timer AND for the rollback context's deadline.
  const boundedBudgetMs = Math.min(
    ROLLBACK_BUDGET_CAP_MS,
    inputSession.timeoutMs,
  );

  // Build a rollback-only context. The target/session/plugin identity
  // is preserved; the signal is the fresh rollback controller; the
  // deadline is independent.
  const rollbackContext = createProbeContext({
    target: input.context.target as unknown as PluginProbeTarget,
    sessionId: input.context.sessionId,
    pluginName: input.context.pluginName,
    checkId: input.context.checkId,
    signal: rollbackController.signal,
    deadlineMs: nowFn() + boundedBudgetMs,
    sshExec: deps.sshExec ?? defaultSshExec,
    baseLogger: deps.baseLogger ?? defaultBaseLogger(),
    now: nowFn,
  });

  // 1) Persist `rollback-pending` BEFORE invoking rollback.
  let current = await deps.sessions.transition(inputSession, {
    toState: "rollback-pending",
    setHistory: true,
    reason: input.rollbackReason,
  });

  // 2) Persist `rolling-back` BEFORE invoking rollback.
  current = await deps.sessions.transition(current, {
    toState: "rolling-back",
    setHistory: true,
  });

  // 3) Invoke rollback with a fresh budget. If it throws or returns
  //    success=false, persist `unresolved` and KEEP the reservation
  //    blocking — the operator must investigate before retry.
  let result: PluginProbeRollbackResult;
  try {
    result = await runLifecycleStep<PluginProbeRollbackResult>({
      label: "rollback",
      context: rollbackContext,
      run: () => input.module.rollback(rollbackContext, input.prepared, input.executed),
      controller: rollbackController,
      timeoutMs: boundedBudgetMs,
      deps,
    });
  } catch (error) {
    current = await deps.sessions.transition(current, {
      toState: "unresolved",
      reason: `rollback-failed: ${sanitizeProbeError(error)}`,
    });
    return { status: "unresolved", sessionId: current.sessionId };
  }

  if (result.success === true) {
    const encryptedRollback = await deps.encryptPayload(result);
    current = await deps.sessions.transition(current, {
      toState: "rolled-back",
      setHistory: true,
      payload: { slot: "rollback", encrypted: encryptedRollback },
    });
    // releaseRolledBackReservation is delegated to the canonical facade.
    // The session-store facade persists the rolled-back transition first,
    // THEN releases — that ordering is enforced by the facade, not by us.
    await deps.sessions.releaseRolledBackReservation(current);
    return {
      status: "rolled-back",
      sessionId: current.sessionId,
      verificationPassed: input.verificationPassed,
    };
  }

  current = await deps.sessions.transition(current, {
    toState: "unresolved",
    reason: `rollback-returned-false: ${result.summary ?? "no summary"}`,
  });
  return { status: "unresolved", sessionId: current.sessionId };
}

// ─── Defaults ──────────────────────────────────────────────────────────────

function defaultBaseLogger(): ProbeBaseLogger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

async function defaultSshExec(
  ip: string,
  command: string,
  opts: { timeoutMs: number; signal: AbortSignal },
): Promise<{ code: number; stdout: string; stderr: string }> {
  // Late import avoids circular dep at module-load time and lets the
  // executor be tested without a real SSH binary on the box.
  const mod = await import("../../utils/ssh.js");
  return mod.sshExec(ip, command, { timeoutMs: opts.timeoutMs, signal: opts.signal });
}
