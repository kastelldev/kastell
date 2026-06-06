/**
 * Bounded parallel fan-out. Spawns up to `chunkSize` workers that pull from a shared cursor.
 * Contract: `worker` MUST NOT throw — wrap exceptions inside the callback and return a result
 * variant (e.g. `{ ok: false, err }`). An unhandled rejection aborts the whole batch and leaves
 * remaining slots `undefined`. For cancellation, the caller is responsible for short-circuiting
 * inside `worker` (e.g. check `AbortSignal.aborted`).
 */
export async function chunkConcurrent<T, R>(
  items: T[],
  chunkSize: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(chunkSize, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Bounded parallel fan-out that lets the worker throw. Returns one
 * `PromiseSettledResult<R>` per input item, in input order, so callers
 * don't have to wrap try/catch around their worker bodies just to capture
 * failures. Use when the worker result type can't naturally encode a
 * failure variant (e.g. typed domain objects that don't have a "failed" shape).
 */
export async function chunkConcurrentSettled<T, R>(
  items: T[],
  chunkSize: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  return chunkConcurrent(items, chunkSize, async (item, idx) => {
    try {
      const value = await worker(item, idx);
      return { status: "fulfilled" as const, value };
    } catch (reason) {
      return { status: "rejected" as const, reason };
    }
  });
}
