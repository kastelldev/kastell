import { mkdirSync, rmSync, statSync, writeFileSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { hostname } from "os";
import { createHash } from "crypto";
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
  ownerPid: string | "unknown";
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
  preAssessed?: LockAssessment;
}

interface LockAssessment {
  mtimeMs: number;
  parsed: ParsedPidFile | null;
  reclaimable: boolean;
}

function assessLockState(lockDir: string, probe: ProbeFn): LockAssessment | null {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(lockDir).mtimeMs;
  } catch {
    return null; // lock disappeared between checks
  }
  const age = Date.now() - mtimeMs;
  const parsed = readPidFile(lockDir);

  let reclaimable: boolean;
  if (parsed && parsed.host === hostname()) {
    const liveness = probe(parsed.pid);
    if (liveness === "dead") reclaimable = true;
    else if (liveness === "alive") reclaimable = age > HARD_CEILING_MS;
    // "unknown" → mtime fallback (aggressive: STALE_THRESHOLD_MS)
    else reclaimable = age > STALE_THRESHOLD_MS;
  } else {
    // farklı hostname, parse fail, veya PID file yok → mtime fallback
    reclaimable = age > STALE_THRESHOLD_MS;
  }
  return { mtimeMs, parsed, reclaimable };
}

function deriveProcessState(assessment: LockAssessment, probe: ProbeFn): ProcessState {
  if (!assessment.parsed) return "not-probed";
  if (assessment.parsed.host !== hostname()) return "not-probed";
  return probe(assessment.parsed.pid);
}

function hashPid(pid: number): string {
  return `hash:${createHash("sha256").update(String(pid)).digest("hex").slice(0, 8)}`;
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

  // If caller pre-assessed, reuse — avoid re-statSync / re-readFileSync / re-probe.
  const assessment = options.preAssessed;
  let age: number;
  let parsed: ParsedPidFile | null;
  if (assessment) {
    age = Date.now() - assessment.mtimeMs;
    result.ageMs = age;
    parsed = assessment.parsed;
    if (parsed) {
      result.ownerPid = hashPid(parsed.pid);
      result.ownerHost = "internal";
    }
    result.processState = deriveProcessState(assessment, probe);
  } else {
    let mtimeMs: number;
    try {
      mtimeMs = statSync(lockDir).mtimeMs;
    } catch {
      // statSync failed — keep age/stale unknown
      return result;
    }
    age = Date.now() - mtimeMs;
    result.ageMs = age;
    parsed = readPidFile(lockDir);
    if (parsed) {
      result.ownerPid = hashPid(parsed.pid);
      result.ownerHost = "internal";
    }
    result.processState = deriveProcessState(
      { mtimeMs, parsed, reclaimable: false },
      probe,
    );
  }

  // staleness — mirrors assessLockState's reclaimable decision.
  if (parsed && parsed.host === hostname()) {
    if (result.processState === "dead") result.stale = true;
    else if (result.processState === "alive") result.stale = age > HARD_CEILING_MS;
    else result.stale = age > STALE_THRESHOLD_MS;
  } else {
    result.stale = age > STALE_THRESHOLD_MS;
  }

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

export async function withFileLock<T>(
  filePath: string,
  fn: () => Promise<T> | T,
  probe: ProbeFn = probeProcess,
): Promise<T> {
  const lockDir = filePath + ".lock";
  const maxRetries = 10;
  const retryDelay = 200;

  mkdirSync(dirname(lockDir), { recursive: true });

  // Track the last assessment so the exhaust path can reuse it instead of
  // re-running statSync / readPidFile / probe (Reuse-F7, Efficiency-F2).
  let lastAssessment: LockAssessment | null = null;

  const runWithAcquiredLock = async (): Promise<T> => {
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
      removeLockDirBestEffort(lockDir);
    }
  };

  for (let i = 0; i < maxRetries; i++) {
    try {
      mkdirSync(lockDir);
      return await runWithAcquiredLock();
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        const assessment = assessLockState(lockDir, probe);
        lastAssessment = assessment;
        if (assessment?.reclaimable) {
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

  // Exhausted: reuse the last assessment and attempt a final best-effort reclaim
  // to surface the rmSync error code in the diagnostic.
  let reclaimAttempted = false;
  let lastReclaimError: unknown;
  let lastReclaimErrorCode: string | undefined;
  if (lastAssessment?.reclaimable) {
    reclaimAttempted = true;
    const removal = removeLockDirBestEffort(lockDir);
    if (removal.removed) {
      try {
        mkdirSync(lockDir);
        return await runWithAcquiredLock();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error;
        }
        lastAssessment = assessLockState(lockDir, probe);
      }
    } else {
      lastReclaimError = removal.error;
      lastReclaimErrorCode = removal.errorCode;
    }
  }

  const diagnostic = collectLockDiagnostic(lockDir, probe, {
    reclaimAttempted,
    lastReclaimErrorCode,
    retries: maxRetries,
    totalWaitMs: maxRetries * retryDelay,
    preAssessed: lastAssessment ?? undefined,
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
