import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import * as fs from "fs";
import { statKey, memoizeOnStat } from "../../../src/utils/fsMtime.js";

jest.mock("fs");

const mockedFs = fs as jest.Mocked<typeof fs>;
const asStats = (obj: object) => obj as unknown as import("fs").Stats;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("statKey", () => {
  it("returns null when file does not exist (ENOENT)", () => {
    const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    mockedFs.statSync.mockImplementation(() => { throw err; });
    expect(statKey("/tmp/missing.json")).toBeNull();
  });

  it("returns { mtime, dev } on success", () => {
    mockedFs.statSync.mockReturnValue(asStats({ mtimeMs: 12345, dev: 67890 }));
    expect(statKey("/tmp/exists.json")).toEqual({ mtime: 12345, dev: 67890 });
  });

  it("returns null on I/O error (not ENOENT)", () => {
    mockedFs.statSync.mockImplementation(() => { throw new Error("EACCES"); });
    expect(statKey("/tmp/forbidden.json")).toBeNull();
  });
});

describe("memoizeOnStat", () => {
  it("runs compute() on first call and caches result by cacheKey", () => {
    const cache = new Map<string, { statKey: { mtime: number; dev: number } | null; value: number }>();
    mockedFs.statSync.mockReturnValue(asStats({ mtimeMs: 100, dev: 1 }));
    const compute = jest.fn(() => 42);

    const v1 = memoizeOnStat(cache, "/a.json::1.2.3.4", "/a.json", compute);
    const v2 = memoizeOnStat(cache, "/a.json::1.2.3.4", "/a.json", compute);

    expect(v1).toBe(42);
    expect(v2).toBe(42);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("treats different cacheKeys as independent entries (regression guard)", () => {
    // CRITICAL: this is the bug we fixed. Same filePath + different cacheKey
    // must NOT share cache. Otherwise loadLatestAudit("1.2.3.4") result
    // would be returned for loadLatestAudit("5.6.7.8").
    const cache = new Map<string, { statKey: { mtime: number; dev: number } | null; value: number }>();
    mockedFs.statSync.mockReturnValue(asStats({ mtimeMs: 100, dev: 1 }));
    const compute = jest.fn((() => {
      let counter = 0;
      return () => ++counter;
    })());

    const v1 = memoizeOnStat(cache, "/a.json::1.2.3.4", "/a.json", compute);
    const v2 = memoizeOnStat(cache, "/a.json::5.6.7.8", "/a.json", compute);

    expect(v1).toBe(1);
    expect(v2).toBe(2);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("re-runs compute() when mtime changes (invalidation)", () => {
    const cache = new Map<string, { statKey: { mtime: number; dev: number } | null; value: number }>();
    mockedFs.statSync.mockReturnValueOnce(asStats({ mtimeMs: 100, dev: 1 }));
    const compute = jest.fn(() => 1);
    expect(memoizeOnStat(cache, "/a.json::1.2.3.4", "/a.json", compute)).toBe(1);

    mockedFs.statSync.mockReturnValueOnce(asStats({ mtimeMs: 200, dev: 1 }));
    compute.mockReturnValueOnce(2);
    expect(memoizeOnStat(cache, "/a.json::1.2.3.4", "/a.json", compute)).toBe(2);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("caches null result when file does not exist", () => {
    const cache = new Map<string, { statKey: { mtime: number; dev: number } | null; value: number }>();
    const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    mockedFs.statSync.mockImplementation(() => { throw err; });
    const compute = jest.fn(() => 0);

    expect(memoizeOnStat(cache, "/missing.json::1.2.3.4", "/missing.json", compute)).toBe(0);
    expect(memoizeOnStat(cache, "/missing.json::1.2.3.4", "/missing.json", compute)).toBe(0);
    expect(compute).toHaveBeenCalledTimes(1);
  });
});

describe("memoizeOnStat — LRU bound (options.maxSize)", () => {
  it("evicts least-recently-used entry once size exceeds maxSize", () => {
    const cache = new Map<string, { statKey: { mtime: number; dev: number } | null; value: number }>();
    mockedFs.statSync.mockReturnValue(asStats({ mtimeMs: 100, dev: 1 }));

    memoizeOnStat(cache, "k1", "/a.json", () => 1, { maxSize: 2 });
    memoizeOnStat(cache, "k2", "/a.json", () => 2, { maxSize: 2 });
    memoizeOnStat(cache, "k3", "/a.json", () => 3, { maxSize: 2 });

    expect(cache.size).toBe(2);
    expect(cache.has("k1")).toBe(false); // oldest evicted
    expect(cache.has("k2")).toBe(true);
    expect(cache.has("k3")).toBe(true);
  });

  it("promotes hits to MRU position so they survive eviction", () => {
    const cache = new Map<string, { statKey: { mtime: number; dev: number } | null; value: number }>();
    mockedFs.statSync.mockReturnValue(asStats({ mtimeMs: 100, dev: 1 }));

    memoizeOnStat(cache, "k1", "/a.json", () => 1, { maxSize: 2 });
    memoizeOnStat(cache, "k2", "/a.json", () => 2, { maxSize: 2 });
    // Hit k1 — should promote to MRU
    memoizeOnStat(cache, "k1", "/a.json", () => 99, { maxSize: 2 });
    // Insert k3 — should evict k2 (now oldest), not k1 (just promoted)
    memoizeOnStat(cache, "k3", "/a.json", () => 3, { maxSize: 2 });

    expect(cache.size).toBe(2);
    expect(cache.has("k1")).toBe(true); // survived via MRU promote
    expect(cache.has("k2")).toBe(false); // evicted
    expect(cache.has("k3")).toBe(true);
  });

  it("leaves cache unbounded when maxSize is omitted (back-compat)", () => {
    const cache = new Map<string, { statKey: { mtime: number; dev: number } | null; value: number }>();
    mockedFs.statSync.mockReturnValue(asStats({ mtimeMs: 100, dev: 1 }));

    for (let i = 0; i < 50; i++) {
      memoizeOnStat(cache, `k${i}`, "/a.json", () => i);
    }

    expect(cache.size).toBe(50);
  });
});
