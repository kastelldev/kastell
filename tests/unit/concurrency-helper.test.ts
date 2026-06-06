import { chunkConcurrent, chunkConcurrentSettled } from "../../src/utils/concurrency";

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

describe("chunkConcurrentSettled", () => {
  test("returns fulfilled for all successful workers", async () => {
    const result = await chunkConcurrentSettled([1, 2, 3], 2, async (n) => n * 2);
    expect(result).toEqual([
      { status: "fulfilled", value: 2 },
      { status: "fulfilled", value: 4 },
      { status: "fulfilled", value: 6 },
    ]);
  });

  test("returns rejected entries with reason when workers throw", async () => {
    const result = await chunkConcurrentSettled([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("nope");
      return n;
    });
    expect(result[0]).toEqual({ status: "fulfilled", value: 1 });
    expect(result[1]?.status).toBe("rejected");
    if (result[1]?.status === "rejected") {
      expect((result[1] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
      expect((result[1] as PromiseRejectedResult).reason.message).toBe("nope");
    }
    expect(result[2]).toEqual({ status: "fulfilled", value: 3 });
  });

  test("preserves input order regardless of completion order", async () => {
    const result = await chunkConcurrentSettled([3, 1, 2], 3, async (n) => {
      await new Promise((r) => setTimeout(r, 10 - n * 3));
      return n;
    });
    expect(result.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual([3, 1, 2]);
  });
});
