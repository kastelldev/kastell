import { chunkConcurrent } from "../../src/utils/concurrency";

describe("chunkConcurrent", () => {
  test("max N concurrent workers", async () => {
    let active = 0, peak = 0;
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const results = await chunkConcurrent(items, 4, async (item) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise(r => setTimeout(r, 10));
      active--;
      return item * 2;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(results).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
  });

  test("preserves order even with varying durations", async () => {
    const items = [3, 1, 2];
    const results = await chunkConcurrent(items, 3, async (item) => {
      await new Promise(r => setTimeout(r, item * 5));
      return item;
    });
    expect(results).toEqual([3, 1, 2]);
  });
});
