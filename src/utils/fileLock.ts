import { mkdirSync, rmdirSync, statSync } from "fs";
import { dirname } from "path";

const STALE_THRESHOLD_MS = 30_000; // 30s

export async function withFileLock<T>(
  filePath: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  const lockDir = filePath + ".lock";
  const maxRetries = 10;
  const retryDelay = 200;

  // Ensure parent directory exists (CI runners may not have ~/.kastell/)
  mkdirSync(dirname(lockDir), { recursive: true });

  for (let i = 0; i < maxRetries; i++) {
    try {
      mkdirSync(lockDir);
      try {
        return await fn();
      } finally {
        try {
          rmdirSync(lockDir);
        } catch {
          /* best effort */
        }
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        // Stale lock detection
        try {
          const stat = statSync(lockDir);
          if (Date.now() - stat.mtimeMs > STALE_THRESHOLD_MS) {
            rmdirSync(lockDir);
            continue;
          }
        } catch {
          /* lock was released between checks */
        }
        await new Promise((r) => setTimeout(r, retryDelay));
        continue;
      }
      throw err;
    }
  }
  throw new Error(
    `Could not acquire lock on ${filePath} after ${maxRetries} retries`,
  );
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
