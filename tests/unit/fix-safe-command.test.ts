/**
 * Tests for the `kastell fix --safe` command (src/commands/fix.ts).
 * Covers: gate check, dry-run, backup abort, SAFE-only execution, score delta, edge cases.
 */

import type { AuditResult, AuditCategory, AuditCheck } from "../../src/core/audit/types.js";
import type { BackupResult } from "../../src/core/backup.js";

jest.mock("../../src/utils/serverSelect.js");
jest.mock("../../src/utils/ssh.js");
jest.mock("../../src/core/audit/index.js");
jest.mock("../../src/core/audit/fix.js");
jest.mock("../../src/core/backup.js");
jest.mock("../../src/utils/logger.js");
jest.mock("inquirer");

import { fixSafeCommand } from "../../src/commands/fix.js";
import { resolveServer } from "../../src/utils/serverSelect.js";
import { checkSshAvailable, sshExec } from "../../src/utils/ssh.js";
import { runAudit } from "../../src/core/audit/index.js";
import { previewSafeFixes, runScoreCheck, isFixCommandAllowed } from "../../src/core/audit/fix.js";
import { backupServer } from "../../src/core/backup.js";
import { logger, createSpinner } from "../../src/utils/logger.js";
import inquirer from "inquirer";

const mockedResolveServer = resolveServer as jest.MockedFunction<typeof resolveServer>;
const mockedCheckSsh = checkSshAvailable as jest.MockedFunction<typeof checkSshAvailable>;
const mockedSshExec = sshExec as jest.MockedFunction<typeof sshExec>;
const mockedRunAudit = runAudit as jest.MockedFunction<typeof runAudit>;
const mockedPreviewSafeFixes = previewSafeFixes as jest.MockedFunction<typeof previewSafeFixes>;
const mockedRunScoreCheck = runScoreCheck as jest.MockedFunction<typeof runScoreCheck>;
const mockedBackupServer = backupServer as jest.MockedFunction<typeof backupServer>;
const mockedPrompt = inquirer.prompt as jest.MockedFunction<typeof inquirer.prompt>;
const mockedLogger = logger as jest.Mocked<typeof logger>;

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
      guardedCount: 0,
      forbiddenCount: 0,
      guardedIds: [],
    });
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
      guardedCount: 0,
      forbiddenCount: 0,
      guardedIds: [],
    });
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
      guardedCount: 0,
      forbiddenCount: 0,
      guardedIds: [],
    });
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
});
