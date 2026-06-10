import { mkdirSync, rmSync, statSync, writeFileSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { hostname } from "os";
import { DEFAULT_PERMISSION_RETRY_ATTEMPTS, DEFAULT_PERMISSION_RETRY_DELAY_MS, retryOnPermission } from "./fsRetry.js";

const STALE_THRESHOLD_MS = 30_000;
// Reclaim even when probeProcess reports "alive" (guards against clock drift, zombies, PID reuse).
const HARD_CEILING_MS = 60_000;

interface LockRemovalResult {
  removed: boolean;
  error?: unknown;
  errorCode?: string;
}

function removeLockDirBestEffort(lockDir: string): LockRemovalResult {
  try {
    retryOnPermission(() => rmSync(lockDir, { recursive: true, force: true }), {
      attempts: DEFAULT_PERMISSION_RETRY_ATTEMPTS,
      delayMs: DEFAULT_PERMISSION_RETRY_DELAY_MS,
    });
    return { removed: true };
  } catch (error) {
    return {
      removed: false,
      error,
      errorCode: (error as NodeJS.ErrnoException).code,
    };
  }
}

/** Module-local wrapper for testability — DO NOT inline `process.kill`. */
export function probeProcess(pid: number): "alive" | "dead" | "unknown" {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return "dead";
    return "unknown";
  }
}

interface ParsedPidFile {
  pid: number;
  host: string;
}

function readPidFile(lockDir: string): ParsedPidFile | null {
  try {
    const raw = readFileSync(join(lockDir, "owner.pid"), "utf-8");
    const parts = raw.split("@");
    if (parts.length !== 3) return null;
    const pid = parseInt(parts[0], 10);
    if (isNaN(pid) || pid <= 0) return null;
    return { pid, host: parts[1] };
  } catch {
    return null;
  }
}

type ProbeFn = (pid: number) => "alive" | "dead" | "unknown";

type ProcessState = "alive" | "dead" | "unknown" | "not-probed";

interface LockDiagnostic {
  lockDir: string;
  ageMs: number | "unknown";
  ownerPid: number | "unknown";
  ownerHost: string | "unknown";
  processState: ProcessState;
  stale: boolean | "unknown";
  reclaimAttempted: boolean;
  reclaimErrorCode?: string;
  retries: number;
  totalWaitMs: number;
}

interface CollectLockDiagnosticOptions {
  reclaimAttempted: boolean;
  lastReclaimErrorCode?: string;
  retries: number;
  totalWaitMs: number;
}

function collectLockDiagnostic(
  lockDir: string,
  probe: ProbeFn,
  options: CollectLockDiagnosticOptions,
): LockDiagnostic {
  const result: LockDiagnostic = {
    lockDir,
    ageMs: "unknown",
    ownerPid: "unknown",
    ownerHost: "unknown",
    processState: "not-probed",
    stale: "unknown",
    reclaimAttempted: options.reclaimAttempted,
    reclaimErrorCode: options.lastReclaimErrorCode,
    retries: options.retries,
    totalWaitMs: options.totalWaitMs,
  };

  let mtimeMs: number;
  try {
    mtimeMs = statSync(lockDir).mtimeMs;
  } catch {
    // statSync failed — keep age/stale unknown
    return result;
  }
  const age = Date.now() - mtimeMs;
  result.ageMs = age;

  const parsed = readPidFile(lockDir);
  if (parsed) {
    result.ownerPid = parsed.pid;
    result.ownerHost = parsed.host;
  }

  let stale: boolean;
  if (parsed && parsed.host === hostname()) {
    const liveness = probe(parsed.pid);
    result.processState = liveness;
    if (liveness === "dead") stale = true;
    else if (liveness === "alive") stale = age > HARD_CEILING_MS;
    else stale = age > STALE_THRESHOLD_MS;
  } else {
    // cross-host, parse fail, or no PID file → mtime fallback
    stale = age > STALE_THRESHOLD_MS;
  }
  result.stale = stale;

  return result;
}

function formatLockDiagnostic(filePath: string, diagnostic: LockDiagnostic): string {
  const reclaimError = diagnostic.reclaimErrorCode ?? "none";
  return [
    `Could not acquire lock on ${filePath} after ${diagnostic.retries} retries ` +
      `(${diagnostic.totalWaitMs}ms).`,
    `lock=${diagnostic.lockDir}`,
    `ageMs=${diagnostic.ageMs}`,
    `ownerPid=${diagnostic.ownerPid}`,
    `ownerHost=${diagnostic.ownerHost}`,
    `processState=${diagnostic.processState}`,
    `stale=${diagnostic.stale}`,
    `reclaimAttempted=${diagnostic.reclaimAttempted}`,
    `reclaimError=${reclaimError}`,
    "Close other Kastell processes, then remove the stale lock only after verifying no writer is active.",
  ].join(" ");
}

function shouldReclaimStaleLock(lockDir: string, probe: ProbeFn): boolean {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(lockDir).mtimeMs;
  } catch {
    return false; // lock disappeared between checks
  }
  const age = Date.now() - mtimeMs;
  const parsed = readPidFile(lockDir);

  if (parsed && parsed.host === hostname()) {
    const liveness = probe(parsed.pid);
    if (liveness === "dead") return true;
    if (liveness === "alive") return age > HARD_CEILING_MS;
    // "unknown" → mtime fallback (aggressive: STALE_THRESHOLD_MS)
  }
  // farklı hostname, parse fail, PID file yok, veya "unknown" → mtime fallback
  return age > STALE_THRESHOLD_MS;
}

export async function withFileLock<T>(
  filePath: string,
  fn: () => Promise<T> | T,
  probe: ProbeFn = probeProcess,
): Promise<T> {
  const lockDir = filePath + ".lock";
  const maxRetries = 10;
  const retryDelay = 200;

  mkdirSync(dirname(lockDir), { recursive: true });

  for (let i = 0; i < maxRetries; i++) {
    try {
      mkdirSync(lockDir);
      try {
        try {
          writeFileSync(
            join(lockDir, "owner.pid"),
            `${process.pid}@${hostname()}@${Date.now()}`,
            { encoding: "utf-8" },
          );
        } catch {
          /* best effort — if PID write fails, mtime fallback still protects */
        }
        return await fn();
      } finally {
        try {
          removeLockDirBestEffort(lockDir);
        } catch {
          /* best effort */
        }
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        if (shouldReclaimStaleLock(lockDir, probe)) {
          const removal = removeLockDirBestEffort(lockDir);
          if (removal.removed) {
            continue;
          }
          // Stale and tried to reclaim, but failed — keep looping so next iteration
          // can collect a richer diagnostic if retries also exhaust.
          await new Promise((r) => setTimeout(r, retryDelay));
          continue;
        }
        await new Promise((r) => setTimeout(r, retryDelay));
        continue;
      }
      throw err;
    }
  }

  // Exhausted: collect best-effort diagnostic and throw with cause.
  // We re-probe through collectLockDiagnostic which mirrors the shouldReclaimStaleLock
  // path but tolerates statSync/readFileSync failures (returns "unknown" fields).
  let reclaimAttempted = false;
  let lastReclaimError: unknown;
  let lastReclaimErrorCode: string | undefined;
  // Best effort — re-attempt stale reclaim to surface its final error code.
  const probeForDiag: ProbeFn = probe;
  const lockForDiag = lockDir;
  let mtimeMs: number;
  try {
    mtimeMs = statSync(lockForDiag).mtimeMs;
  } catch {
    mtimeMs = -1;
  }
  if (mtimeMs >= 0) {
    const age = Date.now() - mtimeMs;
    const parsed = readPidFile(lockForDiag);
    let reclaimable: boolean;
    if (parsed && parsed.host === hostname()) {
      const liveness = probeForDiag(parsed.pid);
      if (liveness === "dead") reclaimable = true;
      else if (liveness === "alive") reclaimable = age > HARD_CEILING_MS;
      else reclaimable = age > STALE_THRESHOLD_MS;
    } else {
      reclaimable = age > STALE_THRESHOLD_MS;
    }
    if (reclaimable) {
      reclaimAttempted = true;
      const removal = removeLockDirBestEffort(lockForDiag);
      if (!removal.removed) {
        lastReclaimError = removal.error;
        lastReclaimErrorCode = removal.errorCode;
      }
    }
  }

  const diagnostic = collectLockDiagnostic(lockDir, probe, {
    reclaimAttempted,
    lastReclaimErrorCode,
    retries: maxRetries,
    totalWaitMs: maxRetries * retryDelay,
  });
  throw new Error(formatLockDiagnostic(filePath, diagnostic), {
    cause: lastReclaimError,
  });
}

/** Warn on stderr if a caught error is a permission issue. Returns true if it was a permission error. */
export function warnIfPermissionError(err: unknown, label: string): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "EACCES" || code === "EPERM") {
    process.stderr.write(`Warning: cannot read ${label} — ${code}\n`);
    return true;
  }
  return false;
}
