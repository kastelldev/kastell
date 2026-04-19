// tests/property/schema-arbitraries.ts
import fc from "fast-check";

// Audit check severity arbitrary
export const severityArb = fc.constantFrom("critical", "warning", "info");

// Platform arbitrary
export const platformArb = fc.constantFrom("coolify", "dokploy", "bare");

// Valid IP arbitrary
export const ipArb = fc.tuple(
  fc.integer({ min: 1, max: 255 }),
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 1, max: 254 }),
).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

// ISO timestamp arbitrary
export const isoTimestampArb = fc.date({
  min: new Date("2020-01-01"),
  max: new Date("2030-12-31"),
}).map((d) => d.toISOString());

// Check ID arbitrary (e.g. "SSH-001", "FW-DENY")
export const checkIdArb = fc.tuple(
  fc.constantFrom("SSH", "FW", "KRN", "FS", "AUTH", "DOCK", "LOG", "CRYPT"),
  fc.stringMatching(/^[A-Z0-9-]{1,20}$/),
).map(([prefix, suffix]) => `${prefix}-${suffix}`);

// Single audit check arbitrary
export const auditCheckArb = fc.record({
  id: checkIdArb,
  category: fc.constantFrom("SSH", "Firewall", "Kernel", "Filesystem", "Auth", "Docker", "Logging", "Crypto"),
  name: fc.string({ minLength: 3, maxLength: 80 }),
  severity: severityArb,
  passed: fc.boolean(),
  currentValue: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
  expectedValue: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
  fixCommand: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
  explain: fc.option(fc.string({ maxLength: 500 }), { nil: undefined }),
});

// Category arbitrary
export const categoryArb = fc.record({
  name: fc.constantFrom("SSH", "Firewall", "Kernel", "Filesystem", "Auth", "Docker", "Logging", "Crypto"),
  score: fc.integer({ min: 0, max: 100 }),
  maxScore: fc.integer({ min: 1, max: 100 }),
  checks: fc.array(auditCheckArb, { minLength: 1, maxLength: 10 }),
  connectionError: fc.option(fc.boolean(), { nil: undefined }),
});

// Base audit result arbitrary
export const baseAuditArb = fc.record({
  serverName: fc.stringMatching(/^[a-z][a-z0-9-]{2,62}$/),
  serverIp: ipArb,
  platform: platformArb,
  timestamp: isoTimestampArb,
  overallScore: fc.integer({ min: 0, max: 100 }),
  categories: fc.array(categoryArb, { minLength: 1, maxLength: 5 }),
});

// Quick win arbitrary
export const quickWinArb = fc.record({
  commands: fc.array(fc.string({ minLength: 5, maxLength: 200 }), { minLength: 1, maxLength: 3 }),
  currentScore: fc.integer({ min: 0, max: 100 }),
  projectedScore: fc.integer({ min: 0, max: 100 }),
  description: fc.string({ minLength: 5, maxLength: 200 }),
});

// Snapshot V2 arbitrary
export const snapshotV2Arb = fc.record({
  schemaVersion: fc.constant(2),
  name: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  savedAt: isoTimestampArb,
  audit: baseAuditArb.chain((audit) =>
    fc.record({ auditVersion: fc.constant("1.17.1") }).map((extra) => ({ ...audit, ...extra }))
  ),
});

// Guard state entry arbitrary
export const guardStateEntryArb = fc.record({
  installedAt: isoTimestampArb,
  cronExpr: fc.constant("*/5 * * * *"),
});

// Guard state arbitrary (record of serverName → entry)
export const guardStateArb = fc.dictionary(
  fc.stringMatching(/^[a-z][a-z0-9-]{2,30}$/),
  guardStateEntryArb,
  { minKeys: 0, maxKeys: 5 },
);
