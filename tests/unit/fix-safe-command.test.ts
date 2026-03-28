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
jest.mock("../../src/core/backup.js");
jest.mock("../../src/utils/logger.js");
jest.mock("../../src/core/audit/fix-history.js");
jest.mock("inquirer");

import { fixSafeCommand } from "../../src/commands/fix.js";
import { resolveServer } from "../../src/utils/serverSelect.js";
import { checkSshAvailable, sshExec } from "../../src/utils/ssh.js";
import { runAudit } from "../../src/core/audit/index.js";
import {
  previewSafeFixes,
  runScoreCheck,
  isFixCommandAllowed,
  collectFixCommands,
} from "../../src/core/audit/fix.js";
import { backupServer } from "../../src/core/backup.js";
import { logger, createSpinner } from "../../src/utils/logger.js";
import {
  loadFixHistory,
  saveFixHistory,
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
const mockedBackupRemoteCleanup = backupRemoteCleanup as jest.MockedFunction<typeof backupRemoteCleanup>;
const mockedCollectFixCommands = collectFixCommands as jest.MockedFunction<typeof collectFixCommands>;

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
  mockedCollectFixCommands.mockReturnValue([
    { checkId: "KERN-01", fixCommand: "sysctl -w net.ipv4.tcp_syncookies=1" },
  ]);
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
        "fix-2026-03-29-001",
        "/root/.kastell/fix-backups/fix-2026-03-29-001",
      );
      expect(mockedSaveFixHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          fixId: "fix-2026-03-29-001-rollback",
          status: "rolled-back",
          serverIp: "1.2.3.4",
        }),
      );
    });

    it("Test R2: --rollback last resolves to last applied fix ID", async () => {
      mockedResolveServer.mockResolvedValue(testServer);
      mockedGetLastFixId.mockReturnValue("fix-2026-03-29-001");
      const entry = makeHistoryEntry({ fixId: "fix-2026-03-29-001", status: "applied" });
      mockedLoadFixHistory.mockReturnValue([entry]);
      mockedCheckSsh.mockReturnValue(true);
      mockedRollbackFix.mockResolvedValue({ restored: ["/etc/sysctl.conf"], errors: [] });
      mockedRunAudit.mockResolvedValue({ success: true, data: makeResult([], 68) });

      await fixSafeCommand(undefined, { rollback: "last" });

      expect(mockedGetLastFixId).toHaveBeenCalledWith("1.2.3.4");
      // Should log that 'last' was resolved
      expect(mockedLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("fix-2026-03-29-001"),
      );
      expect(mockedRollbackFix).toHaveBeenCalled();
    });

    it("Test R3: --rollback last with no applied fixes shows error", async () => {
      mockedResolveServer.mockResolvedValue(testServer);
      mockedGetLastFixId.mockReturnValue(null);

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
});
