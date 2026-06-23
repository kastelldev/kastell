// tests/unit/probe-payload.test.ts
import {
  serializeProbePayload,
  assertProbeSessionEnvelopeSize,
  encryptProbePayload,
  decryptProbePayload,
  redactProbeDiagnostic,
  ProbePayloadLimitError,
  ProbePayloadAuthenticationError,
  ProbePayloadTypeError,
  MAX_PROBE_PAYLOAD_BYTES,
} from "../../src/core/probe/payload.js";
import { PROBE_SESSION_STATES, type ProbeSessionRecord } from "../../src/core/probe/types.js";
import { MOCK_KEY } from "../helpers/encryption-factories.js";

const key = MOCK_KEY;

function buildSessionRecord(overrides: Partial<ProbeSessionRecord> = {}): ProbeSessionRecord {
  return {
    schemaVersion: 1,
    revision: 1,
    sessionId: "session-1",
    targetKeyHash: "hash-1",
    state: "prepared",
    pluginName: "probe-plugin",
    pluginVersion: "1.0.0",
    checkId: "check-1",
    handlerPath: "/abs/path/to/handler.js",
    handlerSha256: "abc123",
    risk: "safe",
    timeoutMs: 30_000,
    target: { serverId: "srv-1", provider: "hetzner", ip: "1.2.3.4" },
    createdAt: "2026-06-19T00:00:00.000Z",
    updatedAt: "2026-06-19T00:00:00.000Z",
    history: [],
    ...overrides,
  };
}

describe("serializeProbePayload", () => {
  it("round-trips a valid plain JSON object", () => {
    const json = serializeProbePayload({ rollbackToken: "x", steps: [1, 2, 3] });
    expect(JSON.parse(json)).toEqual({ rollbackToken: "x", steps: [1, 2, 3] });
  });

  it("rejects functions", () => {
    expect(() => serializeProbePayload({ fn: () => 1 })).toThrow(ProbePayloadTypeError);
  });

  it("rejects symbols", () => {
    expect(() => serializeProbePayload({ sym: Symbol("s") })).toThrow(ProbePayloadTypeError);
  });

  it("rejects class instances", () => {
    class Foo {
      x = 1;
    }
    expect(() => serializeProbePayload({ obj: new Foo() })).toThrow(ProbePayloadTypeError);
  });

  it("rejects cyclic references", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => serializeProbePayload(a)).toThrow(ProbePayloadTypeError);
  });

  it("rejects Buffer values", () => {
    expect(() => serializeProbePayload({ buf: Buffer.from("hi") })).toThrow(ProbePayloadTypeError);
  });

  it("rejects BigInt values", () => {
    expect(() => serializeProbePayload({ n: 10n })).toThrow(ProbePayloadTypeError);
  });

  it("accepts 65,536 UTF-8 bytes and rejects 65,537", () => {
    const exact = { value: "a".repeat(65_524) };
    const oversized = { value: "a".repeat(65_525) };

    expect(Buffer.byteLength(JSON.stringify(exact), "utf8")).toBe(65_536);
    expect(() => serializeProbePayload(exact)).not.toThrow();
    expect(() => serializeProbePayload(oversized)).toThrow(ProbePayloadLimitError);
  });

  it("counts UTF-8 multibyte characters in bytes, not code units", () => {
    // Each emoji (U+1F600) is 4 UTF-8 bytes; String.length counts UTF-16 code
    // units (2 per emoji). 16,384 emoji => 65,536 bytes + 12 JSON wrap =>
    // 65,548 bytes total, which exceeds MAX_PROBE_PAYLOAD_BYTES (65,536).
    // String.length alone would report 32,782 — well under any naive limit.
    const emojis = "😀".repeat(16_384);
    const bytes = Buffer.byteLength(JSON.stringify({ value: emojis }), "utf8");
    expect(bytes).toBeGreaterThan(MAX_PROBE_PAYLOAD_BYTES);
    expect(emojis.length).toBeLessThan(MAX_PROBE_PAYLOAD_BYTES);
    expect(() => serializeProbePayload({ value: emojis })).toThrow(ProbePayloadLimitError);
  });
});

describe("assertProbeSessionEnvelopeSize", () => {
  it("accepts a small envelope", () => {
    expect(() => assertProbeSessionEnvelopeSize(buildSessionRecord())).not.toThrow();
  });

  it("rejects an envelope larger than 1 MiB", () => {
    const oversized = buildSessionRecord({
      history: [
        {
          from: "prepared",
          to: "executing",
          at: "x".repeat(1024 * 1024),
          reason: "test",
        },
      ],
    });
    expect(() => assertProbeSessionEnvelopeSize(oversized)).toThrow(ProbePayloadLimitError);
  });
});

describe("encryptProbePayload / decryptProbePayload", () => {
  it("produces an encrypted envelope that contains no plaintext secret", () => {
    const secret = "super-secret-token";
    const envelope = encryptProbePayload({ token: secret }, key);

    const serialized = JSON.stringify(envelope);
    expect(serialized).not.toContain(secret);
    expect(envelope.encrypted).toBe(true);
    expect(envelope.version).toBe(1);
  });

  it("round-trips encrypted payload back to the original value", () => {
    const original = { rollbackToken: "abc", step: 2 };
    const envelope = encryptProbePayload(original, key);
    const decrypted = decryptProbePayload(envelope, key);
    expect(JSON.parse(decrypted)).toEqual(original);
  });

  it("fails closed when ciphertext authentication is corrupted", () => {
    const encrypted = encryptProbePayload({ rollbackToken: "secret" }, key);
    const corrupted = {
      ...encrypted,
      tag: "AA" + encrypted.tag.slice(2),
    };

    expect(() => decryptProbePayload(corrupted, key)).toThrow(ProbePayloadAuthenticationError);
  });

  it("fails closed when iv is corrupted", () => {
    const encrypted = encryptProbePayload({ rollbackToken: "secret" }, key);
    const corrupted = {
      ...encrypted,
      iv: "AA" + encrypted.iv.slice(2),
    };

    expect(() => decryptProbePayload(corrupted, key)).toThrow(ProbePayloadAuthenticationError);
  });
});

describe("redactProbeDiagnostic", () => {
  it("redacts top-level token keys", () => {
    const out = redactProbeDiagnostic({ token: "abc", ok: true });
    expect(out).toEqual({ token: "[REDACTED]", ok: true });
  });

  it("redacts nested password, Bearer, and JWT-shaped strings", () => {
    const out = redactProbeDiagnostic({
      request: {
        headers: { authorization: "Bearer eyJhbGc.payload.sig" },
        body: { password: "p@ss" },
      },
    }) as { request: { headers: { authorization: string }; body: { password: string } } };
    expect(out.request.headers.authorization).toBe("[REDACTED]");
    expect(out.request.body.password).toBe("[REDACTED]");
  });

  it("redacts JWT-shaped strings anywhere in the structure", () => {
    const out = redactProbeDiagnostic({ message: "found jwt eyJhbGciOi.payload.signature" }) as {
      message: string;
    };
    expect(out.message).not.toContain("eyJhbGciOi");
    expect(out.message).toContain("[REDACTED]");
  });

  it("preserves non-sensitive values", () => {
    const out = redactProbeDiagnostic({ id: 1, name: "ok", nested: { x: 1 } });
    expect(out).toEqual({ id: 1, name: "ok", nested: { x: 1 } });
  });
});

describe("PROBE_SESSION_STATES", () => {
  it("contains the expected ordered set", () => {
    expect(PROBE_SESSION_STATES).toEqual([
      "preparing",
      "prepared",
      "executing",
      "executed",
      "verifying",
      "verified",
      "rollback-pending",
      "rolling-back",
      "rolled-back",
      "unresolved",
    ]);
  });
});
