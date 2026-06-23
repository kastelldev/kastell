import { copyFileSync, renameSync } from "fs";
import { performance } from "perf_hooks";
import { secureWriteFileSync, type SecureWriteOptions } from "./secureWrite.js";
import {
  DEFAULT_PERMISSION_RETRY_ATTEMPTS,
  DEFAULT_PERMISSION_RETRY_DELAY_MS,
  isPermissionError,
  retryOnPermission,
  unlinkBestEffort,
} from "./fsRetry.js";

export interface AtomicWriteOptions extends SecureWriteOptions {
  attempts?: number;
  delayMs?: number;
  /**
   * When true (default), exhausted permission retries fall back to
   * `copyFileSync + unlinkSync` so the destination still receives the new
   * bytes (non-atomic but durable on most filesystems).
   *
   * When false, exhausted permission retries remove the temporary file and
   * throw WITHOUT copying over the destination. The previous durable
   * contents are preserved untouched. Callers that cannot tolerate torn
   * state under crash (e.g. Active Probe session persistence) MUST pass
   * `allowCopyFallback: false` and wrap writes in a file lock.
   */
  allowCopyFallback?: boolean;
}

/**
 * Diagnostic error thrown when atomic write retries are exhausted.
 *
 * Carries:
 *  - `target` — destination path the write could not land on
 *  - `attempts` — number of rename attempts (matches caller's request)
 *  - `elapsedMs` — wall-clock time spent in the retry loop
 *  - `finalCode` — last seen errno code (e.g. EPERM, EIO)
 *  - `stage` — `"rename"` (primary path exhausted) or `"copy"` (fallback failed)
 *  - `cause` — the original error instance, preserved for downstream handlers
 *
 * The message includes the target path and stage so the failure is greppable
 * in logs. We intentionally do NOT echo the original error's `message`
 * verbatim (it may include paths or environment-specific data the caller
 * has not whitelisted).
 */
export class AtomicWriteExhaustedError extends Error {
  readonly target: string;
  readonly attempts: number;
  readonly elapsedMs: number;
  readonly finalCode: string;
  readonly stage: "rename" | "copy";
  override readonly cause: Error;

  constructor(details: {
    target: string;
    attempts: number;
    elapsedMs: number;
    finalCode: string;
    stage: "rename" | "copy";
    cause: Error;
  }) {
    super(
      `atomic write to "${details.target}" exhausted after ${details.attempts} ` +
        `attempt(s) at stage "${details.stage}" (elapsed ${details.elapsedMs}ms, ` +
        `final code ${details.finalCode})`,
      { cause: details.cause },
    );
    this.name = "AtomicWriteExhaustedError";
    this.target = details.target;
    this.attempts = details.attempts;
    this.elapsedMs = details.elapsedMs;
    this.finalCode = details.finalCode;
    this.stage = details.stage;
    this.cause = details.cause;
    Object.setPrototypeOf(this, AtomicWriteExhaustedError.prototype);
  }
}

/**
 * Write a file through `targetPath + ".tmp"` and rename it into place.
 *
 * `renameSync()` is the primary path and is atomic. On transient Windows
 * permission failures from file scanners (antivirus, OneDrive, search indexer)
 * or sync clients, this helper retries. If retries exhaust on permission
 * errors, it falls back to `copyFileSync + unlinkSync`. That fallback is
 * best-effort and not atomic — under crash between `copyFileSync` and
 * `unlinkSync`, the target may be left torn between the old and new content.
 * Callers that cannot tolerate torn state must wrap the call in a file lock
 * (see `withFileLock`). Safe to call repeatedly with the same `targetPath`.
 *
 * Retry sleeps are synchronous and block the CLI process briefly.
 *
 * @throws The original non-permission rename error (propagated unchanged so
 *         callers can classify by `err.code`), or an
 *         {@link AtomicWriteExhaustedError} when retries are exhausted on
 *         permission errors (rename stage) OR when the copy fallback itself
 *         fails (copy stage).
 */
export function atomicWriteFileSync(
  targetPath: string,
  content: string,
  options: AtomicWriteOptions = {},
): void {
  const tmpFile = `${targetPath}.tmp`;
  const {
    attempts = DEFAULT_PERMISSION_RETRY_ATTEMPTS,
    delayMs = DEFAULT_PERMISSION_RETRY_DELAY_MS,
    allowCopyFallback = true,
    ...writeOptions
  } = options;

  secureWriteFileSync(tmpFile, content, writeOptions);

  const startedAt = performance.now();
  try {
    retryOnPermission(() => renameSync(tmpFile, targetPath), { attempts, delayMs });
  } catch (renameErr) {
    // Non-permission error → propagate immediately (callers classify by code).
    // Permission errors are exhausted here, so the copy fallback takes over
    // unless the caller explicitly opted out (allowCopyFallback === false).
    if (!isPermissionError(renameErr)) {
      unlinkBestEffort(tmpFile);
      throw renameErr;
    }
    if (!allowCopyFallback) {
      // Caller refuses non-atomic fallback. Remove the temp file and surface
      // a "rename"-stage exhaustion error so the previous durable contents
      // stay untouched. Wrap the original rename error as the cause.
      unlinkBestEffort(tmpFile);
      const renameErrno = renameErr as NodeJS.ErrnoException;
      throw new AtomicWriteExhaustedError({
        target: targetPath,
        attempts,
        elapsedMs: Math.round(performance.now() - startedAt),
        finalCode: renameErrno.code ?? "EPERM",
        stage: "rename",
        cause: renameErr instanceof Error ? renameErr : new Error(String(renameErr)),
      });
    }
    // Permission errors exhausted. Try the copy fallback; on failure, throw
    // with stage "copy" so the operator can tell which step died.
    try {
      copyFileSync(tmpFile, targetPath);
    } catch (copyErr) {
      unlinkBestEffort(tmpFile);
      const copyErrno = copyErr as NodeJS.ErrnoException;
      throw new AtomicWriteExhaustedError({
        target: targetPath,
        attempts,
        elapsedMs: Math.round(performance.now() - startedAt),
        finalCode: copyErrno.code ?? "EIO",
        stage: "copy",
        cause: copyErr instanceof Error ? copyErr : new Error(String(copyErr)),
      });
    }
    unlinkBestEffort(tmpFile);
  }
}
