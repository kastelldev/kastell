import { copyFileSync, renameSync, unlinkSync } from "fs";
import { secureWriteFileSync, type WriteFileOptions } from "./secureWrite.js";
import { isPermissionError, retryOnPermission } from "./fsRetry.js";

export interface AtomicWriteOptions extends WriteFileOptions {
  attempts?: number;
  delayMs?: number;
}

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_DELAY_MS = 10;

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

function unlinkBestEffort(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    /* best effort */
  }
}
