import { copyFileSync, renameSync, unlinkSync } from "fs";
import { atomicWriteFileSync } from "../../src/utils/atomicWrite.js";
import { secureWriteFileSync } from "../../src/utils/secureWrite.js";

jest.mock("fs");
jest.mock("../../src/utils/secureWrite.js");

const mockedRenameSync = renameSync as jest.MockedFunction<typeof renameSync>;
const mockedCopyFileSync = copyFileSync as jest.MockedFunction<typeof copyFileSync>;
const mockedUnlinkSync = unlinkSync as jest.MockedFunction<typeof unlinkSync>;
const mockedSecureWriteFileSync = secureWriteFileSync as jest.MockedFunction<typeof secureWriteFileSync>;

function fsError(code: string): NodeJS.ErrnoException {
  const err = new Error(code) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

describe("atomicWriteFileSync", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("should write target tmp file when no errors occur", () => {
    atomicWriteFileSync("/state/servers.json", "[]", { encoding: "utf-8" });

    expect(mockedSecureWriteFileSync).toHaveBeenCalledWith(
      "/state/servers.json.tmp",
      "[]",
      { encoding: "utf-8" },
    );
  });

  it("should rename tmp file to target when no errors occur", () => {
    atomicWriteFileSync("/state/servers.json", "[]", { encoding: "utf-8" });

    expect(mockedRenameSync).toHaveBeenCalledWith(
      "/state/servers.json.tmp",
      "/state/servers.json",
    );
  });

  it("should skip copy fallback when rename succeeds", () => {
    atomicWriteFileSync("/state/servers.json", "[]", { encoding: "utf-8" });

    expect(mockedCopyFileSync).not.toHaveBeenCalled();
  });

  it("should leave temp cleanup to rename when rename succeeds", () => {
    atomicWriteFileSync("/state/servers.json", "[]", { encoding: "utf-8" });

    expect(mockedUnlinkSync).not.toHaveBeenCalled();
  });

  it("should retry renameSync when EPERM is thrown transiently", () => {
    mockedRenameSync
      .mockImplementationOnce(() => {
        throw fsError("EPERM");
      })
      .mockImplementationOnce(() => undefined);

    atomicWriteFileSync("/state/audit-history.json", "[]", {
      attempts: 2,
      delayMs: 0,
    });

    expect(mockedRenameSync).toHaveBeenCalledTimes(2);
    expect(mockedCopyFileSync).not.toHaveBeenCalled();
    expect(mockedUnlinkSync).not.toHaveBeenCalled();
  });

  it("should fall back to copy and unlink when renameSync keeps throwing EACCES", () => {
    mockedRenameSync.mockImplementation(() => {
      throw fsError("EACCES");
    });

    atomicWriteFileSync("/state/fix-history.json", "[]", {
      attempts: 2,
      delayMs: 0,
    });

    expect(mockedRenameSync).toHaveBeenCalledTimes(2);
    expect(mockedCopyFileSync).toHaveBeenCalledWith(
      "/state/fix-history.json.tmp",
      "/state/fix-history.json",
    );
    expect(mockedUnlinkSync).toHaveBeenCalledWith("/state/fix-history.json.tmp");
  });

  it("should rethrow non-permission errors and clean up tmp file when rename fails", () => {
    mockedRenameSync.mockImplementation(() => {
      throw fsError("ENOSPC");
    });

    expect(() =>
      atomicWriteFileSync("/state/regression.json", "{}", {
        attempts: 2,
        delayMs: 0,
      }),
    ).toThrow("ENOSPC");

    expect(mockedCopyFileSync).not.toHaveBeenCalled();
    expect(mockedUnlinkSync).toHaveBeenCalledWith("/state/regression.json.tmp");
  });

  it("should rethrow fallback copy errors after tmp cleanup attempt", () => {
    mockedRenameSync.mockImplementation(() => {
      throw fsError("EPERM");
    });
    mockedCopyFileSync.mockImplementation(() => {
      throw fsError("EIO");
    });

    expect(() =>
      atomicWriteFileSync("/state/snapshot.json", "{}", {
        attempts: 1,
        delayMs: 0,
      }),
    ).toThrow("EIO");

    expect(mockedUnlinkSync).toHaveBeenCalledWith("/state/snapshot.json.tmp");
  });

  it("should pass encoding option through when non-utf8 encoding is given", () => {
    atomicWriteFileSync("/state/custom.txt", "cafe", { encoding: "latin1" });

    expect(mockedSecureWriteFileSync).toHaveBeenCalledWith(
      "/state/custom.txt.tmp",
      "cafe",
      { encoding: "latin1" },
    );
  });

  // ─── Task 3: P143-A Atomic Rename Diagnostics ───────────────────────────────

  it("should throw a diagnostic error including target path, attempts, elapsedMs, final code, and stage:'copy' when rename retries exhaust AND copy fallback fails", () => {
    const renameCause = Object.assign(new Error("rename EPERM"), { code: "EPERM" });
    const copyCause = Object.assign(new Error("copy EIO"), { code: "EIO" });
    mockedRenameSync.mockImplementation(() => {
      throw renameCause;
    });
    mockedCopyFileSync.mockImplementation(() => {
      throw copyCause;
    });

    let caught: (Error & { [k: string]: unknown }) | undefined;
    try {
      atomicWriteFileSync("/state/copy-fail.json", "[]", { attempts: 2, delayMs: 0 });
    } catch (e) {
      caught = e as Error & { [k: string]: unknown };
    }

    expect(caught).toBeDefined();
    expect(caught!.message).toMatch(/copy-fail\.json/);
    expect(caught!.message).toMatch(/copy/);
    // Diagnostic fields
    expect(caught!.target).toBe("/state/copy-fail.json");
    expect(caught!.attempts).toBe(2);
    expect(typeof caught!.elapsedMs).toBe("number");
    expect((caught!.elapsedMs as number) >= 0).toBe(true);
    expect(caught!.finalCode).toBe("EIO");
    expect(caught!.stage).toBe("copy");
    // Original cause is preserved for downstream handlers (cause chain)
    expect(caught!.cause).toBe(copyCause);
    // The rename loop ran the requested number of times
    expect(mockedRenameSync).toHaveBeenCalledTimes(2);
    expect(mockedCopyFileSync).toHaveBeenCalledTimes(1);
  });

  it("should tag the diagnostic with stage:'rename' when the copy fallback path is not entered (non-permission error path)", () => {
    // ENOSPC is a non-permission error → rename propagates immediately, the
    // copy fallback is NEVER called, and no diagnostic wrapper is added.
    const cause = Object.assign(new Error("rename ENOSPC"), { code: "ENOSPC" });
    mockedRenameSync.mockImplementation(() => {
      throw cause;
    });

    let caught: (Error & { [k: string]: unknown }) | undefined;
    try {
      atomicWriteFileSync("/state/rename-only.json", "[]", { attempts: 3, delayMs: 0 });
    } catch (e) {
      caught = e as Error & { [k: string]: unknown };
    }

    expect(caught).toBeDefined();
    // Original error instance is propagated unchanged — NO diagnostic wrapper.
    expect(caught).toBe(cause);
    expect((caught as NodeJS.ErrnoException).code).toBe("ENOSPC");
    // The diagnostic fields must NOT be present on the original error.
    expect(caught!.target).toBeUndefined();
    expect(caught!.stage).toBeUndefined();
    expect(caught!.attempts).toBeUndefined();
    expect(caught!.elapsedMs).toBeUndefined();
    // Copy fallback must NOT have been attempted for non-permission errors.
    expect(mockedCopyFileSync).not.toHaveBeenCalled();
  });

  it("should NOT throw a diagnostic when rename retries exhaust but copy fallback succeeds (existing fallback semantic preserved)", () => {
    // Rename is exhausted on permission errors but copy succeeds → file
    // landed via the fallback. No diagnostic should be raised.
    mockedRenameSync.mockImplementation(() => {
      throw fsError("EACCES");
    });
    // copyFileSync has no mock → returns undefined (success).

    expect(() =>
      atomicWriteFileSync("/state/fallback-ok.json", "[]", { attempts: 2, delayMs: 0 }),
    ).not.toThrow();

    expect(mockedRenameSync).toHaveBeenCalledTimes(2);
    expect(mockedCopyFileSync).toHaveBeenCalledWith(
      "/state/fallback-ok.json.tmp",
      "/state/fallback-ok.json",
    );
    expect(mockedUnlinkSync).toHaveBeenCalledWith("/state/fallback-ok.json.tmp");
  });

  // ─── P144 T9: allowCopyFallback: false (Active Probe writes) ────────────────

  it("should throw a 'rename'-stage exhaustion diagnostic when allowCopyFallback is false and rename retries exhaust on permission errors", () => {
    const renameCause = Object.assign(new Error("rename EPERM"), { code: "EPERM" });
    mockedRenameSync.mockImplementation(() => {
      throw renameCause;
    });

    let caught: (Error & { [k: string]: unknown }) | undefined;
    try {
      atomicWriteFileSync("/state/probe-session.json", "{}", {
        attempts: 2,
        delayMs: 0,
        allowCopyFallback: false,
      });
    } catch (e) {
      caught = e as Error & { [k: string]: unknown };
    }

    expect(caught).toBeDefined();
    expect(caught!.name).toBe("AtomicWriteExhaustedError");
    expect(caught!.target).toBe("/state/probe-session.json");
    expect(caught!.stage).toBe("rename");
    expect(caught!.attempts).toBe(2);
    expect(caught!.finalCode).toBe("EPERM");
    expect(caught!.cause).toBe(renameCause);
    // copyFileSync MUST NOT be called when copy fallback is disabled
    expect(mockedCopyFileSync).not.toHaveBeenCalled();
    // Temp file MUST be cleaned up
    expect(mockedUnlinkSync).toHaveBeenCalledWith("/state/probe-session.json.tmp");
  });

  it("should propagate non-permission rename errors unchanged when allowCopyFallback is false (no diagnostic wrapper)", () => {
    const cause = Object.assign(new Error("rename ENOSPC"), { code: "ENOSPC" });
    mockedRenameSync.mockImplementation(() => {
      throw cause;
    });

    let caught: Error | undefined;
    try {
      atomicWriteFileSync("/state/probe-oversized.json", "{}", {
        attempts: 2,
        delayMs: 0,
        allowCopyFallback: false,
      });
    } catch (e) {
      caught = e as Error;
    }

    expect(caught).toBeDefined();
    expect(caught).toBe(cause);
    expect((caught as NodeJS.ErrnoException).code).toBe("ENOSPC");
    expect(mockedCopyFileSync).not.toHaveBeenCalled();
  });

  it("should default allowCopyFallback to true (existing call sites retain the copy fallback)", () => {
    mockedRenameSync.mockImplementation(() => {
      throw fsError("EACCES");
    });

    // No allowCopyFallback option → copy fallback still runs (no throw).
    expect(() =>
      atomicWriteFileSync("/state/default-true.json", "[]", { attempts: 2, delayMs: 0 }),
    ).not.toThrow();

    expect(mockedCopyFileSync).toHaveBeenCalledWith(
      "/state/default-true.json.tmp",
      "/state/default-true.json",
    );
    expect(mockedUnlinkSync).toHaveBeenCalledWith("/state/default-true.json.tmp");
  });
});
