import { withFileLock } from "../../src/utils/fileLock.js";
import fs from "fs";

jest.mock("fs");

const mockedFs = jest.mocked(fs);

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
      mockedFs.rmdirSync.mockReturnValue(undefined);

      const fn = jest.fn().mockReturnValue("result");
      const result = await withFileLock("/path/to/file.json", fn);

      expect(result).toBe("result");
      expect(mockedFs.mkdirSync).toHaveBeenCalledWith("/path/to/file.json.lock");
      expect(fn).toHaveBeenCalledTimes(1);
      expect(mockedFs.rmdirSync).toHaveBeenCalledWith("/path/to/file.json.lock");
    });

    it("should work with async fn", async () => {
      mockedFs.mkdirSync.mockReturnValue(undefined);
      mockedFs.rmdirSync.mockReturnValue(undefined);

      const fn = jest.fn().mockResolvedValue("async-result");
      const result = await withFileLock("/path/to/file.json", fn);

      expect(result).toBe("async-result");
    });
  });

  describe("staleLockDetection", () => {
    it("should remove stale lock older than 30s and re-acquire", async () => {
      const eexistError = Object.assign(new Error("EEXIST"), { code: "EEXIST" });
      mockedFs.mkdirSync
        .mockImplementationOnce(() => { throw eexistError; })
        .mockReturnValueOnce(undefined);
      mockedFs.statSync.mockReturnValue({
        mtimeMs: Date.now() - 35_000, // 35s ago = stale
      } as unknown as fs.Stats);
      mockedFs.rmdirSync.mockReturnValue(undefined);

      const fn = jest.fn().mockReturnValue("ok");
      const result = await withFileLock("/path/to/file.json", fn);

      expect(result).toBe("ok");
      // rmdirSync called once for stale lock removal, once for release
      expect(mockedFs.rmdirSync).toHaveBeenCalledTimes(2);
    });
  });

  describe("retryOnEEXIST", () => {
    it("should retry up to 10 times with 200ms delay when lock exists", async () => {
      const eexistError = Object.assign(new Error("EEXIST"), { code: "EEXIST" });

      // Fail 3 times with EEXIST, then succeed
      mockedFs.mkdirSync
        .mockImplementationOnce(() => { throw eexistError; })
        .mockImplementationOnce(() => { throw eexistError; })
        .mockImplementationOnce(() => { throw eexistError; })
        .mockReturnValueOnce(undefined);
      // Return current fake time so lock is never stale
      mockedFs.statSync.mockImplementation(() => ({
        mtimeMs: Date.now(),
      } as unknown as fs.Stats));
      mockedFs.rmdirSync.mockReturnValue(undefined);

      const fn = jest.fn().mockReturnValue("got-it");

      const promise = withFileLock("/path/to/file.json", fn);

      // Advance timers for each retry (200ms each)
      await jest.advanceTimersByTimeAsync(200);
      await jest.advanceTimersByTimeAsync(200);
      await jest.advanceTimersByTimeAsync(200);

      const result = await promise;
      expect(result).toBe("got-it");
      expect(mockedFs.mkdirSync).toHaveBeenCalledTimes(4);
    });
  });

  describe("lockExhausted", () => {
    it("should throw after 10 failed retries", async () => {
      const eexistError = Object.assign(new Error("EEXIST"), { code: "EEXIST" });
      mockedFs.mkdirSync.mockImplementation(() => { throw eexistError; });
      // Return current fake time so lock is never stale
      mockedFs.statSync.mockImplementation(() => ({
        mtimeMs: Date.now(),
      } as unknown as fs.Stats));

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
      mockedFs.rmdirSync.mockReturnValue(undefined);

      const fn = jest.fn().mockImplementation(() => {
        throw new Error("fn-error");
      });

      await expect(withFileLock("/path/to/file.json", fn)).rejects.toThrow("fn-error");
      expect(mockedFs.rmdirSync).toHaveBeenCalledWith("/path/to/file.json.lock");
    });
  });

  describe("nonEEXISTError", () => {
    it("should throw non-EEXIST mkdirSync errors immediately", async () => {
      const permError = Object.assign(new Error("EPERM"), { code: "EPERM" });
      mockedFs.mkdirSync.mockImplementation(() => { throw permError; });

      const fn = jest.fn();

      await expect(withFileLock("/path/to/file.json", fn)).rejects.toThrow("EPERM");
      expect(mockedFs.mkdirSync).toHaveBeenCalledTimes(1);
      expect(fn).not.toHaveBeenCalled();
    });
  });
});
