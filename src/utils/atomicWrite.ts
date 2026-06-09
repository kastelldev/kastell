import { copyFileSync, renameSync, unlinkSync } from "fs";
import { secureWriteFileSync, type WriteFileOptions } from "./secureWrite.js";

export interface AtomicWriteOptions extends WriteFileOptions {
  attempts?: number;
  delayMs?: number;
}

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_DELAY_MS = 10;
const PERMISSION_ERROR_CODES = new Set(["EPERM", "EACCES"]);

function isPermissionError(err: unknown): boolean {
  return PERMISSION_ERROR_CODES.has((err as NodeJS.ErrnoException).code ?? "");
}

function sleepSync(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function unlinkBestEffort(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    /* best effort */
  }
}

/**
 * Write a file through `targetPath + ".tmp"` and rename it into place.
 *
 * `renameSync()` is still the primary path. On transient Windows permission
 * failures from file scanners or sync clients, this helper retries and then
 * falls back to copy/unlink. The final copy fallback is not atomic, but avoids
 * failing completed local state updates when the target is briefly locked.
 * Retry sleeps are synchronous and block the CLI process briefly.
 *
 * @throws The original non-permission rename error, or the fallback copy error.
 */
export function atomicWriteFileSync(
  targetPath: string,
  content: string,
  options: AtomicWriteOptions = {},
): void {
  const tmpFile = `${targetPath}.tmp`;
  const { attempts = DEFAULT_ATTEMPTS, delayMs = DEFAULT_DELAY_MS, ...writeOptions } = options;
  const maxAttempts = Math.max(1, attempts);

  secureWriteFileSync(tmpFile, content, writeOptions);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      renameSync(tmpFile, targetPath);
      return;
    } catch (err: unknown) {
      if (!isPermissionError(err)) {
        unlinkBestEffort(tmpFile);
        throw err;
      }
      if (attempt < maxAttempts) {
        sleepSync(delayMs);
        continue;
      }
    }
  }

  try {
    copyFileSync(tmpFile, targetPath);
  } catch (err: unknown) {
    unlinkBestEffort(tmpFile);
    throw err;
  }

  unlinkBestEffort(tmpFile);
}
