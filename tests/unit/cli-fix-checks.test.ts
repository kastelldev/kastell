import { CHECK_IDS } from "../../src/core/audit/checkIds.js";
import { fixSafeCommand } from "../../src/commands/fix.js";

// Mock all dependencies
jest.mock("../../src/utils/serverSelect.js", () => ({
  resolveServer: jest.fn(() => Promise.resolve({
    name: "test-srv", ip: "1.2.3.4", provider: "hetzner", mode: "bare",
  })),
}));

jest.mock("../../src/utils/ssh.js", () => ({
  checkSshAvailable: jest.fn(() => Promise.resolve(true)),
  sshExec: jest.fn(() => Promise.resolve({ stdout: "", stderr: "", code: 0 })),
}));

jest.mock("../../src/core/audit/index.js", () => ({
  runAudit: jest.fn(() => Promise.resolve({
    success: true,
    data: {
      serverName: "test-srv",
      serverIp: "1.2.3.4",
      platform: "bare",
      overallScore: 65,
      timestamp: "2026-04-19T10:00:00Z",
      categories: [
        {
          name: "Kernel",
          score: 5,
          maxScore: 10,
          checks: [
            { id: "KERN-SYNCOOKIES", name: "SYN cookies", passed: false, severity: "warning", category: "Kernel", fix: "sysctl -w net.ipv4.tcp_syncookies=1" },
            { id: "KERN-RPLIMIT", name: "RP filter", passed: false, severity: "warning", category: "Kernel", fix: "sysctl -w net.ipv4.conf.all.rp_filter=1" },
          ],
        },
      ],
      quickWins: [],
    },
  })),
}));

jest.mock("../../src/core/backup.js", () => ({
  backupServer: jest.fn(() => Promise.resolve({ success: true })),
}));

jest.mock("../../src/core/audit/fix.js", () => ({
  previewSafeFixes: jest.fn(() => ({
    safePlan: { groups: [{ checks: [] }] },
    guardedCount: 0,
    forbiddenCount: 0,
    guardedIds: [],
    forbiddenFixes: [],
  })),
  runPostFixReAudit: jest.fn(() => Promise.resolve({ overallScore: 70 })),
  isFixCommandAllowed: jest.fn(() => true),
  sortChecksByImpact: jest.fn((checks) => checks),
  selectChecksForTop: jest.fn((checks) => checks),
  selectChecksForTarget: jest.fn((checks) => checks),
  fixCommandsFromChecks: jest.fn(() => []),
  extractAffectedCategories: jest.fn(() => []),
  runForbiddenFixes: jest.fn(() => Promise.resolve({ applied: [], skipped: [], errors: [] })),
}));

jest.mock("../../src/core/audit/handlers/index.js", () => ({
  tryHandlerDispatch: jest.fn(() => ({ handled: false })),
}));

jest.mock("../../src/core/audit/regression.js", () => ({
  loadBaseline: jest.fn(() => null),
  saveBaselineSafe: jest.fn(() => Promise.resolve()),
  checkRegression: jest.fn(() => ({ regressions: [], newPasses: [], baselineScore: 0, currentScore: 0 })),
  hasRegression: jest.fn(() => false),
  shouldUpdateBaseline: jest.fn(() => true),
  extractPassedCheckIds: jest.fn(() => []),
  formatRegressionSummary: jest.fn(() => []),
}));

jest.mock("../../src/core/audit/fix-history.js", () => ({
  loadFixHistory: jest.fn(() => []),
  saveFixHistory: jest.fn(),
  saveRollbackEntry: jest.fn(),
  generateFixId: jest.fn(() => "fix-2026-04-19-001"),
  backupFilesBeforeFix: jest.fn(() => Promise.resolve([])),
  backupRemoteCleanup: jest.fn(() => Promise.resolve()),
  rollbackFix: jest.fn(),
  rollbackAllFixes: jest.fn(),
  rollbackToFix: jest.fn(),
}));

describe("CLI fix --checks", () => {
  beforeEach(() => {
    jest.requireMock("../../src/core/audit/fix.js").previewSafeFixes.mockClear();
  });

  it("accepts checks option as comma-separated string", async () => {
    await fixSafeCommand("test-srv", {
      safe: true,
      dryRun: true,
      checks: "KERN-SYNCOOKIES,KERN-RPLIMIT",
    } as any);
    expect(jest.requireMock("../../src/core/audit/fix.js").previewSafeFixes).toHaveBeenCalledTimes(1);
  });

  it("filters audit checks to only specified IDs", async () => {
    const mockPreview = jest.requireMock("../../src/core/audit/fix.js").previewSafeFixes;
    const mockSortChecks = jest.requireMock("../../src/core/audit/fix.js").sortChecksByImpact;

    const bothChecks = [
      { id: "KERN-SYNCOOKIES", name: "SYN cookies", severity: "warning", category: "Kernel", tier: "SAFE", impact: 5, commands: ["echo test"] },
      { id: "KERN-RPLIMIT", name: "RP filter", severity: "warning", category: "Kernel", tier: "SAFE", impact: 5, commands: ["echo test"] },
    ];

    mockPreview.mockReturnValueOnce({
      safePlan: { groups: [{ checks: bothChecks }] },
      guardedCount: 0,
      forbiddenCount: 0,
      guardedIds: [],
    });

    let capturedSorted: { id: string }[] = [];
    mockSortChecks.mockImplementationOnce((checks: { id: string }[]) => {
      capturedSorted = checks;
      return checks;
    });

    await fixSafeCommand("test-srv", {
      safe: true,
      dryRun: true,
      checks: "KERN-SYNCOOKIES",
    } as any);

    expect(mockPreview).toHaveBeenCalledTimes(1);
    expect(capturedSorted.map((c) => c.id)).toEqual(["KERN-SYNCOOKIES", "KERN-RPLIMIT"]);
  });

  it("passes includeForbidden to previewSafeFixes when flag is set", async () => {
    const mockPreview = jest.requireMock("../../src/core/audit/fix.js").previewSafeFixes;
    mockPreview.mockReturnValueOnce({
      safePlan: { groups: [] },
      guardedCount: 0,
      forbiddenCount: 0,
      guardedIds: [],
      forbiddenFixes: [],
    });

    await fixSafeCommand("test-srv", {
      safe: true,
      dryRun: true,
      includeForbidden: true,
    } as any);

    expect(mockPreview).toHaveBeenCalledWith(
      expect.anything(),
      { includeForbidden: true },
    );
  });

  it("calls runForbiddenFixes when forbiddenFixes exist and not dry-run", async () => {
    const mockPreview = jest.requireMock("../../src/core/audit/fix.js").previewSafeFixes;
    const mockRunForbiddenFixes = jest.requireMock("../../src/core/audit/fix.js").runForbiddenFixes;

    const forbiddenFix = [{ checkId: CHECK_IDS.SSH.SSH_ROOT_LOGIN, command: "echo test", tier: "FORBIDDEN" as const }];
    const safeCheck = { id: "KERN-SYNCOOKIES", name: "SYN cookies", severity: "warning", category: "Kernel", tier: "SAFE", impact: 5, commands: ["echo test"] };
    mockPreview.mockReturnValueOnce({
      safePlan: { groups: [{ checks: [safeCheck] }] },
      guardedCount: 0,
      forbiddenCount: 1,
      guardedIds: [],
      forbiddenFixes: forbiddenFix,
    });

    await fixSafeCommand("test-srv", {
      safe: true,
      dryRun: false,
      force: true,
      interactive: false,
    } as any);

    expect(mockRunForbiddenFixes).toHaveBeenCalledWith("1.2.3.4", forbiddenFix);
  });
});