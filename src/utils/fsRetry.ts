/**
 * Shared helpers for transient Windows EPERM/EACCES retries.
 *
 * Background: Windows file-scanners (antivirus, OneDrive, search indexer) briefly
 * hold handles to local state files. The held handle causes fs operations
 * (rename, rmSync) to throw EPERM/EACCES for a few milliseconds. A short retry
 * loop with a sync sleep is enough to ride out the contention without surfacing
 * the error to the user.
 */

const PERMISSION_ERROR_CODES = new Set(["EPERM", "EACCES"]);
const SLEEP_BUFFER = new Int32Array(new SharedArrayBuffer(4));

export function isPermissionError(err: unknown): boolean {
  return PERMISSION_ERROR_CODES.has((err as NodeJS.ErrnoException).code ?? "");
}

/** Synchronous sleep using Atomics.wait. ms <= 0 returns immediately. */
export function sleepSync(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(SLEEP_BUFFER, 0, 0, ms);
}

export interface RetryOptions {
  attempts: number;
  delayMs: number;
}

/**
 * Run `fn` up to `attempts` times, retrying only on transient permission errors.
 * Throws the first non-permission error. Re-throws the last permission error
 * if all attempts fail.
 */
export function retryOnPermission<T>(fn: () => T, { attempts, delayMs }: RetryOptions): T {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return fn();
    } catch (err: unknown) {
      if (!isPermissionError(err)) throw err;
      lastError = err;
      if (attempt < attempts) sleepSync(delayMs);
    }
  }
  throw lastError;
}
