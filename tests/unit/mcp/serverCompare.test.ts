import * as config from "../../../src/utils/config";
import * as auditIndex from "../../../src/core/audit/index";
import * as diff from "../../../src/core/audit/diff";
import * as ssh from "../../../src/utils/ssh";
import { handleServerCompare } from "../../../src/mcp/tools/serverCompare";

jest.mock("../../../src/utils/config");
jest.mock("../../../src/core/audit/index");
jest.mock("../../../src/core/audit/diff");
jest.mock("../../../src/utils/ssh");

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedAudit = auditIndex as jest.Mocked<typeof auditIndex>;
const mockedDiff = diff as jest.Mocked<typeof diff>;
const mockedSsh = ssh as jest.Mocked<typeof ssh>;

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
  mockedSsh.assertValidIp.mockImplementation(() => {});
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

  it("uses snapshots when available", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer, sampleServerB]);
    const auditA = makeAudit("server-a");
    const auditB = makeAudit("server-b");
    mockedDiff.resolveSnapshotRef.mockResolvedValueOnce({ audit: auditA } as any);
    mockedDiff.resolveSnapshotRef.mockResolvedValueOnce({ audit: auditB } as any);
    mockedDiff.buildCategorySummary.mockReturnValue({
      beforeLabel: "server-a", afterLabel: "server-b", scoreBefore: 80, scoreAfter: 80,
      scoreDelta: 0, categories: [], weakestCategory: null,
    });

    const result = await handleServerCompare({ serverA: "server-a", serverB: "server-b" });
    expect(result.isError).toBeUndefined();
    expect(mockedAudit.runAudit).not.toHaveBeenCalled();
    expect(mockedDiff.buildCategorySummary).toHaveBeenCalled();
  });

  it("falls back to live audit when snapshot missing", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer, sampleServerB]);
    mockedDiff.resolveSnapshotRef.mockResolvedValueOnce(null);
    mockedDiff.resolveSnapshotRef.mockResolvedValueOnce({ audit: makeAudit("server-b") } as any);
    mockedAudit.runAudit.mockResolvedValueOnce({ success: true, data: makeAudit("server-a") });
    mockedDiff.buildCategorySummary.mockReturnValue({
      beforeLabel: "server-a", afterLabel: "server-b", scoreBefore: 80, scoreAfter: 80,
      scoreDelta: 0, categories: [], weakestCategory: null,
    });

    const result = await handleServerCompare({ serverA: "server-a", serverB: "server-b" });
    expect(result.isError).toBeUndefined();
    expect(mockedAudit.runAudit).toHaveBeenCalledTimes(1);
  });

  it("uses live audit for both when fresh=true", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer, sampleServerB]);
    mockedAudit.runAudit.mockResolvedValueOnce({ success: true, data: makeAudit("server-a") });
    mockedAudit.runAudit.mockResolvedValueOnce({ success: true, data: makeAudit("server-b") });
    mockedDiff.buildCategorySummary.mockReturnValue({
      beforeLabel: "server-a", afterLabel: "server-b", scoreBefore: 80, scoreAfter: 80,
      scoreDelta: 0, categories: [], weakestCategory: null,
    });

    const result = await handleServerCompare({ serverA: "server-a", serverB: "server-b", fresh: true });
    expect(result.isError).toBeUndefined();
    expect(mockedAudit.runAudit).toHaveBeenCalledTimes(2);
    expect(mockedDiff.resolveSnapshotRef).not.toHaveBeenCalled();
  });

  it("returns check-level diff when detail=true", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer, sampleServerB]);
    mockedDiff.resolveSnapshotRef.mockResolvedValueOnce({ audit: makeAudit("server-a") } as any);
    mockedDiff.resolveSnapshotRef.mockResolvedValueOnce({ audit: makeAudit("server-b") } as any);
    mockedDiff.diffAudits.mockReturnValue({
      beforeLabel: "server-a", afterLabel: "server-b", scoreBefore: 80, scoreAfter: 80,
      scoreDelta: 0, improvements: [], regressions: [], unchanged: [], added: [], removed: [],
    });

    const result = await handleServerCompare({ serverA: "server-a", serverB: "server-b", detail: true });
    expect(result.isError).toBeUndefined();
    expect(mockedDiff.diffAudits).toHaveBeenCalled();
    expect(mockedDiff.buildCategorySummary).not.toHaveBeenCalled();
  });

  it("returns error when live audit fails", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer, sampleServerB]);
    mockedAudit.runAudit.mockResolvedValueOnce({ success: false, error: "SSH timeout" });
    mockedAudit.runAudit.mockResolvedValueOnce({ success: true, data: makeAudit("server-b") });

    const result = await handleServerCompare({ serverA: "server-a", serverB: "server-b", fresh: true });
    expect(result.isError).toBe(true);
  });
});