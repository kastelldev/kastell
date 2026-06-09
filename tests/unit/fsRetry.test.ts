import { isPermissionError, retryOnPermission, sleepSync } from "../../src/utils/fsRetry.js";

function fsError(code: string): NodeJS.ErrnoException {
  const err = new Error(code) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

describe("isPermissionError", () => {
  it("returns true for EPERM", () => {
    expect(isPermissionError(fsError("EPERM"))).toBe(true);
  });

  it("returns true for EACCES", () => {
    expect(isPermissionError(fsError("EACCES"))).toBe(true);
  });

  it("returns false for other error codes", () => {
    expect(isPermissionError(fsError("ENOENT"))).toBe(false);
    expect(isPermissionError(fsError("ENOSPC"))).toBe(false);
  });

  it("returns false for errors without a code", () => {
    expect(isPermissionError(new Error("boom"))).toBe(false);
  });
});

describe("sleepSync", () => {
  it("returns immediately for ms <= 0", () => {
    const start = Date.now();
    sleepSync(0);
    sleepSync(-1);
    expect(Date.now() - start).toBeLessThan(50);
  });
});

describe("retryOnPermission", () => {
  it("returns the fn result on first success", () => {
    expect(retryOnPermission(() => 42, { attempts: 3, delayMs: 0 })).toBe(42);
  });

  it("retries on transient EPERM and eventually returns", () => {
    let calls = 0;
    const result = retryOnPermission(
      () => {
        calls++;
        if (calls < 3) throw fsError("EPERM");
        return "ok";
      },
      { attempts: 3, delayMs: 0 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("throws the last permission error after exhausting attempts", () => {
    expect(() =>
      retryOnPermission(
        () => {
          throw fsError("EACCES");
        },
        { attempts: 2, delayMs: 0 },
      ),
    ).toThrow("EACCES");
  });

  it("rethrows non-permission errors immediately", () => {
    let calls = 0;
    expect(() =>
      retryOnPermission(
        () => {
          calls++;
          throw fsError("ENOSPC");
        },
        { attempts: 5, delayMs: 0 },
      ),
    ).toThrow("ENOSPC");
    expect(calls).toBe(1);
  });
});
