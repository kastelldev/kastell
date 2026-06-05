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
 *
 * `options.maxSize` opts the cache into bounded LRU semantics: once `cache.size`
 * exceeds `maxSize`, the least-recently-used entry is evicted. Hits promote to
 * MRU. Default (omitted) leaves the cache unbounded (back-compat).
 */
export function memoizeOnStat<T>(
  cache: Map<string, MemoizedEntry<T>>,
  cacheKey: string,
  filePath: string,
  compute: () => T,
  options?: { maxSize?: number },
): T {
  const current = statKey(filePath);
  const cached = cache.get(cacheKey);

  const isHit =
    cached !== undefined &&
    ((cached.statKey === null && current === null) ||
      (current !== null &&
        cached.statKey !== null &&
        cached.statKey.mtime === current.mtime &&
        cached.statKey.dev === current.dev));

  if (isHit) {
    // MRU promote: only when LRU is active (preserves unbounded back-compat).
    if (options?.maxSize !== undefined) {
      cache.delete(cacheKey);
      cache.set(cacheKey, cached);
    }
    return cached.value;
  }

  const value = compute();
  // Re-insert at MRU position when LRU active so insertion order = recency.
  if (options?.maxSize !== undefined) {
    cache.delete(cacheKey);
  }
  cache.set(cacheKey, { statKey: current, value });

  if (options?.maxSize !== undefined) {
    while (cache.size > options.maxSize) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }

  return value;
}
