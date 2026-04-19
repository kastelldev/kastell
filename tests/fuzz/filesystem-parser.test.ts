// tests/fuzz/filesystem-parser.test.ts
import fc from "fast-check";
import { parseFilesystemChecks } from "../../src/core/audit/checks/filesystem.js";
import { mountOutputArb, statOutputArb, garbageOutputArb, assertNoThrow, assertValidChecks } from "./parser-helpers.js";

describe("Fuzz: Filesystem Parser", () => {
  const platformArb = fc.constantFrom("coolify", "dokploy", "bare");

  it("never crashes on valid mount + stat output", () => {
    fc.assert(
      fc.property(
        fc.tuple(statOutputArb, mountOutputArb, garbageOutputArb).map(
          ([stat, mount, extra]) => `${stat}\n${mount}\n${extra}`,
        ),
        platformArb,
        (output, platform) => {
          assertNoThrow(() => {
            const checks = parseFilesystemChecks(output, platform);
            assertValidChecks(checks);
          });
        },
      ),
      { numRuns: 300 },
    );
  });

  it("never crashes on garbage input", () => {
    fc.assert(
      fc.property(garbageOutputArb, platformArb, (output, platform) => {
        assertNoThrow(() => {
          const checks = parseFilesystemChecks(output, platform);
          assertValidChecks(checks);
        });
      }),
      { numRuns: 300 },
    );
  });

  it("empty mount output returns checks", () => {
    const checks = parseFilesystemChecks("", "bare");
    assertValidChecks(checks);
  });

  it("returns consistent results for same input", () => {
    fc.assert(
      fc.property(mountOutputArb, platformArb, (output, platform) => {
        const checks1 = parseFilesystemChecks(output, platform);
        const checks2 = parseFilesystemChecks(output, platform);
        return checks1.length === checks2.length;
      }),
      { numRuns: 100 },
    );
  });
});
