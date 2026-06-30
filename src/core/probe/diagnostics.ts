// src/core/probe/diagnostics.ts
// Active Probe recovery classification and bootstrap maintenance wrapper.
//
// Three responsibilities live here:
//
//   1. `classifyProbeSessions` — project a `ProbeSessionLoadResult[]` plus a
//      current-handler-digest resolver into a `ProbeDiagnostic[]`. The kinds
//      are: interrupted, unresolved, corrupt, undecryptable, handler-mismatch,
//      orphan-reservation. Severities come from the brief: critical (probe
//      crashed mid-execution / terminal unresolved / handler-mismatch / orphan)
//      and warning (corrupt JSON / undecryptable payload).
//
//   2. `cleanupExpiredProbeSessions` is re-exported here as a convenience so
//      bootstrap code only needs one import. The real implementation lives in
//      sessionStore.ts (retention policy + lock acquisition).
//
//   3. Bootstrap wrapper: `runProbeSessionMaintenance` is the single public
//      maintenance API. Two overloads:
//        - `runProbeSessionMaintenance()` — strict mode, throws on failure.
//        - `runProbeSessionMaintenance({ strict: false })` — bootstrap mode,
//          catches, redacts, security-logs, returns bounded result with
//          optional `error` populated. NEVER throws.
//      Bootstrap call sites (CLI, MCP, doctor) MUST use `{ strict: false }`
//      so cleanup failure never crashes startup.
//
// Digest resolution is data-only: it reads the file bytes and SHA-256s them.
// It does NOT import or execute the handler module — bootstrap must never
// resume probe lifecycle execution.

import { createHash } from "crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "fs";

import {
  listProbeSessions,
  cleanupExpiredProbeSessions as cleanupFromStore,
  type ProbeSessionLoadResult,
  type ProbeCleanupResult,
} from "./sessionStore.js";
import { redactProbeDiagnostic } from "./payload.js";
import type { ProbeSessionRecord, RedactedProbeError } from "./types.js";
import {
  KASTELL_DIR,
  PROBE_TARGETS_DIR,
} from "../../utils/paths.js";
import { logSecurityEvent } from "../../utils/securityLogger.js";
import { secureMkdirSync } from "../../utils/secureWrite.js";
import { DOCTOR_SEVERITY_WEIGHTS } from "../../types/severity.js";
import type { CheckResult } from "../doctor-local.js";
import type { DoctorFinding } from "../doctor.js";

// ─── Diagnostic kinds ──────────────────────────────────────────────────────

export type ProbeDiagnosticKind =
  | "interrupted"
  | "unresolved"
  | "corrupt"
  | "undecryptable"
  | "handler-mismatch"
  | "orphan-reservation";

export type ProbeDiagnosticSeverity = "critical" | "warning";

/**
 * Probe kinds that surface as doctor findings (T12 review Option A).
 * Forensic kinds (`undecryptable`, `handler-mismatch`, `orphan-reservation`)
 * surface via dedicated probe commands, not doctor.
 */
export const DOCTOR_ACTIONABLE_KINDS: ReadonlySet<ProbeDiagnosticKind> = new Set([
  "unresolved",
  "interrupted",
  "corrupt",
]);

export interface ProbeDiagnostic {
  kind: ProbeDiagnosticKind;
  severity: ProbeDiagnosticSeverity;
  /** Blocking diagnostics must be cleared before the next reserve on the same target. */
  blocking: boolean;
  sessionId?: string;
  targetKeyHash?: string;
  message: string;
}

export interface ProbeMaintenanceResult {
  diagnostics: ProbeDiagnostic[];
  cleanup: ProbeCleanupResult;
}

export interface ProbeMaintenanceBootstrapResult extends ProbeMaintenanceResult {
  /** Present only when the strict maintenance operation threw. */
  error?: RedactedProbeError;
}

// ─── Handler digest resolution (data-only) ─────────────────────────────────

export interface CurrentHandlerDigestInput {
  handlerPath: string;
}

export async function resolveCurrentHandlerDigest(
  record: CurrentHandlerDigestInput,
): Promise<string | undefined> {
  try {
    if (!record.handlerPath || !existsSync(record.handlerPath)) {
      return undefined;
    }
    const bytes = readFileSync(record.handlerPath);
    return createHash("sha256").update(bytes).digest("hex");
  } catch {
    // Data-only — never propagate I/O errors as lifecycle errors.
    return undefined;
  }
}

// ─── Classification ─────────────────────────────────────────────────────────

export interface ClassifyDependencies {
  resolveCurrentHandlerDigest(
    record: ProbeSessionRecord,
  ): Promise<string | undefined>;
}

const NON_TERMINAL_STATES = new Set<ProbeSessionRecord["state"]>([
  "preparing",
  "prepared",
  "executing",
  "executed",
  "verifying",
  "verified",
  "rollback-pending",
  "rolling-back",
]);

export async function classifyProbeSessions(
  records: ProbeSessionLoadResult[],
  dependencies: ClassifyDependencies,
): Promise<ProbeDiagnostic[]> {
  const diagnostics: ProbeDiagnostic[] = [];

  for (const entry of records) {
    if (!entry.record) {
      diagnostics.push({
        kind: "corrupt",
        severity: "warning",
        blocking: false,
        sessionId: entry.sessionId,
        message: `Probe session ${entry.sessionId} could not be parsed (${entry.reason ?? "unknown"}).`,
      });
      continue;
    }

    const record = entry.record;

    if (NON_TERMINAL_STATES.has(record.state)) {
      diagnostics.push({
        kind: "interrupted",
        severity: "critical",
        blocking: true,
        sessionId: record.sessionId,
        targetKeyHash: record.targetKeyHash,
        message:
          `Probe session ${record.sessionId} is in non-terminal state "${record.state}". ` +
          "A process crash mid-execution likely interrupted the lifecycle.",
      });
    } else if (record.state === "unresolved") {
      diagnostics.push({
        kind: "unresolved",
        severity: "critical",
        blocking: true,
        sessionId: record.sessionId,
        targetKeyHash: record.targetKeyHash,
        message:
          `Probe session ${record.sessionId} terminated as "unresolved" — ` +
          "manual cleanup is required to clear the durable state.",
      });
    }

    // Per-record digest cache: only within this record's iteration. The
    // mismatch check and the undecryptable check both resolve the same
    // handlerPath; sharing within one record avoids the double-read+hash.
    // NOT cached across records — TOCTOU invariant: each record must be
    // validated against live file state to detect mid-loop tampering.
    let currentDigest: string | undefined | null = null;
    async function digestOnce(): Promise<string | undefined> {
      if (currentDigest === null) {
        currentDigest = await dependencies.resolveCurrentHandlerDigest(record);
      }
      return currentDigest;
    }

    // Handler-digest mismatch is checked for ALL records with a recorded
    // sha256 (terminal rolled-back is the most common case, but the brief
    // specifies this as a cross-cutting integrity invariant).
    if (record.handlerSha256) {
      const current = await digestOnce();
      if (current !== undefined && current !== record.handlerSha256) {
        diagnostics.push({
          kind: "handler-mismatch",
          severity: "critical",
          blocking: true,
          sessionId: record.sessionId,
          targetKeyHash: record.targetKeyHash,
          message:
            `Handler file SHA-256 changed for session ${record.sessionId}: ` +
            `recorded=${record.handlerSha256.slice(0, 12)}… current=${current.slice(0, 12)}…. ` +
            "Code may have been tampered with — investigate before resuming.",
        });
      }
    }

    // Undecryptable: a terminal rolled-back with NO lastError envelope AND
    // no resolvable current handler. Treat as a warning that operator must
    // inspect the persisted (encrypted) payloads.
    if (record.state === "rolled-back" && !record.lastError) {
      const current = await digestOnce();
      if (current === undefined) {
        diagnostics.push({
          kind: "undecryptable",
          severity: "warning",
          blocking: false,
          sessionId: record.sessionId,
          targetKeyHash: record.targetKeyHash,
          message:
            `Terminal rolled-back session ${record.sessionId} has no lastError envelope ` +
            "and its current handler path cannot be resolved — payloads may be undecryptable.",
        });
      }
    }
  }

  // Orphan reservations: a reservation file exists whose sessionId has no
  // matching session file on disk. T9 establishes this as the desired
  // durable state after a crash between the two writes.
  diagnostics.push(...findOrphanReservations(records));

  return diagnostics;
}

function findOrphanReservations(
  records: ProbeSessionLoadResult[],
): ProbeDiagnostic[] {
  const orphanDiagnostics: ProbeDiagnostic[] = [];
  const liveSessionIds = new Set<string>();
  for (const entry of records) {
    if (entry.record) liveSessionIds.add(entry.record.sessionId);
  }

  let reservationFiles: string[];
  try {
    mkdirSync(PROBE_TARGETS_DIR, { recursive: true });
    reservationFiles = readdirSync(PROBE_TARGETS_DIR);
  } catch {
    return orphanDiagnostics;
  }

  for (const file of reservationFiles) {
    if (!file.endsWith(".reservation.json")) continue;
    const path = `${PROBE_TARGETS_DIR}/${file}`;
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as Record<string, unknown>)["sessionId"] !== "string" ||
      typeof (parsed as Record<string, unknown>)["targetKeyHash"] !== "string"
    ) {
      continue;
    }
    const sessionId = (parsed as Record<string, string>)["sessionId"]!;
    const targetKeyHash = (parsed as Record<string, string>)["targetKeyHash"]!;
    if (liveSessionIds.has(sessionId)) continue;
    orphanDiagnostics.push({
      kind: "orphan-reservation",
      severity: "critical",
      blocking: true,
      sessionId,
      targetKeyHash,
      message:
        `Reservation for session ${sessionId} (target ${targetKeyHash}) ` +
        "has no matching session file — target is blocked from new reservations until cleared.",
    });
  }

  return orphanDiagnostics;
}

// ─── Bootstrap wrappers ────────────────────────────────────────────────────

function ensureKastellDir(): void {
  try {
    secureMkdirSync(KASTELL_DIR);
  } catch {
    // best-effort — caller is best-effort too
  }
}

/**
 * Strict maintenance: classify sessions and run retention cleanup. Throws on
 * any unrecoverable error. Used by lifecycle tests and explicit operator
 * runs.
 */
async function runStrictProbeSessionMaintenance(): Promise<ProbeMaintenanceResult> {
  ensureKastellDir();
  const records = listProbeSessions();
  const diagnostics = await classifyProbeSessions(records, {
    resolveCurrentHandlerDigest,
  });
  const cleanup = cleanupFromStore();
  return { diagnostics, cleanup };
}

/**
 * Single public maintenance API with two contract overloads:
 *
 *   - `runProbeSessionMaintenance()` — strict mode. Throws on any
 *     unrecoverable error. Used by lifecycle tests and explicit operator
 *     runs.
 *
 *   - `runProbeSessionMaintenance({ strict: false })` — bootstrap mode.
 *     Catches every error, redacts it, security-logs, and returns a
 *     bounded `ProbeMaintenanceBootstrapResult` with optional `error`
 *     populated. NEVER throws. This is the ONLY contract bootstrap call
 *     sites (CLI startup, MCP server creation, doctor entry) should use.
 *
 * Test-env short-circuit contract (applies only to `{ strict: false }`):
 *   - In Jest (`NODE_ENV === "test"`), the bootstrap mode defaults to a
 *     no-op UNLESS `KASTELL_TEST_MODE === "1"` is set explicitly (via
 *     `tests/helpers/isolatedKastellEnv.ts`). The default-skip is the
 *     reason every Jest test that needs real probe maintenance must
 *     opt-in.
 *   - In production, `NODE_ENV` is not "test" by default — probe
 *     maintenance runs. A misconfigured production deployment that sets
 *     `NODE_ENV=test` (e.g. a CI pipeline mirror or a stray build flag)
 *     would silently skip cleanup, letting old probe sessions accumulate
 *     on disk. This is a bounded disk-pressure issue, not a security
 *     boundary, but if you are touching this branch, consider whether a
 *     hard `KASTELL_TEST_MODE` opt-in is now appropriate for your callers.
 *
 * The public overloads are the contract; the implementation signature
 * uses a union because internally both shapes must be produced.
 */
export function runProbeSessionMaintenance(): Promise<ProbeMaintenanceResult>;
export function runProbeSessionMaintenance(options: { strict: false }): Promise<ProbeMaintenanceBootstrapResult>;
export function runProbeSessionMaintenance(options: { strict?: true }): Promise<ProbeMaintenanceResult>;
export async function runProbeSessionMaintenance(
  options?: { strict?: boolean },
): Promise<ProbeMaintenanceResult | ProbeMaintenanceBootstrapResult> {
  if (options?.strict === false) {
    if (process.env.NODE_ENV === "test" && process.env.KASTELL_TEST_MODE !== "1") {
      return {
        diagnostics: [],
        cleanup: { deletedSessionIds: [], scannedAt: new Date().toISOString() },
      };
    }
    try {
      return await runStrictProbeSessionMaintenance();
    } catch (cause) {
      const error = redactError(cause);
      try {
        logSecurityEvent({
          level: "warn",
          action: "probe_maintenance_failed",
          category: "plugin-probe",
          result: "failure",
          reason: error.message,
        });
      } catch {
        // security log failure must never propagate
      }
      return {
        diagnostics: [],
        cleanup: { deletedSessionIds: [], scannedAt: new Date().toISOString() },
        error,
      };
    }
  }

  return await runStrictProbeSessionMaintenance();
}

function redactError(cause: unknown): RedactedProbeError {
  if (cause instanceof Error) {
    return {
      code: (cause as Error & { code?: string }).code ?? "PROBE_MAINTENANCE_ERROR",
      // Pass the raw message through the canonical probe redactor so JWTs,
      // Bearer tokens, and sensitive-key substrings never escape to logs.
      message: String(redactProbeDiagnostic(cause.message) ?? ""),
      stack: typeof cause.stack === "string" ? cause.stack.split("\n").slice(0, 3).join("\n") : undefined,
    };
  }
  return {
    code: "PROBE_MAINTENANCE_ERROR",
    message: typeof cause === "string" ? String(redactProbeDiagnostic(cause) ?? cause) : "Unknown maintenance failure",
  };
}

// ─── Doctor adapter (read-only) ─────────────────────────────────────────────
//
// Surface probe diagnostics into DoctorFinding for local, server, CLI, and
// MCP doctor paths. This module NEVER imports or invokes lifecycle handlers —
// it is a pure projection over `classifyProbeSessions` output. All probe
// findings are reported as `critical` regardless of the underlying diagnostic
// severity, and `fixCommand` is absent because probe findings require operator
// investigation (no auto-fix surface).

const SHORT_SESSION_ID_LEN = 8;

/** Stable, human-distinguishable suffix from a probe session UUID. */
export function shortSessionId(sessionId: string): string {
  // Strip non-[A-Za-z0-9_-] so the resulting ID is safe to embed in a
  // finding ID and shell-renderable. Empty/all-special input collapses to
  // "UNKNOWN" so consumers always get a non-empty, shell-safe token.
  const cleaned = sessionId.replace(/[^A-Za-z0-9_-]/g, "");
  if (cleaned.length === 0) return "UNKNOWN";
  return cleaned.length > SHORT_SESSION_ID_LEN
    ? cleaned.slice(0, SHORT_SESSION_ID_LEN)
    : cleaned;
}

/**
 * Adapter: project a single `ProbeDiagnostic` into the public `DoctorFinding`
 * shape. ALL probe findings are surfaced as `critical` (warning diagnostics
 * like `corrupt` and `undecryptable` are still surfaced because they block
 * resume — operator must investigate). `fixCommand` is intentionally absent:
 * no auto-fix path is offered for probe diagnostics.
 */
export function probeDiagnosticToDoctorFinding(
  diagnostic: ProbeDiagnostic,
): DoctorFinding {
  const sessionId = typeof diagnostic.sessionId === "string"
    ? diagnostic.sessionId
    : "UNKNOWN";
  const inspectionCommand = `kastell probe inspect ${sessionId}`;
  return {
    id: `PROBE_${diagnostic.kind.toUpperCase()}_${shortSessionId(sessionId)}`,
    severity: "critical",
    description: diagnostic.message,
    command: inspectionCommand,
    weight: DOCTOR_SEVERITY_WEIGHTS.critical,
  };
}

/**
 * Adapter: project probe diagnostics into local-doctor `CheckResult[]`.
 * One failed check per unresolved/interrupted/corrupt record. Rolled-back
 * records (terminal, handled by retention cleanup) produce NO finding.
 *
 * Doctor-actionable kinds (T12 review, Option A): unresolved | interrupted
 * | corrupt. The forensic kinds (`undecryptable`, `handler-mismatch`,
 * `orphan-reservation`) are intentionally excluded — they surface via the
 * dedicated probe commands, not doctor. This matches the server path.
 *
 * When `targetKeyHash` is provided, only diagnostics for that hash are
 * surfaced (server-identity filter — the same canonical hash that
 * `runServerDoctor` uses to scope findings to one server). When omitted,
 * all sessions across all configured servers are listed (CLI default).
 */
export async function runLocalProbeDoctorChecks(
  targetKeyHash?: string,
): Promise<CheckResult[]> {
  const result = await runProbeSessionMaintenance({ strict: false });
  const out: CheckResult[] = [];
  for (const diagnostic of result.diagnostics) {
    if (!DOCTOR_ACTIONABLE_KINDS.has(diagnostic.kind)) {
      continue;
    }
    if (
      targetKeyHash !== undefined &&
      diagnostic.targetKeyHash !== targetKeyHash
    ) {
      continue;
    }
    out.push({
      name: `Probe Session (${diagnostic.kind})`,
      status: "fail",
      detail: diagnostic.message,
    });
  }
  return out;
}
