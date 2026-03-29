/**
 * Tests for the `kastell fix --safe` command (src/commands/fix.ts).
 * Covers: gate check, dry-run, backup abort, SAFE-only execution, score delta,
 * --history display, --rollback flow, history save after apply.
 */

import type { AuditResult, AuditCategory, AuditCheck } from "../../src/core/audit/types.js";
import type { BackupResult } from "../../src/core/backup.js";

jest.mock("../../src/utils/serverSelect.js");
jest.mock("../../src/utils/ssh.js");
jest.mock("../../src/core/audit/index.js");
jest.mock("../../src/core/audit/fix.js");
jest.mock("../../src/core/audit/scoring.js");
jest.mock("../../src/core/backup.js");
jest.mock("../../src/utils/logger.js");
jest.mock("../../src/core/audit/fix-history.js");
jest.mock("../../src/core/audit/handlers/index.js");
jest.mock("../../src/core/audit/profiles.js");
jest.mock("../../src/utils/fixReport.js");
jest.mock("fs");
jest.mock("inquirer");

import { fixSafeCommand } from "../../src/commands/fix.js";
import { resolveServer } from "../../src/utils/serverSelect.js";
import { checkSshAvailable, sshExec } from "../../src/utils/ssh.js";
import { runAudit } from "../../src/core/audit/index.js";
import {
  previewSafeFixes,
  runScoreCheck,
  isFixCommandAllowed,
  fixCommandsFromChecks,
  sortChecksByImpact,
  selectChecksForTop,
  selectChecksForTarget,
} from "../../src/core/audit/fix.js";
import {
  tryHandlerDispatch,
} from "../../src/core/audit/handlers/index.js";
import { buildImpactContext } from "../../src/core/audit/scoring.js";
import { filterChecksByProfile, isValidProfile } from "../../src/core/audit/profiles.js";
import { generateFixReport, fixReportFilename } from "../../src/utils/fixReport.js";
import { backupServer } from "../../src/core/backup.js";
import { logger, createSpinner } from "../../src/utils/logger.js";
import {
  loadFixHistory,
  saveFixHistory,
  saveRollbackEntry,
  generateFixId,
  getLastFixId,
  backupFilesBeforeFix,
  rollbackFix,
  backupRemoteCleanup,
} from "../../src/core/audit/fix-history.js";
import inquirer from "inquirer";
import type { FixHistoryEntry } from "../../src/core/audit/types.js";

const mockedResolveServer = resolveServer as jest.MockedFunction<typeof resolveServer>;
const mockedCheckSsh = checkSshAvailable as jest.MockedFunction<typeof checkSshAvailable>;
const mockedSshExec = sshExec as jest.MockedFunction<typeof sshExec>;
const mockedRunAudit = runAudit as jest.MockedFunction<typeof runAudit>;
const mockedPreviewSafeFixes = previewSafeFixes as jest.MockedFunction<typeof previewSafeFixes>;
const mockedRunScoreCheck = runScoreCheck as jest.MockedFunction<typeof runScoreCheck>;
const mockedBackupServer = backupServer as jest.MockedFunction<typeof backupServer>;
const mockedPrompt = inquirer.prompt as jest.MockedFunction<typeof inquirer.prompt>;
const mockedLogger = logger as jest.Mocked<typeof logger>;
const mockedLoadFixHistory = loadFixHistory as jest.MockedFunction<typeof loadFixHistory>;
const mockedSaveFixHistory = saveFixHistory as jest.MockedFunction<typeof saveFixHistory>;
const mockedGenerateFixId = generateFixId as jest.MockedFunction<typeof generateFixId>;
const mockedGetLastFixId = getLastFixId as jest.MockedFunction<typeof getLastFixId>;
const mockedBackupFilesBeforeFix = backupFilesBeforeFix as jest.MockedFunction<typeof backupFilesBeforeFix>;
const mockedRollbackFix = rollbackFix as jest.MockedFunction<typeof rollbackFix>;
const mockedSaveRollbackEntry = saveRollbackEntry as jest.MockedFunction<typeof saveRollbackEntry>;
const mockedBackupRemoteCleanup = backupRemoteCleanup as jest.MockedFunction<typeof backupRemoteCleanup>;
const mockedFixCommandsFromChecks = fixCommandsFromChecks as jest.MockedFunction<typeof fixCommandsFromChecks>;
const mockedSortChecksByImpact = sortChecksByImpact as jest.MockedFunction<typeof sortChecksByImpact>;
const mockedSelectChecksForTop = selectChecksForTop as jest.MockedFunction<typeof selectChecksForTop>;
const mockedSelectChecksForTarget = selectChecksForTarget as jest.MockedFunction<typeof selectChecksForTarget>;
const mockedBuildImpactContext = buildImpactContext as jest.MockedFunction<typeof buildImpactContext>;
const mockedTryHandlerDispatch = tryHandlerDispatch as jest.MockedFunction<typeof tryHandlerDispatch>;

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeCheck(overrides: Partial<AuditCheck> = {}): AuditCheck {
  return {
    id: "TEST-01",
    category: "Kernel",
    name: "Test Check",
    severity: "warning",
    passed: true,
    currentValue: "good",
    expectedValue: "good",
    ...overrides,
  };
}

function makeCategory(name: string, checks: AuditCheck[], score = 50): AuditCategory {
  return { name, checks, score, maxScore: 100 };
}

function makeResult(categories: AuditCategory[], overallScore = 70): AuditResult {
  return {
    serverName: "test-server",
    serverIp: "1.2.3.4",
    platform: "bare",
    timestamp: "2026-01-01T00:00:00.000Z",
    auditVersion: "1.0.0",
    categories,
    overallScore,
    quickWins: [],
  };
}

const testServer = {
  id: "hetzner-123",
  name: "test-server",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "fsn1",
  size: "cx21",
  createdAt: "2026-01-01T00:00:00.000Z",
  mode: "bare" as const,
};

function makeHistoryEntry(overrides: Partial<FixHistoryEntry> = {}): FixHistoryEntry {
  return {
    fixId: "fix-2026-03-29-001",
    serverIp: "1.2.3.4",
    serverName: "test-server",
    timestamp: "2026-03-29T10:00:00.000Z",
    checks: ["KERN-01"],
    scoreBefore: 70,
    scoreAfter: 75,
    status: "applied",
    backupPath: "/root/.kastell/fix-backups/fix-2026-03-29-001",
    ...overrides,
  };
}

const defaultSafePlan = {
  safePlan: {
    groups: [{
      severity: "warning" as const,
      checks: [{
        id: "KERN-01",
        category: "Kernel",
        name: "TCP SYN Cookies",
        severity: "warning" as const,
        fixCommand: "sysctl -w net.ipv4.tcp_syncookies=1",
      }],
      estimatedImpact: 3,
    }],
  },
  guardedCount: 0,
  forbiddenCount: 0,
  guardedIds: [],
};

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.resetAllMocks();

  // Default spinner mock — returns a no-op spinner
  (createSpinner as jest.Mock).mockReturnValue({
    start: jest.fn(),
    stop: jest.fn(),
  });

  // Default isFixCommandAllowed mock — allow common fix prefixes
  (isFixCommandAllowed as jest.MockedFunction<typeof isFixCommandAllowed>).mockImplementation(
    (cmd: string) => ["sysctl", "echo ", "sed ", "chmod", "systemctl"].some((p) => cmd.startsWith(p)),
  );

  // Default fix-history mocks
  mockedLoadFixHistory.mockReturnValue([]);
  mockedSaveFixHistory.mockResolvedValue(undefined);
  mockedGenerateFixId.mockReturnValue("fix-2026-03-29-001");
  mockedGetLastFixId.mockReturnValue(null);
  mockedBackupFilesBeforeFix.mockResolvedValue("/root/.kastell/fix-backups/fix-2026-03-29-001");
  mockedRollbackFix.mockResolvedValue({ restored: [], errors: [] });
  mockedBackupRemoteCleanup.mockResolvedValue(undefined);
  mockedFixCommandsFromChecks.mockReturnValue([
    { checkId: "KERN-01", fixCommand: "sysctl -w net.ipv4.tcp_syncookies=1" },
  ]);

  // Default prioritization mocks — pass checks through with impact=5
  mockedBuildImpactContext.mockReturnValue({
    catWeightMap: new Map(),
    totalOverallWeight: 100,
  } as never);
  mockedSortChecksByImpact.mockImplementation((checks) =>
    checks.map((c) => ({ ...c, impact: 5 })),
  );
  mockedSelectChecksForTop.mockImplementation((sorted, n) => sorted.slice(0, n));
  mockedSelectChecksForTarget.mockImplementation((sorted) => sorted);

  // Default handler mock — return { handled: false } (no match) so existing tests use shell path
  mockedTryHandlerDispatch.mockResolvedValue({ handled: false });

  // Default profiles mocks — pass-through (all checks accepted)
  (isValidProfile as jest.MockedFunction<typeof isValidProfile>).mockImplementation(
    (name: string): name is "web-server" | "database" | "mail-server" =>
      name === "web-server" || name === "database" || name === "mail-server",
  );
  (filterChecksByProfile as jest.MockedFunction<typeof filterChecksByProfile>).mockImplementation(
    (checks) => checks,
  );

  // Default fixReport mocks
  (generateFixReport as jest.MockedFunction<typeof generateFixReport>).mockReturnValue("# Report\n");
  (fixReportFilename as jest.MockedFunction<typeof fixReportFilename>).mockReturnValue("kastell-fix-report-test-server-2026-03-29.md");
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("fixSafeCommand", () => {
  it("Test 1: prints usage help and returns without audit when --safe not set", async () => {
    await fixSafeCommand(undefined, {});

    expect(mockedLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("kastell fix --safe"),
    );
    expect(mockedRunAudit).not.toHaveBeenCalled();
    expect(mockedResolveServer).not.toHaveBeenCalled();
  });

  it("Test 2: --safe --dry-run shows preview but does NOT call backupServer", async () => {
    mockedResolveServer.mockResolvedValue(testServer);
    mockedCheckSsh.mockReturnValue(true);

    const auditResult = makeResult([
      makeCategory("Kernel", [
        makeCheck({ id: "KERN-01", category: "Kernel", severity: "warning", passed: false, fixCommand: "sysctl -w net.ipv4.tcp_syncookies=1", safeToAutoFix: "SAFE" }),
      ]),
    ]);
    mockedRunAudit.mockResolvedValue({ success: true, data: auditResult });
    mockedPreviewSafeFixes.mockReturnValue({
      safePlan: {
        groups: [{
          severity: "warning",
          checks: [{
            id: "KERN-01",
            category: "Kernel",
            name: "TCP SYN Cookies",
            severity: "warning",
            fixCommand: "sysctl -w net.ipv4.tcp_syncookies=1",
          }],
          estimatedImpact: 3,
        }],
      },
      guardedCount: 2,
      forbiddenCount: 5,
      guardedIds: ["G-1", "G-2"],
    });

    await fixSafeCommand(undefined, { safe: true, dryRun: true });

    expect(mockedBackupServer).not.toHaveBeenCalled();
    expect(mockedSshExec).not.toHaveBeenCalled();
    // Should show GUARDED and FORBIDDEN counts
    expect(mockedLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("GUARDED"),
    );
    expect(mockedLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("FORBIDDEN"),
    );
  });

  it("Test 3: --safe calls backupServer before applying fixes", async () => {
    mockedResolveServer.mockResolvedValue(testServer);
    mockedCheckSsh.mockReturnValue(true);

    const auditResult = makeResult([
      makeCategory("Kernel", [
        makeCheck({ id: "KERN-01", category: "Kernel", severity: "warning", passed: false, fixCommand: "sysctl -w net.ipv4.tcp_syncookies=1", safeToAutoFix: "SAFE" }),
      ]),
    ]);
    mockedRunAudit.mockResolvedValue({ success: true, data: auditResult });
    mockedPreviewSafeFixes.mockReturnValue(defaultSafePlan);
    mockedPrompt.mockResolvedValue({ confirm: true });
    mockedBackupServer.mockResolvedValue({ success: true, backupPath: "/tmp/backup" } as BackupResult);
    mockedSshExec.mockResolvedValue({ stdout: "", stderr: "", code: 0 });

    await fixSafeCommand(undefined, { safe: true });

    expect(mockedBackupServer).toHaveBeenCalledWith(testServer);
    expect(mockedSshExec).toHaveBeenCalled();
  });

  it("Test 4: aborts when backup fails — zero sshExec calls for fixes (D-07)", async () => {
    mockedResolveServer.mockResolvedValue(testServer);
    mockedCheckSsh.mockReturnValue(true);

    const auditResult = makeResult([
      makeCategory("Kernel", [
        makeCheck({ id: "KERN-01", category: "Kernel", severity: "warning", passed: false, fixCommand: "sysctl -w net.ipv4.tcp_syncookies=1", safeToAutoFix: "SAFE" }),
      ]),
    ]);
    mockedRunAudit.mockResolvedValue({ success: true, data: auditResult });
    mockedPreviewSafeFixes.mockReturnValue(defaultSafePlan);
    mockedPrompt.mockResolvedValue({ confirm: true });
    mockedBackupServer.mockResolvedValue({ success: false, error: "disk full" } as BackupResult);

    await fixSafeCommand(undefined, { safe: true });

    // Backup failed — no fix commands should be executed
    expect(mockedSshExec).not.toHaveBeenCalled();
    expect(mockedRunScoreCheck).not.toHaveBeenCalled();
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("Backup failed"),
    );
  });

  it("Test 5: applies only SAFE tier fixes, skips GUARDED checks", async () => {
    mockedResolveServer.mockResolvedValue(testServer);
    mockedCheckSsh.mockReturnValue(true);

    const auditResult = makeResult([
      makeCategory("Kernel", [
        makeCheck({ id: "KERN-01", category: "Kernel", severity: "warning", passed: false, fixCommand: "sysctl -w net.ipv4.tcp_syncookies=1", safeToAutoFix: "SAFE" }),
      ]),
      makeCategory("Logging", [
        makeCheck({ id: "LOG-01", category: "Logging", severity: "warning", passed: false, fixCommand: "systemctl restart rsyslog", safeToAutoFix: "GUARDED" }),
      ]),
    ]);
    mockedRunAudit.mockResolvedValue({ success: true, data: auditResult });
    // previewSafeFixes returns ONLY the SAFE check in the safePlan
    mockedPreviewSafeFixes.mockReturnValue({
      safePlan: {
        groups: [{
          severity: "warning",
          checks: [{
            id: "KERN-01",
            category: "Kernel",
            name: "TCP SYN Cookies",
            severity: "warning",
            fixCommand: "sysctl -w net.ipv4.tcp_syncookies=1",
          }],
          estimatedImpact: 3,
        }],
      },
      guardedCount: 1,
      forbiddenCount: 0,
      guardedIds: ["LOG-01"],
    });
    mockedPrompt.mockResolvedValue({ confirm: true });
    mockedBackupServer.mockResolvedValue({ success: true, backupPath: "/tmp/backup" } as BackupResult);
    mockedSshExec.mockResolvedValue({ stdout: "", stderr: "", code: 0 });
    mockedRunScoreCheck.mockResolvedValue(75);

    await fixSafeCommand(undefined, { safe: true });

    // sshExec should be called with SAFE fix command, NOT with GUARDED command
    const sshCalls = mockedSshExec.mock.calls;
    const fixCommands = sshCalls.map((c) => String(c[1]));
    expect(fixCommands.some((cmd) => cmd.includes("sysctl"))).toBe(true);
    expect(fixCommands.some((cmd) => cmd.includes("restart rsyslog"))).toBe(false);
  });

  it("Test 6: calls runScoreCheck after successful fixes and logs score delta", async () => {
    mockedResolveServer.mockResolvedValue(testServer);
    mockedCheckSsh.mockReturnValue(true);

    const auditResult = makeResult([
      makeCategory("Kernel", [
        makeCheck({ id: "KERN-01", category: "Kernel", severity: "warning", passed: false, fixCommand: "sysctl -w net.ipv4.tcp_syncookies=1", safeToAutoFix: "SAFE" }),
      ]),
    ], 70);
    mockedRunAudit.mockResolvedValue({ success: true, data: auditResult });
    mockedPreviewSafeFixes.mockReturnValue(defaultSafePlan);
    mockedPrompt.mockResolvedValue({ confirm: true });
    mockedBackupServer.mockResolvedValue({ success: true, backupPath: "/tmp/backup" } as BackupResult);
    mockedSshExec.mockResolvedValue({ stdout: "", stderr: "", code: 0 });
    mockedRunScoreCheck.mockResolvedValue(85);

    await fixSafeCommand(undefined, { safe: true });

    expect(mockedRunScoreCheck).toHaveBeenCalledWith(
      "1.2.3.4",
      "bare",
      auditResult,
      ["Kernel"],
    );
    // Score delta format: "Score: 70 → 85 (+15)"
    expect(mockedLogger.success).toHaveBeenCalledWith(
      expect.stringMatching(/Score: 70 \u2192 85 \(\+15\)/),
    );
  });

  it("Test 7: does NOT call runScoreCheck when no fixes were applied", async () => {
    mockedResolveServer.mockResolvedValue(testServer);
    mockedCheckSsh.mockReturnValue(true);

    const auditResult = makeResult([
      makeCategory("Kernel", [
        makeCheck({ id: "KERN-01", category: "Kernel", severity: "warning", passed: false, fixCommand: "unknown_command foo", safeToAutoFix: "SAFE" }),
      ]),
    ]);
    mockedRunAudit.mockResolvedValue({ success: true, data: auditResult });
    mockedPreviewSafeFixes.mockReturnValue({
      safePlan: {
        groups: [{
          severity: "warning",
          checks: [{
            id: "KERN-01",
            category: "Kernel",
            name: "Test",
            severity: "warning",
            fixCommand: "unknown_command foo",
          }],
          estimatedImpact: 3,
        }],
      },
      guardedCount: 0,
      forbiddenCount: 0,
      guardedIds: [],
    });
    mockedPrompt.mockResolvedValue({ confirm: true });
    mockedBackupServer.mockResolvedValue({ success: true, backupPath: "/tmp/backup" } as BackupResult);
    // sshExec for fix will return code 1 (command rejected by prefix guard)

    await fixSafeCommand(undefined, { safe: true });

    // Fix was rejected (unknown prefix), so applied.length === 0
    expect(mockedRunScoreCheck).not.toHaveBeenCalled();
  });

  it("Test 8: returns early if resolveServer returns undefined", async () => {
    mockedResolveServer.mockResolvedValue(undefined);

    await fixSafeCommand(undefined, { safe: true });

    expect(mockedCheckSsh).not.toHaveBeenCalled();
    expect(mockedRunAudit).not.toHaveBeenCalled();
  });

  it("Test 9: returns early if runAudit fails", async () => {
    mockedResolveServer.mockResolvedValue(testServer);
    mockedCheckSsh.mockReturnValue(true);
    mockedRunAudit.mockResolvedValue({ success: false, error: "SSH connection refused" });

    await fixSafeCommand(undefined, { safe: true });

    expect(mockedPreviewSafeFixes).not.toHaveBeenCalled();
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("Audit failed"),
    );
  });

  it("Test 10: shows GUARDED count and FORBIDDEN count in dry-run output", async () => {
    mockedResolveServer.mockResolvedValue(testServer);
    mockedCheckSsh.mockReturnValue(true);

    const auditResult = makeResult([
      makeCategory("Kernel", [
        makeCheck({ id: "KERN-01", category: "Kernel", severity: "warning", passed: false, fixCommand: "sysctl -w net.ipv4.tcp_syncookies=1", safeToAutoFix: "SAFE" }),
      ]),
    ]);
    mockedRunAudit.mockResolvedValue({ success: true, data: auditResult });
    mockedPreviewSafeFixes.mockReturnValue({
      safePlan: {
        groups: [{
          severity: "warning",
          checks: [{
            id: "KERN-01",
            category: "Kernel",
            name: "TCP SYN Cookies",
            severity: "warning",
            fixCommand: "sysctl -w net.ipv4.tcp_syncookies=1",
          }],
          estimatedImpact: 3,
        }],
      },
      guardedCount: 4,
      forbiddenCount: 8,
      guardedIds: ["LOG-01", "LOG-02", "SVC-01", "SVC-02"],
    });

    await fixSafeCommand(undefined, { safe: true, dryRun: true });

    // Should display GUARDED count
    const guardedCall = mockedLogger.info.mock.calls.find(
      (args) => typeof args[0] === "string" && args[0].includes("GUARDED") && args[0].includes("4"),
    );
    expect(guardedCall).toBeDefined();

    // Should display FORBIDDEN count
    const forbiddenCall = mockedLogger.info.mock.calls.find(
      (args) => typeof args[0] === "string" && args[0].includes("FORBIDDEN") && args[0].includes("8"),
    );
    expect(forbiddenCall).toBeDefined();
  });

  // ── --history flag ───────────────────────────────────────────────────────

  describe("--history flag", () => {
    it("Test H1: displays table of fix history entries", async () => {
      mockedResolveServer.mockResolvedValue(testServer);
      const entry = makeHistoryEntry();
      mockedLoadFixHistory.mockReturnValue([entry]);

      await fixSafeCommand(undefined, { history: true });

      expect(mockedLoadFixHistory).toHaveBeenCalledWith("1.2.3.4");
      expect(mockedLogger.title).toHaveBeenCalledWith("Fix History");
      // Should show fix ID in output
      expect(mockedLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("fix-2026-03-29-001"),
      );
    });

    it("Test H2: shows 'No fix history found' when no entries", async () => {
      mockedResolveServer.mockResolvedValue(testServer);
      mockedLoadFixHistory.mockReturnValue([]);

      await fixSafeCommand(undefined, { history: true });

      expect(mockedLogger.info).toHaveBeenCalledWith(
        "No fix history found for this server.",
      );
      expect(mockedLogger.title).not.toHaveBeenCalled();
    });

    it("Test H3: returns early if resolveServer returns undefined for --history", async () => {
      mockedResolveServer.mockResolvedValue(undefined);

      await fixSafeCommand(undefined, { history: true });

      expect(mockedLoadFixHistory).not.toHaveBeenCalled();
    });

    it("Test H4: shows status colors for applied/rolled-back/failed entries", async () => {
      mockedResolveServer.mockResolvedValue(testServer);
      const entries = [
        makeHistoryEntry({ fixId: "fix-2026-03-29-001", status: "applied" }),
        makeHistoryEntry({ fixId: "fix-2026-03-29-002", status: "rolled-back" }),
        makeHistoryEntry({ fixId: "fix-2026-03-29-003", status: "failed" }),
      ];
      mockedLoadFixHistory.mockReturnValue(entries);

      await fixSafeCommand(undefined, { history: true });

      // Should have logged each entry
      const infoCalls = mockedLogger.info.mock.calls.map((c) => c[0] as string);
      expect(infoCalls.some((c) => c.includes("fix-2026-03-29-001"))).toBe(true);
      expect(infoCalls.some((c) => c.includes("fix-2026-03-29-002"))).toBe(true);
      expect(infoCalls.some((c) => c.includes("fix-2026-03-29-003"))).toBe(true);
    });
  });

  // ── --rollback flag ──────────────────────────────────────────────────────

  describe("--rollback flag", () => {
    it("Test R1: --rollback <id> calls rollbackFix and saves rolled-back history entry", async () => {
      mockedResolveServer.mockResolvedValue(testServer);
      const entry = makeHistoryEntry({ fixId: "fix-2026-03-29-001", status: "applied" });
      mockedLoadFixHistory.mockReturnValue([entry]);
      mockedCheckSsh.mockReturnValue(true);
      mockedRollbackFix.mockResolvedValue({ restored: ["/etc/sysctl.conf"], errors: [] });
      mockedRunAudit.mockResolvedValue({ success: true, data: makeResult([], 68) });

      await fixSafeCommand(undefined, { rollback: "fix-2026-03-29-001" });

      expect(mockedRollbackFix).toHaveBeenCalledWith(
        "1.2.3.4",
        "/root/.kastell/fix-backups/fix-2026-03-29-001",
      );
      expect(mockedSaveRollbackEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          fixId: "fix-2026-03-29-001",
          status: "applied",
          serverIp: "1.2.3.4",
        }),
        68,
      );
    });

    it("Test R2: --rollback last resolves to last applied fix ID", async () => {
      mockedResolveServer.mockResolvedValue(testServer);
      const entry = makeHistoryEntry({ fixId: "fix-2026-03-29-001", status: "applied" });
      mockedLoadFixHistory.mockReturnValue([entry]);
      mockedCheckSsh.mockReturnValue(true);
      mockedRollbackFix.mockResolvedValue({ restored: ["/etc/sysctl.conf"], errors: [] });
      mockedRunAudit.mockResolvedValue({ success: true, data: makeResult([], 68) });

      await fixSafeCommand(undefined, { rollback: "last" });

      expect(mockedLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("fix-2026-03-29-001"),
      );
      expect(mockedRollbackFix).toHaveBeenCalled();
    });

    it("Test R3: --rollback last with no applied fixes shows error", async () => {
      mockedResolveServer.mockResolvedValue(testServer);
      mockedLoadFixHistory.mockReturnValue([]);

      await fixSafeCommand(undefined, { rollback: "last" });

      expect(mockedLogger.error).toHaveBeenCalledWith(
        "No applied fixes found for this server.",
      );
      expect(mockedRollbackFix).not.toHaveBeenCalled();
    });

    it("Test R4: --rollback with nonexistent fix ID shows error", async () => {
      mockedResolveServer.mockResolvedValue(testServer);
      mockedLoadFixHistory.mockReturnValue([]);

      await fixSafeCommand(undefined, { rollback: "fix-nonexistent" });

      expect(mockedLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("fix-nonexistent"),
      );
      expect(mockedRollbackFix).not.toHaveBeenCalled();
    });

    it("Test R5: --rollback with already rolled-back fix ID shows error", async () => {
      mockedResolveServer.mockResolvedValue(testServer);
      const entry = makeHistoryEntry({ fixId: "fix-2026-03-29-001", status: "rolled-back" });
      mockedLoadFixHistory.mockReturnValue([entry]);

      await fixSafeCommand(undefined, { rollback: "fix-2026-03-29-001" });

      expect(mockedLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("fix-2026-03-29-001"),
      );
      expect(mockedRollbackFix).not.toHaveBeenCalled();
    });

    it("Test R6: --rollback returns early if SSH not available", async () => {
      mockedResolveServer.mockResolvedValue(testServer);
      const entry = makeHistoryEntry({ fixId: "fix-2026-03-29-001", status: "applied" });
      mockedLoadFixHistory.mockReturnValue([entry]);
      mockedCheckSsh.mockReturnValue(false);

      await fixSafeCommand(undefined, { rollback: "fix-2026-03-29-001" });

      expect(mockedLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("SSH client not found"),
      );
      expect(mockedRollbackFix).not.toHaveBeenCalled();
    });

    it("Test R7: --rollback returns early if resolveServer returns undefined", async () => {
      mockedResolveServer.mockResolvedValue(undefined);

      await fixSafeCommand(undefined, { rollback: "fix-2026-03-29-001" });

      expect(mockedRollbackFix).not.toHaveBeenCalled();
      expect(mockedSaveFixHistory).not.toHaveBeenCalled();
    });

    it("Test R8: --rollback reports restored files and errors", async () => {
      mockedResolveServer.mockResolvedValue(testServer);
      const entry = makeHistoryEntry({ fixId: "fix-2026-03-29-001", status: "applied" });
      mockedLoadFixHistory.mockReturnValue([entry]);
      mockedCheckSsh.mockReturnValue(true);
      mockedRollbackFix.mockResolvedValue({
        restored: ["/etc/sysctl.conf"],
        errors: ["restore-commands.sh failed (exit 1)"],
      });
      mockedRunAudit.mockResolvedValue({ success: true, data: makeResult([], 68) });

      await fixSafeCommand(undefined, { rollback: "fix-2026-03-29-001" });

      expect(mockedLogger.success).toHaveBeenCalledWith(
        expect.stringContaining("/etc/sysctl.conf"),
      );
      expect(mockedLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("restore-commands.sh"),
      );
    });
  });

  // ── --safe apply flow with history save ──────────────────────────────────

  describe("--safe apply: history save integration", () => {
    it("Test A1: saves history entry after successful apply", async () => {
      mockedResolveServer.mockResolvedValue(testServer);
      mockedCheckSsh.mockReturnValue(true);

      const auditResult = makeResult([
        makeCategory("Kernel", [
          makeCheck({ id: "KERN-01", category: "Kernel", severity: "warning", passed: false, fixCommand: "sysctl -w net.ipv4.tcp_syncookies=1", safeToAutoFix: "SAFE" }),
        ]),
      ], 70);
      mockedRunAudit.mockResolvedValue({ success: true, data: auditResult });
      mockedPreviewSafeFixes.mockReturnValue(defaultSafePlan);
      mockedPrompt.mockResolvedValue({ confirm: true });
      mockedBackupServer.mockResolvedValue({ success: true, backupPath: "/tmp/backup" } as BackupResult);
      mockedSshExec.mockResolvedValue({ stdout: "", stderr: "", code: 0 });
      mockedRunScoreCheck.mockResolvedValue(75);
      mockedGenerateFixId.mockReturnValue("fix-2026-03-29-001");
      mockedBackupFilesBeforeFix.mockResolvedValue("/root/.kastell/fix-backups/fix-2026-03-29-001");

      await fixSafeCommand(undefined, { safe: true });

      expect(mockedGenerateFixId).toHaveBeenCalledWith("1.2.3.4");
      expect(mockedBackupFilesBeforeFix).toHaveBeenCalledWith(
        "1.2.3.4",
        "fix-2026-03-29-001",
        expect.any(Array),
      );
      expect(mockedSaveFixHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          fixId: "fix-2026-03-29-001",
          serverIp: "1.2.3.4",
          serverName: "test-server",
          checks: ["KERN-01"],
          scoreBefore: 70,
          scoreAfter: 75,
          status: "applied",
          backupPath: "/root/.kastell/fix-backups/fix-2026-03-29-001",
        }),
      );
    });

    it("Test A2: calls backupRemoteCleanup after saving history", async () => {
      mockedResolveServer.mockResolvedValue(testServer);
      mockedCheckSsh.mockReturnValue(true);

      const auditResult = makeResult([
        makeCategory("Kernel", [
          makeCheck({ id: "KERN-01", category: "Kernel", severity: "warning", passed: false, fixCommand: "sysctl -w net.ipv4.tcp_syncookies=1", safeToAutoFix: "SAFE" }),
        ]),
      ]);
      mockedRunAudit.mockResolvedValue({ success: true, data: auditResult });
      mockedPreviewSafeFixes.mockReturnValue(defaultSafePlan);
      mockedPrompt.mockResolvedValue({ confirm: true });
      mockedBackupServer.mockResolvedValue({ success: true, backupPath: "/tmp/backup" } as BackupResult);
      mockedSshExec.mockResolvedValue({ stdout: "", stderr: "", code: 0 });

      await fixSafeCommand(undefined, { safe: true });

      expect(mockedBackupRemoteCleanup).toHaveBeenCalledWith("1.2.3.4");
    });

    it("Test A3: saves history entry with 'failed' status when no fixes applied", async () => {
      mockedResolveServer.mockResolvedValue(testServer);
      mockedCheckSsh.mockReturnValue(true);

      const auditResult = makeResult([
        makeCategory("Kernel", [
          makeCheck({ id: "KERN-01", category: "Kernel", severity: "warning", passed: false, fixCommand: "unknown_command foo", safeToAutoFix: "SAFE" }),
        ]),
      ]);
      mockedRunAudit.mockResolvedValue({ success: true, data: auditResult });
      mockedPreviewSafeFixes.mockReturnValue({
        safePlan: {
          groups: [{
            severity: "warning" as const,
            checks: [{
              id: "KERN-01",
              category: "Kernel",
              name: "Test",
              severity: "warning" as const,
              fixCommand: "unknown_command foo",
            }],
            estimatedImpact: 3,
          }],
        },
        guardedCount: 0,
        forbiddenCount: 0,
        guardedIds: [],
      });
      mockedPrompt.mockResolvedValue({ confirm: true });
      mockedBackupServer.mockResolvedValue({ success: true, backupPath: "/tmp/backup" } as BackupResult);

      await fixSafeCommand(undefined, { safe: true });

      // Fix was rejected, so status should be "failed"
      expect(mockedSaveFixHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          checks: [],
        }),
      );
    });
  });

  // ── --top and --target flag tests ────────────────────────────────────────

  describe("--top and --target flags", () => {
    it("Test P1: --top without --safe returns error and no audit", async () => {
      await fixSafeCommand(undefined, { top: "3" });

      expect(mockedLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("--top / --target sadece --safe ile kullanilir"),
      );
      expect(mockedRunAudit).not.toHaveBeenCalled();
    });

    it("Test P2: --target without --safe returns error and no audit", async () => {
      await fixSafeCommand(undefined, { target: "80" });

      expect(mockedLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("--top / --target sadece --safe ile kullanilir"),
      );
      expect(mockedRunAudit).not.toHaveBeenCalled();
    });

    it("Test P3: --top and --target together returns mutual exclusion error", async () => {
      await fixSafeCommand(undefined, { safe: true, top: "3", target: "80" });

      expect(mockedLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("birlikte kullanilamaz"),
      );
      expect(mockedRunAudit).not.toHaveBeenCalled();
    });

    it("Test P4: --top N applies only N fixes from sorted list", async () => {
      mockedResolveServer.mockResolvedValue(testServer);
      mockedCheckSsh.mockReturnValue(true);

      const fiveChecks = [
        { id: "CHECK-01", category: "Kernel", name: "Check 1", severity: "warning" as const, fixCommand: "sysctl -w check.01=1" },
        { id: "CHECK-02", category: "Kernel", name: "Check 2", severity: "warning" as const, fixCommand: "sysctl -w check.02=1" },
        { id: "CHECK-03", category: "Kernel", name: "Check 3", severity: "warning" as const, fixCommand: "sysctl -w check.03=1" },
        { id: "CHECK-04", category: "Kernel", name: "Check 4", severity: "warning" as const, fixCommand: "sysctl -w check.04=1" },
        { id: "CHECK-05", category: "Kernel", name: "Check 5", severity: "warning" as const, fixCommand: "sysctl -w check.05=1" },
      ];
      const auditResult = makeResult([makeCategory("Kernel", [])], 60);
      mockedRunAudit.mockResolvedValue({ success: true, data: auditResult });
      mockedPreviewSafeFixes.mockReturnValue({
        safePlan: { groups: [{ severity: "warning", checks: fiveChecks, estimatedImpact: 25 }] },
        guardedCount: 0, forbiddenCount: 0, guardedIds: [],
      });
      const scoredChecks = fiveChecks.map((c) => ({ ...c, impact: 5 }));
      mockedSortChecksByImpact.mockReturnValue(scoredChecks);
      mockedSelectChecksForTop.mockReturnValue(scoredChecks.slice(0, 3));
      mockedPrompt.mockResolvedValue({ confirm: true });
      mockedBackupServer.mockResolvedValue({ success: true, backupPath: "/tmp/backup" } as BackupResult);
      mockedSshExec.mockResolvedValue({ stdout: "", stderr: "", code: 0 });

      await fixSafeCommand(undefined, { safe: true, top: "3" });

      expect(mockedSelectChecksForTop).toHaveBeenCalledWith(
        expect.any(Array),
        3,
      );
      // Only 3 SSH fix commands should be issued (not 5)
      const fixCalls = mockedSshExec.mock.calls.filter((c) =>
        String(c[1]).includes("sysctl -w check."),
      );
      expect(fixCalls.length).toBe(3);
    });

    it("Test P5: --target already met shows 'fix gerekmez' and no SSH", async () => {
      mockedResolveServer.mockResolvedValue(testServer);
      mockedCheckSsh.mockReturnValue(true);

      const auditResult = makeResult([makeCategory("Kernel", [])], 85);
      mockedRunAudit.mockResolvedValue({ success: true, data: auditResult });
      mockedPreviewSafeFixes.mockReturnValue({
        safePlan: { groups: [{ severity: "warning", checks: [{ id: "KERN-01", category: "Kernel", name: "Test", severity: "warning" as const, fixCommand: "sysctl -w x=1" }], estimatedImpact: 5 }] },
        guardedCount: 0, forbiddenCount: 0, guardedIds: [],
      });
      mockedSortChecksByImpact.mockReturnValue([
        { id: "KERN-01", category: "Kernel", name: "Test", severity: "warning" as const, fixCommand: "sysctl -w x=1", impact: 5 },
      ]);

      await fixSafeCommand(undefined, { safe: true, target: "80" });

      expect(mockedLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("fix gerekmez"),
      );
      expect(mockedSshExec).not.toHaveBeenCalled();
      expect(mockedBackupServer).not.toHaveBeenCalled();
    });

    it("Test P6: --target unreachable applies all SAFE + shows GUARDED/FORBIDDEN warning", async () => {
      mockedResolveServer.mockResolvedValue(testServer);
      mockedCheckSsh.mockReturnValue(true);

      const auditResult = makeResult([makeCategory("Kernel", [])], 50);
      mockedRunAudit.mockResolvedValue({ success: true, data: auditResult });
      mockedPreviewSafeFixes.mockReturnValue(defaultSafePlan);
      const scoredCheck = {
        id: "KERN-01", category: "Kernel", name: "TCP SYN Cookies",
        severity: "warning" as const, fixCommand: "sysctl -w net.ipv4.tcp_syncookies=1", impact: 3,
      };
      mockedSortChecksByImpact.mockReturnValue([scoredCheck]);
      mockedSelectChecksForTarget.mockReturnValue([scoredCheck]);
      mockedPrompt.mockResolvedValue({ confirm: true });
      mockedBackupServer.mockResolvedValue({ success: true, backupPath: "/tmp/backup" } as BackupResult);
      mockedSshExec.mockResolvedValue({ stdout: "", stderr: "", code: 0 });
      // After fix, score is still well below target 99
      mockedRunScoreCheck.mockResolvedValue(53);

      await fixSafeCommand(undefined, { safe: true, target: "99" });

      const infoCalls = mockedLogger.info.mock.calls.map((c) => String(c[0]));
      const hasWarning = infoCalls.some((msg) => msg.includes("GUARDED/FORBIDDEN"));
      expect(hasWarning).toBe(true);
    });
  });

  // ── handler dispatch integration ─────────────────────────────────────────

  describe("handler dispatch integration", () => {
    const sysctlCompoundCommand =
      "sysctl -w kernel.randomize_va_space=2 && echo 'kernel.randomize_va_space=2' >> /etc/sysctl.conf";

    const handlerCheckPlan = {
      safePlan: {
        groups: [{
          severity: "warning" as const,
          checks: [{
            id: "KERN-RANDOMIZE",
            category: "Kernel",
            name: "ASLR Randomization",
            severity: "warning" as const,
            fixCommand: sysctlCompoundCommand,
          }],
          estimatedImpact: 5,
        }],
      },
      guardedCount: 0,
      forbiddenCount: 0,
      guardedIds: [],
    };

    it("Test HD1: sysctl compound fixCommand executes via handler instead of being rejected", async () => {
      mockedResolveServer.mockResolvedValue(testServer);
      mockedCheckSsh.mockReturnValue(true);

      const auditResult = makeResult([
        makeCategory("Kernel", [
          makeCheck({ id: "KERN-RANDOMIZE", category: "Kernel", passed: false,
            fixCommand: sysctlCompoundCommand, safeToAutoFix: "SAFE" }),
        ]),
      ]);
      mockedRunAudit.mockResolvedValue({ success: true, data: auditResult });
      mockedPreviewSafeFixes.mockReturnValue(handlerCheckPlan);
      mockedPrompt.mockResolvedValue({ confirm: true });
      mockedBackupServer.mockResolvedValue({ success: true, backupPath: "/tmp/backup" } as BackupResult);

      // Handler matches and succeeds — pushes to applied array
      mockedTryHandlerDispatch.mockImplementation(async (_ip, check, applied, _errors) => {
        applied.push(check.id);
        return { handled: true };
      });

      await fixSafeCommand(undefined, { safe: true });

      // Handler was called with the compound command
      expect(mockedTryHandlerDispatch).toHaveBeenCalledWith(
        expect.any(String), expect.objectContaining({ fixCommand: sysctlCompoundCommand }),
        expect.any(Array), expect.any(Array),
      );
      // isFixCommandAllowed NOT called for this check (handler bypasses shell path)
      expect(isFixCommandAllowed).not.toHaveBeenCalledWith(sysctlCompoundCommand);
      // Check was applied (in applied array) — saveFixHistory called with it
      expect(mockedSaveFixHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          checks: expect.arrayContaining(["KERN-RANDOMIZE"]),
          status: "applied",
        }),
      );
    });

    it("Test HD2: unmatched fixCommand falls through to shell path", async () => {
      mockedResolveServer.mockResolvedValue(testServer);
      mockedCheckSsh.mockReturnValue(true);

      const metacharCommand = "rm -rf /tmp/test && echo bad";
      const plan = {
        safePlan: {
          groups: [{
            severity: "warning" as const,
            checks: [{
              id: "TEST-01",
              category: "Kernel",
              name: "Test",
              severity: "warning" as const,
              fixCommand: metacharCommand,
            }],
            estimatedImpact: 3,
          }],
        },
        guardedCount: 0,
        forbiddenCount: 0,
        guardedIds: [],
      };

      const auditResult = makeResult([makeCategory("Kernel", [])]);
      mockedRunAudit.mockResolvedValue({ success: true, data: auditResult });
      mockedPreviewSafeFixes.mockReturnValue(plan);
      mockedPrompt.mockResolvedValue({ confirm: true });
      mockedBackupServer.mockResolvedValue({ success: true, backupPath: "/tmp/backup" } as BackupResult);

      // Handler returns { handled: false } — no match, falls through to shell path
      mockedTryHandlerDispatch.mockResolvedValue({ handled: false });
      // isFixCommandAllowed returns false (metachar)
      (isFixCommandAllowed as jest.MockedFunction<typeof isFixCommandAllowed>).mockReturnValue(false);

      await fixSafeCommand(undefined, { safe: true });

      // isFixCommandAllowed WAS called (shell fallback path)
      expect(isFixCommandAllowed).toHaveBeenCalledWith(metacharCommand);
      // Rejected — appears in errors
      expect(mockedSaveFixHistory).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed" }),
      );
    });

    it("Test HD3: handler failure reports in errors array", async () => {
      mockedResolveServer.mockResolvedValue(testServer);
      mockedCheckSsh.mockReturnValue(true);

      const auditResult = makeResult([makeCategory("Kernel", [])]);
      mockedRunAudit.mockResolvedValue({ success: true, data: auditResult });
      mockedPreviewSafeFixes.mockReturnValue(handlerCheckPlan);
      mockedPrompt.mockResolvedValue({ confirm: true });
      mockedBackupServer.mockResolvedValue({ success: true, backupPath: "/tmp/backup" } as BackupResult);

      // Handler matches but fails — pushes to errors array
      mockedTryHandlerDispatch.mockImplementation(async (_ip, check, _applied, errors) => {
        errors.push(`${check.id}: handler failed — sysctl write failed`);
        return { handled: true };
      });

      await fixSafeCommand(undefined, { safe: true });

      // Error logged with "handler failed" message
      expect(mockedLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("handler failed"),
      );
    });

    it("Test HD4: handler failure with no successful fixes produces status:failed in history (D-09)", async () => {
      mockedResolveServer.mockResolvedValue(testServer);
      mockedCheckSsh.mockReturnValue(true);

      const auditResult = makeResult([makeCategory("Kernel", [])]);
      mockedRunAudit.mockResolvedValue({ success: true, data: auditResult });
      mockedPreviewSafeFixes.mockReturnValue(handlerCheckPlan);
      mockedPrompt.mockResolvedValue({ confirm: true });
      mockedBackupServer.mockResolvedValue({ success: true, backupPath: "/tmp/backup" } as BackupResult);

      // All fixes go through handler path — all fail
      mockedTryHandlerDispatch.mockImplementation(async (_ip, check, _applied, errors) => {
        errors.push(`${check.id}: handler failed — permission denied`);
        return { handled: true };
      });

      await fixSafeCommand(undefined, { safe: true });

      // applied.length === 0 → saveFixHistory called with status:"failed" (D-09)
      expect(mockedSaveFixHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          checks: [],
        }),
      );
    });
  });

  // ── --profile, --diff, --report flag tests ───────────────────────────────

  describe("--profile, --diff, --report flags", () => {
    it("Test PR1: --profile without --safe returns error and no audit", async () => {
      await fixSafeCommand(undefined, { profile: "web-server" });

      expect(mockedLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("--profile requires --safe"),
      );
      expect(mockedRunAudit).not.toHaveBeenCalled();
    });

    it("Test PR2: --report without --safe returns error and no audit", async () => {
      await fixSafeCommand(undefined, { report: true });

      expect(mockedLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("--report requires --safe"),
      );
      expect(mockedRunAudit).not.toHaveBeenCalled();
    });

    it("Test PR3: --profile with invalid name returns error", async () => {
      mockedResolveServer.mockResolvedValue(testServer);
      mockedCheckSsh.mockReturnValue(true);

      const auditResult = makeResult([
        makeCategory("Kernel", [
          makeCheck({ id: "KERN-01", category: "Kernel", severity: "warning", passed: false, fixCommand: "sysctl -w net.ipv4.tcp_syncookies=1", safeToAutoFix: "SAFE" }),
        ]),
      ]);
      mockedRunAudit.mockResolvedValue({ success: true, data: auditResult });
      mockedPreviewSafeFixes.mockReturnValue(defaultSafePlan);

      await fixSafeCommand(undefined, { safe: true, profile: "invalid-profile" });

      expect(mockedLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Unknown profile"),
      );
      expect(mockedBackupServer).not.toHaveBeenCalled();
    });

    it("Test PR4: --diff alone (without --safe) returns usage help only (no apply)", async () => {
      // --diff without --safe triggers the gate check showing usage help
      await fixSafeCommand(undefined, { diff: true });

      // No audit should run — fell through to gate check
      expect(mockedRunAudit).not.toHaveBeenCalled();
      // Usage info shown (gate check output)
      expect(mockedLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("kastell fix --safe"),
      );
    });

    it("Test PR5: --diff with --safe shows diff lines for handler-applied fixes", async () => {
      mockedResolveServer.mockResolvedValue(testServer);
      mockedCheckSsh.mockReturnValue(true);

      const auditResult = makeResult([
        makeCategory("Kernel", [
          makeCheck({ id: "KERN-01", category: "Kernel", severity: "warning", passed: false, fixCommand: "sysctl -w net.ipv4.tcp_syncookies=1", safeToAutoFix: "SAFE" }),
        ]),
      ]);
      mockedRunAudit.mockResolvedValue({ success: true, data: auditResult });
      mockedPreviewSafeFixes.mockReturnValue(defaultSafePlan);
      mockedPrompt.mockResolvedValue({ confirm: true });
      mockedBackupServer.mockResolvedValue({ success: true, backupPath: "/tmp/backup" } as BackupResult);

      const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => { /* noop */ });

      // Handler returns diff info
      mockedTryHandlerDispatch.mockImplementation(async (_ip, check, applied, _errors) => {
        applied.push(check.id);
        return {
          handled: true,
          diff: { handlerType: "sysctl" as const, key: "net.ipv4.tcp_syncookies", before: "0", after: "1" },
        };
      });

      await fixSafeCommand(undefined, { safe: true, diff: true });

      // Should print diff line
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("net.ipv4.tcp_syncookies"),
      );

      consoleSpy.mockRestore();
    });
  });
});
