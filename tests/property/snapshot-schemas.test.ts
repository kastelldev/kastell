// tests/property/snapshot-schemas.test.ts
import fc from "fast-check";
import {
  auditCheckSchema,
  categorySchema,
  quickWinSchema,
  snapshotFileV2Schema,
} from "../../src/core/audit/snapshot.js";
import {
  auditCheckArb,
  categoryArb,
  quickWinArb,
  snapshotV2Arb,
} from "./schema-arbitraries.js";

describe("Property-based: Snapshot Schemas", () => {
  describe("auditCheckSchema", () => {
    it("accepts all valid generated audit checks", () => {
      fc.assert(
        fc.property(auditCheckArb, (check) => {
          const result = auditCheckSchema.safeParse(check);
          if (!result.success) {
            throw new Error(
              `Valid check rejected: ${JSON.stringify(check)}\nError: ${result.error.message}`
            );
          }
        }),
        { numRuns: 200 },
      );
    });

    it("rejects checks with invalid severity", () => {
      fc.assert(
        fc.property(
          auditCheckArb.map((check) => ({ ...check, severity: "INVALID" })),
          (check) => {
            const result = auditCheckSchema.safeParse(check);
            return !result.success;
          },
        ),
        { numRuns: 50 },
      );
    });

    it("rejects checks with missing required fields", () => {
      fc.assert(
        fc.property(
          fc.constantFrom("id", "category", "name", "severity", "passed", "currentValue", "expectedValue"),
          auditCheckArb,
          (fieldToRemove, check) => {
            const broken = { ...check };
            delete (broken as Record<string, unknown>)[fieldToRemove];
            const result = auditCheckSchema.safeParse(broken);
            return !result.success;
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("categorySchema", () => {
    it("accepts all valid generated categories", () => {
      fc.assert(
        fc.property(categoryArb, (cat) => {
          const result = categorySchema.safeParse(cat);
          if (!result.success) {
            throw new Error(
              `Valid category rejected: ${JSON.stringify(cat).slice(0, 200)}\nError: ${result.error.message}`
            );
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("quickWinSchema", () => {
    it("accepts all valid generated quick wins", () => {
      fc.assert(
        fc.property(quickWinArb, (qw) => {
          const result = quickWinSchema.safeParse(qw);
          if (!result.success) {
            throw new Error(
              `Valid quickWin rejected: ${JSON.stringify(qw)}\nError: ${result.error.message}`
            );
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("snapshotFileV2Schema", () => {
    it("accepts all valid generated V2 snapshots", () => {
      fc.assert(
        fc.property(snapshotV2Arb, (snap) => {
          const result = snapshotFileV2Schema.safeParse(snap);
          if (!result.success) {
            throw new Error(
              `Valid snapshot rejected: ${JSON.stringify(snap).slice(0, 300)}\nError: ${result.error.message}`
            );
          }
        }),
        { numRuns: 100 },
      );
    });

    it("roundtrip: parse → serialize → parse produces same result", () => {
      fc.assert(
        fc.property(snapshotV2Arb, (snap) => {
          const parsed1 = snapshotFileV2Schema.safeParse(snap);
          if (!parsed1.success) return true;
          const serialized = JSON.parse(JSON.stringify(parsed1.data));
          const parsed2 = snapshotFileV2Schema.safeParse(serialized);
          if (!parsed2.success) {
            throw new Error("Roundtrip failed");
          }
          return parsed2.data.audit.overallScore === parsed1.data.audit.overallScore;
        }),
        { numRuns: 100 },
      );
    });

    it("rejects snapshots with wrong schemaVersion", () => {
      fc.assert(
        fc.property(
          snapshotV2Arb.map((snap) => ({ ...snap, schemaVersion: 99 })),
          (snap) => {
            const result = snapshotFileV2Schema.safeParse(snap);
            return !result.success;
          },
        ),
        { numRuns: 50 },
      );
    });
  });
});
