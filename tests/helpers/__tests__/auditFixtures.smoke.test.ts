/**
 * Smoke test for auditFixtures helper.
 * CQS-11 #9d: factory output satisfies declared types — compile-time assert
 * via `satisfies` for makeAuditResult, runtime check for makeServerRecord.
 */

import { makeAuditResult, makeServerRecord } from "../auditFixtures.js";
import type { AuditResult } from "../../../src/core/audit/types.js";
import type { ServerRecord } from "../../../src/types/index.js";

describe("auditFixtures smoke (CQS-11 #9d)", () => {
  it("makeAuditResult() output satisfies AuditResult", () => {
    const result = makeAuditResult() satisfies AuditResult;
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.categories)).toBe(true);
  });

  it("makeAuditResult({ overallScore: 75 }) override works", () => {
    const result = makeAuditResult({ overallScore: 75 });
    expect(result.overallScore).toBe(75);
  });

  it("makeServerRecord() output is a structurally valid ServerRecord", () => {
    const record = makeServerRecord("test-server", "1.2.3.4") satisfies ServerRecord;
    expect(record.name).toBe("test-server");
    expect(record.ip).toBe("1.2.3.4");
    expect(record.provider).toBeTruthy();
    expect(record.mode).toBe("coolify");
  });

  it("makeServerRecord() with overrides propagates", () => {
    const record = makeServerRecord("custom", "10.0.0.1", { provider: "digitalocean" });
    expect(record.name).toBe("custom");
    expect(record.provider).toBe("digitalocean");
  });
});