import * as auditCore from "../../src/core/audit/index";
import * as serverSelect from "../../src/utils/serverSelect";
import * as ssh from "../../src/utils/ssh";
import * as formatters from "../../src/core/audit/formatters/index";
import * as auditHistory from "../../src/core/audit/history";
import * as trendFormatters from "../../src/core/audit/formatters/trend";
import * as auditFilter from "../../src/core/audit/filter";
import * as auditFix from "../../src/core/audit/fix";
import * as listChecksModule from "../../src/core/audit/listChecks";
import * as watchModule from "../../src/core/audit/watch";
import * as complianceScoringModule from "../../src/core/audit/compliance/scoring";
import * as complianceFormatterModule from "../../src/core/audit/formatters/compliance";
import * as regressionModule from "../../src/core/audit/regression";

jest.mock("../../src/core/audit/index");
jest.mock("../../src/core/audit/regression");
jest.mock("../../src/utils/serverSelect");
jest.mock("../../src/utils/ssh");
jest.mock("../../src/core/audit/formatters/index");
jest.mock("../../src/core/audit/history");
jest.mock("../../src/core/audit/fix");
jest.mock("../../src/core/audit/watch");
jest.mock("../../src/core/audit/formatters/trend");
jest.mock("../../src/core/audit/filter");
jest.mock("../../src/core/audit/listChecks");
jest.mock("../../src/core/audit/compliance/scoring");
jest.mock("../../src/core/audit/formatters/compliance");

const mockedAuditCore = auditCore as jest.Mocked<typeof auditCore>;
const mockedServerSelect = serverSelect as jest.Mocked<typeof serverSelect>;
const mockedHistory = auditHistory as jest.Mocked<typeof auditHistory>;
const mockedSsh = ssh as jest.Mocked<typeof ssh>;
const mockedFormatters = formatters as jest.Mocked<typeof formatters>;
const mockedTrendFormatters = trendFormatters as jest.Mocked<typeof trendFormatters>;
const mockedFilter = auditFilter as jest.Mocked<typeof auditFilter>;
const mockedFix = auditFix as jest.Mocked<typeof auditFix>;
const mockedListChecks = listChecksModule as jest.Mocked<typeof listChecksModule>;
const mockedWatch = watchModule as jest.Mocked<typeof watchModule>;
const mockedComplianceScoring = complianceScoringModule as jest.Mocked<typeof complianceScoringModule>;
const mockedComplianceFormatter = complianceFormatterModule as jest.Mocked<typeof complianceFormatterModule>;
const mockedRegression = regressionModule as jest.Mocked<typeof regressionModule>;
mockedRegression.formatRegressionSummary;
mockedRegression.extractPassedCheckIds;

// Mock AuditResult for testing
const mockAuditResult = {
  serverName: "test-server",
  serverIp: "1.2.3.4",
  platform: "bare" as const,
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
          severity: "critical" as const,
          passed: true,
          currentValue: "no",
          expectedValue: "no",
          fixCommand: "sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config",
        },
        {
          id: "SSH-ROOT-LOGIN",
          category: "SSH",
          name: "Root Login",
          severity: "critical" as const,
          passed: false,
          currentValue: "yes",
          expectedValue: "prohibit-password",
          fixCommand: "sed -i 's/PermitRootLogin yes/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config",
        },
      ],
      score: 50,
      maxScore: 100,
    },
    {
      name: "Firewall",
      checks: [
        {
          id: "FW-UFW-ACTIVE",
          category: "Firewall",
          name: "UFW Enabled",
          severity: "critical" as const,
          passed: true,
          currentValue: "active",
          expectedValue: "active",
        },
      ],
      score: 100,
      maxScore: 100,
    },
  ],
  overallScore: 72,
  quickWins: [
    {
      commands: ["sed -i 's/PermitRootLogin yes/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config"],
      currentScore: 72,
      projectedScore: 85,
      description: "Disable root password login",
    },
  ],
};

describe("auditCommand", () => {
  let consoleSpy: jest.SpyInstance;
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    exitSpy = jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
    process.exitCode = undefined;
    jest.clearAllMocks();

    mockedServerSelect.resolveServer.mockResolvedValue({
      id: "srv-1",
      name: "test-server",
      provider: "hetzner",
      ip: "1.2.3.4",
      region: "fsn1",
      size: "cx11",
      createdAt: "2026-01-01",
      mode: "bare",
    });

    mockedAuditCore.runAudit.mockResolvedValue({
      success: true,
      data: mockAuditResult,
    });

    // Mock history to return empty/first audit (no trend output)
    mockedHistory.loadAuditHistory.mockReturnValue([]);
    mockedHistory.detectTrend.mockReturnValue("first audit");
    mockedHistory.saveAuditHistory.mockImplementation(() => Promise.resolve());

    // Default formatter mock — returns a simple string representation
    mockedFormatters.selectFormatter.mockResolvedValue(
      (result) => `formatted: ${result.overallScore}/100`,
    );

    // Default filter mocks — pass-through (no filtering)
    mockedFilter.filterAuditResult.mockImplementation((result) => result);
    mockedFilter.buildFilterAnnotation.mockReturnValue("");
    mockedFilter.parseSeverity.mockImplementation((raw) => raw as ReturnType<typeof auditFilter.parseSeverity>);

    // Default fix mocks
    mockedFix.runFix.mockResolvedValue({ applied: [], skipped: [], errors: [] });
    mockedFix.runPostFixReAudit.mockResolvedValue(null);

    // Default regression mocks
    mockedRegression.saveBaselineSafe.mockResolvedValue();
    mockedRegression.loadBaseline.mockReturnValue(null);
    mockedRegression.extractPassedCheckIds.mockReturnValue([]);
    mockedRegression.checkRegression.mockReturnValue({ regressions: [], newPasses: [], baselineScore: 0, currentScore: 0 });
    mockedRegression.formatRegressionSummary.mockReturnValue([{ severity: "info", text: "Best score: 0" }]);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("should call runAudit with resolved server IP and name", async () => {
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand("test-server", {});

    expect(mockedAuditCore.runAudit).toHaveBeenCalledWith("1.2.3.4", "test-server", "bare");
  });

  it("should use --json flag and pass it to selectFormatter", async () => {
    // When json is requested, selectFormatter gets { json: true }
    mockedFormatters.selectFormatter.mockResolvedValue(
      (result) => JSON.stringify(result, null, 2),
    );

    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, { json: true });

    expect(mockedFormatters.selectFormatter).toHaveBeenCalledWith(
      expect.objectContaining({ json: true }),
    );
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it("should use --badge flag and pass it to selectFormatter", async () => {
    mockedFormatters.selectFormatter.mockResolvedValue(
      () => '<svg xmlns="http://www.w3.org/2000/svg">72/100</svg>',
    );

    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, { badge: true });

    expect(mockedFormatters.selectFormatter).toHaveBeenCalledWith(
      expect.objectContaining({ badge: true }),
    );
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("<svg");
    expect(output).toContain("xmlns");
  });

  it("should output score/100 with --score-only", async () => {
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, { scoreOnly: true });

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("72/100");
    // selectFormatter should NOT be called for score-only
    expect(mockedFormatters.selectFormatter).not.toHaveBeenCalled();
  });

  it("should parse --host user@ip and skip resolveServer", async () => {
    mockedSsh.assertValidIp.mockImplementation(() => {});
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, { host: "root@5.6.7.8" });

    expect(mockedServerSelect.resolveServer).not.toHaveBeenCalled();
    expect(mockedAuditCore.runAudit).toHaveBeenCalledWith("5.6.7.8", "5.6.7.8", "bare");
  });

  it("should exit with code 1 if score < threshold", async () => {
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, { threshold: "80" });

    // Score is 72, threshold is 80 -> should set exitCode 1
    expect(process.exitCode).toBe(1);
  });

  it("should not exit with code 1 if score >= threshold", async () => {
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, { threshold: "70" });

    // Score is 72, threshold is 70 -> should NOT set exitCode 1
    expect(process.exitCode).toBeUndefined();
  });

  it("should handle audit failure gracefully", async () => {
    mockedAuditCore.runAudit.mockResolvedValue({
      success: false,
      error: "Audit failed: SSH connection refused",
      hint: "Check SSH config",
    });
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, {});

    // Hint message goes through logger.info -> console.log
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Check SSH config");
    // selectFormatter should not be called on failure
    expect(mockedFormatters.selectFormatter).not.toHaveBeenCalled();
  });

  it("should handle --score-only with --threshold below score", async () => {
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, { scoreOnly: true, threshold: "60" });

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("72/100");
    expect(process.exitCode).toBeUndefined();
  });

  it("should handle --score-only with --threshold above score", async () => {
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, { scoreOnly: true, threshold: "80" });

    expect(process.exitCode).toBe(1);
  });

  it("should parse --host ip (no user@) and skip resolveServer", async () => {
    mockedSsh.assertValidIp.mockImplementation(() => {});
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, { host: "9.8.7.6" });

    expect(mockedServerSelect.resolveServer).not.toHaveBeenCalled();
    expect(mockedAuditCore.runAudit).toHaveBeenCalledWith("9.8.7.6", "9.8.7.6", "bare");
  });

  it("should return early when resolveServer returns undefined", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(undefined);
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand("nonexistent", {});

    expect(mockedAuditCore.runAudit).not.toHaveBeenCalled();
  });

  it("should show methodology-change warning when trend is methodology-change", async () => {
    mockedHistory.detectTrend.mockReturnValue("methodology-change");
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, {});

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("methodology updated");
  });

  it("should show trend info when trend is not first audit or methodology-change", async () => {
    mockedHistory.detectTrend.mockReturnValue("improving");
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, {});

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("Trend: improving");
  });

  it("should handle --score-only with NaN threshold", async () => {
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, { scoreOnly: true, threshold: "abc" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("--threshold must be a number");
  });

  it("should handle NaN threshold in normal mode", async () => {
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, { threshold: "abc" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("--threshold must be a number");
  });

  it("should show invalid severity warning and show all results", async () => {
    mockedFilter.parseSeverity.mockReturnValue(undefined);
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, { severity: "invalid-level" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("Invalid severity");
  });

  it("should display quick wins when present and not json/badge/report", async () => {
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, {});

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("Quick wins");
    expect(output).toContain("85/100");
  });

  it("should NOT display quick wins when --json is set", async () => {
    mockedFormatters.selectFormatter.mockResolvedValue(
      (result) => JSON.stringify({ score: result.overallScore }),
    );
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, { json: true });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).not.toContain("Quick wins");
  });

  it("should show fix errors when present", async () => {
    mockedFix.runFix.mockResolvedValue({
      applied: [],
      skipped: [],
      errors: ["SSH-FAIL: could not apply"],
    });

    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, { fix: true });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("Errors:");
    expect(output).toContain("SSH-FAIL");
  });

  it("should show fix dry-run preview groups with check details", async () => {
    mockedFix.runFix.mockResolvedValue({
      applied: [],
      skipped: [],
      errors: [],
      preview: {
        groups: [
          {
            severity: "critical",
            estimatedImpact: 5,
            checks: [
              { id: "SSH-01", name: "SSH Key Auth", category: "SSH", severity: "critical" as const, fixCommand: "sed -i ..." },
            ],
          },
        ],
      },
    });

    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, { fix: true, dryRun: true });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("critical");
    expect(output).toContain("1 fixable issue(s)");
    expect(output).toContain("SSH-01");
  });

  it("should use platform from server.platform when available", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue({
      id: "srv-1",
      name: "test-server",
      provider: "hetzner",
      ip: "1.2.3.4",
      region: "fsn1",
      size: "cx11",
      createdAt: "2026-01-01",
      mode: "coolify",
      platform: "coolify",
    });
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand("test-server", {});

    expect(mockedAuditCore.runAudit).toHaveBeenCalledWith("1.2.3.4", "test-server", "coolify");
  });

  it("should handle audit failure without hint", async () => {
    mockedAuditCore.runAudit.mockResolvedValue({
      success: false,
      error: "Connection refused",
    });
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, {});

    expect(mockedFormatters.selectFormatter).not.toHaveBeenCalled();
  });

  it("should pass --category and --severity to filterAuditResult after saveAuditHistory", async () => {
    const callOrder: string[] = [];
    mockedHistory.saveAuditHistory.mockImplementation(() => {
      callOrder.push("saveAuditHistory");
      return Promise.resolve();
    });
    mockedFilter.filterAuditResult.mockImplementation((result) => {
      callOrder.push("filterAuditResult");
      return result;
    });

    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, { category: "ssh", severity: "critical" });

    expect(mockedFilter.filterAuditResult).toHaveBeenCalledWith(
      mockAuditResult,
      { category: "ssh", severity: "critical" },
    );
    expect(callOrder.indexOf("saveAuditHistory")).toBeLessThan(
      callOrder.indexOf("filterAuditResult"),
    );
  });

  it("should display filter annotation when --category is provided", async () => {
    mockedFilter.buildFilterAnnotation.mockReturnValue(" (showing category: ssh)");

    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, { category: "ssh" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("(showing category: ssh)");
  });

  it("should pass unfiltered auditResult to saveAuditHistory when --category is active", async () => {
    const filteredResult = {
      ...mockAuditResult,
      categories: [mockAuditResult.categories[0]],
    };
    mockedFilter.filterAuditResult.mockReturnValue(filteredResult);

    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, { category: "ssh" });

    // saveAuditHistory must receive the full unfiltered result
    expect(mockedHistory.saveAuditHistory).toHaveBeenCalledWith(mockAuditResult);
    // formatter receives the filtered result
    expect(mockedFormatters.selectFormatter).toHaveBeenCalled();
  });

  it("shows score delta after successful fix", async () => {
    const loggerSpy = jest.spyOn(console, "log");
    mockedFix.runFix.mockResolvedValue({
      applied: ["SSH-ROOT-LOGIN"],
      skipped: [],
      errors: [],
    });
    mockedFix.runPostFixReAudit.mockResolvedValue({...mockAuditResult, overallScore: 85});

    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, { fix: true });

    const output = loggerSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("\u2192 85");
  });

  it("does not call runPostFixReAudit on dry-run", async () => {
    mockedFix.runFix.mockResolvedValue({
      applied: [],
      skipped: [],
      errors: [],
      preview: { groups: [] },
    });

    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, { fix: true, dryRun: true });

    expect(mockedFix.runPostFixReAudit).not.toHaveBeenCalled();
  });

  it("does not call runPostFixReAudit when zero fixes applied", async () => {
    mockedFix.runFix.mockResolvedValue({
      applied: [],
      skipped: ["SSH-ROOT-LOGIN"],
      errors: [],
    });

    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, { fix: true });

    expect(mockedFix.runPostFixReAudit).not.toHaveBeenCalled();
  });

  it("handles runPostFixReAudit returning null gracefully", async () => {
    mockedFix.runFix.mockResolvedValue({
      applied: ["SSH-ROOT-LOGIN"],
      skipped: [],
      errors: [],
    });
    mockedFix.runPostFixReAudit.mockResolvedValue(null);

    const { auditCommand } = await import("../../src/commands/audit");
    // Should not throw
    await expect(auditCommand(undefined, { fix: true })).resolves.not.toThrow();
  });

  it("should call saveBaseline after successful audit", async () => {
    mockedRegression.saveBaselineSafe.mockResolvedValue();
    mockedRegression.loadBaseline.mockReturnValue(null);

    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand("test-server", {});

    expect(mockedRegression.saveBaselineSafe).toHaveBeenCalledWith(mockAuditResult, null, []);
  });

  it("should call checkRegression when baseline exists and display regressions", async () => {
    const loggerSpy = jest.spyOn(console, "log").mockImplementation();
    mockedRegression.saveBaselineSafe.mockResolvedValue();
    mockedRegression.loadBaseline.mockReturnValue({
      version: 1,
      serverIp: "1.2.3.4",
      lastUpdated: "2026-04-20T10:00:00Z",
      bestScore: 80,
      passedChecks: ["FW-UFW-ACTIVE", "SSH-PASSWORD-AUTH"],
    });
    mockedRegression.checkRegression.mockReturnValue({
      regressions: ["SSH-ROOT-LOGIN"],
      newPasses: [],
      baselineScore: 80,
      currentScore: 72,
    });
    mockedRegression.formatRegressionSummary.mockReturnValue([
      { severity: "warn", text: "Regression: 1 check(s) regressed: SSH-ROOT-LOGIN" },
      { severity: "info", text: "Best score: 80" },
    ]);

    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand("test-server", {});

    expect(mockedRegression.checkRegression).toHaveBeenCalled();
    const output = loggerSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("Regression");
    loggerSpy.mockRestore();
  });

  it("should call checkRegression when baseline exists and display new passes", async () => {
    const loggerSpy = jest.spyOn(console, "log").mockImplementation();
    mockedRegression.saveBaselineSafe.mockResolvedValue();
    mockedRegression.loadBaseline.mockReturnValue({
      version: 1,
      serverIp: "1.2.3.4",
      lastUpdated: "2026-04-20T10:00:00Z",
      bestScore: 70,
      passedChecks: ["SSH-PASSWORD-AUTH"],
    });
    mockedRegression.checkRegression.mockReturnValue({
      regressions: [],
      newPasses: ["FW-UFW-ACTIVE"],
      baselineScore: 70,
      currentScore: 72,
    });
    mockedRegression.formatRegressionSummary.mockReturnValue([
      { severity: "info", text: "New passes: 1 check(s) now passing: FW-UFW-ACTIVE" },
      { severity: "info", text: "Best score: 70" },
    ]);

    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand("test-server", {});

    expect(mockedRegression.checkRegression).toHaveBeenCalled();
    const output = loggerSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("New passes");
    loggerSpy.mockRestore();
  });
});

describe("auditCommand --trend", () => {
  let consoleSpy: jest.SpyInstance;

  const mockHistory = [
    {
      serverIp: "1.2.3.4",
      serverName: "test-server",
      timestamp: "2026-03-10T00:00:00.000Z",
      overallScore: 65,
      categoryScores: { SSH: 60, Firewall: 70 },
    },
    {
      serverIp: "1.2.3.4",
      serverName: "test-server",
      timestamp: "2026-03-13T00:00:00.000Z",
      overallScore: 80,
      categoryScores: { SSH: 80, Firewall: 80 },
    },
  ];

  const mockTrendResult = {
    serverIp: "1.2.3.4",
    serverName: "test-server",
    entries: [
      { timestamp: "2026-03-10T00:00:00.000Z", score: 65, delta: null, causeList: [] },
      {
        timestamp: "2026-03-13T00:00:00.000Z",
        score: 80,
        delta: 15,
        causeList: [{ category: "SSH", scoreBefore: 60, scoreAfter: 80, delta: 20 }],
      },
    ],
  };

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.resetAllMocks();

    mockedServerSelect.resolveServer.mockResolvedValue({
      id: "srv-1",
      name: "test-server",
      provider: "hetzner",
      ip: "1.2.3.4",
      region: "fsn1",
      size: "cx11",
      createdAt: "2026-01-01",
      mode: "bare",
    });

    mockedHistory.loadAuditHistory.mockReturnValue(mockHistory);
    mockedHistory.computeTrend.mockReturnValue(mockTrendResult);
    mockedTrendFormatters.formatTrendTerminal.mockReturnValue("trend-terminal-output");
    mockedTrendFormatters.formatTrendJson.mockReturnValue('{"serverIp":"1.2.3.4"}');
    mockedRegression.saveBaselineSafe.mockResolvedValue();
    mockedRegression.loadBaseline.mockReturnValue(null);
    mockedRegression.checkRegression.mockReturnValue({ regressions: [], newPasses: [], baselineScore: 0, currentScore: 0 });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("should call computeTrend with loadAuditHistory result and NOT call runAudit", async () => {
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand("test-server", { trend: true });

    expect(mockedHistory.loadAuditHistory).toHaveBeenCalledWith("1.2.3.4");
    expect(mockedHistory.computeTrend).toHaveBeenCalledWith(mockHistory, { days: undefined });
    expect(mockedAuditCore.runAudit).not.toHaveBeenCalled();
  });

  it("should call formatTrendTerminal and print result when --trend without --json", async () => {
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand("test-server", { trend: true });

    expect(mockedTrendFormatters.formatTrendTerminal).toHaveBeenCalledWith(mockTrendResult);
    expect(mockedTrendFormatters.formatTrendJson).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith("trend-terminal-output");
  });

  it("should call formatTrendJson when --trend --json", async () => {
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand("test-server", { trend: true, json: true });

    expect(mockedTrendFormatters.formatTrendJson).toHaveBeenCalledWith(mockTrendResult);
    expect(mockedTrendFormatters.formatTrendTerminal).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith('{"serverIp":"1.2.3.4"}');
  });

  it("should pass days:7 to computeTrend when --trend --days 7", async () => {
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand("test-server", { trend: true, days: "7" });

    expect(mockedHistory.computeTrend).toHaveBeenCalledWith(mockHistory, { days: 7 });
  });

  it("should pass days:undefined to computeTrend when --trend --days NaN", async () => {
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand("test-server", { trend: true, days: "abc" });

    expect(mockedHistory.computeTrend).toHaveBeenCalledWith(mockHistory, { days: undefined });
  });

  it("should return early without running SSH audit when --trend is set", async () => {
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand("test-server", { trend: true });

    // runAudit involves SSH — must not be called
    expect(mockedAuditCore.runAudit).not.toHaveBeenCalled();
    // selectFormatter should not be called either
    expect(mockedFormatters.selectFormatter).not.toHaveBeenCalled();
  });
});

describe("auditCommand --list-checks", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
    mockedListChecks.listAllChecks.mockReturnValue([]);
    mockedListChecks.formatListChecksTerminal.mockReturnValue("terminal-checks");
    mockedListChecks.formatListChecksJson.mockReturnValue('{"checks":[]}');
    mockedRegression.saveBaselineSafe.mockResolvedValue();
    mockedRegression.loadBaseline.mockReturnValue(null);
    mockedRegression.checkRegression.mockReturnValue({ regressions: [], newPasses: [], baselineScore: 0, currentScore: 0 });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("should call listAllChecks and format as terminal by default", async () => {
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, { listChecks: true });

    expect(mockedListChecks.listAllChecks).toHaveBeenCalledWith({});
    expect(mockedListChecks.formatListChecksTerminal).toHaveBeenCalled();
    expect(mockedAuditCore.runAudit).not.toHaveBeenCalled();
  });

  it("should call formatListChecksJson when --json is set", async () => {
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, { listChecks: true, json: true });

    expect(mockedListChecks.formatListChecksJson).toHaveBeenCalled();
    expect(mockedListChecks.formatListChecksTerminal).not.toHaveBeenCalled();
  });

  it("should pass category filter to listAllChecks", async () => {
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, { listChecks: true, category: "ssh" });

    expect(mockedListChecks.listAllChecks).toHaveBeenCalledWith({ category: "ssh" });
  });

  it("should pass parsed severity filter to listAllChecks", async () => {
    mockedFilter.parseSeverity.mockReturnValue("critical");
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, { listChecks: true, severity: "critical" });

    expect(mockedListChecks.listAllChecks).toHaveBeenCalledWith({ severity: "critical" });
  });

  it("should not pass severity when parseSeverity returns undefined", async () => {
    mockedFilter.parseSeverity.mockReturnValue(undefined);
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, { listChecks: true, severity: "bogus" });

    expect(mockedListChecks.listAllChecks).toHaveBeenCalledWith({});
  });
});

describe("auditCommand --watch", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();

    mockedServerSelect.resolveServer.mockResolvedValue({
      id: "srv-1",
      name: "test-server",
      provider: "hetzner",
      ip: "1.2.3.4",
      region: "fsn1",
      size: "cx11",
      createdAt: "2026-01-01",
      mode: "bare",
    });
    mockedFormatters.selectFormatter.mockResolvedValue(
      (result) => `formatted: ${result.overallScore}/100`,
    );
    mockedWatch.watchAudit.mockResolvedValue(undefined);
    mockedRegression.saveBaselineSafe.mockResolvedValue();
    mockedRegression.loadBaseline.mockReturnValue(null);
    mockedRegression.checkRegression.mockReturnValue({ regressions: [], newPasses: [], baselineScore: 0, currentScore: 0 });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("should call watchAudit with default interval when --watch has no value", async () => {
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand("test-server", { watch: "" });

    expect(mockedWatch.watchAudit).toHaveBeenCalledWith(
      "1.2.3.4",
      "test-server",
      "bare",
      expect.objectContaining({ interval: undefined }),
    );
    expect(mockedAuditCore.runAudit).not.toHaveBeenCalled();
  });

  it("should call watchAudit with parsed interval when --watch has value", async () => {
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand("test-server", { watch: "60" });

    expect(mockedWatch.watchAudit).toHaveBeenCalledWith(
      "1.2.3.4",
      "test-server",
      "bare",
      expect.objectContaining({ interval: 60 }),
    );
  });

  it("should show error when --watch interval is invalid (NaN)", async () => {
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand("test-server", { watch: "abc" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("positive number");
    expect(mockedWatch.watchAudit).not.toHaveBeenCalled();
  });

  it("should show error when --watch interval is zero", async () => {
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand("test-server", { watch: "0" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("positive number");
    expect(mockedWatch.watchAudit).not.toHaveBeenCalled();
  });
});

describe("auditCommand --compliance", () => {
  let consoleSpy: jest.SpyInstance;

  const mockSpinner = {
    start: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
    stop: jest.fn().mockReturnThis(),
    warn: jest.fn().mockReturnThis(),
  };

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();

    // Re-mock createSpinner after clearAllMocks
    jest.spyOn(require("../../src/utils/logger"), "createSpinner").mockReturnValue(mockSpinner);

    mockedServerSelect.resolveServer.mockResolvedValue({
      id: "srv-1",
      name: "test-server",
      provider: "hetzner",
      ip: "1.2.3.4",
      region: "fsn1",
      size: "cx11",
      createdAt: "2026-01-01",
      mode: "bare",
    });
    mockedRegression.saveBaselineSafe.mockResolvedValue();
    mockedRegression.loadBaseline.mockReturnValue(null);
    mockedRegression.checkRegression.mockReturnValue({ regressions: [], newPasses: [], baselineScore: 0, currentScore: 0 });

    mockedAuditCore.runAudit.mockResolvedValue({
      success: true,
      data: {
        serverName: "test-server",
        serverIp: "1.2.3.4",
        platform: "bare" as const,
        timestamp: "2026-03-08T00:00:00.000Z",
        auditVersion: "1.0.0",
        categories: [],
        overallScore: 72,
        quickWins: [],
      },
    });

    mockedHistory.loadAuditHistory.mockReturnValue([]);
    mockedHistory.detectTrend.mockReturnValue("first audit");
    mockedHistory.saveAuditHistory.mockResolvedValue(undefined);
    mockedFilter.filterAuditResult.mockImplementation((result) => result);
    mockedFilter.buildFilterAnnotation.mockReturnValue("");
    mockedFilter.parseSeverity.mockImplementation((raw) => raw as ReturnType<typeof auditFilter.parseSeverity>);
    mockedComplianceScoring.calculateComplianceDetail.mockReturnValue([]);
    mockedComplianceFormatter.formatComplianceReport.mockReturnValue("compliance-report-output");
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("should show error for invalid compliance framework", async () => {
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand("test-server", { compliance: "invalid-framework" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("Invalid framework");
  });

  it("should display compliance report as terminal output", async () => {
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand("test-server", { compliance: "pci-dss" });

    expect(mockedComplianceFormatter.formatComplianceReport).toHaveBeenCalled();
    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("compliance-report-output");
  });

  it("should output compliance JSON when --json is set", async () => {
    mockedComplianceScoring.calculateComplianceDetail.mockReturnValue([
      { framework: "PCI-DSS", totalControls: 10, passedControls: 8, passRate: 80, controls: [] },
    ] as never);

    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand("test-server", { compliance: "pci-dss", json: true });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("overallScore");
    expect(output).toContain("compliance");
  });
});

describe("auditCommand --profile", () => {
  let consoleSpy: jest.SpyInstance;

  const mockSpinner = {
    start: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
    stop: jest.fn().mockReturnThis(),
    warn: jest.fn().mockReturnThis(),
  };

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();

    // Re-mock createSpinner after clearAllMocks
    jest.spyOn(require("../../src/utils/logger"), "createSpinner").mockReturnValue(mockSpinner);

    mockedServerSelect.resolveServer.mockResolvedValue({
      id: "srv-1",
      name: "test-server",
      provider: "hetzner",
      ip: "1.2.3.4",
      region: "fsn1",
      size: "cx11",
      createdAt: "2026-01-01",
      mode: "bare",
    });
    mockedRegression.saveBaselineSafe.mockResolvedValue();
    mockedRegression.loadBaseline.mockReturnValue(null);
    mockedRegression.checkRegression.mockReturnValue({ regressions: [], newPasses: [], baselineScore: 0, currentScore: 0 });

    mockedAuditCore.runAudit.mockResolvedValue({
      success: true,
      data: {
        serverName: "test-server",
        serverIp: "1.2.3.4",
        platform: "bare" as const,
        timestamp: "2026-03-08T00:00:00.000Z",
        auditVersion: "1.0.0",
        categories: [],
        overallScore: 72,
        quickWins: [],
      },
    });

    mockedHistory.loadAuditHistory.mockReturnValue([]);
    mockedHistory.detectTrend.mockReturnValue("first audit");
    mockedHistory.saveAuditHistory.mockResolvedValue(undefined);
    mockedFilter.filterAuditResult.mockImplementation((result) => result);
    mockedFilter.buildFilterAnnotation.mockReturnValue("");
    mockedFilter.parseSeverity.mockImplementation((raw) => raw as ReturnType<typeof auditFilter.parseSeverity>);
    mockedComplianceScoring.filterByProfile.mockImplementation((result) => ({ ...result, complianceDetail: [] }));
    mockedComplianceScoring.calculateComplianceDetail.mockReturnValue([]);
    mockedFormatters.selectFormatter.mockResolvedValue(
      (result) => `formatted: ${result.overallScore}/100`,
    );
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("should show error for invalid profile name", async () => {
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand("test-server", { profile: "invalid-profile" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("Invalid profile");
  });

  it("should filter by profile and format output", async () => {
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand("test-server", { profile: "pci-dss" });

    expect(mockedComplianceScoring.filterByProfile).toHaveBeenCalled();
    expect(mockedFormatters.selectFormatter).toHaveBeenCalled();
  });

  it("should show profile score when compliance detail is available", async () => {
    mockedComplianceScoring.calculateComplianceDetail.mockReturnValue([
      { framework: "PCI-DSS", totalControls: 10, passedControls: 8, passRate: 80, controls: [] },
    ] as never);

    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand("test-server", { profile: "pci-dss" });

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("8/10 controls");
    expect(output).toContain("80%");
  });
});
