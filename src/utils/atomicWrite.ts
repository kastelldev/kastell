import { copyFileSync, renameSync } from "fs";
import { performance } from "perf_hooks";
import { secureWriteFileSync, type WriteFileOptions } from "./secureWrite.js";
import {
  DEFAULT_PERMISSION_RETRY_ATTEMPTS,
  DEFAULT_PERMISSION_RETRY_DELAY_MS,
  isPermissionError,
  retryOnPermission,
  unlinkBestEffort,
} from "./fsRetry.js";

export interface AtomicWriteOptions extends WriteFileOptions {
  attempts?: number;
  delayMs?: number;
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
  const { attempts = DEFAULT_PERMISSION_RETRY_ATTEMPTS, delayMs = DEFAULT_PERMISSION_RETRY_DELAY_MS, ...writeOptions } = options;

  secureWriteFileSync(tmpFile, content, writeOptions);

  const startedAt = performance.now();
  try {
    retryOnPermission(() => renameSync(tmpFile, targetPath), { attempts, delayMs });
  } catch (renameErr) {
    // Non-permission error → propagate immediately (callers classify by code).
    // Permission errors are exhausted here, so the copy fallback takes over.
    if (!isPermissionError(renameErr)) {
      unlinkBestEffort(tmpFile);
      throw renameErr;
    }
    // Rename retries exhausted on permission errors. Build a diagnostic,
    // then try the copy fallback. If the copy itself fails, rethrow the
    // diagnostic with stage "copy" so the operator can tell which step died.
    const renameExhaustedErr = renameErr as NodeJS.ErrnoException;
    const renameExhausted: AtomicWriteExhaustedError = new AtomicWriteExhaustedError({
      target: targetPath,
      attempts,
      elapsedMs: Math.round(performance.now() - startedAt),
      finalCode: renameExhaustedErr.code ?? "EPERM",
      stage: "rename",
      cause: renameExhaustedErr,
    });
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
    // The copy fallback succeeded — the original rename exhaustion is no
    // longer a hard failure. Do not throw.
    // (We keep `renameExhausted` referenced so future diagnostic consumers
    // can opt into strict-rename mode without restructuring the helper.)
    void renameExhausted;
  }
}
