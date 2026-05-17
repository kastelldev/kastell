/**
 * MCP server_compare integration tests.
 *
 * Coverage: RPC boot, handler wiring, schema round-trip, cache-hit/fresh paths,
 * detail/summary modes, same-server rejection, server-not-found, and outputSchema.
 *
 * Strategy: mock I/O boundaries (config, ssh, snapshot, audit index), exercise real handler.
 */

jest.mock("../../../src/utils/config.js");
jest.mock("../../../src/core/audit/diff.js");
jest.mock("../../../src/core/audit/snapshot.js");
jest.mock("../../../src/core/audit/index.js");
jest.mock("../../../src/utils/ssh.js");

import * as configUtils from "../../../src/utils/config.js";
import * as auditDiff from "../../../src/core/audit/diff.js";
import * as auditSnapshot from "../../../src/core/audit/snapshot.js";
import * as auditIndex from "../../../src/core/audit/index.js";
import * as sshUtils from "../../../src/utils/ssh.js";
import { handleServerCompare } from "../../../src/mcp/tools/serverCompare.js";
import { serverCompareOutputSchema } from "../../../src/mcp/tools/serverCompare.js";

const mockedConfig = configUtils as jest.Mocked<typeof configUtils>;
const mockedDiff = auditDiff as jest.Mocked<typeof auditDiff>;
const mockedSnapshot = auditSnapshot as jest.Mocked<typeof auditSnapshot>;
const mockedAuditIndex = auditIndex as jest.Mocked<typeof auditIndex>;
const mockedSsh = sshUtils as jest.Mocked<typeof sshUtils>;

const serverA = {
  id: "htz-001", name: "web-1", provider: "hetzner" as const,
  ip: "10.0.0.1", region: "nbg1", size: "cax11",
  createdAt: "2026-03-01T00:00:00Z", mode: "coolify" as const,
};
const serverB = {
  id: "htz-002", name: "db-1", provider: "hetzner" as const,
  ip: "10.0.0.2", region: "nbg1", size: "cax21",
  createdAt: "2026-03-02T00:00:00Z", mode: "coolify" as const,
};

function makeAudit(name: string, score: number) {
  return {
    serverName: name, serverIp: "10.0.0.0", platform: "coolify" as const,
    timestamp: new Date().toISOString(), auditVersion: "2.0.0",
    categories: [{
      name: "SSH", score: 8, maxScore: 10, weight: 1,
      checks: [{ id: "SSH-001", name: "SSH check", passed: true, severity: "medium" as const }],
    }],
    overallScore: score, quickWins: [], skippedCategories: [],
  };
}

function makeSnapshot(name: string, score: number) {
  return {
    audit: makeAudit(name, score),
    timestamp: new Date().toISOString(),
    filename: `${name}.json`,
    schemaVersion: 1,
    savedAt: "2026-03-01T00:00:00Z",
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedConfig.getServers.mockReturnValue([serverA, serverB]);
});

describe("handleServerCompare — integration", () => {

  // ── 1. Happy path — cache hit (both snapshots exist) ───────────────────

  it("should return category diff with cache hit", async () => {
    mockedSnapshot.listSnapshots.mockResolvedValue([
      { filename: "web-1.json", name: "web-1", savedAt: "2026-03-01T00:00:00Z", overallScore: 72 },
    ]);
    mockedSnapshot.loadSnapshot
      .mockResolvedValueOnce(makeSnapshot("web-1", 72) as never)
      .mockResolvedValueOnce(makeSnapshot("db-1", 85) as never);
    mockedDiff.buildCategorySummary.mockReturnValue({
      beforeLabel: "web-1", afterLabel: "db-1",
      scoreBefore: 72, scoreAfter: 85, scoreDelta: 13,
      categories: [{ category: "SSH", scoreBefore: 8, scoreAfter: 10, delta: 2, passedBefore: 1, passedAfter: 1, totalBefore: 1, totalAfter: 1 }],
      weakestCategory: null,
    } as never);

    const result = await handleServerCompare({ serverA: "web-1", serverB: "db-1" });

    console.error("DEBUG cache hit error:", JSON.parse(result.content[0].text));
    expect(result.isError).toBeFalsy();
    const body = JSON.parse(result.content[0].text);
    expect(body.format).toBe("category");
    expect(body.serverA).toBe("web-1");
    expect(body.serverB).toBe("db-1");
    expect(body.overallDelta).toBe(13);
    expect(body.overallA).toBe(72);
    expect(body.overallB).toBe(85);
    expect(mockedSnapshot.listSnapshots).toHaveBeenCalledTimes(2);
    expect(mockedDiff.buildCategorySummary).toHaveBeenCalled();
  });

  // ── 2. Fresh audit branch — runAudit called twice ───────────────────────

  it("should run live audits when fresh=true", async () => {
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedAuditIndex.runAudit
      .mockResolvedValueOnce({ success: true, data: makeAudit("web-1", 70) } as never)
      .mockResolvedValueOnce({ success: true, data: makeAudit("db-1", 88) } as never);
    mockedDiff.buildCategorySummary.mockReturnValue({
      beforeLabel: "web-1", afterLabel: "db-1",
      scoreBefore: 70, scoreAfter: 88, scoreDelta: 18,
      categories: [], weakestCategory: null,
    } as never);

    const result = await handleServerCompare({ serverA: "web-1", serverB: "db-1", fresh: true });

    expect(result.isError).toBeFalsy();
    expect(mockedAuditIndex.runAudit).toHaveBeenCalledWith("10.0.0.1", "web-1", "coolify");
    expect(mockedAuditIndex.runAudit).toHaveBeenCalledWith("10.0.0.2", "db-1", "coolify");
    expect(mockedDiff.diffAudits).not.toHaveBeenCalled();
    expect(mockedDiff.buildCategorySummary).toHaveBeenCalled();
  });

  // ── 3. Detail mode — check-level diff ───────────────────────────────────

  it("should return check-level diff when detail=true", async () => {
    mockedSnapshot.listSnapshots.mockResolvedValue([
      { filename: "web-1.json", name: "web-1", savedAt: "2026-03-01T00:00:00Z", overallScore: 72 },
    ]);
    mockedSnapshot.loadSnapshot.mockReturnValueOnce(
      Promise.resolve(makeSnapshot("web-1", 72)) as never,
    ).mockReturnValueOnce(
      Promise.resolve(makeSnapshot("db-1", 85)) as never,
    );
    mockedDiff.diffAudits.mockReturnValue({
      beforeLabel: "web-1", afterLabel: "db-1",
      scoreBefore: 72, scoreAfter: 85, scoreDelta: 13,
      improvements: [], regressions: [], unchanged: [
        { id: "SSH-001", name: "SSH check", category: "SSH", severity: "medium" as const, status: "unchanged" as const, before: true, after: true },
      ], added: [], removed: [],
    } as never);

    const result = await handleServerCompare({ serverA: "web-1", serverB: "db-1", detail: true });

    expect(result.isError).toBeFalsy();
    const body = JSON.parse(result.content[0].text);
    expect(body.format).toBe("check");
    expect(body.serverA).toBe("web-1");
    expect(body.serverB).toBe("db-1");
    expect(mockedDiff.diffAudits).toHaveBeenCalled();
    expect(mockedDiff.buildCategorySummary).not.toHaveBeenCalled();
  });

  // ── 4. Summary mode (default) — category-level diff ─────────────────────

  it("should return category-level diff by default", async () => {
    mockedSnapshot.listSnapshots.mockResolvedValue([
      { filename: "web-1.json", name: "web-1", savedAt: "2026-03-01T00:00:00Z", overallScore: 72 },
    ]);
    mockedSnapshot.loadSnapshot
      .mockReturnValueOnce(Promise.resolve(makeSnapshot("web-1", 72)) as never)
      .mockReturnValueOnce(Promise.resolve(makeSnapshot("db-1", 90)) as never);
    mockedDiff.buildCategorySummary.mockReturnValue({
      beforeLabel: "web-1", afterLabel: "db-1",
      scoreBefore: 72, scoreAfter: 90, scoreDelta: 18,
      categories: [{ category: "SSH", scoreBefore: 8, scoreAfter: 10, delta: 2, passedBefore: 1, passedAfter: 1, totalBefore: 1, totalAfter: 1 }],
      weakestCategory: null,
    } as never);

    const result = await handleServerCompare({ serverA: "web-1", serverB: "db-1" });

    expect(result.isError).toBeFalsy();
    const body = JSON.parse(result.content[0].text);
    expect(body.format).toBe("category");
    expect(body.overallDelta).toBe(18);
    expect(body.categories).toBeInstanceOf(Array);
    expect(mockedDiff.buildCategorySummary).toHaveBeenCalled();
  });

  // ── 5. serverA === serverB ───────────────────────────────────────────

  it("should reject same server", async () => {
    mockedConfig.getServers.mockReturnValue([serverA]);

    const result = await handleServerCompare({ serverA: "web-1", serverB: "web-1" });

    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0].text);
    expect(body.error).toMatch(/different/i);
  });

  // ── 6. Server not found ───────────────────────────────────────────────

  it("should return error when server not found", async () => {
    mockedConfig.getServers.mockReturnValue([serverA, serverB]);

    const result = await handleServerCompare({ serverA: "web-1", serverB: "ghost-server" });

    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0].text);
    expect(body.error).toMatch(/Server not found/);
    expect(body.error).toMatch(/ghost-server/);
  });

  // ── 7. Schema round-trip ───────────────────────────────────────────────

  it("should produce structuredContent matching outputSchema", async () => {
    mockedSnapshot.listSnapshots.mockResolvedValue([
      { filename: "web-1.json", name: "web-1", savedAt: "2026-03-01T00:00:00Z", overallScore: 72 },
    ]);
    mockedSnapshot.loadSnapshot.mockReturnValueOnce(
      Promise.resolve(makeSnapshot("web-1", 72)) as never,
    ).mockReturnValueOnce(
      Promise.resolve(makeSnapshot("db-1", 85)) as never,
    );
    mockedDiff.buildCategorySummary.mockReturnValue({
      beforeLabel: "web-1", afterLabel: "db-1",
      scoreBefore: 72, scoreAfter: 85, scoreDelta: 13,
      categories: [{ category: "SSH", scoreBefore: 8, scoreAfter: 10, delta: 2, passedBefore: 1, passedAfter: 1, totalBefore: 1, totalAfter: 1 }],
      weakestCategory: null,
    } as never);

    const result = await handleServerCompare({ serverA: "web-1", serverB: "db-1" });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeDefined();
    const parsed = serverCompareOutputSchema.safeParse(
      { result: (result as { structuredContent?: unknown }).structuredContent },
    );
    expect(parsed.success).toBe(true);
  });

});