/**
 * Tests for src/core/doctor.ts
 * Covers all 7 pure check functions, metrics cache helpers, and runServerDoctor orchestrator.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "fs";
import * as sshUtils from "../../src/utils/ssh";
import * as auditHistory from "../../src/core/audit/history";
import {
  checkDiskTrend,
  checkSwapUsage,
  checkStalePackages,
  checkFail2banBanRate,
  checkAuditRegressionStreak,
  checkBackupAge,
  checkDockerDisk,
  runServerDoctor,
  loadMetricsHistory,
  saveMetricsHistory,
  metricsHistoryPath,
  DoctorSeverity,
} from "../../src/core/doctor";
import type { DoctorFinding, DoctorResult } from "../../src/core/doctor";
import type { MetricSnapshot } from "../../src/types/index";
import type { AuditHistoryEntry } from "../../src/core/audit/types";

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock("fs", () => ({
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  renameSync: jest.fn(),
}));

jest.mock("os", () => ({
  homedir: () => "/home/test",
}));

jest.mock("../../src/utils/ssh");
jest.mock("../../src/core/audit/history");

const mockedSsh = sshUtils as jest.Mocked<typeof sshUtils>;
const mockedHistory = auditHistory as jest.Mocked<typeof auditHistory>;
const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockedReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;
const mockedWriteFileSync = writeFileSync as jest.MockedFunction<typeof writeFileSync>;
const mockedRenameSync = renameSync as jest.MockedFunction<typeof renameSync>;

const VALID_IP = "1.2.3.4";
const SERVER_NAME = "my-server";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSnapshot(diskPct: number, hoursAgo: number): MetricSnapshot {
  const ts = new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
  return { timestamp: ts, diskPct, ramPct: 50, cpuLoad1: 1, ncpu: 2, auditScore: 80 };
}

function makeHistoryEntry(score: number, daysAgo: number): AuditHistoryEntry {
  const ts = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  return {
    serverIp: VALID_IP,
    serverName: SERVER_NAME,
    timestamp: ts,
    overallScore: score,
    categoryScores: { SSH: score },
  };
}

// ─── checkDiskTrend ───────────────────────────────────────────────────────────

describe("checkDiskTrend", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("returns null with 0 snapshots", () => {
    expect(checkDiskTrend([], SERVER_NAME)).toBeNull();
  });

  it("returns null with 1 snapshot", () => {
    expect(checkDiskTrend([makeSnapshot(50, 24)], SERVER_NAME)).toBeNull();
  });

  it("returns null when slope <= 0 (disk shrinking)", () => {
    const snapshots = [makeSnapshot(60, 48), makeSnapshot(50, 0)];
    expect(checkDiskTrend(snapshots, SERVER_NAME)).toBeNull();
  });

  it("returns null when slope = 0 (disk flat)", () => {
    const snapshots = [makeSnapshot(50, 48), makeSnapshot(50, 0)];
    expect(checkDiskTrend(snapshots, SERVER_NAME)).toBeNull();
  });

  it("returns null when projected > 30 days", () => {
    // Very slow growth — disk at 10%, increasing just 1% over 48h → 0.5%/day → reaches 95% in 170 days
    const snapshots = [makeSnapshot(10, 48), makeSnapshot(11, 0)];
    const result = checkDiskTrend(snapshots, SERVER_NAME);
    expect(result).toBeNull();
  });

  it("returns critical when projected < 3 days", () => {
    // disk at 85%, increasing 5% over 24h → slope 5/24 pct/h → hoursToFull = (95-90)/slope ~24h
    const snapshots = [makeSnapshot(85, 24), makeSnapshot(90, 0)];
    const result = checkDiskTrend(snapshots, SERVER_NAME);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("critical");
    expect(result!.id).toBe("DISK_TREND");
  });

  it("returns warning when projected 3-14 days", () => {
    // disk at 60%, increasing 5% over 24h → slope 5/24 pct/h → hoursToFull = (95-65)/slope = 6*24 = 144h = 6 days
    const snapshots = [makeSnapshot(60, 24), makeSnapshot(65, 0)];
    const result = checkDiskTrend(snapshots, SERVER_NAME);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("warning");
  });

  it("returns info when projected 14-30 days", () => {
    // disk at 75%, increasing 1% over 24h → slope 1/24 pct/h → hoursToFull = (95-76)/slope = 19*24 = 456h = 19 days
    const snapshots = [makeSnapshot(75, 24), makeSnapshot(76, 0)];
    const result = checkDiskTrend(snapshots, SERVER_NAME);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("info");
  });

  it("returns finding with id, severity, description, command", () => {
    const snapshots = [makeSnapshot(85, 24), makeSnapshot(90, 0)];
    const result = checkDiskTrend(snapshots, SERVER_NAME);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("DISK_TREND");
    expect(result!.severity).toBeDefined();
    expect(result!.description).toBeTruthy();
    expect(result!.command).toContain("df -h /");
    expect(result!.command).toContain(SERVER_NAME);
  });

  it("description includes projected days", () => {
    const snapshots = [makeSnapshot(85, 24), makeSnapshot(90, 0)];
    const result = checkDiskTrend(snapshots, SERVER_NAME);
    expect(result!.description).toMatch(/\d+\s*day/i);
  });
});

// ─── checkSwapUsage ───────────────────────────────────────────────────────────

describe("checkSwapUsage", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("returns null for empty output", () => {
    expect(checkSwapUsage("")).toBeNull();
  });

  it("returns null for whitespace-only output", () => {
    expect(checkSwapUsage("   ")).toBeNull();
  });

  it("returns null when swap usage <= 50%", () => {
    expect(checkSwapUsage("50")).toBeNull();
    expect(checkSwapUsage("30")).toBeNull();
    expect(checkSwapUsage("0")).toBeNull();
  });

  it("returns warning when swap > 50% and <= 80%", () => {
    const result = checkSwapUsage("75");
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("warning");
    expect(result!.id).toBe("HIGH_SWAP");
  });

  it("returns critical when swap > 80%", () => {
    const result = checkSwapUsage("85");
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("critical");
  });

  it("returns finding with id, severity, description, command", () => {
    const result = checkSwapUsage("75");
    expect(result!.id).toBe("HIGH_SWAP");
    expect(result!.severity).toBeDefined();
    expect(result!.description).toBeTruthy();
    expect(result!.command).toBe("free -h");
  });

  it("returns null for non-numeric output (error)", () => {
    expect(checkSwapUsage("error: no swap")).toBeNull();
  });
});

// ─── checkStalePackages ───────────────────────────────────────────────────────

describe("checkStalePackages", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("returns null for empty output", () => {
    expect(checkStalePackages("")).toBeNull();
  });

  it("returns null when <= 10 upgradable packages (subtract header line)", () => {
    // 11 lines = header + 10 packages = 10 upgradable → no finding
    const lines = ["Listing..."].concat(Array(10).fill("pkg/focal 1.0 amd64"));
    expect(checkStalePackages(lines.join("\n"))).toBeNull();
  });

  it("returns warning when > 10 and <= 50 upgradable packages", () => {
    // 12 lines = header + 11 packages = 11 upgradable → warning
    const lines = ["Listing..."].concat(Array(11).fill("pkg/focal 1.0 amd64"));
    const result = checkStalePackages(lines.join("\n"));
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("warning");
    expect(result!.id).toBe("STALE_PACKAGES");
  });

  it("returns critical when > 50 upgradable packages", () => {
    // 52 lines = header + 51 packages = 51 upgradable → critical
    const lines = ["Listing..."].concat(Array(51).fill("pkg/focal 1.0 amd64"));
    const result = checkStalePackages(lines.join("\n"));
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("critical");
  });

  it("returns finding with id, severity, description, command", () => {
    const lines = ["Listing..."].concat(Array(15).fill("pkg/focal 1.0 amd64"));
    const result = checkStalePackages(lines.join("\n"));
    expect(result!.id).toBe("STALE_PACKAGES");
    expect(result!.severity).toBeDefined();
    expect(result!.description).toBeTruthy();
    expect(result!.command).toContain("apt");
  });
});

// ─── checkFail2banBanRate ─────────────────────────────────────────────────────

describe("checkFail2banBanRate", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("returns null for empty output", () => {
    expect(checkFail2banBanRate("")).toBeNull();
  });

  it("returns null for whitespace-only output", () => {
    expect(checkFail2banBanRate("  \n  ")).toBeNull();
  });

  it("returns null when total bans <= 100", () => {
    expect(checkFail2banBanRate("100")).toBeNull();
    expect(checkFail2banBanRate("50")).toBeNull();
    expect(checkFail2banBanRate("0")).toBeNull();
  });

  it("returns warning when total bans > 100", () => {
    const result = checkFail2banBanRate("150");
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("warning");
    expect(result!.id).toBe("HIGH_BAN_RATE");
  });

  it("returns finding with id, severity, description, command", () => {
    const result = checkFail2banBanRate("200");
    expect(result!.id).toBe("HIGH_BAN_RATE");
    expect(result!.severity).toBeDefined();
    expect(result!.description).toBeTruthy();
    expect(result!.command).toContain("fail2ban");
  });

  it("returns null for non-numeric output (fail2ban not present)", () => {
    expect(checkFail2banBanRate("command not found")).toBeNull();
  });
});

// ─── checkAuditRegressionStreak ───────────────────────────────────────────────

describe("checkAuditRegressionStreak", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("returns null with 0 entries", () => {
    expect(checkAuditRegressionStreak([], SERVER_NAME)).toBeNull();
  });

  it("returns null with 1 entry", () => {
    expect(checkAuditRegressionStreak([makeHistoryEntry(80, 0)], SERVER_NAME)).toBeNull();
  });

  it("returns null when scores are non-decreasing", () => {
    const history = [
      makeHistoryEntry(70, 4),
      makeHistoryEntry(75, 3),
      makeHistoryEntry(80, 2),
      makeHistoryEntry(80, 1),
    ];
    expect(checkAuditRegressionStreak(history, SERVER_NAME)).toBeNull();
  });

  it("returns null with single decline (no streak)", () => {
    const history = [
      makeHistoryEntry(80, 2),
      makeHistoryEntry(75, 1),
      makeHistoryEntry(78, 0),
    ];
    expect(checkAuditRegressionStreak(history, SERVER_NAME)).toBeNull();
  });

  it("returns warning with 2 consecutive declines", () => {
    const history = [
      makeHistoryEntry(80, 3),
      makeHistoryEntry(75, 2),
      makeHistoryEntry(70, 1),
    ];
    const result = checkAuditRegressionStreak(history, SERVER_NAME);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("warning");
    expect(result!.id).toBe("AUDIT_REGRESSION");
  });

  it("returns finding with id, severity, description, command", () => {
    const history = [
      makeHistoryEntry(80, 3),
      makeHistoryEntry(75, 2),
      makeHistoryEntry(70, 1),
    ];
    const result = checkAuditRegressionStreak(history, SERVER_NAME);
    expect(result!.id).toBe("AUDIT_REGRESSION");
    expect(result!.severity).toBeDefined();
    expect(result!.description).toBeTruthy();
    expect(result!.command).toContain(SERVER_NAME);
  });
});

// ─── checkBackupAge ───────────────────────────────────────────────────────────

describe("checkBackupAge", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("returns null for empty output", () => {
    expect(checkBackupAge("", SERVER_NAME)).toBeNull();
  });

  it("returns null for whitespace-only output", () => {
    expect(checkBackupAge("   ", SERVER_NAME)).toBeNull();
  });

  it("returns null when backup is within 7 days", () => {
    const recentTs = new Date(Date.now() - 3 * 86_400_000).toISOString();
    expect(checkBackupAge(recentTs, SERVER_NAME)).toBeNull();
  });

  it("returns warning when last backup 7-30 days old", () => {
    const oldTs = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const result = checkBackupAge(oldTs, SERVER_NAME);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("warning");
    expect(result!.id).toBe("OLD_BACKUP");
  });

  it("returns critical when last backup > 30 days old", () => {
    const veryOldTs = new Date(Date.now() - 35 * 86_400_000).toISOString();
    const result = checkBackupAge(veryOldTs, SERVER_NAME);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("critical");
  });

  it("returns finding with id, severity, description, command", () => {
    const oldTs = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const result = checkBackupAge(oldTs, SERVER_NAME);
    expect(result!.id).toBe("OLD_BACKUP");
    expect(result!.severity).toBeDefined();
    expect(result!.description).toBeTruthy();
    expect(result!.command).toContain(SERVER_NAME);
  });

  it("returns null for unparseable timestamp", () => {
    expect(checkBackupAge("not-a-date", SERVER_NAME)).toBeNull();
  });
});

// ─── checkDockerDisk ──────────────────────────────────────────────────────────

describe("checkDockerDisk", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("returns null for empty output", () => {
    expect(checkDockerDisk("")).toBeNull();
  });

  it("returns null for whitespace-only output (docker not present)", () => {
    expect(checkDockerDisk("   ")).toBeNull();
  });

  it("returns null when reclaimable < 5GB", () => {
    // docker system df --format '{{json .}}' returns lines of JSON objects
    const lines = [
      JSON.stringify({ Type: "Images", Reclaimable: "2GB (10%)" }),
      JSON.stringify({ Type: "Containers", Reclaimable: "100MB (5%)" }),
    ];
    expect(checkDockerDisk(lines.join("\n"))).toBeNull();
  });

  it("returns warning when reclaimable > 5GB and <= 20GB", () => {
    const lines = [
      JSON.stringify({ Type: "Images", Reclaimable: "8GB (30%)" }),
      JSON.stringify({ Type: "Containers", Reclaimable: "500MB (5%)" }),
    ];
    const result = checkDockerDisk(lines.join("\n"));
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("warning");
    expect(result!.id).toBe("DOCKER_DISK");
  });

  it("returns critical when reclaimable > 20GB", () => {
    const lines = [
      JSON.stringify({ Type: "Images", Reclaimable: "25GB (50%)" }),
    ];
    const result = checkDockerDisk(lines.join("\n"));
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("critical");
  });

  it("returns finding with id, severity, description, command", () => {
    const lines = [JSON.stringify({ Type: "Images", Reclaimable: "10GB (40%)" })];
    const result = checkDockerDisk(lines.join("\n"));
    expect(result!.id).toBe("DOCKER_DISK");
    expect(result!.severity).toBeDefined();
    expect(result!.description).toBeTruthy();
    expect(result!.command).toContain("docker");
  });

  it("handles output with MB and KB gracefully (below threshold)", () => {
    const lines = [
      JSON.stringify({ Type: "Images", Reclaimable: "500MB (10%)" }),
      JSON.stringify({ Type: "Build Cache", Reclaimable: "200KB (1%)" }),
    ];
    expect(checkDockerDisk(lines.join("\n"))).toBeNull();
  });

  it("handles lines with 0B reclaimable", () => {
    const lines = [
      JSON.stringify({ Type: "Images", Reclaimable: "0B (0%)" }),
    ];
    expect(checkDockerDisk(lines.join("\n"))).toBeNull();
  });
});

// ─── DoctorFinding shape invariant ────────────────────────────────────────────

describe("DoctorFinding shape invariant", () => {
  it("every returned finding has non-empty id, severity, description, command", () => {
    const findings: (DoctorFinding | null)[] = [
      checkDiskTrend([makeSnapshot(85, 24), makeSnapshot(90, 0)], SERVER_NAME),
      checkSwapUsage("75"),
      checkStalePackages(["Listing..."].concat(Array(15).fill("pkg")).join("\n")),
      checkFail2banBanRate("200"),
      checkAuditRegressionStreak(
        [makeHistoryEntry(80, 3), makeHistoryEntry(75, 2), makeHistoryEntry(70, 1)],
        SERVER_NAME,
      ),
      checkBackupAge(new Date(Date.now() - 10 * 86_400_000).toISOString(), SERVER_NAME),
      checkDockerDisk(JSON.stringify({ Type: "Images", Reclaimable: "10GB (40%)" })),
    ];

    for (const finding of findings) {
      expect(finding).not.toBeNull();
      expect(finding!.id).toBeTruthy();
      expect(finding!.severity).toBeTruthy();
      expect(finding!.description).toBeTruthy();
      expect(finding!.command).toBeTruthy();
    }
  });
});

// ─── runServerDoctor orchestrator ─────────────────────────────────────────────

describe("runServerDoctor", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedExistsSync.mockReturnValue(false);
    mockedHistory.loadAuditHistory.mockReturnValue([]);
  });

  it("returns failure when IP is invalid", async () => {
    mockedSsh.assertValidIp.mockImplementation(() => {
      throw new Error("Invalid IP");
    });

    const result = await runServerDoctor("not-an-ip", SERVER_NAME, {});
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("cached mode (fresh=false): returns success without SSH calls", async () => {
    mockedSsh.assertValidIp.mockImplementation(() => undefined);

    const result = await runServerDoctor(VALID_IP, SERVER_NAME, { fresh: false });
    expect(result.success).toBe(true);
    expect(mockedSsh.sshExec).not.toHaveBeenCalled();
    expect(result.data).toBeDefined();
    expect(result.data!.usedFreshData).toBe(false);
  });

  it("fresh mode: SSHes and appends snapshot to cache", async () => {
    mockedSsh.assertValidIp.mockImplementation(() => undefined);

    const fakeSnapshot: MetricSnapshot = {
      timestamp: new Date().toISOString(),
      diskPct: 50,
      ramPct: 40,
      cpuLoad1: 1,
      ncpu: 2,
      auditScore: 85,
    };

    // SSH calls in order: metrics.json, swap, apt, fail2ban, backup log, docker
    mockedSsh.sshExec
      .mockResolvedValueOnce({ code: 0, stdout: JSON.stringify(fakeSnapshot), stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "30", stderr: "" }) // swap
      .mockResolvedValueOnce({ code: 0, stdout: "Listing...\n", stderr: "" }) // apt
      .mockResolvedValueOnce({ code: 0, stdout: "0", stderr: "" }) // fail2ban
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // backup log
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // docker

    const result = await runServerDoctor(VALID_IP, SERVER_NAME, { fresh: true });
    expect(result.success).toBe(true);
    expect(result.data!.usedFreshData).toBe(true);
    expect(mockedSsh.sshExec).toHaveBeenCalled();
    expect(mockedWriteFileSync).toHaveBeenCalled();
    expect(mockedRenameSync).toHaveBeenCalled();
  });

  it("returns DoctorResult with serverName, serverIp, findings, ranAt, usedFreshData", async () => {
    mockedSsh.assertValidIp.mockImplementation(() => undefined);

    const result = await runServerDoctor(VALID_IP, SERVER_NAME, {});
    expect(result.success).toBe(true);
    const data = result.data!;
    expect(data.serverName).toBe(SERVER_NAME);
    expect(data.serverIp).toBe(VALID_IP);
    expect(Array.isArray(data.findings)).toBe(true);
    expect(data.ranAt).toBeTruthy();
    expect(typeof data.usedFreshData).toBe("boolean");
  });

  it("findings are sorted: critical first, then warning, then info", async () => {
    mockedSsh.assertValidIp.mockImplementation(() => undefined);

    // Put critical-generating data in history cache to trigger findings
    const snapshots: MetricSnapshot[] = [
      makeSnapshot(85, 24),
      makeSnapshot(90, 0),
    ];
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(JSON.stringify(snapshots));

    const history = [
      makeHistoryEntry(80, 3),
      makeHistoryEntry(75, 2),
      makeHistoryEntry(70, 1),
    ];
    mockedHistory.loadAuditHistory.mockReturnValue(history);

    const result = await runServerDoctor(VALID_IP, SERVER_NAME, { fresh: false });
    expect(result.success).toBe(true);

    const findings = result.data!.findings;
    if (findings.length >= 2) {
      const severityOrder = { critical: 0, warning: 1, info: 2 };
      for (let i = 0; i < findings.length - 1; i++) {
        expect(severityOrder[findings[i].severity]).toBeLessThanOrEqual(
          severityOrder[findings[i + 1].severity],
        );
      }
    }
  });

  it("fresh mode: SSH error on metrics fetch is handled gracefully", async () => {
    mockedSsh.assertValidIp.mockImplementation(() => undefined);

    mockedSsh.sshExec
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "file not found" }) // metrics.json error
      .mockResolvedValueOnce({ code: 0, stdout: "30", stderr: "" }) // swap
      .mockResolvedValueOnce({ code: 0, stdout: "Listing...\n", stderr: "" }) // apt
      .mockResolvedValueOnce({ code: 0, stdout: "0", stderr: "" }) // fail2ban
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // backup log
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // docker

    const result = await runServerDoctor(VALID_IP, SERVER_NAME, { fresh: true });
    expect(result.success).toBe(true);
  });

  it("loadMetricsHistory returns empty array when file missing", async () => {
    mockedSsh.assertValidIp.mockImplementation(() => undefined);
    mockedExistsSync.mockReturnValue(false);

    const result = await runServerDoctor(VALID_IP, SERVER_NAME, { fresh: false });
    expect(result.success).toBe(true);
    // checkDiskTrend should return null (< 2 snapshots) → 0 disk trend findings
    const diskFindings = result.data!.findings.filter((f) => f.id === "DISK_TREND");
    expect(diskFindings.length).toBe(0);
  });

  it("loadMetricsHistory returns empty array on corrupt file", async () => {
    mockedSsh.assertValidIp.mockImplementation(() => undefined);
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("not-valid-json");

    const result = await runServerDoctor(VALID_IP, SERVER_NAME, { fresh: false });
    expect(result.success).toBe(true);
    const diskFindings = result.data!.findings.filter((f) => f.id === "DISK_TREND");
    expect(diskFindings.length).toBe(0);
  });
});

// ─── Mutation-Killer: loadMetricsHistory / saveMetricsHistory / metricsHistoryPath ───

describe("loadMetricsHistory mutation-killer", () => {
  const IP = "10.0.0.1";

  beforeEach(() => jest.resetAllMocks());

  it("returns [] (not undefined/null) when file does not exist", () => {
    mockedExistsSync.mockReturnValue(false);
    const result = loadMetricsHistory(IP);
    expect(result).toEqual([]);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  it("returns [] when file has non-array JSON (object)", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('{"key":"value"}');
    const result = loadMetricsHistory(IP);
    expect(result).toEqual([]);
    expect(Array.isArray(result)).toBe(true);
  });

  it("returns [] when file has non-array JSON (string)", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('"hello"');
    const result = loadMetricsHistory(IP);
    expect(result).toEqual([]);
  });

  it("returns [] when file has non-array JSON (number)", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("42");
    const result = loadMetricsHistory(IP);
    expect(result).toEqual([]);
  });

  it("returns [] when file has null", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("null");
    const result = loadMetricsHistory(IP);
    expect(result).toEqual([]);
  });

  it("returns [] when readFileSync throws", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockImplementation(() => { throw new Error("EACCES"); });
    const result = loadMetricsHistory(IP);
    expect(result).toEqual([]);
  });

  it("returns parsed array when file has valid array", () => {
    mockedExistsSync.mockReturnValue(true);
    const snapshots = [{ ts: "2026-01-01", disk: 50 }];
    mockedReadFileSync.mockReturnValue(JSON.stringify(snapshots));
    const result = loadMetricsHistory(IP);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ ts: "2026-01-01", disk: 50 });
  });

  it("returns array with multiple items", () => {
    mockedExistsSync.mockReturnValue(true);
    const snapshots = [{ ts: "a" }, { ts: "b" }, { ts: "c" }];
    mockedReadFileSync.mockReturnValue(JSON.stringify(snapshots));
    const result = loadMetricsHistory(IP);
    expect(result).toHaveLength(3);
  });
});

describe("metricsHistoryPath mutation-killer", () => {
  it("replaces dots with dashes in IP", () => {
    const path = metricsHistoryPath("10.0.0.1");
    expect(path).toContain("10-0-0-1");
    expect(path).not.toContain("10.0.0.1");
  });

  it("includes doctor-metrics prefix", () => {
    const path = metricsHistoryPath("1.2.3.4");
    expect(path).toContain("doctor-metrics-");
  });

  it("ends with .json", () => {
    const path = metricsHistoryPath("1.2.3.4");
    expect(path).toMatch(/\.json$/);
  });
});

describe("saveMetricsHistory mutation-killer", () => {
  const IP = "10.0.0.1";

  beforeEach(() => jest.resetAllMocks());

  it("writes atomically (tmp file then rename)", () => {
    mockedExistsSync.mockReturnValue(true);
    const snap: MetricSnapshot = { timestamp: "2026-01-01T00:00:00Z", diskPct: 50, ramPct: 40, cpuLoad1: 1, ncpu: 2, auditScore: 80 };
    saveMetricsHistory(IP, [snap]);
    expect(writeFileSync).toHaveBeenCalled();
    expect(renameSync).toHaveBeenCalled();
    // writeFileSync should write to .tmp path
    const writePath = (writeFileSync as jest.Mock).mock.calls[0][0] as string;
    expect(writePath).toContain(".tmp");
    // renameSync should move .tmp to final path
    const [from, to] = (renameSync as jest.Mock).mock.calls[0];
    expect(from).toContain(".tmp");
    expect(to).not.toContain(".tmp");
  });

  it("creates directory if it doesn't exist", () => {
    mockedExistsSync.mockReturnValue(false);
    saveMetricsHistory(IP, []);
    expect(mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
  });

  it("writes JSON with 2-space indent", () => {
    mockedExistsSync.mockReturnValue(true);
    const snap: MetricSnapshot = { timestamp: "2026-01-01T00:00:00Z", diskPct: 50, ramPct: 40, cpuLoad1: 1, ncpu: 2, auditScore: 80 };
    saveMetricsHistory(IP, [snap]);
    const content = (writeFileSync as jest.Mock).mock.calls[0][1] as string;
    expect(content).toContain("\n  ");
  });
});
