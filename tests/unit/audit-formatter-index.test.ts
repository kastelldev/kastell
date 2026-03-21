import type { AuditResult } from "../../src/core/audit/types";

const baseResult: AuditResult = {
  serverName: "test-server",
  serverIp: "203.0.113.1",
  platform: "bare",
  timestamp: "2026-01-01T00:00:00.000Z",
  auditVersion: "1.0.0",
  categories: [
    {
      name: "SSH",
      checks: [
        {
          id: "SSH-01",
          category: "SSH",
          name: "Test Check",
          severity: "critical",
          passed: true,
          currentValue: "yes",
          expectedValue: "yes",
        },
      ],
      score: 100,
      maxScore: 100,
    },
  ],
  overallScore: 100,
  quickWins: [],
};

describe("selectFormatter", () => {
  it("json branch: returns formatter that produces valid JSON", async () => {
    const { selectFormatter } = await import("../../src/core/audit/formatters/index");
    const formatter = await selectFormatter({ json: true });
    const output = formatter(baseResult);
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it("badge branch: returns formatter that produces badge-like SVG string", async () => {
    const { selectFormatter } = await import("../../src/core/audit/formatters/index");
    const formatter = await selectFormatter({ badge: true });
    const output = formatter(baseResult);
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
  });

  it("html branch: returns formatter that produces HTML string", async () => {
    const { selectFormatter } = await import("../../src/core/audit/formatters/index");
    const formatter = await selectFormatter({ report: "html" });
    const output = formatter(baseResult);
    expect(output).toContain("<");
  });

  it("md branch: returns formatter that produces markdown string", async () => {
    const { selectFormatter } = await import("../../src/core/audit/formatters/index");
    const formatter = await selectFormatter({ report: "md" });
    const output = formatter(baseResult);
    expect(output).toContain("#");
  });

  it("summary branch: returns formatter that produces summary with server name", async () => {
    const { selectFormatter } = await import("../../src/core/audit/formatters/index");
    const formatter = await selectFormatter({ summary: true });
    const output = formatter(baseResult);
    expect(output).toContain("test-server");
  });

  it("default branch (no options): returns terminal formatter with server name", async () => {
    const { selectFormatter } = await import("../../src/core/audit/formatters/index");
    const formatter = await selectFormatter({});
    const output = formatter(baseResult);
    expect(output).toContain("test-server");
  });

  it("json takes precedence over badge when both are set", async () => {
    const { selectFormatter } = await import("../../src/core/audit/formatters/index");
    const formatter = await selectFormatter({ json: true, badge: true });
    const output = formatter(baseResult);
    // json branch hits first — output must be valid JSON
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it("unknown report value falls through to default terminal formatter", async () => {
    const { selectFormatter } = await import("../../src/core/audit/formatters/index");
    const formatter = await selectFormatter({ report: "unknown" });
    const output = formatter(baseResult);
    // Default terminal formatter includes server name
    expect(output).toContain("test-server");
  });
});
