import * as auditCore from "../../src/core/audit/index";
import * as serverSelect from "../../src/utils/serverSelect";
import * as ssh from "../../src/utils/ssh";
import * as formatters from "../../src/core/audit/formatters/index";
import * as auditHistory from "../../src/core/audit/history";
import * as trendFormatters from "../../src/core/audit/formatters/trend";
import * as auditFilter from "../../src/core/audit/filter";
import * as auditFix from "../../src/core/audit/fix";

jest.mock("../../src/core/audit/index");
jest.mock("../../src/utils/serverSelect");
jest.mock("../../src/utils/ssh");
jest.mock("../../src/core/audit/formatters/index");
jest.mock("../../src/core/audit/history");
jest.mock("../../src/core/audit/fix");
jest.mock("../../src/core/audit/watch");
jest.mock("../../src/core/audit/formatters/trend");
jest.mock("../../src/core/audit/filter");

const mockedAuditCore = auditCore as jest.Mocked<typeof auditCore>;
const mockedServerSelect = serverSelect as jest.Mocked<typeof serverSelect>;
const mockedHistory = auditHistory as jest.Mocked<typeof auditHistory>;
const mockedSsh = ssh as jest.Mocked<typeof ssh>;
const mockedFormatters = formatters as jest.Mocked<typeof formatters>;
const mockedTrendFormatters = trendFormatters as jest.Mocked<typeof trendFormatters>;
const mockedFilter = auditFilter as jest.Mocked<typeof auditFilter>;
const mockedFix = auditFix as jest.Mocked<typeof auditFix>;

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
    mockedFix.runScoreCheck.mockResolvedValue(null);
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
    mockedFix.runScoreCheck.mockResolvedValue(85);

    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, { fix: true });

    const output = loggerSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("\u2192 85");
  });

  it("does not call runScoreCheck on dry-run", async () => {
    mockedFix.runFix.mockResolvedValue({
      applied: [],
      skipped: [],
      errors: [],
      preview: { groups: [] },
    });

    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, { fix: true, dryRun: true });

    expect(mockedFix.runScoreCheck).not.toHaveBeenCalled();
  });

  it("does not call runScoreCheck when zero fixes applied", async () => {
    mockedFix.runFix.mockResolvedValue({
      applied: [],
      skipped: ["SSH-ROOT-LOGIN"],
      errors: [],
    });

    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand(undefined, { fix: true });

    expect(mockedFix.runScoreCheck).not.toHaveBeenCalled();
  });

  it("handles runScoreCheck returning null gracefully", async () => {
    mockedFix.runFix.mockResolvedValue({
      applied: ["SSH-ROOT-LOGIN"],
      skipped: [],
      errors: [],
    });
    mockedFix.runScoreCheck.mockResolvedValue(null);

    const { auditCommand } = await import("../../src/commands/audit");
    // Should not throw
    await expect(auditCommand(undefined, { fix: true })).resolves.not.toThrow();
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

  it("should return early without running SSH audit when --trend is set", async () => {
    const { auditCommand } = await import("../../src/commands/audit");
    await auditCommand("test-server", { trend: true });

    // runAudit involves SSH — must not be called
    expect(mockedAuditCore.runAudit).not.toHaveBeenCalled();
    // selectFormatter should not be called either
    expect(mockedFormatters.selectFormatter).not.toHaveBeenCalled();
  });
});
