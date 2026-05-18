import * as config from "../../../src/utils/config";
import * as diff from "../../../src/core/audit/diff";
import { handleServerCompare } from "../../../src/mcp/tools/serverCompare";

jest.mock("../../../src/utils/config");
jest.mock("../../../src/core/audit/diff");

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedDiff = diff as jest.Mocked<typeof diff>;

const sampleServer = {
  id: "123",
  name: "server-a",
  provider: "hetzner" as const,
  ip: "1.1.1.1",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-02-20T00:00:00Z",
  mode: "bare" as const,
};

const sampleServerB = {
  id: "456",
  name: "server-b",
  provider: "hetzner" as const,
  ip: "2.2.2.2",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-02-20T00:00:00Z",
  mode: "bare" as const,
};

function makeAudit(name: string) {
  return {
    serverName: name,
    serverIp: "1.2.3.4",
    platform: "bare" as const,
    timestamp: new Date().toISOString(),
    auditVersion: "2.0.0",
    categories: [],
    overallScore: 80,
    quickWins: [],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("handleServerCompare", () => {
  it("returns error when no servers exist", async () => {
    mockedConfig.getServers.mockReturnValue([]);
    const result = await handleServerCompare({ serverA: "a", serverB: "b" });
    expect(result.isError).toBe(true);
  });

  it("returns error when serverA not found", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    const result = await handleServerCompare({ serverA: "unknown", serverB: "server-a" });
    expect(result.isError).toBe(true);
  });

  it("returns category summary by default", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer, sampleServerB]);
    const auditA = makeAudit("server-a");
    const auditB = makeAudit("server-b");
    mockedDiff.resolveAuditPair.mockResolvedValue({
      success: true, data: { auditA, auditB },
    });
    mockedDiff.buildCategorySummary.mockReturnValue({
      beforeLabel: "server-a", afterLabel: "server-b", scoreBefore: 80, scoreAfter: 80,
      scoreDelta: 0, categories: [], weakestCategory: null,
    });

    const result = await handleServerCompare({ serverA: "server-a", serverB: "server-b" });
    expect(result.isError).toBeUndefined();
    expect(mockedDiff.resolveAuditPair).toHaveBeenCalledWith(sampleServer, sampleServerB, false);
    expect(mockedDiff.buildCategorySummary).toHaveBeenCalled();
  });

  it("passes fresh=true to resolveAuditPair", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer, sampleServerB]);
    mockedDiff.resolveAuditPair.mockResolvedValue({
      success: true, data: { auditA: makeAudit("server-a"), auditB: makeAudit("server-b") },
    });
    mockedDiff.buildCategorySummary.mockReturnValue({
      beforeLabel: "server-a", afterLabel: "server-b", scoreBefore: 80, scoreAfter: 80,
      scoreDelta: 0, categories: [], weakestCategory: null,
    });

    const result = await handleServerCompare({ serverA: "server-a", serverB: "server-b", fresh: true });
    expect(result.isError).toBeUndefined();
    expect(mockedDiff.resolveAuditPair).toHaveBeenCalledWith(sampleServer, sampleServerB, true);
  });

  it("returns check-level diff when detail=true", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer, sampleServerB]);
    mockedDiff.resolveAuditPair.mockResolvedValue({
      success: true, data: { auditA: makeAudit("server-a"), auditB: makeAudit("server-b") },
    });
    mockedDiff.diffAudits.mockReturnValue({
      beforeLabel: "server-a", afterLabel: "server-b", scoreBefore: 80, scoreAfter: 80,
      scoreDelta: 0, improvements: [], regressions: [], unchanged: [], added: [], removed: [],
    });

    const result = await handleServerCompare({ serverA: "server-a", serverB: "server-b", detail: true });
    expect(result.isError).toBeUndefined();
    expect(mockedDiff.diffAudits).toHaveBeenCalled();
    expect(mockedDiff.buildCategorySummary).not.toHaveBeenCalled();
  });

  it("detail mode returns flat checks array (not object)", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer, sampleServerB]);
    mockedDiff.resolveAuditPair.mockResolvedValue({
      success: true, data: { auditA: makeAudit("server-a"), auditB: makeAudit("server-b") },
    });
    mockedDiff.diffAudits.mockReturnValue({
      beforeLabel: "server-a", afterLabel: "server-b", scoreBefore: 80, scoreAfter: 80,
      scoreDelta: 0,
      improvements: [{ id: "A-1", name: "Check A", category: "cat", severity: "warning" as const, status: "improved" as const, before: null, after: true }],
      regressions: [{ id: "B-1", name: "Check B", category: "cat", severity: "critical" as const, status: "regressed" as const, before: true, after: false }],
      unchanged: [
        { id: "C-1", name: "Check C", category: "cat", severity: "warning" as const, status: "unchanged" as const, before: false, after: false },
        { id: "D-1", name: "Check D", category: "cat", severity: "warning" as const, status: "unchanged" as const, before: true, after: true },
      ],
      added: [],
      removed: [],
    });

    const result = await handleServerCompare({ serverA: "server-a", serverB: "server-b", detail: true });
    expect(result.isError).toBeUndefined();
    const body = result.structuredContent!.result as { format: string; checks: Array<{ id: string; name: string; status: string }> };
    expect(body.format).toBe("check");
    expect(Array.isArray(body.checks)).toBe(true);
    expect(body.checks).toHaveLength(4);
    body.checks.forEach((c) => {
      expect(typeof c.id).toBe("string");
      expect(["same", "A_better", "B_better", "both_fail", "both_pass"]).toContain(c.status);
    });
    const statuses = body.checks.map((c) => c.status);
    expect(statuses).toContain("A_better");
    expect(statuses).toContain("B_better");
    expect(statuses).toContain("both_fail");
    expect(statuses).toContain("both_pass");
  });

  it("returns error when resolveAuditPair fails", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer, sampleServerB]);
    mockedDiff.resolveAuditPair.mockResolvedValue({
      success: false, error: "SSH timeout",
    });

    const result = await handleServerCompare({ serverA: "server-a", serverB: "server-b" });
    expect(result.isError).toBe(true);
  });
});
