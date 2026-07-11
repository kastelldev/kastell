import { logger, createSpinner, setMachineMode, isMachineMode, withMachineMode } from "../../src/utils/logger";

describe("logger machine mode", () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    stderrSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    setMachineMode(false);
  });

  afterEach(() => {
    setMachineMode(false);
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("should default to non-machine mode", () => {
    expect(isMachineMode()).toBe(false);
  });

  it("should reflect machine mode state when enabled", () => {
    setMachineMode(true);
    expect(isMachineMode()).toBe(true);
    setMachineMode(false);
    expect(isMachineMode()).toBe(false);
  });

  it("should route logger.info to stderr when in machine mode", () => {
    setMachineMode(true);
    logger.info("diagnostic");
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("should route logger.success to stderr when in machine mode", () => {
    setMachineMode(true);
    logger.success("success");
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("should route logger.step to stderr when in machine mode", () => {
    setMachineMode(true);
    logger.step("step");
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("should suppress decorative blank lines for logger.title when in machine mode", () => {
    setMachineMode(true);
    logger.title("My Title");
    // In machine mode title should not emit the leading/trailing empty console.log calls
    expect(stdoutSpy).not.toHaveBeenCalled();
    // title must still emit the title text to stderr exactly once — guards against
    // regressions where blank lines would also reach stderr (e.g. empty console.log
    // calls routed to stderr in machine mode).
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("My Title"));
  });

  it("should keep logger.error on stderr regardless of machine mode", () => {
    setMachineMode(true);
    logger.error("boom");
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledWith(expect.any(String), "boom");
  });

  it("should keep logger.warning on stderr regardless of machine mode", () => {
    setMachineMode(true);
    logger.warning("warn");
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledWith(expect.any(String), "warn");
  });

  it("should restore stdout routing for logger.info after machine mode is disabled", () => {
    setMachineMode(true);
    logger.info("hidden");
    setMachineMode(false);
    logger.info("visible");
    // visible should be called via stdout (console.log)
    expect(stdoutSpy).toHaveBeenCalled();
  });
});

describe("withMachineMode", () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    stderrSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    setMachineMode(false);
  });

  afterEach(() => {
    setMachineMode(false);
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("should enable machine mode for the duration of fn and restore after", async () => {
    expect(isMachineMode()).toBe(false);
    await withMachineMode(() => {
      expect(isMachineMode()).toBe(true);
    });
    expect(isMachineMode()).toBe(false);
  });

  it("should restore machine mode even when fn throws", async () => {
    setMachineMode(false);
    await expect(
      withMachineMode(() => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(isMachineMode()).toBe(false);
  });

  it("should preserve an outer machine-mode state when invoked from inside machine mode", async () => {
    setMachineMode(true);
    await withMachineMode(() => {
      expect(isMachineMode()).toBe(true);
    });
    // Outer mode was true on entry, restored to true on exit.
    expect(isMachineMode()).toBe(true);
    setMachineMode(false);
  });
});

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

  it("should redact sensitive context before logging errors", () => {
    logger.error("request failed", {
      token: "dop_v1_aB3xK9mZ2qL5wR8n",
      nested: { password: "p4ssw0rd" },
      serverId: "srv_a1b2c3",
    });

    const output = stderrSpy.mock.calls
      .map((call) => call.map((part: unknown) => String(part)).join(" "))
      .join("\n");

    expect(output).toContain("request failed");
    expect(output).toContain("srv_a1b2c3");
    expect(output).not.toContain("dop_v1_aB3xK9mZ2qL5wR8n");
    expect(output).not.toContain("p4ssw0rd");
    expect(output).toContain("[REDACTED]");
  });

  it("should redact secret-shaped strings in diagnostic logger methods", () => {
    logger.info("Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig");
    logger.success("dop_v1_aB3xK9mZ2qL5wR8n");
    logger.warning("hcic_f7d2c9e4b1a8g6h3");

    const output = [...stdoutSpy.mock.calls, ...stderrSpy.mock.calls]
      .map((call) => call.map((part: unknown) => String(part)).join(" "))
      .join("\n");

    expect(output).not.toContain("eyJhbGciOiJIUzI1NiJ9.payload.sig");
    expect(output).not.toContain("dop_v1_aB3xK9mZ2qL5wR8n");
    expect(output).not.toContain("hcic_f7d2c9e4b1a8g6h3");
    expect(output).toContain("[REDACTED]");
  });

  it("should redact secrets embedded mid-string (substring redaction)", () => {
    // Provider tokens embedded in longer messages — pre-fix, the
    // whole-string-only redactString let these leak through stderr.
    logger.error(`auth failed: token=hcic_aB3xK9mZ2qL5wR8n user=alice`);
    logger.warning(`Re-run with HETZNER_TOKEN=hcic_f7d2c9e4b1a8g6h3 set`);
    logger.info(`request url: /api/v1?token=dop_v1_aB3xK9mZ2qL5wR8n&page=1`);
    // Bearer mid-string
    logger.warning(`upstream returned Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c`);

    const output = [...stdoutSpy.mock.calls, ...stderrSpy.mock.calls]
      .map((call) => call.map((part: unknown) => String(part)).join(" "))
      .join("\n");

    expect(output).not.toContain("hcic_aB3xK9mZ2qL5wR8n");
    expect(output).not.toContain("hcic_f7d2c9e4b1a8g6h3");
    expect(output).not.toContain("dop_v1_aB3xK9mZ2qL5wR8n");
    expect(output).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c");
    // IPv4 addresses and other non-secret substrings remain visible
    expect(output).toContain("auth failed");
    expect(output).toContain("alice");
  });

  it("should redact multiple secrets in a single message", () => {
    // Two Hetzner tokens in one message — global regex replaces every occurrence.
    logger.error(
      "rotating from hcic_oldOneAAA111 to hcic_newTwoBBB222 succeeded",
    );
    const out = stderrSpy.mock.calls
      .map((call) => call.map((p: unknown) => String(p)).join(" "))
      .join("\n");
    expect(out).not.toContain("hcic_oldOneAAA111");
    expect(out).not.toContain("hcic_newTwoBBB222");
    expect(out).toContain("[REDACTED]");
    expect(out).toContain("rotating from");
    expect(out).toContain("succeeded");
  });

  it("should redact repeated secret-shaped substrings across separate log calls", () => {
    logger.warning("first token=hcic_firstAAA111");
    logger.warning("second token=hcic_secondBBB222");

    const out = stderrSpy.mock.calls
      .map((call) => call.map((p: unknown) => String(p)).join(" "))
      .join("\n");

    expect(out).not.toContain("hcic_firstAAA111");
    expect(out).not.toContain("hcic_secondBBB222");
    expect(out).toContain("first token=");
    expect(out).toContain("second token=");
  });

  it("should redact JWT substring in the middle of a longer message", () => {
    // JWT (3-segment base64url, each segment >=20 chars) embedded mid-string.
    logger.error(
      "request failed: jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c retry=3",
    );
    const out = stderrSpy.mock.calls
      .map((call) => call.map((p: unknown) => String(p)).join(" "))
      .join("\n");
    expect(out).not.toContain(
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
    );
    expect(out).toContain("request failed");
    expect(out).toContain("retry=3");
  });

  it("should not redact IPv4 addresses (JWT_PATTERN length floor)", () => {
    // Regression guard: pre-fix, JWT_PATTERN without min segment length matched
    // IPv4 '203.0.113.42' as '203.0.113'. The 20-char floor prevents this.
    logger.error("connected from 203.0.113.42 in 50ms");
    const out = stderrSpy.mock.calls
      .map((call) => call.map((p: unknown) => String(p)).join(" "))
      .join("\n");
    expect(out).toContain("203.0.113.42");
  });

  it("should redact Vultr v2 token as whole-string (provider token gap)", () => {
    // Vultr v2 API keys use the `vltc` prefix followed by an optional separator
    // and 32-char alphanumeric body (per Vultr docs). Pre-fix, no PROVIDER_TOKEN
    // pattern matched Vultr, so the whole token would leak to stderr.
    const vultrKey = "vltc.AbCdEfGhIjKlMnOpQrStUvWxYz012345";
    logger.error(vultrKey);
    const out = stderrSpy.mock.calls
      .map((call) => call.map((p: unknown) => String(p)).join(" "))
      .join("\n");
    expect(out).not.toContain(vultrKey);
    expect(out).toContain("[REDACTED]");
  });

  it("should redact Vultr v2 token embedded mid-string (substring redaction)", () => {
    // Substring path: provider token inside a longer diagnostic message.
    const vultrKey = "vltc.AbCdEfGhIjKlMnOpQrStUvWxYz012345";
    logger.error(`auth failed: token=${vultrKey} user=alice`);
    const out = stderrSpy.mock.calls
      .map((call) => call.map((p: unknown) => String(p)).join(" "))
      .join("\n");
    expect(out).not.toContain(vultrKey);
    expect(out).toContain("auth failed");
    expect(out).toContain("alice");
  });

  it("should redact long opaque tokens as whole-string (Linode-style, no public prefix)", () => {
    // Linode doesn't publish its token prefix (security through obscurity).
    // Tokens are long opaque alphanumeric strings used as Bearer auth, typically
    // 50+ chars. The whole-string pattern catches them; the 50-char floor
    // avoids false-positives on commit hashes (40 hex) and UUIDs (32-36 chars).
    const linodeKey = "aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3wX4yZ5aB6cD7eF8gH9";
    logger.error(linodeKey);
    const out = stderrSpy.mock.calls
      .map((call) => call.map((p: unknown) => String(p)).join(" "))
      .join("\n");
    expect(out).not.toContain(linodeKey);
    expect(out).toContain("[REDACTED]");
  });

  it("should NOT redact short hex hashes when length below the long-token floor", () => {
    // Regression guard: SHA-1 (40 hex) and similar short identifiers must NOT
    // be redacted. The 50-char whole-string floor keeps them visible.
    const sha1 = "5d41402abc4b2a76b9719d911017c592";
    logger.info(`commit ${sha1}`);
    const out = stdoutSpy.mock.calls
      .map((call) => call.map((p: unknown) => String(p)).join(" "))
      .join("\n");
    expect(out).toContain(sha1);
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

  // P147 Task 9 — coverage gaps G1/G2/G7
  it("should not throw when logger.error receives an empty message", () => {
    expect(() => logger.error("")).not.toThrow();
    expect(stderrSpy).toHaveBeenCalled();
    const flatOutput = stderrSpy.mock.calls
      .map((call) => call.map((part: unknown) => String(part)).join(" "))
      .join("\n");
    // Empty message is preserved as-is (redactString("") === "" — looksLikeSecretValue returns false).
    expect(flatOutput).toBeDefined();
  });

  it("should not throw when logger.error receives a circular reference in context", () => {
    const ctx: Record<string, unknown> = { name: "test" };
    ctx.self = ctx;
    expect(() => logger.error("circular ctx", ctx)).not.toThrow();
    const flatOutput = stderrSpy.mock.calls
      .map((call) => call.map((part: unknown) => String(part)).join(" "))
      .join("\n");
    expect(flatOutput).toContain("[Circular]");
    expect(flatOutput).toContain("circular ctx");
  });

  it("should not throw when logger.error context has a throwing getter", () => {
    const evil: Record<string, unknown> = {};
    Object.defineProperty(evil, "boom", {
      get() {
        throw new Error("getter exploded");
      },
      enumerable: true,
    });
    expect(() => logger.error("getter ctx", evil)).not.toThrow();
    const flatOutput = stderrSpy.mock.calls
      .map((call) => call.map((part: unknown) => String(part)).join(" "))
      .join("\n");
    expect(flatOutput).not.toContain("getter exploded");
  });

  it("should NOT collapse short Bearer messages as whole-string (P147 redaction length floor)", () => {
    // 'Bearer missing' is a legitimate diagnostic — the entire string matches the
    // WHOLE bearer shape but the token is < 8 chars and is not an actual secret.
    // Pre-153c715 redesign this would have collapsed to [REDACTED]; the fix adds a
    // minimum token length floor so diagnostic strings survive.
    logger.error("Bearer missing in config");
    const out = stderrSpy.mock.calls
      .map((call) => call.map((p: unknown) => String(p)).join(" "))
      .join("\n");
    expect(out).toContain("Bearer missing");
    expect(out).not.toContain("[REDACTED]");
  });

  it("should NOT redact identifier-internal 'Bearer' substring (P147 boundary anchor)", () => {
    // 'XBearer abc' is an identifier, not an Authorization header. Pre-153c715 the
    // substring pattern used a (^|\W) boundary anchor; the redesign dropped it.
    // The boundary must be restored so identifier-internal matches don't leak.
    logger.error("connection failed: XBearer abc invalid");
    const out = stderrSpy.mock.calls
      .map((call) => call.map((p: unknown) => String(p)).join(" "))
      .join("\n");
    expect(out).toContain("XBearer abc");
  });

  it("should not throw when logger.warning receives an empty message", () => {
    expect(() => logger.warning("")).not.toThrow();
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("should not throw when logger.title receives an empty message in human mode", () => {
    setMachineMode(false);
    expect(() => logger.title("")).not.toThrow();
    // 3 console.log calls (empty-line + title + empty-line) — each with the redacted title arg.
    expect(stdoutSpy).toHaveBeenCalledTimes(3);
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
