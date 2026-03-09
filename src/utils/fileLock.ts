import { mkdirSync, rmdirSync, statSync } from "fs";

const STALE_THRESHOLD_MS = 30_000; // 30s

export async function withFileLock<T>(
  filePath: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  const lockDir = filePath + ".lock";
  const maxRetries = 10;
  const retryDelay = 200;

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
