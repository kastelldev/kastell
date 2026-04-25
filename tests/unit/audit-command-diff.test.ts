/**
 * Unit tests for audit command --diff and --compare CLI wiring.
 * Verifies snapshot loading, diff output, and exit code behavior.
 */

import * as diffModule from "../../src/core/audit/diff";
import * as configModule from "../../src/utils/config";
import * as serverSelect from "../../src/utils/serverSelect";
import * as ssh from "../../src/utils/ssh";
import * as auditCore from "../../src/core/audit/index";
import * as formatters from "../../src/core/audit/formatters/index";
import * as auditHistory from "../../src/core/audit/history";
import * as snapshotModule from "../../src/core/audit/snapshot";

jest.mock("../../src/core/audit/diff");
jest.mock("../../src/utils/config");
jest.mock("../../src/utils/serverSelect");
jest.mock("../../src/utils/ssh");
jest.mock("../../src/core/audit/index");
jest.mock("../../src/core/audit/formatters/index");
jest.mock("../../src/core/audit/history");
jest.mock("../../src/core/audit/snapshot");
jest.mock("../../src/core/audit/fix");
jest.mock("../../src/core/audit/watch");
jest.mock("../../src/utils/logger", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    success: jest.fn(),
    warn: jest.fn(),
  },
  createSpinner: jest.fn(() => ({
    start: jest.fn(),
    stop: jest.fn(),
    succeed: jest.fn(),
    fail: jest.fn(),
  })),
}));

const mockedDiff = diffModule as jest.Mocked<typeof diffModule>;
const mockedConfig = configModule as jest.Mocked<typeof configModule>;
const mockedServerSelect = serverSelect as jest.Mocked<typeof serverSelect>;
const mockedHistory = auditHistory as jest.Mocked<typeof auditHistory>;
const mockedFormatters = formatters as jest.Mocked<typeof formatters>;
const mockedSnapshot = snapshotModule as jest.Mocked<typeof snapshotModule>;
const mockedAudit = auditCore as jest.Mocked<typeof auditCore>;

const mockAuditResult = {
  serverName: "server-a",
  serverIp: "1.2.3.4",
  platform: "bare" as const,
  timestamp: "2026-03-11T00:00:00.000Z",
  auditVersion: "1.0.0",
  categories: [],
  overallScore: 80,
  quickWins: [],
};

const makeSnapshotFile = (name?: string, score = 80) => ({
  schemaVersion: 1,
  name,
  savedAt: "2026-03-11T00:00:00.000Z",
  audit: { ...mockAuditResult, overallScore: score },
});

const makeAuditResult = (name: string, score: number) => ({
  serverName: name,
  serverIp: name === "server-a" ? "1.2.3.4" : "5.6.7.8",
  platform: "bare" as const,
  timestamp: "2026-03-11T00:00:00.000Z",
  auditVersion: "1.0.0",
  categories: [],
  overallScore: score,
  quickWins: [],
});

const makeDiffResult = (regressionCount = 0) => ({
  beforeLabel: "before",
  afterLabel: "after",
  scoreBefore: 80,
  scoreAfter: 80 - regressionCount * 5,
  scoreDelta: -regressionCount * 5,
  improvements: [],
  regressions: regressionCount > 0
    ? Array.from({ length: regressionCount }, (_, i) => ({
        id: `SSH-0${i + 1}`,
        name: `Check ${i + 1}`,
        category: "SSH",
        severity: "warning" as const,
        status: "regressed" as const,
        before: true,
        after: false,
      }))
    : [],
  unchanged: [],
  added: [],
  removed: [],
});

const mockServer = {
  id: "srv-1",
  name: "server-a",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "fsn1",
  size: "cx11",
  createdAt: "2026-01-01",
  mode: "bare" as const,
};

describe("auditCommand --diff wiring", () => {
  let consoleSpy: jest.SpyInstance;
  let originalExitCode: number | undefined;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    originalExitCode = process.exitCode as number | undefined;
    process.exitCode = undefined;
    jest.clearAllMocks();

    mockedServerSelect.resolveServer.mockResolvedValue(mockServer);
    mockedHistory.loadAuditHistory.mockReturnValue([]);
    mockedHistory.detectTrend.mockReturnValue("first audit");
    mockedHistory.saveAuditHistory.mockResolvedValue(undefined);
    mockedFormatters.selectFormatter.mockResolvedValue(
      () => "formatted output",
    );
    mockedSnapshot.listSnapshots.mockResolvedValue([]);
    mockedSnapshot.saveSnapshot.mockResolvedValue(undefined);
    mockedDiff.formatDiffTerminal.mockReturnValue("terminal diff output");
    mockedDiff.formatDiffJson.mockReturnValue('{"diff": true}');
    mockedDiff.diffAudits.mockReturnValue(makeDiffResult(0));
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    process.exitCode = originalExitCode;
  });

  describe("happy path", () => {
    it("loads both snapshots and outputs terminal diff", async () => {
      const beforeSnap = makeSnapshotFile("pre-upgrade");
      const afterSnap = makeSnapshotFile("latest");
      mockedDiff.resolveSnapshotRef
        .mockResolvedValueOnce(beforeSnap)
        .mockResolvedValueOnce(afterSnap);

      const { auditCommand } = await import("../../src/commands/audit");
      await auditCommand("server-a", { diff: "pre-upgrade:latest" });

      expect(mockedDiff.resolveSnapshotRef).toHaveBeenCalledWith("1.2.3.4", "pre-upgrade");
      expect(mockedDiff.resolveSnapshotRef).toHaveBeenCalledWith("1.2.3.4", "latest");
      expect(mockedDiff.diffAudits).toHaveBeenCalledWith(
        beforeSnap.audit,
        afterSnap.audit,
        { before: "pre-upgrade", after: "latest" },
      );
      expect(mockedDiff.formatDiffTerminal).toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
      expect(output).toContain("terminal diff output");
    });

    it("uses ref as label when snapshot has no name", async () => {
      const beforeSnap = { ...makeSnapshotFile(), name: undefined };
      const afterSnap = { ...makeSnapshotFile(), name: undefined };
      mockedDiff.resolveSnapshotRef
        .mockResolvedValueOnce(beforeSnap)
        .mockResolvedValueOnce(afterSnap);

      const { auditCommand } = await import("../../src/commands/audit");
      await auditCommand("server-a", { diff: "snap-a:snap-b" });

      expect(mockedDiff.diffAudits).toHaveBeenCalledWith(
        beforeSnap.audit,
        afterSnap.audit,
        { before: "snap-a", after: "snap-b" },
      );
    });
  });

  describe("invalid format", () => {
    it("shows error when --diff has no colon", async () => {
      const loggerMock = await import("../../src/utils/logger");
      const { auditCommand } = await import("../../src/commands/audit");
      await auditCommand("server-a", { diff: "single-value" });

      expect(loggerMock.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("--diff requires format"),
      );
      expect(mockedDiff.resolveSnapshotRef).not.toHaveBeenCalled();
    });
  });

  describe("missing snapshots", () => {
    it("shows error when before snapshot not found", async () => {
      mockedDiff.resolveSnapshotRef.mockResolvedValueOnce(null);
      const loggerMock = await import("../../src/utils/logger");

      const { auditCommand } = await import("../../src/commands/audit");
      await auditCommand("server-a", { diff: "missing:latest" });

      expect(loggerMock.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Snapshot not found: missing"),
      );
      expect(mockedDiff.diffAudits).not.toHaveBeenCalled();
    });

    it("shows error when after snapshot not found", async () => {
      const beforeSnap = makeSnapshotFile("pre-upgrade");
      mockedDiff.resolveSnapshotRef
        .mockResolvedValueOnce(beforeSnap)
        .mockResolvedValueOnce(null);
      const loggerMock = await import("../../src/utils/logger");

      const { auditCommand } = await import("../../src/commands/audit");
      await auditCommand("server-a", { diff: "pre-upgrade:missing" });

      expect(loggerMock.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Snapshot not found: missing"),
      );
      expect(mockedDiff.diffAudits).not.toHaveBeenCalled();
    });
  });

  describe("exit code behavior", () => {
    it("sets process.exitCode = 1 when regressions exist", async () => {
      const beforeSnap = makeSnapshotFile("before");
      const afterSnap = makeSnapshotFile("after");
      mockedDiff.resolveSnapshotRef
        .mockResolvedValueOnce(beforeSnap)
        .mockResolvedValueOnce(afterSnap);
      mockedDiff.diffAudits.mockReturnValue(makeDiffResult(2));

      const { auditCommand } = await import("../../src/commands/audit");
      await auditCommand("server-a", { diff: "before:after" });

      expect(process.exitCode).toBe(1);
    });

    it("does NOT set process.exitCode = 1 when no regressions", async () => {
      const beforeSnap = makeSnapshotFile("before");
      const afterSnap = makeSnapshotFile("after");
      mockedDiff.resolveSnapshotRef
        .mockResolvedValueOnce(beforeSnap)
        .mockResolvedValueOnce(afterSnap);
      mockedDiff.diffAudits.mockReturnValue(makeDiffResult(0));

      const { auditCommand } = await import("../../src/commands/audit");
      await auditCommand("server-a", { diff: "before:after" });

      expect(process.exitCode).not.toBe(1);
    });
  });

  describe("JSON output", () => {
    it("calls formatDiffJson (not formatDiffTerminal) when --json is set", async () => {
      const beforeSnap = makeSnapshotFile("before");
      const afterSnap = makeSnapshotFile("after");
      mockedDiff.resolveSnapshotRef
        .mockResolvedValueOnce(beforeSnap)
        .mockResolvedValueOnce(afterSnap);

      const { auditCommand } = await import("../../src/commands/audit");
      await auditCommand("server-a", { diff: "before:after", json: true });

      expect(mockedDiff.formatDiffJson).toHaveBeenCalled();
      expect(mockedDiff.formatDiffTerminal).not.toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
      expect(output).toContain('{"diff": true}');
    });
  });

  describe("does not run live audit", () => {
    it("returns early without calling runAudit", async () => {
      const auditCoreMock = auditCore as jest.Mocked<typeof auditCore>;
      const beforeSnap = makeSnapshotFile("before");
      const afterSnap = makeSnapshotFile("after");
      mockedDiff.resolveSnapshotRef
        .mockResolvedValueOnce(beforeSnap)
        .mockResolvedValueOnce(afterSnap);

      const { auditCommand } = await import("../../src/commands/audit");
      await auditCommand("server-a", { diff: "before:after" });

      expect(auditCoreMock.runAudit).not.toHaveBeenCalled();
    });
  });
});

describe("auditCommand --compare wiring", () => {
  let consoleSpy: jest.SpyInstance;
  let originalExitCode: number | undefined;

  const serverA = {
    id: "srv-a",
    name: "server-a",
    provider: "hetzner",
    ip: "1.2.3.4",
    region: "fsn1",
    size: "cx11",
    createdAt: "2026-01-01",
    mode: "bare" as const,
  };

  const serverB = {
    id: "srv-b",
    name: "server-b",
    provider: "hetzner",
    ip: "5.6.7.8",
    region: "fsn1",
    size: "cx11",
    createdAt: "2026-01-01",
    mode: "bare" as const,
  };

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    originalExitCode = process.exitCode as number | undefined;
    process.exitCode = undefined;
    jest.clearAllMocks();

    mockedServerSelect.resolveServer.mockResolvedValue(serverA);
    mockedHistory.loadAuditHistory.mockReturnValue([]);
    mockedHistory.detectTrend.mockReturnValue("first audit");
    mockedHistory.saveAuditHistory.mockResolvedValue(undefined);
    mockedFormatters.selectFormatter.mockResolvedValue(() => "formatted output");
    mockedSnapshot.listSnapshots.mockResolvedValue([]);
    mockedSnapshot.saveSnapshot.mockResolvedValue(undefined);
    mockedDiff.formatDiffTerminal.mockReturnValue("compare terminal output");
    mockedDiff.formatDiffJson.mockReturnValue('{"compare": true}');
    mockedDiff.diffAudits.mockReturnValue(makeDiffResult(0));
    mockedConfig.getServers.mockReturnValue([serverA, serverB]);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    process.exitCode = originalExitCode;
  });

  describe("happy path", () => {
    it("loads latest snapshot for each server and outputs diff", async () => {
      const snapA = makeSnapshotFile(undefined, 80);
      const snapB = makeSnapshotFile(undefined, 70);
      mockedDiff.resolveSnapshotRef
        .mockResolvedValueOnce(snapA)
        .mockResolvedValueOnce(snapB);

      const { auditCommand } = await import("../../src/commands/audit");
      await auditCommand(undefined, { compare: "server-a:server-b" });

      expect(mockedConfig.getServers).toHaveBeenCalled();
      expect(mockedDiff.resolveSnapshotRef).toHaveBeenCalledWith("1.2.3.4", "latest");
      expect(mockedDiff.resolveSnapshotRef).toHaveBeenCalledWith("5.6.7.8", "latest");
      expect(mockedDiff.diffAudits).toHaveBeenCalledWith(
        snapA.audit,
        snapB.audit,
        { before: "server-a", after: "server-b" },
      );
      expect(mockedDiff.formatDiffTerminal).toHaveBeenCalled();
    });
  });

  describe("invalid format", () => {
    it("shows error when --compare has no colon", async () => {
      const loggerMock = await import("../../src/utils/logger");

      const { auditCommand } = await import("../../src/commands/audit");
      await auditCommand(undefined, { compare: "single-server" });

      expect(loggerMock.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("--compare requires format"),
      );
      expect(mockedDiff.resolveSnapshotRef).not.toHaveBeenCalled();
    });
  });

  describe("server not found", () => {
    it("shows error when first server is not in config", async () => {
      mockedConfig.getServers.mockReturnValue([serverB]);
      const loggerMock = await import("../../src/utils/logger");

      const { auditCommand } = await import("../../src/commands/audit");
      await auditCommand(undefined, { compare: "server-a:server-b" });

      expect(loggerMock.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Server not found: server-a"),
      );
      expect(mockedDiff.resolveSnapshotRef).not.toHaveBeenCalled();
    });

    it("shows error when second server is not in config", async () => {
      mockedConfig.getServers.mockReturnValue([serverA]);
      const loggerMock = await import("../../src/utils/logger");

      const { auditCommand } = await import("../../src/commands/audit");
      await auditCommand(undefined, { compare: "server-a:server-b" });

      expect(loggerMock.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Server not found: server-b"),
      );
      expect(mockedDiff.resolveSnapshotRef).not.toHaveBeenCalled();
    });
  });

  describe("no snapshots", () => {
    it("falls back to live audit when server-a has no snapshots", async () => {
      mockedDiff.resolveSnapshotRef.mockResolvedValueOnce(null);
      mockedDiff.resolveSnapshotRef.mockResolvedValueOnce(makeSnapshotFile(undefined, 70));
      mockedAudit.runAudit.mockResolvedValueOnce({ success: true, data: makeAuditResult("server-a", 80) });
      mockedDiff.buildCategorySummary.mockReturnValue({
        beforeLabel: "server-a", afterLabel: "server-b", scoreBefore: 80, scoreAfter: 70,
        scoreDelta: -10, categories: [], weakestCategory: null,
      });
      mockedDiff.diffAudits.mockReturnValue({
        beforeLabel: "server-a", afterLabel: "server-b", scoreBefore: 80, scoreAfter: 70,
        scoreDelta: -10, improvements: [], regressions: [], unchanged: [], added: [], removed: [],
      });

      const { auditCommand } = await import("../../src/commands/audit");
      await auditCommand(undefined, { compare: "server-a:server-b" });

      expect(mockedAudit.runAudit).toHaveBeenCalled();
      expect(mockedDiff.buildCategorySummary).toHaveBeenCalled();
    });

    it("falls back to live audit when server-b has no snapshots", async () => {
      const snapA = makeSnapshotFile(undefined, 80);
      mockedDiff.resolveSnapshotRef
        .mockResolvedValueOnce(snapA)
        .mockResolvedValueOnce(null);
      mockedAudit.runAudit.mockResolvedValueOnce({ success: true, data: makeAuditResult("server-b", 70) });
      mockedDiff.buildCategorySummary.mockReturnValue({
        beforeLabel: "server-a", afterLabel: "server-b", scoreBefore: 80, scoreAfter: 70,
        scoreDelta: -10, categories: [], weakestCategory: null,
      });
      mockedDiff.diffAudits.mockReturnValue({
        beforeLabel: "server-a", afterLabel: "server-b", scoreBefore: 80, scoreAfter: 70,
        scoreDelta: -10, improvements: [], regressions: [], unchanged: [], added: [], removed: [],
      });

      const { auditCommand } = await import("../../src/commands/audit");
      await auditCommand(undefined, { compare: "server-a:server-b" });

      expect(mockedAudit.runAudit).toHaveBeenCalled();
      expect(mockedDiff.buildCategorySummary).toHaveBeenCalled();
    });
  });

  describe("exit code behavior", () => {
    it("sets process.exitCode = 1 when regressions exist", async () => {
      const snapA = makeSnapshotFile();
      const snapB = makeSnapshotFile();
      mockedDiff.resolveSnapshotRef
        .mockResolvedValueOnce(snapA)
        .mockResolvedValueOnce(snapB);
      mockedDiff.diffAudits.mockReturnValue(makeDiffResult(3));

      const { auditCommand } = await import("../../src/commands/audit");
      await auditCommand(undefined, { compare: "server-a:server-b" });

      expect(process.exitCode).toBe(1);
    });
  });
});
