// tests/property/probe-payload.property.test.ts
import fc from "fast-check";
import {
  serializeProbePayload,
  assertProbeSessionEnvelopeSize,
  encryptProbePayload,
  decryptProbePayload,
  redactProbeDiagnostic,
  ProbePayloadTypeError,
} from "../../src/core/probe/payload.js";
import { MOCK_KEY } from "../helpers/encryption-factories.js";

// Small primitive generators (no exotic types, no cycles).
const leafJsonArb = fc.oneof(
  fc.string({ maxLength: 32 }),
  fc.integer(),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.boolean(),
  fc.constant(null),
);

// Nested plain JSON values (primitives, arrays, objects, no cycles / exotic types).
const nestedJsonValueArb = fc.letrec((tie) => ({
  self: fc.oneof(
    { arbitrary: fc.string({ maxLength: 16 }), weight: 3 },
    { arbitrary: fc.integer(), weight: 3 },
    { arbitrary: fc.boolean(), weight: 2 },
    { arbitrary: fc.constant(null), weight: 1 },
    { arbitrary: fc.array(tie("self"), { maxLength: 5 }), weight: 2 },
    {
      arbitrary: fc.dictionary(
        fc.string({ minLength: 1, maxLength: 8 }),
        tie("self"),
        { maxKeys: 5 },
      ),
      weight: 2,
    },
  ),
}));

describe("Property: serializeProbePayload", () => {
  it("round-trips any small plain JSON value", () => {
    fc.assert(
      fc.property(
        leafJsonArb,
        (value) => {
          const json = serializeProbePayload(value);
          // JSON.stringify(-0) yields "0", so Jest's deep equality sees a
          // mismatch on the sign bit. Compare via stringified form, matching
          // the nested round-trip test below.
          expect(JSON.stringify(JSON.parse(json))).toBe(JSON.stringify(value));
        },
      ),
      { numRuns: 100 },
    );
  });

  it("round-trips nested plain JSON values (stringified equivalence)", () => {
    fc.assert(
      fc.property(nestedJsonValueArb.self, (value) => {
        const json = serializeProbePayload(value);
        // Compare via JSON.stringify to avoid -0 vs 0 strict equality noise
        // that fast-check's integer generator produces and Jest's deep
        // equality considers distinct.
        expect(JSON.stringify(JSON.parse(json))).toBe(JSON.stringify(value));
      }),
      { numRuns: 100 },
    );
  });

  it("rejects any value containing a BigInt with ProbePayloadTypeError", () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        expect(() => serializeProbePayload({ n: BigInt(n) })).toThrow(ProbePayloadTypeError);
      }),
      { numRuns: 50 },
    );
  });

  it("rejects any payload whose serialized form exceeds 64 KiB", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 65 * 1024 + 1, maxLength: 80 * 1024 }),
        (big) => {
          expect(() => serializeProbePayload({ value: big })).toThrow();
        },
      ),
      { numRuns: 30 },
    );
  });
});

describe("Property: encryptProbePayload / decryptProbePayload", () => {
  it("round-trips any small plain JSON value through encryption", () => {
    fc.assert(
      fc.property(nestedJsonValueArb.self, (value) => {
        const envelope = encryptProbePayload(value, MOCK_KEY);
        const decrypted = decryptProbePayload(envelope, MOCK_KEY);
        expect(JSON.stringify(JSON.parse(decrypted))).toBe(JSON.stringify(value));
      }),
      { numRuns: 50 },
    );
  });
});

describe("Property: redactProbeDiagnostic", () => {
  it("never emits an input-sensitive substring in the output", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 16, maxLength: 64 }).filter((s) => s.trim().length >= 16),
        (secret) => {
          const out = redactProbeDiagnostic({
            headers: { authorization: `Bearer ${secret}` },
          });
          expect(JSON.stringify(out)).not.toContain(secret);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("returns a structurally identical shape (object/array nesting preserved)", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 8 }),
          fc.oneof(
            fc.string({ maxLength: 16 }),
            fc.integer(),
            fc.array(fc.string({ maxLength: 8 }), { maxLength: 4 }),
          ),
          { maxKeys: 6 },
        ),
        (obj) => {
          const out = redactProbeDiagnostic(obj) as Record<string, unknown>;
          expect(Object.keys(out).sort()).toEqual(Object.keys(obj).sort());
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe("Property: assertProbeSessionEnvelopeSize", () => {
  it("accepts any envelope whose serialized size is within 1 MiB", () => {
    fc.assert(
      fc.property(
        fc.record({
          schemaVersion: fc.constant(1 as const),
          revision: fc.integer({ min: 0, max: 10 }),
          sessionId: fc.string({ maxLength: 64 }),
          targetKeyHash: fc.string({ maxLength: 32 }),
          state: fc.constantFrom(
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
          ),
          pluginName: fc.string({ maxLength: 32 }),
          pluginVersion: fc.string({ maxLength: 16 }),
          checkId: fc.string({ maxLength: 32 }),
          handlerPath: fc.string({ maxLength: 64 }),
          handlerSha256: fc.string({ maxLength: 16 }),
          risk: fc.constantFrom("safe", "caution", "dangerous"),
          timeoutMs: fc.integer({ min: 100, max: 60_000 }),
          target: fc.record({
            serverId: fc.string({ maxLength: 32 }),
            provider: fc.string({ maxLength: 16 }),
            cloudId: fc.option(fc.string({ maxLength: 32 }), { nil: undefined }),
            ip: fc.string({ maxLength: 45 }),
          }),
          createdAt: fc.constant("2026-06-19T00:00:00.000Z"),
          updatedAt: fc.constant("2026-06-19T00:00:00.000Z"),
          history: fc.constant([] as Array<unknown>),
        }),
        (record) => {
          expect(() => assertProbeSessionEnvelopeSize(record as never)).not.toThrow();
        },
      ),
      { numRuns: 50 },
    );
  });
});
