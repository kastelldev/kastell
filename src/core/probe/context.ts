// src/core/probe/context.ts
//
// Capability-limited Active Probe context.
//
// Three contracts govern this module:
//
//  1. The context surface is FROZEN at every level. `Object.freeze` is
//     applied to BOTH the outer object AND the inner `target`. Handlers
//     receive a read-only snapshot; mutations throw in strict mode and
//     are silently ignored in sloppy mode.
//
//  2. The context exposes ONLY target/sessionId/pluginName/checkId/signal/
//     deadlineMs/controlled ssh/redacting logger. NO provider token, env,
//     fs, spawn, or session mutation crosses the boundary.
//
//  3. The controlled SSH wrapper clamps the requested `timeoutMs` to the
//     remaining deadline (`max(0, deadlineMs - now)`) and forwards the
//     context's `AbortSignal` so caller cancellation aborts the SSH child.
//     The redacting logger passes handler-supplied fields through
//     `safeStringify` before forwarding them to the base logger — no raw
//     handler object ever crosses the context boundary.
//
// See `tests/unit/probe-context.test.ts` for the 12 invariant tests.

import { assertValidIp } from "../../utils/ssh.js";
import { safeStringify } from "../../utils/logger.js";
import type {
  PluginProbeContext,
  PluginProbeTarget,
} from "../../plugin/sdk/types.js";

// ─── SSH and logger input contracts ─────────────────────────────────────────

export interface ProbeSshExecFn {
  (
    ip: string,
    command: string,
    opts: { timeoutMs: number; signal: AbortSignal },
  ): Promise<{ code: number; stdout: string; stderr: string }>;
}

export interface ProbeBaseLogger {
  /**
   * Accepts a stringified structured-fields argument (the redactor's
   * output). The single-string form is preferred for compatibility with
   * `console.log`-style sinks that ignore trailing args.
   */
  info: (msg: string, fields?: string) => void;
  warn: (msg: string, fields?: string) => void;
  error: (msg: string, fields?: string) => void;
}

// ─── Create-context input ──────────────────────────────────────────────────

export interface CreateProbeContextInput {
  target: PluginProbeTarget;
  sessionId: string;
  pluginName: string;
  checkId: string;
  signal: AbortSignal;
  deadlineMs: number;
  /** Lower-level SSH exec — receives `assertValidIp` output and the clamped timeout. */
  sshExec?: ProbeSshExecFn;
  /** Pre-redaction logger passed through to handler log calls. Optional — defaults to a no-op. */
  baseLogger?: ProbeBaseLogger;
  /** Optional override for `Date.now()` — used by tests for deterministic deadlines. */
  now?: () => number;
}

// ─── Context factory ────────────────────────────────────────────────────────

/**
 * Build the capability-limited `PluginProbeContext` for a single probe
 * invocation. Both the outer object and the `target` field are frozen.
 * No function-valued property crosses the boundary that would let the
 * handler escape the contract (no `transition`, no `reserve`, no `spawn`).
 */
export function createProbeContext(
  input: CreateProbeContextInput,
): PluginProbeContext {
  const now = input.now ?? Date.now;
  const ssh = createControlledProbeSsh(input, now);
  const logger = createRedactingProbeLogger(input.baseLogger);
  return Object.freeze({
    target: Object.freeze({ ...input.target }),
    sessionId: input.sessionId,
    pluginName: input.pluginName,
    checkId: input.checkId,
    signal: input.signal,
    deadlineMs: input.deadlineMs,
    ssh,
    logger,
  });
}

// ─── Controlled SSH ─────────────────────────────────────────────────────────

/**
 * Wrap the lower-level SSH exec so each invocation is clamped to the
 * remaining context deadline AND validated through `assertValidIp`
 * BEFORE any subprocess is spawned. Handler cancellation (via the
 * context's `signal`) aborts the SSH child.
 *
 * `now` is injected so the clamp can be tested deterministically without
 * freezing wall-clock time.
 */
function createControlledProbeSsh(
  input: CreateProbeContextInput,
  now: () => number,
): PluginProbeContext["ssh"] {
  const sshExec = input.sshExec ?? defaultSshExec;
  return async (command, options) => {
    // The IP is validated through the canonical helper so a handler
    // cannot smuggle shell metacharacters via the target. This re-runs on
    // every SSH call — the target is already frozen, but a handler that
    // mutated an upstream copy would still be caught here.
    assertValidIp(input.target.ip);

    const remaining = Math.max(0, input.deadlineMs - now());
    const requested = options?.timeoutMs ?? Number.POSITIVE_INFINITY;
    const clampedTimeoutMs = Math.min(requested, remaining);

    return sshExec(input.target.ip, command, {
      timeoutMs: clampedTimeoutMs,
      signal: input.signal,
    });
  };
}

async function defaultSshExec(
  ip: string,
  command: string,
  opts: { timeoutMs: number; signal: AbortSignal },
): Promise<{ code: number; stdout: string; stderr: string }> {
  // Late import avoids circular dep at module-load time and lets the
  // context be constructed in test setups without a real SSH binary.
  const mod = await import("../../utils/ssh.js");
  return mod.sshExec(ip, command, { timeoutMs: opts.timeoutMs, signal: opts.signal });
}

// ─── Redacting logger ──────────────────────────────────────────────────────

/**
 * Wrap a base logger so handler-supplied fields are passed through
 * `safeStringify` before forwarding. The handler's `info(msg, fields)`
 * shape becomes `info(msg)` with `safeStringify(fields)` prepended, so
 * the base logger sees a single safe string and never the raw object.
 *
 * `safeStringify` redacts sensitive keys (token, password, secret,
 * apiKey, api_key, authorization), Bearer-prefixed values, and JWT
 * substrings; the handler's structured fields therefore cannot leak
 * credentials even if the handler forgets to redact.
 */
function createRedactingProbeLogger(
  base: ProbeBaseLogger | undefined,
): PluginProbeContext["logger"] {
  const target: ProbeBaseLogger = base ?? { info: () => undefined, warn: () => undefined, error: () => undefined };
  const wrap = (level: "info" | "warn" | "error") => (msg: string, fields?: unknown) => {
    if (fields === undefined) {
      target[level](msg);
      return;
    }
    // Forward the redacted structured payload as a second positional
    // argument so log sinks that capture the raw args array can still
    // see the redacted record. The message itself is preserved
    // verbatim — only the fields object is sanitized.
    target[level](msg, safeStringify(fields));
  };
  return {
    info: wrap("info"),
    warn: wrap("warn"),
    error: wrap("error"),
  };
}
