// src/core/probe/sessionStore.ts
// Active Probe crash-safe reservations and CAS session transitions.
//
// Three invariants govern this layer:
//
//  1. Reservation identity is canonical and shared between the reservation
//     file name, the persisted `targetKeyHash`, and the security-log
//     `targetKey` field. IP and display name NEVER participate in exclusion
//     identity — mutable cloud attributes cannot prevent collisions.
//
//  2. Reservation is written BEFORE the preparing session. A crash between
//     writes leaves a blocking orphan reservation (this is the desired
//     blocking behavior — T10 will classify it for the operator).
//
//  3. State-machine transitions are CAS-protected: the writer must present
//     the exact current `state` and `revision` it observed. A matching
//     revision does NOT authorize an edge absent from ALLOWED_PROBE_TRANSITIONS.
//
// Confirmed pre-mutation cleanup is the ONLY deletion path from `preparing`.
// It is NOT a state transition — it deletes the preparing session first and
// the reservation last while holding the reservation critical section.

import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";

import { ValidationError } from "../../utils/errors.js";
import { atomicWriteFileSync } from "../../utils/atomicWrite.js";
import { KASTELL_DIR, PROBE_SESSIONS_DIR, PROBE_TARGETS_DIR } from "../../utils/paths.js";
import { withFileLock } from "../../utils/fileLock.js";
import { logSecurityEvent } from "../../utils/securityLogger.js";
import { assertProbeSessionEnvelopeSize, redactProbeDiagnostic } from "./payload.js";
import type {
  ActiveProbeRisk,
  EncryptedProbePayload,
  ProbeSessionRecord,
  ProbeSessionState,
  ProbeSessionTransition,
  ProbeTargetIdentity,
} from "./types.js";

// Re-exported for diagnostics / retention callers that need the full record
// type — T10 introduces the public `record` alias on `ProbeSessionLoadResult`,
// and T11 lifecycle callers will type their session argument against this.
export type { ProbeSessionRecord };

// ─── UUID dependency injection (test seam) ───────────────────────────────────
//
// `randomUUIDDependency` is the only seam used to generate session IDs.
// Tests reassign this variable (via `jest.replaceProperty`) to inject
// deterministic UUIDs; production code is unchanged. The defensive v4
// regex is still applied — invalid UUIDs throw ProbeSessionConflictError
// rather than silently writing a malformed filename.

let randomUUIDDependency: () => string = randomUUID;

export function setRandomUUIDDependencyForTesting(fn: () => string): void {
  randomUUIDDependency = fn;
}

export function resetRandomUUIDDependencyForTesting(): void {
  randomUUIDDependency = randomUUID;
}

// ─── Public contracts ───────────────────────────────────────────────────────

export interface NewProbeSession {
  pluginName: string;
  pluginVersion: string;
  checkId: string;
  handlerPath: string;
  handlerSha256: string;
  risk: ActiveProbeRisk;
  timeoutMs: number;
  target: ProbeTargetIdentity;
  reason?: string;
}

export interface ProbeTransitionUpdate {
  toState: ProbeSessionState;
  reason?: string;
  expectedTerminal?: boolean;
  /**
   * Marker that the caller intends to write a payload slot on this
   * transition. The slot field is passed through {@link payload}; the
   * store writes the encrypted envelope onto the durable record.
   */
  setHistory?: boolean;
  /** T11: encrypted payload slot to write on this transition. */
  payload?: { slot: "prepared" | "executed" | "verification" | "rollback"; encrypted: EncryptedProbePayload };
}

export interface ProbeSessionLoadResult {
  sessionId: string;
  loaded: ProbeSessionRecord | null;
  /**
   * Alias of `loaded`. T10 callers (diagnostics, retention) prefer the
   * `record` shape; T9 callers (and the loader itself) populate `loaded`.
   * The two refer to the same underlying value.
   */
  record?: ProbeSessionRecord | null;
  reason?: string;
}

export interface ProbeSessionFacade {
  reserve(input: NewProbeSession): Promise<ProbeSessionRecord>;
  transition(
    session: ProbeSessionRecord,
    update: ProbeTransitionUpdate,
  ): Promise<ProbeSessionRecord>;
  removeConfirmedPreMutationSession(session: ProbeSessionRecord): Promise<void>;
  releaseRolledBackReservation(session: ProbeSessionRecord): Promise<void>;
}

// ─── Errors ─────────────────────────────────────────────────────────────────

export class ProbeSessionConflictError extends ValidationError {
  constructor(
    message: string,
    options?: { cause?: unknown; hint?: string },
  ) {
    super(message, { code: "PROBE_SESSION_CONFLICT", ...options });
  }
}

export class ProbeSessionNotFoundError extends ValidationError {
  constructor(
    message: string,
    options?: { cause?: unknown; hint?: string },
  ) {
    super(message, { code: "PROBE_SESSION_NOT_FOUND", ...options });
  }
}

export class ProbeSessionInvalidTransitionError extends ValidationError {
  constructor(
    message: string,
    options?: { cause?: unknown; hint?: string },
  ) {
    super(message, { code: "PROBE_SESSION_INVALID_TRANSITION", ...options });
  }
}

// ─── Lifecycle graph (source of truth) ──────────────────────────────────────

export const ALLOWED_PROBE_TRANSITIONS: Readonly<
  Record<ProbeSessionState, readonly ProbeSessionState[]>
> = {
  preparing: ["prepared", "unresolved"],
  prepared: ["executing"],
  executing: ["executed", "rollback-pending", "unresolved"],
  executed: ["verifying", "rollback-pending", "unresolved"],
  verifying: ["verified", "rollback-pending", "unresolved"],
  verified: ["rollback-pending", "unresolved"],
  "rollback-pending": ["rolling-back", "unresolved"],
  "rolling-back": ["rolled-back", "unresolved"],
  "rolled-back": [],
  unresolved: [],
};

const TERMINAL_STATES: ReadonlySet<ProbeSessionState> = new Set([
  "rolled-back",
  "unresolved",
]);

const MAX_UUID_REVISION = 0xffffffffffff; // RFC 4122 variant mask sanity guard

// ─── UUID generation ────────────────────────────────────────────────────────

function generateSessionId(): string {
  const id = randomUUIDDependency();
  // Defensive: the Node crypto.randomUUID() is always RFC 4122 v4. If a
  // future Node change ever returns something else, surface it loudly
  // instead of letting an invalid filename slip through.
  if (!UUID_V4_RE.test(id)) {
    throw new ProbeSessionConflictError(
      "Generated session ID is not a valid RFC 4122 UUID v4 — refusing to write",
      { hint: "Inspect randomUUID() output; do not retry the reservation" },
    );
  }
  return id;
}

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ─── Canonical target key + hash (shared by reservation + security log) ────

export function canonicalProbeTargetKey(target: ProbeTargetIdentity): string {
  return JSON.stringify([
    "probe-target-v1",
    target.provider,
    target.cloudId
      ? ["cloud", target.cloudId]
      : ["record", target.serverId],
  ]);
}

export function hashProbeTarget(target: ProbeTargetIdentity): string {
  return createHash("sha256")
    .update(canonicalProbeTargetKey(target), "utf8")
    .digest("hex");
}

function reservationPathFor(targetKeyHash: string): string {
  return join(PROBE_TARGETS_DIR, `${targetKeyHash}.reservation.json`);
}

function sessionPathFor(sessionId: string): string {
  return join(PROBE_SESSIONS_DIR, `${sessionId}.session.json`);
}

// ─── Filesystem helpers ─────────────────────────────────────────────────────

function ensureSessionDirs(): void {
  mkdirSync(KASTELL_DIR, { recursive: true });
  mkdirSync(PROBE_SESSIONS_DIR, { recursive: true });
  mkdirSync(PROBE_TARGETS_DIR, { recursive: true });
}

function writeProbeSecret(path: string, content: string): void {
  atomicWriteFileSync(path, content, {
    encoding: "utf8",
    sensitivity: "secret",
    allowCopyFallback: false,
  });
}

function unlinkProbeSecret(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // best-effort — caller already has the durable state they need
  }
}

// ─── Reservation JSON shape (small, durable lock marker) ─────────────────────

interface ProbeReservation {
  schemaVersion: 1;
  targetKeyHash: string;
  sessionId: string;
  createdAt: string;
}

function writeReservation(targetKeyHash: string, sessionId: string): void {
  const reservation: ProbeReservation = {
    schemaVersion: 1,
    targetKeyHash,
    sessionId,
    createdAt: new Date().toISOString(),
  };
  writeProbeSecret(reservationPathFor(targetKeyHash), JSON.stringify(reservation));
}

function loadReservation(targetKeyHash: string): ProbeReservation | null {
  const path = reservationPathFor(targetKeyHash);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as ProbeReservation;
    if (
      parsed &&
      parsed.schemaVersion === 1 &&
      typeof parsed.targetKeyHash === "string" &&
      typeof parsed.sessionId === "string" &&
      typeof parsed.createdAt === "string"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Session read/write helpers ─────────────────────────────────────────────

function loadSessionById(sessionId: string): ProbeSessionRecord | null {
  const path = sessionPathFor(sessionId);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as ProbeSessionRecord;
  } catch {
    return null;
  }
}

function buildPreparingRecord(input: NewProbeSession, sessionId: string): ProbeSessionRecord {
  const now = new Date().toISOString();
  const record: ProbeSessionRecord = {
    schemaVersion: 1,
    revision: 1,
    sessionId,
    targetKeyHash: hashProbeTarget(input.target),
    state: "preparing",
    pluginName: input.pluginName,
    pluginVersion: input.pluginVersion,
    checkId: input.checkId,
    handlerPath: input.handlerPath,
    handlerSha256: input.handlerSha256,
    risk: input.risk,
    timeoutMs: input.timeoutMs,
    target: input.target,
    createdAt: now,
    updatedAt: now,
    history: [],
  };
  assertProbeSessionEnvelopeSize(record);
  return record;
}

function persistSessionRecord(record: ProbeSessionRecord): void {
  // Defensive sanity check before write — caller should already have passed
  // the size guard, but we re-validate in case a caller mutates the record
  // after the initial check.
  assertProbeSessionEnvelopeSize(record);
  writeProbeSecret(sessionPathFor(record.sessionId), JSON.stringify(record));
}

function appendHistory(
  record: ProbeSessionRecord,
  to: ProbeSessionState,
  reason?: string,
): ProbeSessionTransition[] {
  const transition: ProbeSessionTransition = {
    from: record.state,
    to,
    at: new Date().toISOString(),
    ...(reason ? { reason } : {}),
  };
  return [...record.history, transition];
}

function validateExpectedStateAndRevision(
  current: ProbeSessionRecord,
  expected: { state: ProbeSessionState; revision: number },
): void {
  if (current.state !== expected.state) {
    throw new ProbeSessionConflictError(
      `Probe session ${current.sessionId} expected state "${expected.state}" ` +
        `but found "${current.state}"`,
      { hint: "Re-read the session and retry with the actual current state/revision" },
    );
  }
  if (current.revision !== expected.revision) {
    throw new ProbeSessionConflictError(
      `Probe session ${current.sessionId} expected revision ${expected.revision} ` +
        `but found ${current.revision}`,
      { hint: "Re-read the session and retry with the actual current state/revision" },
    );
  }
}

function validateTransitionEdge(from: ProbeSessionState, to: ProbeSessionState): void {
  const allowed = ALLOWED_PROBE_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new ProbeSessionInvalidTransitionError(
      `Probe session cannot transition from "${from}" to "${to}"`,
      { hint: "See ALLOWED_PROBE_TRANSITIONS for the canonical lifecycle graph" },
    );
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Reserve a target for a new Active Probe session.
 *
 * Reservation is written FIRST under the per-target file lock; the preparing
 * session is written second. A crash between writes leaves a blocking orphan
 * reservation — this is the desired blocking behavior (T10 classifies it).
 *
 * A crash between the two writes must NOT prevent a later writer from
 * observing the durable reservation. The hash is stable; the reservation
 * filename is stable; the second reservation attempt with the same target
 * will see the durable reservation and fail closed.
 */
export async function reserveProbeTarget(input: NewProbeSession): Promise<ProbeSessionRecord> {
  ensureSessionDirs();
  const targetKeyHash = hashProbeTarget(input.target);
  const sessionId = generateSessionId();
  const reservationPath = reservationPathFor(targetKeyHash);

  return withFileLock(reservationPath, async () => {
    // Inside the lock: another writer may have just placed a reservation.
    const existing = loadReservation(targetKeyHash);
    if (existing) {
      logSecurityEvent({
        level: "warn",
        action: "probe_reservation_conflict",
        category: "config",
        server: input.target.serverId,
        result: "block",
        reason: "target already reserved",
      });
      throw new ProbeSessionConflictError(
        `Target already reserved by session ${existing.sessionId}`,
        { hint: "Wait for the previous session to terminate or call removeConfirmedPreMutationSession" },
      );
    }

    // 1) Write reservation FIRST (durability anchor).
    writeReservation(targetKeyHash, sessionId);

    // 2) Write preparing session. If this throws, the reservation stays
    //    blocking — desired. Reservation cleanup is the responsibility of
    //    removeConfirmedPreMutationSession (only valid for `preparing`).
    const record = buildPreparingRecord(input, sessionId);
    try {
      persistSessionRecord(record);
    } catch (cause) {
      logSecurityEvent({
        level: "error",
        action: "probe_session_write_failed",
        category: "config",
        server: input.target.serverId,
        result: "failure",
        reason: "preparing session write failed after reservation was placed",
      });
      throw cause;
    }

    logSecurityEvent({
      level: "info",
      action: "probe_session_reserved",
      category: "config",
      server: input.target.serverId,
      result: "success",
    });

    return record;
  });
}

/**
 * CAS-protect a session transition. Caller presents the exact current state
 * and revision it observed; the store re-reads the durable record under the
 * per-session lock and either applies the transition or rejects with
 * {@link ProbeSessionConflictError}.
 *
 * The transition edge must be present in {@link ALLOWED_PROBE_TRANSITIONS}.
 * A matching revision does NOT authorize an edge absent from that table.
 */
export async function transitionProbeSession(
  sessionId: string,
  expected: { state: ProbeSessionState; revision: number },
  update: ProbeTransitionUpdate,
): Promise<ProbeSessionRecord> {
  ensureSessionDirs();
  const path = sessionPathFor(sessionId);
  return withFileLock(path, async () => {
    const current = loadSessionById(sessionId);
    if (!current) {
      throw new ProbeSessionNotFoundError(
        `Probe session ${sessionId} not found`,
        { hint: "The session may have been garbage collected; do not retry" },
      );
    }
    validateExpectedStateAndRevision(current, expected);
    validateTransitionEdge(current.state, update.toState);

    const now = new Date().toISOString();
    const history = appendHistory(current, update.toState, update.reason);
    const next: ProbeSessionRecord = {
      ...current,
      revision: current.revision + 1,
      state: update.toState,
      updatedAt: now,
      history,
      ...(TERMINAL_STATES.has(update.toState) ? { terminalAt: now } : {}),
      ...(update.payload
        ? { [update.payload.slot]: update.payload.encrypted }
        : {}),
      ...(update.reason
        ? {
            lastError: {
              code: "PROBE_EXEC",
              // Defense-in-depth: redact secrets from the persisted
              // lastError.message even though the envelope is encrypted at
              // rest. The redactor strips JWTs, Bearer tokens, and
              // sensitive keys (token, password, secret, apiKey, ...).
              // review: P144 review Important #1.
              message: redactProbeDiagnostic(update.reason) as string,
            },
          }
        : {}),
    };
    assertProbeSessionEnvelopeSize(next);
    persistSessionRecord(next);

    // Rolled-back is the only terminal state that releases the reservation
    // atomically. Release happens AFTER the durable session write so a crash
    // mid-rollback leaves a recoverable (session + reservation) pair, never
    // a released reservation with a dangling session.
    if (update.toState === "rolled-back") {
      await releaseReservationInternal(current.targetKeyHash, sessionId);
    }

    return next;
  });
}

/**
 * Release a session's reservation. Callers should normally use the
 * lifecycle facade (`releaseRolledBackReservation`) — this low-level helper
 * is exposed for tests and for callers that already hold the target hash.
 */
export async function releaseProbeReservation(session: ProbeSessionRecord): Promise<void> {
  await releaseReservationInternal(session.targetKeyHash, session.sessionId);
}

async function releaseReservationInternal(
  targetKeyHash: string,
  sessionId: string,
): Promise<void> {
  const reservationPath = reservationPathFor(targetKeyHash);
  await withFileLock(reservationPath, async () => {
    const reservation = loadReservation(targetKeyHash);
    if (reservation && reservation.sessionId === sessionId) {
      unlinkProbeSecret(reservationPath);
    }
    // A reservation owned by a different session is left alone — it might
    // belong to a newer writer that won the race while we were rolling back.
  });
}

/**
 * Load a session by id. Returns null if the durable file is missing.
 * Use {@link listProbeSessions} for enumeration.
 */
export function loadProbeSession(sessionId: string): ProbeSessionRecord {
  const record = loadSessionById(sessionId);
  if (!record) {
    throw new ProbeSessionNotFoundError(`Probe session ${sessionId} not found`);
  }
  return record;
}

/**
 * Enumerate all durable sessions on disk. Records that fail JSON parse are
 * returned with `loaded: null` and a `reason` string for the operator.
 */
export function listProbeSessions(): ProbeSessionLoadResult[] {
  ensureSessionDirs();
  const results: ProbeSessionLoadResult[] = [];
  let entries: string[];
  try {
    entries = readdirSync(PROBE_SESSIONS_DIR);
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".session.json")) continue;
    const sessionId = entry.slice(0, -".session.json".length);
    const record = loadSessionById(sessionId);
    if (record) {
      results.push({ sessionId, loaded: record, record });
    } else {
      results.push({ sessionId, loaded: null, record: null, reason: "json-parse-failed" });
    }
  }
  return results;
}

// ─── Facade for T11 ─────────────────────────────────────────────────────────

export function createProbeSessionFacade(): ProbeSessionFacade {
  return {
    reserve: reserveProbeTarget,
    async transition(session, update) {
      return transitionProbeSession(
        session.sessionId,
        { state: session.state, revision: session.revision },
        update,
      );
    },
    async removeConfirmedPreMutationSession(session) {
      // ONLY valid for `preparing`. A non-preparing session has durable
      // state worth keeping; never use this path to "clean up" later states.
      if (session.state !== "preparing") {
        throw new ProbeSessionInvalidTransitionError(
          `removeConfirmedPreMutationSession only valid for "preparing", got "${session.state}"`,
        );
      }
      ensureSessionDirs();
      await withFileLock(reservationPathFor(session.targetKeyHash), async () => {
        // Delete the preparing session FIRST. A crash here leaves a session
        // file but no reservation — recoverable by T10. A crash after the
        // reservation delete leaves the reservation cleared (durable state
        // matches). Failure here leaves a blocking reservation, which is
        // the desired safety behavior.
        unlinkProbeSecret(sessionPathFor(session.sessionId));
        const reservation = loadReservation(session.targetKeyHash);
        if (reservation && reservation.sessionId === session.sessionId) {
          unlinkProbeSecret(reservationPathFor(session.targetKeyHash));
        }
      });
    },
    releaseRolledBackReservation(session) {
      return releaseReservationInternal(session.targetKeyHash, session.sessionId);
    },
  };
}

// Re-export for tests that want to introspect.
export const _internal = {
  reservationPathFor,
  sessionPathFor,
  MAX_UUID_REVISION,
};

// ─── Retention (T10) ────────────────────────────────────────────────────────
//
// Retention policy: only `rolled-back` sessions older than 30 days delete.
// Every other durable state (preparing, executing, executed, verifying,
// verified, rollback-pending, rolling-back, unresolved) is security-relevant
// evidence and is NEVER deleted by retention. Corrupt records (json-parse
// failures) are reported as diagnostics and never auto-deleted.
//
// Cleanup acquires the per-session file lock and the per-target reservation
// lock, re-reads the session under the lock, and only deletes when:
//   - state is still "rolled-back" (re-read under lock);
//   - targetKeyHash matches a live reservation belonging to the same session;
//   - terminalAt is parseable, in the past, and strictly older than 30 days.

const MS_PER_DAY_RETENTION = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 30;
const RETENTION_THRESHOLD_MS = MS_PER_DAY_RETENTION * RETENTION_DAYS;

export interface ProbeCleanupResult {
  deletedSessionIds: string[];
  scannedAt: string;
}

function isRetentionEligible(record: ProbeSessionRecord, now: Date): boolean {
  if (record.state !== "rolled-back") return false;
  if (typeof record.terminalAt !== "string") return false;
  const ts = Date.parse(record.terminalAt);
  if (Number.isNaN(ts)) return false;
  // Strictly older than 30 days. Exactly 30 days is NOT eligible.
  return now.getTime() - ts > RETENTION_THRESHOLD_MS;
}

export function cleanupExpiredProbeSessions(now: Date = new Date()): ProbeCleanupResult {
  const scannedAt = now.toISOString();
  const deletedSessionIds: string[] = [];

  ensureSessionDirs();
  const results = listProbeSessions();

  for (const entry of results) {
    if (!entry.record) continue;
    if (!isRetentionEligible(entry.record, now)) continue;

    // Drain each candidate under its own short per-record locks. We never
    // acquire a directory-global or lifecycle-length lock — concurrent
    // probe writers must continue to make progress.
    const deleted = drainRetentionCandidate(
      entry.record.sessionId,
      entry.record.targetKeyHash,
      now,
    );
    if (deleted) {
      deletedSessionIds.push(entry.record.sessionId);
      logSecurityEvent({
        level: "info",
        action: "probe_session_retention_deleted",
        category: "plugin-probe",
        result: "success",
        reason: `rolled-back older than ${RETENTION_DAYS} days`,
      });
    }
  }

  return { deletedSessionIds, scannedAt };
}

/**
 * Drain a single retention candidate under the per-session AND per-reservation
 * locks. Re-reads the session record under the lock; if state has changed
 * (e.g. a concurrent writer resumed the probe), the record is left alone.
 * Returns true only when BOTH the session and the reservation were deleted.
 *
 * Synchronous — uses mkdirSync as an atomic lock primitive. The brief
 * requires `cleanupExpiredProbeSessions` to be a sync function; we trade
 * async reclaim semantics for the synchronous public API. Concurrent probe
 * writers that hold the same lock will block on mkdirSync EEXIST briefly.
 */
function drainRetentionCandidate(
  sessionId: string,
  targetKeyHash: string,
  now: Date,
): boolean {
  const sessionPath = sessionPathFor(sessionId);
  const reservationPath = reservationPathFor(targetKeyHash);
  const reservationLockDir = reservationPath + ".lock";
  const sessionLockDir = sessionPath + ".lock";

  // Acquire reservation lock FIRST — matches canonical write ordering.
  if (!acquireSyncLock(reservationLockDir)) return false;
  try {
    if (!acquireSyncLock(sessionLockDir)) return false;
    try {
      // Re-read under lock — a concurrent writer may have flipped the state.
      const current = loadSessionById(sessionId);
      if (!current) return false;
      if (!isRetentionEligible(current, now)) return false;

      // The reservation may have already been released by the rolled-back
      // transition (the canonical lifecycle releases it before we delete).
      // We tolerate both cases: either the reservation is gone, or it
      // belongs to THIS session. A foreign reservation is left alone — that
      // means a newer writer won the target while we were queued, so we
      // do NOT delete (the newer writer's session is its own concern).
      const reservation = loadReservation(targetKeyHash);
      if (reservation && reservation.sessionId !== sessionId) return false;

      // Delete session first. Reservation may or may not exist — only
      // remove it if present and ours.
      unlinkProbeSecret(sessionPath);
      if (reservation) {
        unlinkProbeSecret(reservationPath);
      }
      return true;
    } finally {
      releaseSyncLock(sessionLockDir);
    }
  } finally {
    releaseSyncLock(reservationLockDir);
  }
}

/**
 * Synchronous mkdir-based lock. Returns true if the lock was acquired,
 * false if another holder exists. mkdirSync is atomic on POSIX and on
 * Windows (CreateDirectoryW returns ERROR_ALREADY_EXISTS). Stale lock
 * reclamation matches the async withFileLock threshold (30s).
 */
const SYNC_LOCK_STALE_MS = 30_000;

function acquireSyncLock(lockDir: string): boolean {
  try {
    mkdirSync(lockDir);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") return false;
    // Stale lock reclaim — if lock is older than threshold, remove it.
    try {
      const stat = statSync(lockDir);
      if (Date.now() - stat.mtimeMs > SYNC_LOCK_STALE_MS) {
        try { rmSync(lockDir, { recursive: true, force: true }); } catch { /* ignore */ }
        try { mkdirSync(lockDir); return true; } catch { return false; }
      }
    } catch { /* lock dir disappeared */ }
    return false;
  }
}

function releaseSyncLock(lockDir: string): void {
  try { rmSync(lockDir, { recursive: true, force: true }); } catch { /* ignore */ }
}