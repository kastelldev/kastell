/**
 * Tests for safeStringify and related redaction helpers in
 * src/utils/logger.ts (P143-F Task 8). The depth contract and the new
 * 2-arg `safeStringify(value, options?)` form are pinned here.
 */
import {
  safeStringify,
  MAX_REDACTION_DEPTH,
  REDACTED,
  CIRCULAR,
  MAX_DEPTH,
  UNSERIALIZABLE,
  SENSITIVE_KEY_PATTERNS,
} from "../../src/utils/logger";

describe("safeStringify export contract", () => {
  it("is exported as a function", () => {
    expect(typeof safeStringify).toBe("function");
  });
});

describe("safeStringify — default depth = 8", () => {
  it("serializes shallow objects normally", () => {
    expect(safeStringify({ a: 1, b: "x" })).toBe(JSON.stringify({ a: 1, b: "x" }));
  });

  it("uses depth 8 by default: depth 9 nested object shows [MaxDepth]", () => {
    // Build: { nest: { nest: { ... 9 deep ... } } }
    let deep: Record<string, unknown> = { v: "leaf" };
    for (let i = 0; i < 9; i++) deep = { nest: deep };
    const out = safeStringify(deep);
    // depth 8 boundary: nodes deeper than 8 levels become [MaxDepth]
    expect(out).toContain(MAX_DEPTH);
  });

  it("uses depth 8 by default: depth 8 nested object does NOT show [MaxDepth]", () => {
    let deep: Record<string, unknown> = { v: "leaf" };
    for (let i = 0; i < 8; i++) deep = { nest: deep };
    const out = safeStringify(deep);
    expect(out).not.toContain(MAX_DEPTH);
  });

  it("exports MAX_REDACTION_DEPTH as 8", () => {
    expect(MAX_REDACTION_DEPTH).toBe(8);
  });
});

describe("safeStringify — 2-arg form with explicit maxDepth", () => {
  it("maxDepth=3 truncates at level 3 ([MaxDepth] visible)", () => {
    let deep: Record<string, unknown> = { v: "leaf" };
    for (let i = 0; i < 5; i++) deep = { nest: deep };
    const out = safeStringify(deep, { maxDepth: 3 });
    expect(out).toContain(MAX_DEPTH);
  });

  it("maxDepth=10 does NOT truncate at 9-deep object", () => {
    let deep: Record<string, unknown> = { v: "leaf" };
    for (let i = 0; i < 9; i++) deep = { nest: deep };
    const out = safeStringify(deep, { maxDepth: 10 });
    expect(out).not.toContain(MAX_DEPTH);
  });

  it("maxDepth=0 still serializes the root object (depth 0 is the root itself)", () => {
    // Contract: `depth > maxDepth` truncates — depth 0 IS the root, so
    // {a:1} survives at maxDepth=0. Children (depth 1) are truncated.
    const out = safeStringify({ a: { b: 1 } }, { maxDepth: 0 });
    expect(out).toContain(MAX_DEPTH);
    expect(out).toContain('"a"');
  });

  it("maxDepth=undefined falls back to default 8", () => {
    let deep: Record<string, unknown> = { v: "leaf" };
    for (let i = 0; i < 9; i++) deep = { nest: deep };
    const out = safeStringify(deep, { maxDepth: undefined });
    expect(out).toContain(MAX_DEPTH);
  });
});

describe("safeStringify — cycle and getter safety", () => {
  it("replaces cycles with [Circular]", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    const out = safeStringify(obj);
    expect(out).toContain(CIRCULAR);
  });

  it("does not throw on object with throwing getter", () => {
    const evil: Record<string, unknown> = {};
    Object.defineProperty(evil, "boom", {
      get() {
        throw new Error("unsafe");
      },
      enumerable: true,
    });
    expect(() => safeStringify(evil)).not.toThrow();
    const out = safeStringify(evil);
    // The throwing getter must not leak the original error text
    expect(out).not.toContain("unsafe");
    expect(out).toContain(UNSERIALIZABLE);
  });

  it("handles nested arrays", () => {
    const out = safeStringify({ rows: [[1, 2], [3, 4]] });
    expect(JSON.parse(out)).toEqual({ rows: [[1, 2], [3, 4]] });
  });
});

describe("safeStringify — sensitive key redaction", () => {
  it("redacts apiToken key", () => {
    const out = safeStringify({ apiToken: "shh" });
    expect(out).toContain(REDACTED);
    expect(out).not.toContain("shh");
  });

  it("redacts password key", () => {
    const out = safeStringify({ password: "p4ss" });
    expect(out).not.toContain("p4ss");
  });

  it("redacts nested sensitive keys at every level", () => {
    const out = safeStringify({
      outer: {
        token: "abc",
        mid: { password: "p4ss", deeper: { apiKey: "k-9", secret: "shh" } },
      },
    });
    // Use unique non-replaced markers so the assertion is unambiguous.
    expect(out).not.toContain("abc");
    expect(out).not.toContain("p4ss");
    expect(out).not.toContain("k-9");
    expect(out).not.toContain("shh");
    expect(out).toContain(REDACTED);
  });
});

describe("safeStringify — string-value redaction", () => {
  it("redacts anchored Bearer token patterns", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const out = safeStringify({ note: `Auth header: Bearer ${jwt}` });
    expect(out).not.toContain(jwt);
  });

  it("redacts JWT-shaped three-segment strings", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const out = safeStringify({ raw: jwt });
    expect(out).not.toContain(jwt);
  });
});

describe("safeStringify — fallback safety", () => {
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
    expect(() => {
      out = safeStringify(evil);
    }).not.toThrow();
    expect(out).not.toContain(secret);
  });
});

describe("SENSITIVE_KEY_PATTERNS contract", () => {
  it("is exported and non-empty", () => {
    expect(Array.isArray(SENSITIVE_KEY_PATTERNS)).toBe(true);
    expect(SENSITIVE_KEY_PATTERNS.length).toBeGreaterThan(0);
  });

  it("matches the contract surface: password, token, secret, apikey, authorization, credential, privateKey", () => {
    // Pinned to the P142 pattern set — see SENSITIVE_KEY_PATTERNS in
    // src/utils/logger.ts. `api-key` is intentionally NOT in the contract
    // (use `apiKey` or `api_key` instead); test reflects that boundary.
    const mustMatch = [
      "password",
      "Password",
      "passphrase",
      "secret",
      "token",
      "apiToken",
      "api_key",
      "apikey",
      "authorization",
      "credential",
      "privateKey",
      "private_key",
    ];
    for (const sample of mustMatch) {
      const matched = SENSITIVE_KEY_PATTERNS.some((re) => re.test(sample));
      expect(matched).toBe(true);
    }
  });
});
