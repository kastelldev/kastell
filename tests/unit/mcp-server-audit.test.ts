import * as config from "../../src/utils/config";
import * as auditRunner from "../../src/core/audit/index";
import * as regressionRunner from "../../src/core/audit/regression";
import { handleServerAudit } from "../../src/mcp/tools/serverAudit";
import type { AuditResult } from "../../src/core/audit/types";

jest.mock("../../src/utils/config");
jest.mock("../../src/core/audit/index");
jest.mock("../../src/core/audit/regression");

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedAuditRunner = auditRunner as jest.Mocked<typeof auditRunner>;
const mockedRegression = regressionRunner as jest.Mocked<typeof regressionRunner>;

const sampleServer = {
  id: "123",
  name: "coolify-test",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-02-20T00:00:00Z",
};

const sampleAuditResult: AuditResult = {
  serverName: "coolify-test",
  serverIp: "1.2.3.4",
  platform: "bare",
  timestamp: "2026-03-08T00:00:00Z",
  auditVersion: "1.0.0",
  categories: [
    {
      name: "SSH",
      checks: [
        {
          id: "SSH-PASSWORD-AUTH",
          category: "SSH",
          name: "Password Authentication",
          severity: "critical",
          passed: true,
          currentValue: "no",
          expectedValue: "no",
        },
      ],
      score: 100,
      maxScore: 100,
    },
    {
      name: "Firewall",
      checks: [
        {
          id: "FW-UFW-ACTIVE",
          category: "Firewall",
          name: "UFW Active",
          severity: "critical",
          passed: false,
          currentValue: "inactive",
          expectedValue: "active",
          fixCommand: "ufw --force enable",
          explain: "An active firewall is the first line of defense against unauthorized network access.",
        },
      ],
      score: 0,
      maxScore: 100,
    },
  ],
  overallScore: 72,
  quickWins: [
    {
      commands: ["ufw --force enable"],
      currentScore: 72,
      projectedScore: 85,
      description: "Fix UFW Active (Firewall)",
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedRegression.saveBaselineSafe.mockResolvedValue();
  mockedRegression.loadBaseline.mockReturnValue(null);
  mockedRegression.checkRegression.mockReturnValue({ regressions: [], newPasses: [], baselineScore: 0, currentScore: 0 });
  mockedRegression.formatRegressionSummary.mockReturnValue([{ severity: "info", text: "Best score: 0" }]);
  mockedRegression.extractPassedCheckIds.mockReturnValue([]);
});

describe("MCP server_audit tool", () => {
  it("should call runAudit with resolved server IP", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedConfig.findServer.mockReturnValue(sampleServer as never);
    mockedAuditRunner.runAudit.mockResolvedValue({
      success: true,
      data: sampleAuditResult,
    });

    const result = await handleServerAudit({ server: "coolify-test", format: "summary" });

    expect(mockedAuditRunner.runAudit).toHaveBeenCalledWith(
      "1.2.3.4",
      "coolify-test",
      expect.any(String),
    );
    expect(result.isError).toBeUndefined();
  });

  it("should return mcpSuccess with formatted audit summary (not full HTML)", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedConfig.findServer.mockReturnValue(sampleServer as never);
    mockedAuditRunner.runAudit.mockResolvedValue({
      success: true,
      data: sampleAuditResult,
    });

    const result = await handleServerAudit({ server: "coolify-test", format: "summary" });

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    const text = result.content[0].text;
    // Summary should contain score and category info, not HTML tags
    expect(text).not.toContain("<html");
    expect(text).toContain("72");
    expect(text).toContain("SSH");
  });

  it("should return mcpError for invalid server", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedConfig.findServer.mockReturnValue(undefined as never);

    const result = await handleServerAudit({ server: "nonexistent", format: "summary" });

    expect(result.isError).toBe(true);
  });

  it("should accept optional server and format parameters", async () => {
    // When only one server exists and no server param, auto-resolve
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedAuditRunner.runAudit.mockResolvedValue({
      success: true,
      data: sampleAuditResult,
    });

    const result = await handleServerAudit({ format: "summary" });
    expect(result.isError).toBeUndefined();
  });

  it('should return full AuditResult as JSON for format "json"', async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedConfig.findServer.mockReturnValue(sampleServer as never);
    mockedAuditRunner.runAudit.mockResolvedValue({
      success: true,
      data: sampleAuditResult,
    });

    const result = await handleServerAudit({ server: "coolify-test", format: "json" });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.overallScore).toBe(72);
    expect(parsed.categories).toHaveLength(2);
    expect(parsed.serverName).toBe("coolify-test");
  });

  it('should return just the score number for format "score"', async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedConfig.findServer.mockReturnValue(sampleServer as never);
    mockedAuditRunner.runAudit.mockResolvedValue({
      success: true,
      data: sampleAuditResult,
    });

    const result = await handleServerAudit({ server: "coolify-test", format: "score" });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.score).toBe(72);
  });

  it("should return mcpError when runAudit fails", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedConfig.findServer.mockReturnValue(sampleServer as never);
    mockedAuditRunner.runAudit.mockResolvedValue({
      success: false,
      error: "SSH connection failed",
      hint: "Check SSH keys",
    });

    const result = await handleServerAudit({ server: "coolify-test", format: "summary" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("SSH connection failed");
  });
});

describe("explain param", () => {
  beforeEach(() => {
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedConfig.findServer.mockReturnValue(sampleServer as never);
    mockedAuditRunner.runAudit.mockResolvedValue({
      success: true,
      data: sampleAuditResult,
    });
  });

  it("should include 'Failing Checks (with explanations):' when explain: true and format is summary", async () => {
    const result = await handleServerAudit({ server: "coolify-test", format: "summary", explain: true });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.summary).toContain("Failing Checks (with explanations):");
  });

  it("should include 'Why:' line with check explain text for a failing check", async () => {
    const result = await handleServerAudit({ server: "coolify-test", format: "summary", explain: true });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.summary).toContain("Why: An active firewall is the first line of defense against unauthorized network access.");
  });

  it("should NOT include 'Failing Checks (with explanations):' when explain param is not set", async () => {
    const result = await handleServerAudit({ server: "coolify-test", format: "summary" });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.summary).not.toContain("Failing Checks (with explanations):");
  });

  it("should return full JSON without extra processing when format is json and explain: true", async () => {
    const result = await handleServerAudit({ server: "coolify-test", format: "json", explain: true });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.overallScore).toBe(72);
    expect(parsed.categories).toHaveLength(2);
  });

  it("should cap output at 10 failing checks with '... and N more' for remainder", async () => {
    const manyFailingChecks = Array.from({ length: 12 }, (_, i) => ({
      id: `CHECK-${i + 1}`,
      category: "Test",
      name: `Test Check ${i + 1}`,
      severity: "warning" as const,
      passed: false,
      currentValue: "bad",
      expectedValue: "good",
      explain: `Explanation for check ${i + 1}`,
    }));

    const auditResultWith12Failures: AuditResult = {
      ...sampleAuditResult,
      categories: [
        {
          name: "Test",
          checks: manyFailingChecks,
          score: 0,
          maxScore: 100,
        },
      ],
    };

    mockedAuditRunner.runAudit.mockResolvedValue({
      success: true,
      data: auditResultWith12Failures,
    });

    const result = await handleServerAudit({ server: "coolify-test", format: "summary", explain: true });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.summary).toContain("... and 2 more failing checks");
  });
});

describe("malformed params", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedConfig.findServer.mockReturnValue(undefined as never);
  });

  it("returns mcpError when server param is empty string", async () => {
    const result = await handleServerAudit({ server: "" });
    expect(result.isError).toBe(true);
  });

  it("returns mcpError when server param is null", async () => {
    const result = await handleServerAudit({ server: null as unknown as string });
    expect(result.isError).toBe(true);
  });

  it("returns mcpError for unmatched server string", async () => {
    const result = await handleServerAudit({ server: "999.999.999.999" });
    expect(result.isError).toBe(true);
  });
});

describe("regression baseline", () => {
  beforeEach(() => {
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedConfig.findServer.mockReturnValue(sampleServer as never);
    mockedAuditRunner.runAudit.mockResolvedValue({
      success: true,
      data: sampleAuditResult,
    });
  });

  it("should call saveBaseline after successful audit", async () => {
    const result = await handleServerAudit({ server: "coolify-test" });
    expect(mockedRegression.saveBaselineSafe).toHaveBeenCalledWith(sampleAuditResult, null, []);
  });

  it("should include baselineRegression in summary when baseline exists", async () => {
    mockedRegression.loadBaseline.mockReturnValue({
      version: 1,
      serverIp: "1.2.3.4",
      lastUpdated: "2026-04-20T10:00:00Z",
      bestScore: 80,
      passedChecks: ["SSH-PASSWORD-AUTH"],
    });
    mockedRegression.checkRegression.mockReturnValue({
      regressions: ["FW-UFW-ACTIVE"],
      newPasses: [],
      baselineScore: 80,
      currentScore: 72,
    });

    const result = await handleServerAudit({ server: "coolify-test", format: "summary" });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.summary).toContain("Regression");
    expect(parsed.summary).toContain("FW-UFW-ACTIVE");
  });

  it("should include baselineRegression in json response when baseline exists", async () => {
    mockedRegression.loadBaseline.mockReturnValue({
      version: 1,
      serverIp: "1.2.3.4",
      lastUpdated: "2026-04-20T10:00:00Z",
      bestScore: 80,
      passedChecks: ["SSH-PASSWORD-AUTH"],
    });
    mockedRegression.checkRegression.mockReturnValue({
      regressions: [],
      newPasses: ["FW-UFW-ACTIVE"],
      baselineScore: 70,
      currentScore: 72,
    });

    const result = await handleServerAudit({ server: "coolify-test", format: "json" });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.baselineRegression).toBeDefined();
    expect((parsed.baselineRegression as any).regressions).toEqual([]);
    expect((parsed.baselineRegression as any).newPasses).toEqual(["FW-UFW-ACTIVE"]);
  });
});
