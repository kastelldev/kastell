// tests/fuzz/firewall-parser.test.ts
import fc from "fast-check";
import { parseFirewallChecks } from "../../src/core/audit/checks/firewall.js";
import { ufwStatusArb, garbageOutputArb, assertNoThrow, assertValidChecks } from "./parser-helpers.js";

describe("Fuzz: Firewall Parser", () => {
  const platformArb = fc.constantFrom("coolify", "dokploy", "bare");

  it("never crashes on valid UFW output", () => {
    fc.assert(
      fc.property(ufwStatusArb, platformArb, (output, platform) => {
        assertNoThrow(() => {
          const checks = parseFirewallChecks(output, platform);
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
          const checks = parseFirewallChecks(output, platform);
          assertValidChecks(checks);
        });
      }),
      { numRuns: 300 },
    );
  });

  it("active status always detected correctly", () => {
    fc.assert(
      fc.property(ufwStatusArb, platformArb, (output, platform) => {
        const checks = parseFirewallChecks(output, platform);
        const activeCheck = checks.find((c) => c.id.includes("ACTIVE") || c.id.includes("UFW"));
        if (activeCheck && output.includes("Status: active")) {
          return activeCheck.passed === true;
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });

  it("returns consistent results for same input", () => {
    fc.assert(
      fc.property(ufwStatusArb, platformArb, (output, platform) => {
        const checks1 = parseFirewallChecks(output, platform);
        const checks2 = parseFirewallChecks(output, platform);
        return checks1.length === checks2.length;
      }),
      { numRuns: 100 },
    );
  });
});
