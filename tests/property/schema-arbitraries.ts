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

// ISO timestamp arbitrary — fc.date() causes stack overflow with wide ranges, use string instead
export const isoTimestampArb = fc.string({ minLength: 20, maxLength: 30 }).map((s) => {
  // Generate valid ISO timestamps
  const base = new Date(2020, 0, 1).getTime();
  const offset = Math.floor(Math.random() * (new Date(2030, 11, 31).getTime() - base));
  return new Date(base + offset).toISOString();
});

// Check ID arbitrary (e.g. "SSH-001", "FW-DENY")
export const checkIdArb = fc.tuple(
  fc.constantFrom("SSH", "FW", "KRN", "FS", "AUTH", "DOCK", "LOG", "CRYPT"),
  fc.stringMatching(/^[A-Z0-9-]{1,20}$/),
).map(([prefix, suffix]) => `${prefix}-${suffix}`);

// Helper: non-empty string arbitrary (no whitespace-only strings)
const nonEmptyString = (maxLength: number) =>
  fc.string({ minLength: 1, maxLength }).filter((s) => s.trim().length > 0);

// Single audit check arbitrary — simplified, only required fields
export const auditCheckArb = fc.record({
  id: checkIdArb,
  category: nonEmptyString(30),
  name: nonEmptyString(80),
  severity: severityArb,
  passed: fc.boolean(),
  currentValue: nonEmptyString(200),
  expectedValue: nonEmptyString(200),
});

// Category arbitrary
export const categoryArb = fc.record({
  name: fc.constantFrom("SSH", "Firewall", "Kernel", "Filesystem", "Auth", "Docker", "Logging", "Crypto"),
  score: fc.integer({ min: 0, max: 100 }),
  maxScore: fc.integer({ min: 1, max: 100 }),
  checks: fc.array(auditCheckArb, { minLength: 1, maxLength: 10 }),
  connectionError: fc.option(fc.boolean(), { nil: undefined }),
});

// Quick win arbitrary
export const quickWinArb = fc.record({
  commands: fc.array(nonEmptyString(200), { minLength: 1, maxLength: 3 }),
  currentScore: fc.integer({ min: 0, max: 100 }),
  projectedScore: fc.integer({ min: 0, max: 100 }),
  description: nonEmptyString(200),
});

// Base audit result arbitrary — matches baseAuditSchema in snapshot.ts
export const baseAuditArb = fc.record({
  serverName: fc.stringMatching(/^[a-z][a-z0-9-]{2,62}$/),
  serverIp: ipArb,
  platform: platformArb,
  timestamp: isoTimestampArb,
  overallScore: fc.integer({ min: 0, max: 100 }),
  categories: fc.array(categoryArb, { minLength: 1, maxLength: 5 }),
  quickWins: fc.array(quickWinArb),
  skippedCategories: fc.option(fc.array(nonEmptyString(30), { minLength: 0, maxLength: 10 }), { nil: undefined }),
  vpsType: fc.option(nonEmptyString(30), { nil: undefined }),
  vpsAdjustedCount: fc.option(fc.integer({ min: 0, max: 1000 }), { nil: undefined }),
  warnings: fc.option(fc.array(nonEmptyString(200), { maxLength: 10 }), { nil: undefined }),
});

// Snapshot V2 arbitrary — matches snapshotFileV2Schema in snapshot.ts
export const snapshotV2Arb = fc.record({
  schemaVersion: fc.constant(2),
  name: fc.option(nonEmptyString(50), { nil: undefined }),
  savedAt: isoTimestampArb,
  audit: fc.record({
    serverName: fc.stringMatching(/^[a-z][a-z0-9-]{2,62}$/),
    serverIp: ipArb,
    platform: platformArb,
    timestamp: isoTimestampArb,
    overallScore: fc.integer({ min: 0, max: 100 }),
    categories: fc.array(categoryArb, { minLength: 1, maxLength: 5 }),
    quickWins: fc.array(quickWinArb),
    skippedCategories: fc.option(fc.array(nonEmptyString(30), { minLength: 0, maxLength: 10 }), { nil: undefined }),
    vpsType: fc.option(nonEmptyString(30), { nil: undefined }),
    vpsAdjustedCount: fc.option(fc.integer({ min: 0, max: 1000 }), { nil: undefined }),
    warnings: fc.option(fc.array(nonEmptyString(200), { maxLength: 10 }), { nil: undefined }),
    auditVersion: nonEmptyString(20),
  }),
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
