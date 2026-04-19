// tests/fuzz/kernel-parser.test.ts
import fc from "fast-check";
import { parseKernelChecks } from "../../src/core/audit/checks/kernel.js";
import { sysctlOutputArb, garbageOutputArb, mixedOutputArb, assertNoThrow, assertValidChecks } from "./parser-helpers.js";

describe("Fuzz: Kernel Parser", () => {
  const platformArb = fc.constantFrom("coolify", "dokploy", "bare");

  it("never crashes on valid sysctl output", () => {
    fc.assert(
      fc.property(sysctlOutputArb, platformArb, (output, platform) => {
        assertNoThrow(() => {
          const checks = parseKernelChecks(output, platform);
          assertValidChecks(checks);
        });
      }),
      { numRuns: 300 },
    );
  });

  it("never crashes on garbage input", () => {
    fc.assert(
      fc.property(garbageOutputArb, platformArb, (output, platform) => {
        assertNoThrow(() => {
          const checks = parseKernelChecks(output, platform);
          assertValidChecks(checks);
        });
      }),
      { numRuns: 300 },
    );
  });

  it("never crashes on mixed valid + garbage input", () => {
    fc.assert(
      fc.property(mixedOutputArb, platformArb, (output, platform) => {
        assertNoThrow(() => {
          const checks = parseKernelChecks(output, platform);
          assertValidChecks(checks);
        });
      }),
      { numRuns: 200 },
    );
  });

  it("returns consistent check count for same input", () => {
    fc.assert(
      fc.property(sysctlOutputArb, platformArb, (output, platform) => {
        const checks1 = parseKernelChecks(output, platform);
        const checks2 = parseKernelChecks(output, platform);
        return checks1.length === checks2.length;
      }),
      { numRuns: 100 },
    );
  });

  it("empty input returns checks (all with default values)", () => {
    const checks = parseKernelChecks("", "bare");
    assertValidChecks(checks);
  });
});
