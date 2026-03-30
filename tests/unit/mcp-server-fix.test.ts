/**
 * MCP server_fix handler unit tests (FIX-07 + FIX-08 scenarios)
 *
 * Covers:
 *   - Empty server list error path
 *   - dryRun:true default (no backup, no SSH)
 *   - SAFE_MODE forces dryRun even when dryRun:false passed
 *   - FORBIDDEN check ID rejection (TypeScript enforcement, FIX-08)
 *   - Non-existent check ID rejection
 *   - checks + category AND filter
 *   - Empty SAFE plan after filter early exit
 *   - Backup failure hard-abort
 *   - Live fix success (backup called, SSH called, scoreAfter populated)
 */

// ─── Module mocks (hoisted by Jest) ─────────────────────────────────────────

jest.mock("../../src/utils/config");
jest.mock("../../src/core/audit/index");
jest.mock("../../src/core/audit/fix");
jest.mock("../../src/core/audit/fix-history");
jest.mock("../../src/core/audit/scoring");
jest.mock("../../src/core/backup");
jest.mock("../../src/core/manage");
jest.mock("../../src/utils/ssh");
jest.mock("../../src/core/audit/handlers/index");
jest.mock("../../src/utils/errorMapper", () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import * as config from "../../src/utils/config";
import * as auditIndex from "../../src/core/audit/index";
import * as fix from "../../src/core/audit/fix";
import * as fixHistory from "../../src/core/audit/fix-history";
import * as scoring from "../../src/core/audit/scoring";
import * as backup from "../../src/core/backup";
import * as manage from "../../src/core/manage";
import * as ssh from "../../src/utils/ssh";
import * as handlers from "../../src/core/audit/handlers/index";
import { handleServerFix } from "../../src/mcp/tools/serverFix";
import type { FixHistoryEntry } from "../../src/core/audit/types";

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedAudit = auditIndex as jest.Mocked<typeof auditIndex>;
const mockedFix = fix as jest.Mocked<typeof fix>;
const mockedFixHistory = fixHistory as jest.Mocked<typeof fixHistory>;
const mockedScoring = scoring as jest.Mocked<typeof scoring>;
const mockedBackup = backup as jest.Mocked<typeof backup>;
const mockedManage = manage as jest.Mocked<typeof manage>;
const mockedSsh = ssh as jest.Mocked<typeof ssh>;
const mockedHandlers = handlers as jest.Mocked<typeof handlers>;

// ─── Test fixtures ────────────────────────────────────────────────────────────

const sampleServer = {
  id: "s1",
  name: "test-srv",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00Z",
};

type CheckOpts = {
  passed?: boolean;
  fixCommand?: string;
  safeToAutoFix?: "SAFE" | "GUARDED" | "FORBIDDEN";
  severity?: "critical" | "warning" | "info";
};

const makeCheck = (
  id: string,
  category: string,
  opts: CheckOpts = {},
) => ({
  id,
  category,
  name: `Check ${id}`,
  severity: opts.severity ?? ("warning" as const),
  passed: opts.passed ?? false,
  currentValue: "bad",
  expectedValue: "good",
  fixCommand: opts.fixCommand ?? `sysctl -w test.${id.toLowerCase()}=1`,
  safeToAutoFix: opts.safeToAutoFix ?? ("SAFE" as const),
});

type SimpleCheck = ReturnType<typeof makeCheck>;

const makeAuditResult = (
  categories: Array<{ name: string; checks: SimpleCheck[] }>,
) => ({
  serverName: "test-srv",
  serverIp: "1.2.3.4",
  platform: "bare" as const,
  timestamp: "2026-01-01T00:00:00Z",
  auditVersion: "1.14.0",
  categories: categories.map((c) => ({ ...c, score: 50, maxScore: 100 })),
  overallScore: 65,
  quickWins: [],
});

/** A FixCheck object matching src/core/audit/fix.ts interface */
const makeFixCheck = (
  id: string,
  category: string,
  severity: "critical" | "warning" | "info" = "warning",
) => ({
  id,
  category,
  name: `Check ${id}`,
  severity,
  fixCommand: `sysctl -w test.${id.toLowerCase()}=1`,
  estimatedImpact: 5,
});

// Default audit result with Kernel (SAFE checks) + SSH (FORBIDDEN check)
const defaultAuditResult = makeAuditResult([
  {
    name: "Kernel",
    checks: [
      makeCheck("KERN-SYNCOOKIES", "Kernel", { safeToAutoFix: "SAFE" }),
      makeCheck("KERN-RANDOMIZE", "Kernel", { safeToAutoFix: "SAFE" }),
    ],
  },
  {
    name: "SSH",
    checks: [
      makeCheck("SSH-PERMIT-ROOT", "SSH", { safeToAutoFix: "FORBIDDEN" }),
    ],
  },
]);

// Default safe plan returned by previewSafeFixes mock
const defaultSafePlan = {
  safePlan: {
    groups: [
      {
        severity: "warning" as const,
        checks: [
          makeFixCheck("KERN-SYNCOOKIES", "Kernel"),
          makeFixCheck("KERN-RANDOMIZE", "Kernel"),
        ],
        estimatedImpact: 5,
      },
    ],
  },
  guardedCount: 0,
  forbiddenCount: 1,
  guardedIds: [],
};

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.resetAllMocks();

  mockedConfig.getServers.mockReturnValue([sampleServer] as never);
  // findServer is used by resolveServerForMcp when there is 1 server
  (mockedConfig as jest.Mocked<typeof config> & { findServer?: jest.Mock }).findServer?.mockReturnValue(sampleServer as never);

  mockedManage.isSafeMode.mockReturnValue(false);

  mockedAudit.runAudit.mockResolvedValue({
    success: true,
    data: defaultAuditResult as never,
  });

  mockedFix.previewSafeFixes.mockReturnValue(defaultSafePlan as never);

  mockedFix.resolveTier.mockImplementation(
    (check: { safeToAutoFix?: string }, catName: string) => {
      if (catName === "SSH" || catName === "Firewall" || catName === "Docker")
        return "FORBIDDEN";
      return (check.safeToAutoFix as "SAFE" | "GUARDED" | "FORBIDDEN") ?? "GUARDED";
    },
  );

  mockedFix.isFixCommandAllowed.mockReturnValue(true);

  mockedBackup.backupServer.mockResolvedValue({
    success: true,
    backupPath: "/tmp/backup",
  });

  mockedSsh.sshExec.mockResolvedValue({ stdout: "", stderr: "", code: 0 });

  mockedFix.runScoreCheck.mockResolvedValue(72);

  // Default fix-history mocks
  mockedFixHistory.loadFixHistory.mockReturnValue([]);
  mockedFixHistory.saveFixHistory.mockResolvedValue(undefined);
  mockedFixHistory.generateFixId.mockReturnValue("fix-2026-03-29-001");
  mockedFixHistory.getLastFixId.mockReturnValue(null);
  mockedFixHistory.backupFilesBeforeFix.mockResolvedValue(
    "/root/.kastell/fix-backups/fix-2026-03-29-001",
  );
  mockedFixHistory.rollbackFix.mockResolvedValue({ restored: [], errors: [] });
  mockedFixHistory.saveRollbackEntry.mockResolvedValue(undefined);
  mockedFixHistory.backupRemoteCleanup.mockResolvedValue(undefined);
  mockedFix.fixCommandsFromChecks.mockReturnValue([
    { checkId: "KERN-SYNCOOKIES", fixCommand: "sysctl -w net.ipv4.tcp_syncookies=1" },
  ]);

  // Default prioritization mocks — pass checks through with impact=5
  mockedScoring.buildImpactContext.mockReturnValue({
    catWeightMap: new Map(),
    totalOverallWeight: 100,
  } as never);
  mockedFix.sortChecksByImpact.mockImplementation((checks) =>
    checks.map((c) => ({ ...c, impact: 5 })),
  );
  mockedFix.selectChecksForTop.mockImplementation((sorted, n) => sorted.slice(0, n));
  mockedFix.selectChecksForTarget.mockImplementation((sorted) => sorted);

  // Default handler mock — return { handled: false } (no match) so existing tests use shell path
  mockedHandlers.tryHandlerDispatch.mockResolvedValue({ handled: false });
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("MCP server_fix tool", () => {
  // ── Server resolution ────────────────────────────────────────────────────

  describe("server resolution", () => {
    it("returns mcpError when no servers configured", async () => {
      mockedConfig.getServers.mockReturnValue([]);

      const result = await handleServerFix({});

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(parsed.error).toContain("No servers found");
    });

    it("returns mcpError with server name when specified server not found", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedConfig.findServer.mockReturnValue(undefined);
      const result = await handleServerFix({ server: "nonexistent" });

      expect(result.isError).toBe(true);
      const text = result.content[0].text;
      expect(text).toContain("not found");
    });

    it("returns mcpError when multiple servers and no server specified", async () => {
      mockedConfig.getServers.mockReturnValue([
        sampleServer,
        { ...sampleServer, id: "s2", name: "srv-2", ip: "5.6.7.8" },
      ] as never);
      const result = await handleServerFix({});

      expect(result.isError).toBe(true);
      const text = result.content[0].text;
      expect(text).toContain("Multiple");
    });
  });

  // ── dryRun default ───────────────────────────────────────────────────────

  describe("dryRun default", () => {
    it("defaults to dryRun:true — returns preview, no backup or SSH called", async () => {
      const result = await handleServerFix({});

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(parsed.dryRun).toBe(true);
      expect(parsed.preview).toBeDefined();
      expect(mockedBackup.backupServer).not.toHaveBeenCalled();
      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
    });

    it("SAFE_MODE=true forces dryRun even when dryRun:false passed", async () => {
      mockedManage.isSafeMode.mockReturnValue(true);

      const result = await handleServerFix({ dryRun: false });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(parsed.safeModeForcedDryRun).toBe(true);
      expect(mockedBackup.backupServer).not.toHaveBeenCalled();
    });

    it("dryRun:true explicitly also returns preview without backup", async () => {
      const result = await handleServerFix({ dryRun: true });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(parsed.dryRun).toBe(true);
      expect(mockedBackup.backupServer).not.toHaveBeenCalled();
    });
  });

  // ── FORBIDDEN rejection (FIX-08) ─────────────────────────────────────────

  describe("FORBIDDEN rejection (FIX-08)", () => {
    it("rejects FORBIDDEN check IDs with reason containing FORBIDDEN", async () => {
      const result = await handleServerFix({ checks: ["SSH-PERMIT-ROOT"] });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text) as Record<
        string,
        unknown
      >;
      const rejected = parsed.rejectedChecks as Array<{
        id: string;
        reason: string;
      }>;
      expect(rejected).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "SSH-PERMIT-ROOT",
            reason: expect.stringContaining("FORBIDDEN"),
          }),
        ]),
      );
    });

    it("rejects non-existent check IDs with 'not found' reason", async () => {
      const result = await handleServerFix({ checks: ["NONEXIST-CHECK"] });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text) as Record<
        string,
        unknown
      >;
      const rejected = parsed.rejectedChecks as Array<{
        id: string;
        reason: string;
      }>;
      expect(rejected).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "NONEXIST-CHECK",
            reason: expect.stringContaining("not found"),
          }),
        ]),
      );
    });
  });

  // ── AND filter ───────────────────────────────────────────────────────────

  describe("checks + category AND filter", () => {
    it("AND filter: returns only checks matching both checks[] and category", async () => {
      // safePlan has KERN-SYNCOOKIES and KERN-RANDOMIZE (both Kernel)
      // checks: ["KERN-SYNCOOKIES"] + category: "Kernel" → only KERN-SYNCOOKIES
      const result = await handleServerFix({
        checks: ["KERN-SYNCOOKIES"],
        category: "Kernel",
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text) as Record<
        string,
        unknown
      >;
      // In dryRun mode, preview groups should contain only KERN-SYNCOOKIES
      const preview = parsed.preview as { groups: Array<{ checks: Array<{ id: string }> }> };
      const allCheckIds = preview.groups.flatMap((g) => g.checks.map((c) => c.id));
      expect(allCheckIds).toContain("KERN-SYNCOOKIES");
      expect(allCheckIds).not.toContain("KERN-RANDOMIZE");
    });

    it("category filter alone returns only checks from that category", async () => {
      const result = await handleServerFix({ category: "Kernel" });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      const preview = parsed.preview as { groups: Array<{ checks: Array<{ id: string; category: string }> }> };
      const allChecks = preview.groups.flatMap((g) => g.checks);
      expect(allChecks.every((c) => c.category === "Kernel")).toBe(true);
    });
  });

  // ── Empty plan early exit ─────────────────────────────────────────────────

  describe("empty plan early exit", () => {
    it("returns message when no SAFE fixes match filter", async () => {
      mockedFix.previewSafeFixes.mockReturnValue({
        safePlan: { groups: [] },
        guardedCount: 0,
        forbiddenCount: 0,
        guardedIds: [],
      } as never);

      const result = await handleServerFix({});

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text) as Record<
        string,
        unknown
      >;
      expect(String(parsed.message)).toMatch(/No matching SAFE fixes/i);
    });
  });

  // ── Live fix path ─────────────────────────────────────────────────────────

  describe("live fix path", () => {
    it("aborts on backup failure — returns isError:true with Backup failed", async () => {
      mockedBackup.backupServer.mockResolvedValue({
        success: false,
        error: "disk full",
      });

      const result = await handleServerFix({ dryRun: false });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text) as Record<
        string,
        unknown
      >;
      expect(String(parsed.error)).toContain("Backup failed");
    });

    it("applies fixes and returns score delta", async () => {
      const result = await handleServerFix({ dryRun: false });

      expect(result.isError).toBeUndefined();
      expect(mockedBackup.backupServer).toHaveBeenCalledTimes(1);
      expect(mockedSsh.sshExec).toHaveBeenCalled();

      const parsed = JSON.parse(result.content[0].text) as Record<
        string,
        unknown
      >;
      expect(Array.isArray(parsed.applied)).toBe(true);
      expect(typeof parsed.scoreBefore).toBe("number");
      // scoreAfter may be null if nothing was applied, but we mock sshExec success
      // so applied should be non-empty → scoreAfter should be a number
      expect(parsed.scoreAfter).toBe(72);
    });

    it("dryRun:false with SAFE_MODE=false executes backup and SSH", async () => {
      mockedManage.isSafeMode.mockReturnValue(false);

      await handleServerFix({ dryRun: false });

      expect(mockedBackup.backupServer).toHaveBeenCalledWith(sampleServer);
    });

    it("returns mcpError when audit fails", async () => {
      mockedAudit.runAudit.mockResolvedValue({
        success: false,
        error: "Connection refused",
        hint: "Check SSH",
      } as never);

      const result = await handleServerFix({ dryRun: false });

      expect(result.isError).toBe(true);
      const text = result.content[0].text;
      expect(text).toContain("Connection refused");
    });

    it("reports preCondition failure without aborting other fixes", async () => {
      const planWithPreCond = {
        safePlan: {
          groups: [{
            severity: "warning" as const,
            checks: [{
              ...makeFixCheck("KERN-SYNCOOKIES", "Kernel"),
              preCondition: "test -f /etc/sysctl.conf",
            }],
            estimatedImpact: 5,
          }],
        },
        guardedCount: 0,
        forbiddenCount: 0,
        guardedIds: [],
      };
      mockedFix.previewSafeFixes.mockReturnValue(planWithPreCond as never);
      mockedSsh.sshExec.mockResolvedValue({ stdout: "", stderr: "", code: 1 });

      const result = await handleServerFix({ dryRun: false });
      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      const errors = parsed.errors as string[];
      expect(errors.some((e: string) => e.includes("pre-condition"))).toBe(true);
    });

    it("reports isFixCommandAllowed rejection", async () => {
      mockedFix.isFixCommandAllowed.mockReturnValue(false);

      const result = await handleServerFix({ dryRun: false });
      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      const errors = parsed.errors as string[];
      expect(errors.some((e: string) => e.includes("rejected"))).toBe(true);
    });

    it("reports SSH command failure with exit code", async () => {
      mockedFix.isFixCommandAllowed.mockReturnValue(true);
      mockedSsh.sshExec.mockResolvedValue({ stdout: "", stderr: "error", code: 127 });

      const result = await handleServerFix({ dryRun: false });
      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      const errors = parsed.errors as string[];
      expect(errors.some((e: string) => e.includes("command failed"))).toBe(true);
    });

    it("catches and reports unexpected SSH errors", async () => {
      mockedFix.isFixCommandAllowed.mockReturnValue(true);
      mockedSsh.sshExec.mockRejectedValue(new Error("ECONNRESET"));

      const result = await handleServerFix({ dryRun: false });
      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      const errors = parsed.errors as string[];
      expect(errors.some((e: string) => e.includes("ECONNRESET"))).toBe(true);
    });

    it("saves history entry after successful live fix", async () => {
      const result = await handleServerFix({ dryRun: false });

      expect(result.isError).toBeUndefined();
      expect(mockedFixHistory.generateFixId).toHaveBeenCalledWith("1.2.3.4");
      expect(mockedFixHistory.backupFilesBeforeFix).toHaveBeenCalledWith(
        "1.2.3.4",
        "fix-2026-03-29-001",
        expect.any(Array),
      );
      expect(mockedFixHistory.saveFixHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          fixId: "fix-2026-03-29-001",
          serverIp: "1.2.3.4",
          serverName: "test-srv",
          status: "applied",
          backupPath: "/root/.kastell/fix-backups/fix-2026-03-29-001",
        }),
      );
    });

    it("calls backupRemoteCleanup after live fix", async () => {
      await handleServerFix({ dryRun: false });

      expect(mockedFixHistory.backupRemoteCleanup).toHaveBeenCalledWith("1.2.3.4");
    });

    it("handler-matchable fixCommand is applied via handler (not shell path)", async () => {
      const sysctlCompound =
        "sysctl -w kernel.randomize_va_space=2 && echo 'kernel.randomize_va_space=2' >> /etc/sysctl.conf";

      const planWithHandler = {
        safePlan: {
          groups: [{
            severity: "warning" as const,
            checks: [makeFixCheck("KERN-RANDOMIZE", "Kernel")],
            estimatedImpact: 5,
          }],
        },
        guardedCount: 0,
        forbiddenCount: 0,
        guardedIds: [],
      };
      // Override the fixCommand to the compound one
      planWithHandler.safePlan.groups[0].checks[0] = {
        ...planWithHandler.safePlan.groups[0].checks[0],
        fixCommand: sysctlCompound,
      };
      mockedFix.previewSafeFixes.mockReturnValue(planWithHandler as never);
      mockedFix.sortChecksByImpact.mockImplementation((checks) =>
        checks.map((c) => ({ ...c, impact: 5 })),
      );
      mockedFix.selectChecksForTarget.mockImplementation((sorted) => sorted);

      // Handler matches and succeeds — pushes to applied array
      mockedHandlers.tryHandlerDispatch.mockImplementation(async (_ip, check, applied, _errors) => {
        applied.push(check.id);
        return { handled: true };
      });

      const result = await handleServerFix({ dryRun: false });

      expect(result.isError).toBeUndefined();
      expect(mockedHandlers.tryHandlerDispatch).toHaveBeenCalled();
      // isFixCommandAllowed NOT called for the handler-matched command
      expect(mockedFix.isFixCommandAllowed).not.toHaveBeenCalledWith(sysctlCompound);
      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect((parsed.applied as string[]).includes("KERN-RANDOMIZE")).toBe(true);
    });

    it("handler failure appears in MCP errors array", async () => {
      // Handler matches but fails — pushes to errors array
      mockedHandlers.tryHandlerDispatch.mockImplementation(async (_ip, check, _applied, errors) => {
        errors.push(`${check.id}: handler failed — sysctl write failed`);
        return { handled: true };
      });

      const result = await handleServerFix({ dryRun: false });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      const errors = parsed.errors as string[];
      expect(errors.some((e) => e.includes("handler failed"))).toBe(true);
    });
  });

  // ── action=history ───────────────────────────────────────────────────────

  describe("action=history", () => {
    it("returns entries for server", async () => {
      const entry: FixHistoryEntry = {
        fixId: "fix-2026-03-29-001",
        serverIp: "1.2.3.4",
        serverName: "test-srv",
        timestamp: "2026-03-29T10:00:00.000Z",
        checks: ["KERN-SYNCOOKIES"],
        scoreBefore: 65,
        scoreAfter: 70,
        status: "applied",
        backupPath: "/root/.kastell/fix-backups/fix-2026-03-29-001",
      };
      mockedFixHistory.loadFixHistory.mockReturnValue([entry]);

      const result = await handleServerFix({ action: "history" });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(parsed.action).toBe("history");
      expect(Array.isArray(parsed.entries)).toBe(true);
      expect((parsed.entries as FixHistoryEntry[]).length).toBe(1);
      expect(parsed.totalEntries).toBe(1);
    });

    it("returns empty entries array when no history", async () => {
      mockedFixHistory.loadFixHistory.mockReturnValue([]);

      const result = await handleServerFix({ action: "history" });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(parsed.action).toBe("history");
      expect(Array.isArray(parsed.entries)).toBe(true);
      expect((parsed.entries as unknown[]).length).toBe(0);
      expect(parsed.totalEntries).toBe(0);
    });

    it("does not call runAudit for history action", async () => {
      const result = await handleServerFix({ action: "history" });

      expect(result.isError).toBeUndefined();
      expect(mockedAudit.runAudit).not.toHaveBeenCalled();
    });
  });

  // ── action=rollback ──────────────────────────────────────────────────────

  describe("action=rollback", () => {
    const appliedEntry: FixHistoryEntry = {
      fixId: "fix-2026-03-29-001",
      serverIp: "1.2.3.4",
      serverName: "test-srv",
      timestamp: "2026-03-29T10:00:00.000Z",
      checks: ["KERN-SYNCOOKIES"],
      scoreBefore: 65,
      scoreAfter: 70,
      status: "applied",
      backupPath: "/root/.kastell/fix-backups/fix-2026-03-29-001",
    };

    it("calls rollbackFix and saves history entry", async () => {
      mockedFixHistory.loadFixHistory.mockReturnValue([appliedEntry]);
      mockedFixHistory.rollbackFix.mockResolvedValue({
        restored: ["/etc/sysctl.conf"],
        errors: [],
      });
      mockedAudit.runAudit.mockResolvedValue({
        success: true,
        data: { ...defaultAuditResult, overallScore: 63 } as never,
      });

      const result = await handleServerFix({
        action: "rollback",
        rollbackId: "fix-2026-03-29-001",
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(parsed.action).toBe("rollback");
      expect(parsed.fixId).toBe("fix-2026-03-29-001");
      expect(mockedFixHistory.rollbackFix).toHaveBeenCalledWith(
        "1.2.3.4",
        "/root/.kastell/fix-backups/fix-2026-03-29-001",
      );
      expect(mockedFixHistory.saveRollbackEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          fixId: "fix-2026-03-29-001",
          status: "applied",
          serverIp: "1.2.3.4",
        }),
        63,
      );
    });

    it("rollbackId=last resolves to last applied fix", async () => {
      mockedFixHistory.loadFixHistory.mockReturnValue([appliedEntry]);
      mockedFixHistory.rollbackFix.mockResolvedValue({
        restored: ["/etc/sysctl.conf"],
        errors: [],
      });
      mockedAudit.runAudit.mockResolvedValue({
        success: true,
        data: { ...defaultAuditResult, overallScore: 63 } as never,
      });

      const result = await handleServerFix({
        action: "rollback",
        rollbackId: "last",
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(parsed.fixId).toBe("fix-2026-03-29-001");
    });

    it("returns error when rollbackId not provided", async () => {
      const result = await handleServerFix({ action: "rollback" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(String(parsed.error)).toContain("rollbackId");
    });

    it("returns error when SAFE_MODE=true", async () => {
      mockedManage.isSafeMode.mockReturnValue(true);

      const result = await handleServerFix({
        action: "rollback",
        rollbackId: "fix-2026-03-29-001",
      });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(String(parsed.error)).toContain("SAFE_MODE");
    });

    it("returns error when fix not found", async () => {
      mockedFixHistory.loadFixHistory.mockReturnValue([]);

      const result = await handleServerFix({
        action: "rollback",
        rollbackId: "fix-nonexistent",
      });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(String(parsed.error)).toContain("fix-nonexistent");
    });

    it("returns error when rollbackId=last but no applied fix exists", async () => {
      mockedFixHistory.getLastFixId.mockReturnValue(null);

      const result = await handleServerFix({
        action: "rollback",
        rollbackId: "last",
      });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(String(parsed.error)).toContain("No applied fixes");
    });

    it("returns error when fix already rolled back", async () => {
      const rolledBackEntry: FixHistoryEntry = { ...appliedEntry, status: "rolled-back" };
      mockedFixHistory.loadFixHistory.mockReturnValue([rolledBackEntry]);

      const result = await handleServerFix({
        action: "rollback",
        rollbackId: "fix-2026-03-29-001",
      });

      expect(result.isError).toBe(true);
    });
  });

  // ── top/target prioritization params ────────────────────────────────────

  describe("top/target prioritization", () => {
    const fiveCheckPlan = {
      safePlan: {
        groups: [{
          severity: "warning" as const,
          checks: [
            makeFixCheck("CHECK-01", "Kernel"),
            makeFixCheck("CHECK-02", "Kernel"),
            makeFixCheck("CHECK-03", "Kernel"),
            makeFixCheck("CHECK-04", "Kernel"),
            makeFixCheck("CHECK-05", "Kernel"),
          ],
          estimatedImpact: 25,
        }],
      },
      guardedCount: 0,
      forbiddenCount: 0,
      guardedIds: [],
    };

    it("top param slices apply list to N checks", async () => {
      mockedFix.previewSafeFixes.mockReturnValue(fiveCheckPlan as never);
      mockedFix.sortChecksByImpact.mockImplementation((checks) =>
        checks.map((c) => ({ ...c, impact: 5 })),
      );
      mockedFix.selectChecksForTop.mockImplementation((sorted, n) => sorted.slice(0, n));

      const result = await handleServerFix({ dryRun: false, top: 3 });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(Array.isArray(parsed.applied)).toBe(true);
      expect((parsed.applied as string[]).length).toBeLessThanOrEqual(3);
    });

    it("target param stops at score threshold", async () => {
      const lowScoreAudit = { ...defaultAuditResult, overallScore: 60 };
      mockedAudit.runAudit.mockResolvedValue({
        success: true,
        data: lowScoreAudit as never,
      });
      mockedFix.previewSafeFixes.mockReturnValue(fiveCheckPlan as never);
      mockedFix.sortChecksByImpact.mockImplementation((checks) =>
        checks.map((c) => ({ ...c, impact: 5 })),
      );
      mockedFix.selectChecksForTarget.mockImplementation((sorted) => sorted.slice(0, 3));

      const result = await handleServerFix({ dryRun: false, target: 75 });

      expect(result.isError).toBeUndefined();
      expect(mockedFix.selectChecksForTarget).toHaveBeenCalledWith(
        expect.any(Array),
        60,
        75,
      );
    });

    it("top and target together returns error", async () => {
      const result = await handleServerFix({ top: 3, target: 80 });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(String(parsed.error)).toContain("mutually exclusive");
    });

    it("target already met returns info message without applying fixes", async () => {
      const highScoreAudit = { ...defaultAuditResult, overallScore: 85 };
      mockedAudit.runAudit.mockResolvedValue({
        success: true,
        data: highScoreAudit as never,
      });

      const result = await handleServerFix({ dryRun: false, target: 80 });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(String(parsed.message)).toContain("already meets target");
      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
    });

    it("top without action=apply is ignored for history action", async () => {
      const result = await handleServerFix({ action: "history", top: 3 });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(parsed.action).toBe("history");
      expect(mockedFix.sortChecksByImpact).not.toHaveBeenCalled();
    });
  });

  // ── sed-replace handler registration ──────────────────────────────────

  describe("sed-replace handler accessible via MCP path", () => {
    it("resolveHandlerChain returns non-null for sed-replace command (handler registered)", () => {
      const realHandlers = jest.requireActual("../../src/core/audit/handlers/index") as typeof handlers;
      const chain = realHandlers.resolveHandlerChain("sed-replace:/etc/ssh/sshd_config:old:new");
      expect(chain).not.toBeNull();
      expect(chain!.length).toBe(1);
      expect(chain![0].params.type).toBe("sed-replace");
    });
  });

  // ── Schema validation ────────────────────────────────────────────────────

  describe("schema validation", () => {
    it("serverFixSchema includes action enum with apply|rollback|history", () => {
      const { serverFixSchema } = require("../../src/mcp/tools/serverFix");
      expect(serverFixSchema.action).toBeDefined();
      const parsed = serverFixSchema.action.parse("apply");
      expect(parsed).toBe("apply");
    });

    it("serverFixSchema includes rollbackId optional string", () => {
      const { serverFixSchema } = require("../../src/mcp/tools/serverFix");
      expect(serverFixSchema.rollbackId).toBeDefined();
      // Optional field — undefined is valid
      const parsed = serverFixSchema.rollbackId.optional().parse(undefined);
      expect(parsed).toBeUndefined();
    });
  });
});
