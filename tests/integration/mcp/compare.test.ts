/**
 * MCP server_compare integration tests.
 *
 * Coverage: RPC boot, handler wiring, schema round-trip, cache-hit/fresh paths,
 * detail/summary modes, same-server rejection, server-not-found, and outputSchema.
 *
 * Strategy: mock I/O boundaries (config, ssh, snapshot, audit index), exercise real handler.
 */

import * as configUtils from "../../../src/utils/config.js";
import * as auditDiff from "../../../src/core/audit/diff.js";
import * as auditSnapshot from "../../../src/core/audit/snapshot.js";
import * as auditIndex from "../../../src/core/audit/index.js";
import * as sshUtils from "../../../src/utils/ssh.js";
import { handleServerCompare } from "../../../src/mcp/tools/serverCompare.js";
import { serverCompareOutputSchema } from "../../../src/mcp/tools/serverCompare.js";

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

beforeEach(() => jest.clearAllMocks());

describe("handleServerCompare — integration", () => {

  // ── 1. Happy path — cache hit (snapshots exist) ──────────────────────────

  it("should return category diff with cache hit", async () => {
    const getServersSpy = jest.spyOn(configUtils, "getServers").mockReturnValue([serverA, serverB]);
    const findServerSpy = jest.spyOn(configUtils, "findServer");
    const listSnapshotsSpy = jest.spyOn(auditSnapshot, "listSnapshots").mockResolvedValue([
      { filename: "snap-001.json", name: "snap", timestamp: new Date().toISOString() },
    ]);
    const loadSnapshotSpy = jest.spyOn(auditSnapshot, "loadSnapshot").mockResolvedValue({
      audit: makeAudit("web-1", 72), timestamp: new Date().toISOString(), filename: "snap-001.json",
    } as never);
    const buildCategorySummarySpy = jest.spyOn(auditDiff, "buildCategorySummary").mockReturnValue({
      beforeLabel: "web-1", afterLabel: "db-1",
      scoreBefore: 72, scoreAfter: 85, scoreDelta: 13,
      categories: [{ category: "SSH", scoreBefore: 8, scoreAfter: 10, delta: 2, passedBefore: 1, passedAfter: 1, totalBefore: 1, totalAfter: 1 }],
      weakestCategory: null,
    } as never);

    const result = await handleServerCompare({ serverA: "web-1", serverB: "db-1" });

    expect(result.isError).toBeFalsy();
    const body = JSON.parse(result.content[0].text);
    expect(body.format).toBe("category");
    expect(body.serverA).toBe("web-1");
    expect(body.serverB).toBe("db-1");
    expect(body.overallDelta).toBe(13);
    expect(listSnapshotsSpy).toHaveBeenCalledTimes(2);
    expect(buildCategorySummarySpy).toHaveBeenCalled();

    getServersSpy.mockRestore(); findServerSpy.mockRestore();
    listSnapshotsSpy.mockRestore(); loadSnapshotSpy.mockRestore();
    buildCategorySummarySpy.mockRestore();
  });

  // ── 2. Fresh audit branch — runAudit called twice ───────────────────────

  it("should run live audits when fresh=true", async () => {
    const getServersSpy = jest.spyOn(configUtils, "getServers").mockReturnValue([serverA, serverB]);
    const assertValidIpSpy = jest.spyOn(sshUtils, "assertValidIp").mockReturnValue(undefined);
    const runAuditA = jest.spyOn(auditIndex, "runAudit").mockResolvedValue({
      success: true, data: makeAudit("web-1", 70),
    } as never);
    const runAuditB = jest.spyOn(auditIndex, "runAudit").mockResolvedValue({
      success: true, data: makeAudit("db-1", 88),
    } as never);
    const buildCategorySummarySpy = jest.spyOn(auditDiff, "buildCategorySummary").mockReturnValue({
      beforeLabel: "web-1", afterLabel: "db-1",
      scoreBefore: 70, scoreAfter: 88, scoreDelta: 18,
      categories: [], weakestCategory: null,
    } as never);

    const result = await handleServerCompare({ serverA: "web-1", serverB: "db-1", fresh: true });

    expect(result.isError).toBeFalsy();
    expect(runAuditA).toHaveBeenCalledWith("10.0.0.1", "web-1", "coolify");
    expect(runAuditB).toHaveBeenCalledWith("10.0.0.2", "db-1", "coolify");

    getServersSpy.mockRestore(); assertValidIpSpy.mockRestore();
    runAuditA.mockRestore(); runAuditB.mockRestore();
    buildCategorySummarySpy.mockRestore();
  });

  // ── 3. Detail mode — check-level diff ───────────────────────────────────

  it("should return check-level diff when detail=true", async () => {
    const getServersSpy = jest.spyOn(configUtils, "getServers").mockReturnValue([serverA, serverB]);
    const listSnapshotsSpy = jest.spyOn(auditSnapshot, "listSnapshots").mockResolvedValue([
      { filename: "a.json", name: "snap", timestamp: new Date().toISOString() },
    ]);
    const loadSnapshotSpy = jest.spyOn(auditSnapshot, "loadSnapshot").mockResolvedValue({
      audit: makeAudit("web-1", 72), timestamp: new Date().toISOString(), filename: "a.json",
    } as never);
    const diffAuditsSpy = jest.spyOn(auditDiff, "diffAudits").mockReturnValue({
      beforeLabel: "web-1", afterLabel: "db-1",
      scoreBefore: 72, scoreAfter: 85, scoreDelta: 13,
      improvements: [], regressions: [], unchanged: [
        { id: "SSH-001", name: "SSH check", category: "SSH", severity: "medium", status: "unchanged", before: true, after: true },
      ], added: [], removed: [],
    } as never);

    const result = await handleServerCompare({ serverA: "web-1", serverB: "db-1", detail: true });

    expect(result.isError).toBeFalsy();
    const body = JSON.parse(result.content[0].text);
    expect(body.format).toBe("check");
    expect(body.checks).toHaveLength(1);
    expect(body.checks[0].status).toBe("same");
    expect(diffAuditsSpy).toHaveBeenCalled();
    expect(auditDiff.buildCategorySummary).not.toHaveBeenCalled();

    getServersSpy.mockRestore(); listSnapshotsSpy.mockRestore();
    loadSnapshotSpy.mockRestore(); diffAuditsSpy.mockRestore();
  });

  // ── 4. Summary mode (default) — category-level diff ─────────────────────

  it("should return category-level diff by default", async () => {
    const getServersSpy = jest.spyOn(configUtils, "getServers").mockReturnValue([serverA, serverB]);
    const listSnapshotsSpy = jest.spyOn(auditSnapshot, "listSnapshots").mockResolvedValue([
      { filename: "a.json", name: "snap", timestamp: new Date().toISOString() },
    ]);
    const loadSnapshotSpy = jest.spyOn(auditSnapshot, "loadSnapshot").mockResolvedValue({
      audit: makeAudit("web-1", 72), timestamp: new Date().toISOString(), filename: "a.json",
    } as never);
    const buildCategorySummarySpy = jest.spyOn(auditDiff, "buildCategorySummary").mockReturnValue({
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
    expect(body.categories).toHaveLength(1);
    expect(buildCategorySummarySpy).toHaveBeenCalled();

    getServersSpy.mockRestore(); listSnapshotsSpy.mockRestore();
    loadSnapshotSpy.mockRestore(); buildCategorySummarySpy.mockRestore();
  });

  // ── 5. serverA === serverB ───────────────────────────────────────────────

  it("should reject same server", async () => {
    const getServersSpy = jest.spyOn(configUtils, "getServers").mockReturnValue([serverA]);

    const result = await handleServerCompare({ serverA: "web-1", serverB: "web-1" });

    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0].text);
    expect(body.error).toMatch(/different/i);

    getServersSpy.mockRestore();
  });

  // ── 6. Server not found ─────────────────────────────────────────────────

  it("should return error when server not found", async () => {
    const getServersSpy = jest.spyOn(configUtils, "getServers").mockReturnValue([serverA, serverB]);

    const result = await handleServerCompare({ serverA: "web-1", serverB: "ghost-server" });

    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0].text);
    expect(body.error).toMatch(/Server not found/);
    expect(body.error).toMatch(/ghost-server/);

    getServersSpy.mockRestore();
  });

  // ── 7. Schema round-trip ────────────────────────────────────────────────

  it("should produce structuredContent matching outputSchema", async () => {
    const getServersSpy = jest.spyOn(configUtils, "getServers").mockReturnValue([serverA, serverB]);
    const listSnapshotsSpy = jest.spyOn(auditSnapshot, "listSnapshots").mockResolvedValue([
      { filename: "a.json", name: "snap", timestamp: new Date().toISOString() },
    ]);
    const loadSnapshotSpy = jest.spyOn(auditSnapshot, "loadSnapshot").mockResolvedValue({
      audit: makeAudit("web-1", 72), timestamp: new Date().toISOString(), filename: "a.json",
    } as never);
    const buildCategorySummarySpy = jest.spyOn(auditDiff, "buildCategorySummary").mockReturnValue({
      beforeLabel: "web-1", afterLabel: "db-1",
      scoreBefore: 72, scoreAfter: 85, scoreDelta: 13,
      categories: [{ category: "SSH", scoreBefore: 8, scoreAfter: 10, delta: 2, passedBefore: 1, passedAfter: 1, totalBefore: 1, totalAfter: 1 }],
      weakestCategory: null,
    } as never);

    const result = await handleServerCompare({ serverA: "web-1", serverB: "db-1" });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeDefined();
    expect(() => serverCompareOutputSchema.parse({ result: (result as { structuredContent?: unknown }).structuredContent })).not.toThrow();

    getServersSpy.mockRestore(); listSnapshotsSpy.mockRestore();
    loadSnapshotSpy.mockRestore(); buildCategorySummarySpy.mockRestore();
  });

});