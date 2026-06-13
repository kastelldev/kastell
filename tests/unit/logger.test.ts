import { logger, createSpinner } from "../../src/utils/logger";

describe("logger", () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(console, "log").mockImplementation();
    stderrSpy = jest.spyOn(console, "error").mockImplementation();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("should log info messages", () => {
    logger.info("test info");
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(stdoutSpy).toHaveBeenCalledWith(expect.any(String), "test info");
  });

  it("should log success messages", () => {
    logger.success("task done");
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(stdoutSpy).toHaveBeenCalledWith(expect.any(String), "task done");
  });

  it("should log error messages to stderr", () => {
    logger.error("something failed");
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.any(String), "something failed");
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("should log warning messages to stderr", () => {
    logger.warning("be careful");
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.any(String), "be careful");
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("should log title with empty lines before and after", () => {
    logger.title("My Title");
    expect(stdoutSpy).toHaveBeenCalledTimes(3);
  });

  it("should log step messages", () => {
    logger.step("doing something");
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(stdoutSpy).toHaveBeenCalledWith(expect.any(String), "doing something");
  });
});

describe("createSpinner", () => {
  it("should create a spinner with given text", () => {
    const spinner = createSpinner("Loading...");
    expect(spinner).toBeDefined();
  });

  it("should return spinner with start method", () => {
    const spinner = createSpinner("Loading...");
    expect(typeof spinner.start).toBe("function");
  });

  it("should return spinner with succeed method", () => {
    const spinner = createSpinner("Loading...");
    expect(typeof spinner.succeed).toBe("function");
  });

  it("should return spinner with fail method", () => {
    const spinner = createSpinner("Loading...");
    expect(typeof spinner.fail).toBe("function");
  });

  it("should allow chaining start", () => {
    const spinner = createSpinner("Loading...");
    const result = spinner.start();
    expect(result).toBe(spinner);
  });
});

/**
 * Recursive secret-shape redaction (P142 Task 5).
 *
 * Reloads `src/utils/logger.ts` with `KASTELL_DEBUG=1` to exercise the
 * `debugLog` path. The sanitizer MUST:
 *   - redact sensitive keys at every nesting level (objects + arrays)
 *   - anchor Bearer/JWT and provider-token patterns in string values
 *   - leave ordinary UUIDs, server IDs, hashes, and IPs visible
 *   - bound cycles to "[Circular]" and depth > 8 to "[MaxDepth]"
 *   - never throw on getters, proxies, or serialization failures
 *   - never include the original secret in fallback output
 */
describe("debugLog redaction (P142)", () => {
  const originalEnv = process.env.KASTELL_DEBUG;
  let stderrSpy: jest.SpyInstance;
  let debugLog: ((...args: unknown[]) => void) | undefined;

  beforeEach(async () => {
    process.env.KASTELL_DEBUG = "1";
    jest.resetModules();
    const mod = await import("../../src/utils/logger");
    debugLog = mod.debugLog;
    stderrSpy = jest.spyOn(console, "error").mockImplementation();
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    if (originalEnv === undefined) delete process.env.KASTELL_DEBUG;
    else process.env.KASTELL_DEBUG = originalEnv;
    jest.resetModules();
  });

  function captureDebugOutput(...args: unknown[]): string {
    debugLog!(...args);
    return stderrSpy.mock.calls
      .map((c) =>
        c
          .map((a: unknown) => (typeof a === "string" ? a : JSON.stringify(a)))
          .join(" "),
      )
      .join("\n");
  }

  it("is defined when KASTELL_DEBUG=1", () => {
    expect(debugLog).toBeDefined();
  });

  it("redacts sensitive keys at every nesting level", () => {
    const out = captureDebugOutput({
      outer: {
        token: "abc123",
        mid: {
          password: "p4ss",
          deeper: {
            apiKey: "k-9",
            secret: "shh",
          },
        },
      },
    });
    expect(out).not.toContain("abc123");
    expect(out).not.toContain("p4ss");
    expect(out).not.toContain("k-9");
    expect(out).not.toContain("shh");
  });

  it("redacts values inside arrays", () => {
    const out = captureDebugOutput({
      headers: [{ authorization: "Bearer xyz" }, { token: "tok-1" }],
    });
    expect(out).not.toContain("xyz");
    expect(out).not.toContain("tok-1");
  });

  it("redacts anchored Bearer <value> patterns in string values", () => {
    const out = captureDebugOutput({ note: "Auth header: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig" });
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiJ9.payload.sig");
  });

  it("redacts JWT-shaped three-segment strings", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const out = captureDebugOutput({ raw: jwt });
    expect(out).not.toContain(jwt);
  });

  it("redacts known provider token prefixes", () => {
    const tokens = [
      "hcic_abcDEF1234567890xyz", // Hetzner
      "dop_v1_4f8e9d2c1a3b5c7e", // DigitalOcean
    ];
    for (const t of tokens) {
      const out = captureDebugOutput({ v: t });
      expect(out).not.toContain(t);
    }
  });

  it("leaves ordinary UUIDs visible", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const out = captureDebugOutput({ id: uuid });
    expect(out).toContain(uuid);
  });

  it("leaves kastell server IDs (srv_ prefix) visible", () => {
    const srv = "srv_a1b2c3d4e5f6";
    const out = captureDebugOutput({ server: srv });
    expect(out).toContain(srv);
  });

  it("leaves hex hashes visible", () => {
    const hash = "5d41402abc4b2a76b9719d911017c592";
    const out = captureDebugOutput({ checksum: hash });
    expect(out).toContain(hash);
  });

  it("leaves IPv4 addresses visible", () => {
    const ip = "203.0.113.42";
    const out = captureDebugOutput({ address: ip });
    expect(out).toContain(ip);
  });

  it("replaces cycles with [Circular]", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    const out = captureDebugOutput(obj);
    expect(out).toContain("[Circular]");
  });

  it("replaces depth > 8 with [MaxDepth]", () => {
    let deep: Record<string, unknown> = { v: "leaf" };
    for (let i = 0; i < 12; i++) deep = { nest: deep };
    const out = captureDebugOutput(deep);
    expect(out).toContain("[MaxDepth]");
  });

  it("does not throw on getter that throws", () => {
    const evil: Record<string, unknown> = {};
    Object.defineProperty(evil, "boom", {
      get() {
        throw new Error("getter exploded");
      },
      enumerable: true,
    });
    expect(() => debugLog!(evil)).not.toThrow();
    const out = stderrSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).not.toContain("getter exploded");
  });

  it("does not throw on proxy traps", () => {
    const evil = new Proxy(
      { real: 1 },
      {
        get(target, prop) {
          if (prop === "boom") throw new Error("proxy trap");
          return Reflect.get(target, prop);
        },
      },
    );
    expect(() => debugLog!(evil)).not.toThrow();
  });

  it("fallback output never contains the original secret", () => {
    const secret = "VERY_SECRET_VALUE_42";
    const evil: Record<string, unknown> = {};
    Object.defineProperty(evil, "explode", {
      get() {
        throw new Error(secret);
      },
      enumerable: true,
    });
    let out = "";
    try {
      debugLog!(evil);
    } catch {
      /* sanitizer MUST swallow */
    }
    out = stderrSpy.mock.calls
      .map((c) => c.map((a: unknown) => String(a)).join(" "))
      .join("\n");
    expect(out).not.toContain(secret);
  });
});
