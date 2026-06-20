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
//   3. Bootstrap wrappers: `runProbeSessionMaintenance` (strict, throws on
//      failure) and `tryRunProbeSessionMaintenance` (catches, redacts,
//      security-logs, returns bounded result). Bootstrap call sites (CLI,
//      MCP, doctor) must use the try-version so cleanup failure never
//      crashes startup.
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
import type { ProbeSessionRecord, RedactedProbeError } from "./types.js";
import {
  KASTELL_DIR,
  PROBE_TARGETS_DIR,
} from "../../utils/paths.js";
import { logSecurityEvent } from "../../utils/securityLogger.js";

// ─── Diagnostic kinds ──────────────────────────────────────────────────────

export type ProbeDiagnosticKind =
  | "interrupted"
  | "unresolved"
  | "corrupt"
  | "undecryptable"
  | "handler-mismatch"
  | "orphan-reservation";

export type ProbeDiagnosticSeverity = "critical" | "warning";

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

    // Handler-digest mismatch is checked for ALL records with a recorded
    // sha256 (terminal rolled-back is the most common case, but the brief
    // specifies this as a cross-cutting integrity invariant).
    if (record.handlerSha256) {
      const current = await dependencies.resolveCurrentHandlerDigest(record);
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
      const current = await dependencies.resolveCurrentHandlerDigest(record);
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
    mkdirSync(KASTELL_DIR, { recursive: true });
  } catch {
    // best-effort — caller is best-effort too
  }
}

/**
 * Strict maintenance: classify sessions and run retention cleanup. Throws on
 * any unrecoverable error. Used by lifecycle tests and explicit operator
 * runs.
 */
export async function runProbeSessionMaintenance(): Promise<ProbeMaintenanceResult> {
  ensureKastellDir();
  const records = listProbeSessions();
  const diagnostics = await classifyProbeSessions(records, {
    resolveCurrentHandlerDigest,
  });
  const cleanup = cleanupFromStore();
  return { diagnostics, cleanup };
}

/**
 * Safe wrapper for bootstrap call sites (CLI startup, MCP server creation,
 * doctor entry). Catches every error, redacts it, security-logs, and
 * returns a bounded result with `error` populated. NEVER throws.
 */
export async function tryRunProbeSessionMaintenance(): Promise<ProbeMaintenanceBootstrapResult> {
  try {
    const result = await runProbeSessionMaintenance();
    return result;
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

function redactError(cause: unknown): RedactedProbeError {
  if (cause instanceof Error) {
    return {
      code: (cause as Error & { code?: string }).code ?? "PROBE_MAINTENANCE_ERROR",
      message: cause.message,
      stack: typeof cause.stack === "string" ? cause.stack.split("\n").slice(0, 3).join("\n") : undefined,
    };
  }
  return {
    code: "PROBE_MAINTENANCE_ERROR",
    message: typeof cause === "string" ? cause : "Unknown maintenance failure",
  };
}
