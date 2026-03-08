import type { AuditResult } from "../../src/core/audit/types";

function makeResult(score: number): AuditResult {
  return {
    serverName: "test-server",
    serverIp: "1.2.3.4",
    platform: "bare",
    timestamp: "2026-03-08T00:00:00.000Z",
    categories: [],
    overallScore: score,
    quickWins: [],
  };
}

describe("formatBadge", () => {
  it("should return valid SVG string with xmlns", async () => {
    const { formatBadge } = await import("../../src/core/audit/formatters/badge");
    const output = formatBadge(makeResult(72));

    expect(output).toContain("<svg");
    expect(output).toContain("xmlns");
    expect(output).toContain("</svg>");
  });

  it("should contain score text", async () => {
    const { formatBadge } = await import("../../src/core/audit/formatters/badge");
    const output = formatBadge(makeResult(72));

    expect(output).toContain("72/100");
  });

  it("should produce green badge for score >= 80", async () => {
    const { formatBadge } = await import("../../src/core/audit/formatters/badge");
    const output = formatBadge(makeResult(85));

    expect(output).toContain("#4c1");
  });

  it("should produce yellow badge for score >= 60 and < 80", async () => {
    const { formatBadge } = await import("../../src/core/audit/formatters/badge");
    const output = formatBadge(makeResult(72));

    expect(output).toContain("#dfb317");
  });

  it("should produce red badge for score < 60", async () => {
    const { formatBadge } = await import("../../src/core/audit/formatters/badge");
    const output = formatBadge(makeResult(45));

    expect(output).toContain("#e05d44");
  });

  it("should contain security label", async () => {
    const { formatBadge } = await import("../../src/core/audit/formatters/badge");
    const output = formatBadge(makeResult(72));

    expect(output).toContain("security");
  });
});
