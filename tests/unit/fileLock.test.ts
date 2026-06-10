import { withFileLock, probeProcess } from "../../src/utils/fileLock.js";
import { mkdirSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

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
