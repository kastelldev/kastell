import type { AuditResult } from "../../src/core/audit/types";
import { CHECK_IDS } from "../../src/core/audit/checkIds.js";
import { calculateQuickWins } from "../../src/core/audit/quickwin.js";

const mockResult: AuditResult = {
  serverName: "test-server",
  serverIp: "1.2.3.4",
  platform: "bare",
  timestamp: "2026-03-08T00:00:00.000Z",
  auditVersion: "1.0.0",
  categories: [
    {
      name: "SSH",
      checks: [
        {
          id: "SSH-PASSWORD-AUTH",
          category: "SSH",
          name: "Password Auth",
          severity: "critical",
          passed: true,
          currentValue: "no",
          expectedValue: "no",
        },
      ],
      score: 100,
      maxScore: 100,
    },
  ],
  overallScore: 100,
  quickWins: [],
};

describe("formatJson", () => {
  it("should return valid JSON string", async () => {
    const { formatJson } = await import("../../src/core/audit/formatters/json");
    const output = formatJson(mockResult);

    expect(() => JSON.parse(output)).not.toThrow();
  });

  it("should preserve original result structure", async () => {
    const { formatJson } = await import("../../src/core/audit/formatters/json");
    const output = formatJson(mockResult);
    const parsed = JSON.parse(output);

    expect(parsed.serverName).toBe("test-server");
    expect(parsed.serverIp).toBe("1.2.3.4");
    expect(parsed.overallScore).toBe(100);
    expect(parsed.categories).toHaveLength(1);
    expect(parsed.categories[0].name).toBe("SSH");
  });

  it("should be pretty-printed with indentation", async () => {
    const { formatJson } = await import("../../src/core/audit/formatters/json");
    const output = formatJson(mockResult);

    // Pretty-printed JSON has newlines
    expect(output).toContain("\n");
    expect(output.split("\n").length).toBeGreaterThan(1);
  });

  it("should include id and severity on each quickWins entry (P142 contract)", async () => {
    // Build a result with a failing SSH check that calculateQuickWins will pick up
    const resultWithFixable: AuditResult = {
      ...mockResult,
      overallScore: 50,
      categories: [
        {
          name: "SSH",
          checks: [
            {
              id: CHECK_IDS.SSH.SSH_PASSWORD_AUTH,
              category: "SSH",
              name: "Password Authentication",
              severity: "critical",
              passed: false,
              currentValue: "yes",
              expectedValue: "no",
              fixCommand: "sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config",
            },
          ],
          score: 0,
          maxScore: 100,
        },
      ],
      quickWins: calculateQuickWins({
        ...mockResult,
        overallScore: 50,
        categories: [
          {
            name: "SSH",
            checks: [
              {
                id: CHECK_IDS.SSH.SSH_PASSWORD_AUTH,
                category: "SSH",
                name: "Password Authentication",
                severity: "critical",
                passed: false,
                currentValue: "yes",
                expectedValue: "no",
                fixCommand: "sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config",
              },
            ],
            score: 0,
            maxScore: 100,
          },
        ],
      }),
    };
    expect(resultWithFixable.quickWins.length).toBeGreaterThan(0);

    const { formatJson } = await import("../../src/core/audit/formatters/json");
    const output = formatJson(resultWithFixable);
    const parsed = JSON.parse(output) as { quickWins: Array<{ id?: string; severity?: string }> };

    expect(parsed.quickWins[0].id).toBe(CHECK_IDS.SSH.SSH_PASSWORD_AUTH);
    expect(parsed.quickWins[0].severity).toBe("critical");
  });

  it("P142: JSON output preserves the full skip object on skipped checks", async () => {
    const resultWithSkip: AuditResult = {
      ...mockResult,
      categories: [
        {
          name: "Plugin",
          checks: [
            {
              id: "PLUGIN-MUTATE-LOCAL",
              category: "Plugin",
              name: "Mutate Local",
              severity: "info",
              passed: false,
              currentValue: "n/a",
              expectedValue: "n/a",
              skip: { code: "legacy-mutating", apiVersion: "2", kind: "mutate-local" },
            },
          ],
          score: 100,
          maxScore: 100,
        },
      ],
      quickWins: [],
    };

    const { formatJson } = await import("../../src/core/audit/formatters/json");
    const output = formatJson(resultWithSkip);
    const parsed = JSON.parse(output) as {
      categories: Array<{ checks: Array<{ skip?: { code: string; apiVersion: string; kind: string } }> }>;
    };

    expect(parsed.categories[0].checks[0].skip).toBeDefined();
    expect(parsed.categories[0].checks[0].skip?.code).toBe("legacy-mutating");
    expect(parsed.categories[0].checks[0].skip?.apiVersion).toBe("2");
    expect(parsed.categories[0].checks[0].skip?.kind).toBe("mutate-local");
  });
});
