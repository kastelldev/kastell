import { statSync } from "fs";

/** Stat key: mtime + dev (dev guards against network FS remount per LESSONS) */
export interface StatKey {
  mtime: number;
  dev: number;
}

/** Cached entry: the stat key at compute-time + the computed value */
export interface MemoizedEntry<T> {
  statKey: StatKey | null;
  value: T;
}

/**
 * Read file stat, returning a comparable key or null on ENOENT/I-O error.
 * Single syscall — replaces existsSync + statSync pattern.
 */
export function statKey(filePath: string): StatKey | null {
  try {
    const s = statSync(filePath);
    return { mtime: s.mtimeMs, dev: s.dev };
  } catch {
    return null;
  }
}

/**
 * Memoize a computation against a file's stat key. If the file's mtime/dev
 * is unchanged since the last call, returns the cached value. Otherwise,
 * runs compute() and caches the result.
 *
 * `cacheKey` distinguishes entries (caller composes — e.g. `filePath + '::' + serverIp`
 * for per-server caches, or just `filePath` for single-entry files). `filePath` is the
 * file to stat for invalidation — it can equal `cacheKey` for simple cases.
 */
export function memoizeOnStat<T>(
  cache: Map<string, MemoizedEntry<T>>,
  cacheKey: string,
  filePath: string,
  compute: () => T,
): T {
  const current = statKey(filePath);
  const cached = cache.get(cacheKey);

  if (cached && cached.statKey === null && current === null) {
    return cached.value;
  }
  if (cached && current !== null && cached.statKey !== null &&
      cached.statKey.mtime === current.mtime &&
      cached.statKey.dev === current.dev) {
    return cached.value;
  }

  const value = compute();
  cache.set(cacheKey, { statKey: current, value });
  return value;
}
