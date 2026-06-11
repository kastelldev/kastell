import { withFileLock, probeProcess } from "../../src/utils/fileLock.js";
import { mkdirSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createHash } from "crypto";

// Lock diagnostic now redacts ownerPid (8-char SHA256 prefix) and replaces
// ownerHost with "internal" — to match production sanitization.
function hashedPid(pid: number): string {
  return `hash:${createHash("sha256").update(String(pid)).digest("hex").slice(0, 8)}`;
}

// Existing mocked tests — rmdirSync → rmSync in assertions to match new implementation
jest.mock("fs");

const mockedFs = jest.mocked(
  require("fs") as typeof import("fs") & {
    __esModule: boolean;
    default: unknown;
  },
);

describe("withFileLock", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("acquireAndRelease", () => {
    it("should create lock dir, execute fn, then remove lock dir", async () => {
      mockedFs.mkdirSync.mockReturnValue(undefined);
      mockedFs.rmSync.mockReturnValue(undefined);

      const fn = jest.fn().mockReturnValue("result");
      const result = await withFileLock("/path/to/file.json", fn);

      expect(result).toBe("result");
      // First call: ensure parent directory exists
      expect(mockedFs.mkdirSync).toHaveBeenCalledWith("/path/to", { recursive: true });
      // Second call: create lock directory
      expect(mockedFs.mkdirSync).toHaveBeenCalledWith("/path/to/file.json.lock");
      expect(fn).toHaveBeenCalledTimes(1);
      expect(mockedFs.rmSync).toHaveBeenCalledWith("/path/to/file.json.lock", {
        recursive: true,
        force: true,
      });
    });

    it("should work with async fn", async () => {
      mockedFs.mkdirSync.mockReturnValue(undefined);
      mockedFs.rmSync.mockReturnValue(undefined);

      const fn = jest.fn().mockResolvedValue("async-result");
      const result = await withFileLock("/path/to/file.json", fn);

      expect(result).toBe("async-result");
    });
  });

  describe("staleLockDetection", () => {
    it("should remove stale lock older than 30s and re-acquire", async () => {
      const eexistError = Object.assign(new Error("EEXIST"), { code: "EEXIST" });
      mockedFs.mkdirSync
        .mockReturnValueOnce(undefined) // parent dir (recursive)
        .mockImplementationOnce(() => { throw eexistError; }) // lock attempt 1
        .mockReturnValueOnce(undefined); // lock attempt 2 (after stale removal)
      mockedFs.statSync.mockReturnValue({
        mtimeMs: Date.now() - 35_000, // 35s ago = stale
      } as unknown as import("fs").Stats);
      mockedFs.rmSync.mockReturnValue(undefined);
      mockedFs.readFileSync.mockReturnValue("");

      const fn = jest.fn().mockReturnValue("ok");
      const result = await withFileLock("/path/to/file.json", fn);

      expect(result).toBe("ok");
      // rmSync called once for stale lock removal, once for release
      expect(mockedFs.rmSync).toHaveBeenCalledTimes(2);
    });

    it("should still retry with delay when stale lock removal exhausts all EPERM retries", async () => {
      // Covers lines 117-119: removeLockDirBestEffort returns false (all 3 rmSync
      // retries fail) → caller falls through to retry-delay path.
      const eexistError = Object.assign(new Error("EEXIST"), { code: "EEXIST" });
      const epermError = Object.assign(new Error("EPERM"), { code: "EPERM" });

      mockedFs.mkdirSync
        .mockReturnValueOnce(undefined) // parent dir
        .mockImplementationOnce(() => {
          throw eexistError;
        })
        .mockReturnValueOnce(undefined); // lock attempt 2 succeeds
      mockedFs.statSync.mockReturnValue({
        mtimeMs: Date.now() - 35_000, // 35s ago → stale
      } as unknown as import("fs").Stats);
      mockedFs.readFileSync.mockReturnValue("");
      // Every rmSync attempt (3 stale + 3 release) throws EPERM — all 6 fail.
      mockedFs.rmSync.mockImplementation(() => {
        throw epermError;
      });

      const fn = jest.fn().mockReturnValue("ok");
      const promise = withFileLock("/path/to/file.json", fn);

      // First iteration: 200ms retry delay after failed removal
      await jest.advanceTimersByTimeAsync(200);

      const result = await promise;
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(1);
      // mkdirSync: 1 parent + 1 EEXIST + 1 success = 3
      expect(mockedFs.mkdirSync).toHaveBeenCalledTimes(3);
      // rmSync: 3 attempts in removeLockDirBestEffort(stale) + 3 in release = 6
      expect(mockedFs.rmSync).toHaveBeenCalledTimes(6);
    });

    it("should retry stale lock reclaim removal when rmSync throws transient EPERM", async () => {
      const eexistError = Object.assign(new Error("EEXIST"), { code: "EEXIST" });
      const epermError = Object.assign(new Error("EPERM"), { code: "EPERM" });

      mockedFs.mkdirSync
        .mockReturnValueOnce(undefined)
        .mockImplementationOnce(() => {
          throw eexistError;
        })
        .mockReturnValueOnce(undefined);

      mockedFs.statSync.mockReturnValue({
        mtimeMs: Date.now() - 35_000,
      } as unknown as import("fs").Stats);
      mockedFs.readFileSync.mockReturnValue("");
      mockedFs.rmSync
        .mockImplementationOnce(() => {
          throw epermError;
        })
        .mockImplementationOnce(() => {
          throw epermError;
        })
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(undefined);

      const fn = jest.fn().mockReturnValue("ok");
      const promise = withFileLock("/path/to/file.json", fn);

      const result = await promise;
      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(1);
      expect(mockedFs.mkdirSync).toHaveBeenCalledTimes(3);
      expect(mockedFs.rmSync).toHaveBeenCalledWith("/path/to/file.json.lock", {
        recursive: true,
        force: true,
      });
      expect(mockedFs.rmSync).toHaveBeenCalledTimes(4);
    });
  });

  describe("retryOnEEXIST", () => {
    it("should retry up to 10 times with 200ms delay when lock exists", async () => {
      const eexistError = Object.assign(new Error("EEXIST"), { code: "EEXIST" });

      // First call: parent dir (recursive), then fail 3 times with EEXIST, then succeed
      mockedFs.mkdirSync
        .mockReturnValueOnce(undefined) // parent dir (recursive)
        .mockImplementationOnce(() => { throw eexistError; })
        .mockImplementationOnce(() => { throw eexistError; })
        .mockImplementationOnce(() => { throw eexistError; })
        .mockReturnValueOnce(undefined);
      // Return current fake time so lock is never stale
      mockedFs.statSync.mockImplementation(() => ({
        mtimeMs: Date.now(),
      } as unknown as import("fs").Stats));
      mockedFs.rmSync.mockReturnValue(undefined);

      const fn = jest.fn().mockReturnValue("got-it");

      const promise = withFileLock("/path/to/file.json", fn);

      // Advance timers for each retry (200ms each)
      await jest.advanceTimersByTimeAsync(200);
      await jest.advanceTimersByTimeAsync(200);
      await jest.advanceTimersByTimeAsync(200);

      const result = await promise;
      expect(result).toBe("got-it");
      expect(mockedFs.mkdirSync).toHaveBeenCalledTimes(5); // 1 parent + 3 EEXIST + 1 success
    });
  });

  describe("lockExhausted", () => {
    it("should throw after 10 failed retries", async () => {
      const eexistError = Object.assign(new Error("EEXIST"), { code: "EEXIST" });
      let callCount = 0;
      mockedFs.mkdirSync.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return undefined; // parent dir (recursive)
        throw eexistError;
      });
      // Return current fake time so lock is never stale
      mockedFs.statSync.mockImplementation(() => ({
        mtimeMs: Date.now(),
      } as unknown as import("fs").Stats));
      mockedFs.readFileSync.mockReturnValue("");

      const fn = jest.fn();

      const promise = withFileLock("/path/to/file.json", fn);

      // Catch immediately to prevent unhandled rejection
      const caught = promise.catch((e: Error) => e);

      // Advance timers enough for all retry delays
      for (let i = 0; i < 10; i++) {
        await jest.advanceTimersByTimeAsync(250);
      }

      const error = await caught;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("Could not acquire lock");
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe("releasesOnError", () => {
    it("should remove lock dir even when fn throws", async () => {
      mockedFs.mkdirSync.mockReturnValue(undefined);
      mockedFs.rmSync.mockImplementation(() => { throw new Error("ENOENT"); });

      const fn = jest.fn().mockImplementation(() => {
        throw new Error("fn-error");
      });

      await expect(withFileLock("/path/to/file.json", fn)).rejects.toThrow("fn-error");
      expect(mockedFs.rmSync).toHaveBeenCalledWith("/path/to/file.json.lock", {
        recursive: true,
        force: true,
      });
    });
  });

  describe("nonEEXISTError", () => {
    it("should throw non-EEXIST mkdirSync errors immediately", async () => {
      const permError = Object.assign(new Error("EPERM"), { code: "EPERM" });
      let callCount = 0;
      mockedFs.mkdirSync.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return undefined; // parent dir
        throw permError;
      });

      const fn = jest.fn();

      await expect(withFileLock("/path/to/file.json", fn)).rejects.toThrow("EPERM");
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe("edge cases", () => {
    it("handles rmSync failure on lock release (best effort)", async () => {
      mockedFs.mkdirSync.mockReturnValue(undefined);
      mockedFs.rmSync.mockImplementation(() => { throw new Error("ENOENT"); });

      const fn = jest.fn().mockReturnValue("ok");
      const result = await withFileLock("/path/to/file.json", fn);

      expect(result).toBe("ok");
    });

    it("handles statSync failure during stale check (lock released between checks)", async () => {
      const eexistError = Object.assign(new Error("EEXIST"), { code: "EEXIST" });
      mockedFs.mkdirSync
        .mockReturnValueOnce(undefined) // parent dir
        .mockImplementationOnce(() => { throw eexistError; }) // lock attempt
        .mockReturnValueOnce(undefined); // retry succeeds
      mockedFs.statSync.mockImplementation(() => { throw new Error("ENOENT"); });
      mockedFs.rmSync.mockReturnValue(undefined);

      const fn = jest.fn().mockReturnValue("recovered");
      const promise = withFileLock("/path/to/file.json", fn);
      await jest.advanceTimersByTimeAsync(200);
      const result = await promise;

      expect(result).toBe("recovered");
    });
  });

  describe("lock diagnostics", () => {
    it("throws enriched error with cause=EPERM when lock acquisition exhausts retries (old lock without owner.pid reclaimed)", async () => {
      const eexistError = Object.assign(new Error("EEXIST"), { code: "EEXIST" });
      const epermError = Object.assign(new Error("EPERM"), { code: "EPERM" });

      // First call: parent dir (recursive) succeeds. All subsequent calls throw EEXIST.
      let mkdirCallCount = 0;
      mockedFs.mkdirSync.mockImplementation(() => {
        mkdirCallCount++;
        if (mkdirCallCount === 1) return undefined; // parent dir
        throw eexistError;
      });
      // Lock is old enough to be reclaimed (mtime > 30s) — but no owner.pid file
      mockedFs.statSync.mockReturnValue({
        mtimeMs: Date.now() - 35_000,
      } as unknown as import("fs").Stats);
      // readFileSync throws ENOENT (no owner.pid) → parsed == null
      mockedFs.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      });
      // Every rmSync (stale reclaim + release) throws EPERM persistently
      mockedFs.rmSync.mockImplementation(() => {
        throw epermError;
      });

      const fn = jest.fn();
      const promise = withFileLock("/path/to/file.json", fn);
      const caught = promise.catch((e: Error) => e);

      for (let i = 0; i < 10; i++) {
        await jest.advanceTimersByTimeAsync(250);
      }

      const error = await caught;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain("Could not acquire lock");
      expect(error.message).toContain("ownerPid=unknown");
      expect(error.message).toContain("ownerHost=unknown");
      // No owner.pid file → probe never attempted → processState=not-probed
      expect(error.message).toContain("processState=not-probed");
      // statSync readable (35s old), no owner.pid → mtime fallback says stale
      expect(error.message).toContain("stale=true");
      expect(error.message).toContain("reclaimAttempted=true");
      expect(error.message).toContain("reclaimError=EPERM");
      expect(error.message).toContain("lock=/path/to/file.json.lock");
      expect(error.message).toContain("ageMs=");
      expect(error.message).toContain("Close other Kastell processes");
      expect(error.cause).toMatchObject({ code: "EPERM" });
      expect(fn).not.toHaveBeenCalled();
    });

    it("recovers after transient EPERM on stale reclaim (transient EPERM reclaimed after retry)", async () => {
      const eexistError = Object.assign(new Error("EEXIST"), { code: "EEXIST" });
      const epermError = Object.assign(new Error("EPERM"), { code: "EPERM" });

      mockedFs.mkdirSync
        .mockReturnValueOnce(undefined) // parent dir
        .mockImplementationOnce(() => { throw eexistError; })
        .mockReturnValueOnce(undefined); // lock acquired after reclaim

      // Old lock (35s) but no owner.pid → mtime fallback says stale
      mockedFs.statSync.mockReturnValue({
        mtimeMs: Date.now() - 35_000,
      } as unknown as import("fs").Stats);
      mockedFs.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      });

      // rmSync transient: first 2 attempts fail, 3rd succeeds (stale reclaim)
      // Then release rmSync also succeeds
      mockedFs.rmSync
        .mockImplementationOnce(() => { throw epermError; })
        .mockImplementationOnce(() => { throw epermError; })
        .mockReturnValue(undefined);

      const fn = jest.fn().mockReturnValue("recovered-after-transient");
      const result = await withFileLock("/path/to/file.json", fn);

      expect(result).toBe("recovered-after-transient");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("does not reclaim a live same-host owner before the hard ceiling (live owner remains after retries)", async () => {
      const eexistError = Object.assign(new Error("EEXIST"), { code: "EEXIST" });

      // parent dir succeeds, then every lock attempt throws EEXIST
      let mkdirCallCount = 0;
      mockedFs.mkdirSync.mockImplementation(() => {
        mkdirCallCount++;
        if (mkdirCallCount === 1) return undefined; // parent dir
        throw eexistError;
      });
      // Lock is fresh (1s old) and owned by a live PID on same host
      mockedFs.statSync.mockReturnValue({
        mtimeMs: Date.now() - 1_000,
      } as unknown as import("fs").Stats);
      // owner.pid is the current process (alive) on current hostname
      mockedFs.readFileSync.mockReturnValue(`${process.pid}@${require("os").hostname()}@${Date.now()}`);

      const fn = jest.fn();
      const promise = withFileLock("/path/to/file.json", fn);
      const caught = promise.catch((e: Error) => e);

      for (let i = 0; i < 10; i++) {
        await jest.advanceTimersByTimeAsync(250);
      }

      const error = await caught;
      expect(error).toBeInstanceOf(Error);
      // Live same-host owner → processState should be "alive", reclaim should NOT be attempted
      expect(error.message).toContain(`ownerPid=${hashedPid(process.pid)}`);
      expect(error.message).toContain("processState=alive");
      expect(error.message).toContain("reclaimAttempted=false");
      expect(error.message).toContain("stale=false");
      expect(fn).not.toHaveBeenCalled();
    });

    it("produces unknown fields when lock metadata is unreadable (unreadable metadata → unknown)", async () => {
      const eexistError = Object.assign(new Error("EEXIST"), { code: "EEXIST" });
      const epermError = Object.assign(new Error("EPERM"), { code: "EPERM" });

      // parent dir succeeds, then every lock attempt throws EEXIST
      let mkdirCallCount = 0;
      mockedFs.mkdirSync.mockImplementation(() => {
        mkdirCallCount++;
        if (mkdirCallCount === 1) return undefined; // parent dir
        throw eexistError;
      });
      // statSync throws → age unknown, can't determine stale
      mockedFs.statSync.mockImplementation(() => {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      });
      // readFileSync throws → owner unknown
      mockedFs.readFileSync.mockImplementation(() => {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      });
      // rmSync throws EPERM persistently
      mockedFs.rmSync.mockImplementation(() => {
        throw epermError;
      });

      const fn = jest.fn();
      const promise = withFileLock("/path/to/file.json", fn);
      const caught = promise.catch((e: Error) => e);

      for (let i = 0; i < 10; i++) {
        await jest.advanceTimersByTimeAsync(250);
      }

      const error = await caught;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain("ageMs=unknown");
      expect(error.message).toContain("ownerPid=unknown");
      expect(error.message).toContain("ownerHost=unknown");
      expect(error.message).toContain("processState=not-probed");
      expect(error.message).toContain("stale=unknown");
      // rmSync never called (statSync failed → shouldReclaimStaleLock returned false)
      // so no reclaim attempted
      expect(error.message).toContain("reclaimAttempted=false");
      expect(error.message).toContain("reclaimError=none");
      expect(fn).not.toHaveBeenCalled();
    });

    it("treats cross-host owner as not-probed (cross-host → not-probed, mtime fallback)", async () => {
      const eexistError = Object.assign(new Error("EEXIST"), { code: "EEXIST" });

      // parent dir succeeds, then every lock attempt throws EEXIST
      let mkdirCallCount = 0;
      mockedFs.mkdirSync.mockImplementation(() => {
        mkdirCallCount++;
        if (mkdirCallCount === 1) return undefined; // parent dir
        throw eexistError;
      });
      // Lock is fresh (1s) — but cross-host, so mtime fallback says NOT stale
      mockedFs.statSync.mockReturnValue({
        mtimeMs: Date.now() - 1_000,
      } as unknown as import("fs").Stats);
      // owner.pid is on a different host
      mockedFs.readFileSync.mockReturnValue(`1234@some-other-host@${Date.now()}`);

      const fn = jest.fn();
      const promise = withFileLock("/path/to/file.json", fn);
      const caught = promise.catch((e: Error) => e);

      for (let i = 0; i < 10; i++) {
        await jest.advanceTimersByTimeAsync(250);
      }

      const error = await caught;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain(`ownerPid=${hashedPid(1234)}`);
      // ownerHost is sanitized to "internal" — actual hostname is never exposed
      expect(error.message).toContain("ownerHost=internal");
      // Cross-host → probe not attempted → processState=not-probed
      expect(error.message).toContain("processState=not-probed");
      // Fresh lock on cross-host → not stale, no reclaim
      expect(error.message).toContain("stale=false");
      expect(error.message).toContain("reclaimAttempted=false");
      expect(fn).not.toHaveBeenCalled();
    });

    it("keeps processState=unknown when probeProcess returns EPERM (probeProcess EPERM → unknown)", async () => {
      const eexistError = Object.assign(new Error("EEXIST"), { code: "EEXIST" });
      const epermError = Object.assign(new Error("EPERM"), { code: "EPERM" });

      // parent dir succeeds, then every lock attempt throws EEXIST
      let mkdirCallCount = 0;
      mockedFs.mkdirSync.mockImplementation(() => {
        mkdirCallCount++;
        if (mkdirCallCount === 1) return undefined; // parent dir
        throw eexistError;
      });
      // Lock is old (>30s) — mtime fallback stale even if probe returns unknown
      mockedFs.statSync.mockReturnValue({
        mtimeMs: Date.now() - 35_000,
      } as unknown as import("fs").Stats);
      // owner.pid is a valid positive integer on same host — probe will be called
      mockedFs.readFileSync.mockReturnValue(`99999@${require("os").hostname()}@${Date.now()}`);

      // rmSync persistently throws EPERM so the loop exhausts and we hit the diagnostic path
      mockedFs.rmSync.mockImplementation(() => {
        throw epermError;
      });

      // Custom probe that returns "unknown" (simulates EPERM from process.kill)
      const probe = jest.fn().mockReturnValue("unknown" as const);

      const fn = jest.fn();
      const promise = withFileLock("/path/to/file.json", fn, probe);
      const caught = promise.catch((e: Error) => e);

      for (let i = 0; i < 10; i++) {
        await jest.advanceTimersByTimeAsync(250);
      }

      const error = await caught;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain(`ownerPid=${hashedPid(99999)}`);
      // probeProcess returned "unknown" (EPERM) → processState=unknown
      expect(error.message).toContain("processState=unknown");
      expect(error.message).toContain("reclaimAttempted=true");
      expect(error.message).toContain("reclaimError=EPERM");
      expect(probe).toHaveBeenCalledWith(99999);
      expect(fn).not.toHaveBeenCalled();
    });
  });
});

describe("probeProcess", () => {
  it("returns 'alive' for current process PID", () => {
    expect(probeProcess(process.pid)).toBe("alive");
  });

  it("returns 'dead' for ESRCH (non-existent PID)", () => {
    const spy = jest.spyOn(process, "kill").mockImplementation(() => {
      const err = new Error("not found") as NodeJS.ErrnoException;
      err.code = "ESRCH";
      throw err;
    });
    expect(probeProcess(99999)).toBe("dead");
    spy.mockRestore();
  });

  it("returns 'unknown' for EPERM (different user)", () => {
    const spy = jest.spyOn(process, "kill").mockImplementation(() => {
      const err = new Error("permission") as NodeJS.ErrnoException;
      err.code = "EPERM";
      throw err;
    });
    expect(probeProcess(1)).toBe("unknown");
    spy.mockRestore();
  });

  it("returns 'unknown' for any other error", () => {
    const spy = jest.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("weird") as NodeJS.ErrnoException;
    });
    expect(probeProcess(42)).toBe("unknown");
    spy.mockRestore();
  });
});
