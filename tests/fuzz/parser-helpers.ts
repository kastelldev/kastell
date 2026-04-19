// tests/fuzz/parser-helpers.ts
import fc from "fast-check";

// Sysctl-like output arbitrary (key = value format)
export const sysctlOutputArb = fc.array(
  fc.tuple(
    fc.stringMatching(/^[a-z][a-z0-9_.]{2,40}$/),
    fc.oneof(
      fc.integer({ min: 0, max: 65535 }).map(String),
      fc.string({ maxLength: 50 }),
    ),
  ).map(([key, val]) => `${key} = ${val}`),
  { minLength: 0, maxLength: 30 },
).map((lines) => lines.join("\n"));

// Completely random garbage output
export const garbageOutputArb = fc.string({ minLength: 0, maxLength: 2000 });

// Output with section sentinels
export const sectionOutputArb = (sectionName: string, content: fc.Arbitrary<string>) =>
  content.map((c) => `---SECTION:${sectionName}---\n${c}\n---SECTION:NEXT---`);

// Mixed valid + garbage output
export const mixedOutputArb = fc.tuple(
  sysctlOutputArb,
  garbageOutputArb,
).map(([valid, garbage]) => `${valid}\n${garbage}`);

// Assert parser never throws
export function assertNoThrow(fn: () => unknown): void {
  try {
    fn();
  } catch (e) {
    throw new Error(`Parser threw: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// Assert parser returns valid check array
export function assertValidChecks(checks: unknown): void {
  if (!Array.isArray(checks)) {
    throw new Error(`Expected array, got ${typeof checks}`);
  }
  for (const check of checks) {
    if (typeof check !== "object" || check === null) {
      throw new Error(`Check is not an object: ${JSON.stringify(check)}`);
    }
    const c = check as Record<string, unknown>;
    if (typeof c.id !== "string") throw new Error(`Check missing id: ${JSON.stringify(c)}`);
    if (typeof c.passed !== "boolean") throw new Error(`Check missing passed: ${JSON.stringify(c)}`);
  }
}

// UFW status output arbitrary
export const ufwStatusArb = fc.tuple(
  fc.constantFrom("Status: active", "Status: inactive", ""),
  fc.array(
    fc.tuple(
      fc.integer({ min: 1, max: 65535 }),
      fc.constantFrom("tcp", "udp"),
      fc.constantFrom("ALLOW", "DENY", "REJECT", "LIMIT"),
      fc.constantFrom("Anywhere", "0.0.0.0/0", "192.168.1.0/24", "10.0.0.0/8"),
    ).map(([port, proto, action, from]) => `${port}/${proto}                    ${action} IN    ${from}`),
    { minLength: 0, maxLength: 10 },
  ),
).map(([status, rules]) => `${status}\n\nTo                         Action      From\n--                         ------      ----\n${rules.join("\n")}`);

// Mount output arbitrary
export const mountOutputArb = fc.array(
  fc.tuple(
    fc.constantFrom("/dev/sda1", "/dev/sdb1", "tmpfs", "proc"),
    fc.constantFrom("/", "/tmp", "/var", "/home", "/var/tmp", "/boot"),
    fc.constantFrom("ext4", "tmpfs", "xfs", "btrfs"),
    fc.array(
      fc.constantFrom("rw", "nosuid", "noexec", "nodev", "relatime", "defaults"),
      { minLength: 1, maxLength: 4 },
    ).map((opts) => opts.join(",")),
  ).map(([dev, mount, fs, opts]) => `${dev} on ${mount} type ${fs} (${opts})`),
  { minLength: 0, maxLength: 8 },
).map((lines) => lines.join("\n"));

// stat output arbitrary (for /tmp)
export const statOutputArb = fc.tuple(
  fc.stringMatching(/^[01]?[0-7]{3}$/),
  fc.constantFrom("root", "www-data", "nobody"),
  fc.constantFrom("root", "www-data", "nogroup"),
).map(([perms, user, group]) => `${perms} ${user} ${group}`);
