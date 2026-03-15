import type { AuditResult } from "../../src/core/audit/types";

const mockResult: AuditResult = {
  serverName: "test-server",
  serverIp: "1.2.3.4",
  platform: "bare",
  timestamp: "2026-03-08T00:00:00.000Z",
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
});
