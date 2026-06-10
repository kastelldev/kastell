import { copyFileSync, renameSync } from "fs";
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
 * @throws The original non-permission rename error, or the fallback copy error.
 */
export function atomicWriteFileSync(
  targetPath: string,
  content: string,
  options: AtomicWriteOptions = {},
): void {
  const tmpFile = `${targetPath}.tmp`;
  const { attempts = DEFAULT_PERMISSION_RETRY_ATTEMPTS, delayMs = DEFAULT_PERMISSION_RETRY_DELAY_MS, ...writeOptions } = options;

  secureWriteFileSync(tmpFile, content, writeOptions);

  try {
    retryOnPermission(() => renameSync(tmpFile, targetPath), { attempts, delayMs });
  } catch (renameErr) {
    // Non-permission error → propagate immediately. Permission errors are
    // exhausted here, so the copy fallback takes over.
    if (!isPermissionError(renameErr)) {
      unlinkBestEffort(tmpFile);
      throw renameErr;
    }
    try {
      copyFileSync(tmpFile, targetPath);
    } catch (copyErr) {
      unlinkBestEffort(tmpFile);
      throw copyErr;
    }
    unlinkBestEffort(tmpFile);
  }
}
