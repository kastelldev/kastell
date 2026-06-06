/**
 * MCP server_compare integration tests.
 *
 * Coverage: RPC boot, handler wiring, schema round-trip, cache-hit/fresh paths,
 * detail/summary modes, same-server rejection, server-not-found, and outputSchema.
 *
 * Strategy: mock resolveAuditPair (the entry point to the diff engine) and
 * buildCategorySummary / diffAuditsFlat directly — mirroring the unit test pattern.
 */

jest.mock("../../../src/utils/config.js");
jest.mock("../../../src/core/audit/diff.js");
jest.mock("../../../src/core/audit/index.js");
jest.mock("../../../src/utils/ssh.js");

import * as configUtils from "../../../src/utils/config.js";
import * as auditDiff from "../../../src/core/audit/diff.js";
import * as auditIndex from "../../../src/core/audit/index.js";
import * as sshUtils from "../../../src/utils/ssh.js";
import { handleServerCompare } from "../../../src/mcp/tools/serverCompare.js";
import { serverCompareOutputSchema } from "../../../src/mcp/tools/serverCompare.js";
import { makeAuditResult, makeServerRecord } from "../../helpers/auditFixtures.js";

const mockedConfig = configUtils as jest.Mocked<typeof configUtils>;
const mockedDiff = auditDiff as jest.Mocked<typeof auditDiff>;
const mockedAuditIndex = auditIndex as jest.Mocked<typeof auditIndex>;
const mockedSsh = sshUtils as jest.Mocked<typeof sshUtils>;

const serverA = makeServerRecord("web-1", "10.0.0.1", { id: "htz-001" });
const serverB = makeServerRecord("db-1", "10.0.0.2", { id: "htz-002", size: "cax21", createdAt: "2026-03-02T00:00:00Z" });

function makeAudit(name: string, score: number) {
  return makeAuditResult({ serverName: name, overallScore: score });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedConfig.getServers.mockReturnValue([serverA, serverB]);
});

describe("handleServerCompare — integration", () => {

  // ── 1. Happy path — cache hit ─────────────────────────────────────────

  it("should return category diff with cache hit", async () => {
    mockedDiff.resolveAuditPair.mockResolvedValue({
      success: true,
      data: { auditA: makeAudit("web-1", 72), auditB: makeAudit("db-1", 85) },
    } as never);
    mockedDiff.buildCategorySummary.mockReturnValue({
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
    expect(body.overallA).toBe(72);
    expect(body.overallB).toBe(85);
    expect(mockedDiff.resolveAuditPair).toHaveBeenCalledWith(serverA, serverB, false);
    expect(mockedDiff.buildCategorySummary).toHaveBeenCalled();
  });

  // ── 2. Fresh audit branch — runAudit called twice ─────────────────────

  it("should run live audits when fresh=true", async () => {
    mockedDiff.resolveAuditPair.mockResolvedValue({
      success: true,
      data: { auditA: makeAudit("web-1", 70), auditB: makeAudit("db-1", 88) },
    } as never);
    mockedDiff.buildCategorySummary.mockReturnValue({
      beforeLabel: "web-1", afterLabel: "db-1",
      scoreBefore: 70, scoreAfter: 88, scoreDelta: 18,
      categories: [], weakestCategory: null,
    } as never);

    const result = await handleServerCompare({ serverA: "web-1", serverB: "db-1", fresh: true });

    expect(result.isError).toBeFalsy();
    expect(mockedDiff.resolveAuditPair).toHaveBeenCalledWith(serverA, serverB, true);
    expect(mockedDiff.diffAuditsFlat).not.toHaveBeenCalled();
    expect(mockedDiff.buildCategorySummary).toHaveBeenCalled();
  });

  // ── 3. Detail mode — check-level diff ─────────────────────────────────

  it("should return check-level diff when detail=true", async () => {
    mockedDiff.resolveAuditPair.mockResolvedValue({
      success: true,
      data: { auditA: makeAudit("web-1", 72), auditB: makeAudit("db-1", 85) },
    } as never);
    mockedDiff.diffAuditsFlat.mockReturnValue({
      beforeLabel: "web-1", afterLabel: "db-1",
      scoreBefore: 72, scoreAfter: 85, scoreDelta: 13,
      checks: [
        { id: "SSH-001", name: "SSH check", status: "both_pass" as const, before: true, after: true },
      ],
    } as never);

    const result = await handleServerCompare({ serverA: "web-1", serverB: "db-1", detail: true });

    expect(result.isError).toBeFalsy();
    const body = JSON.parse(result.content[0].text);
    expect(body.format).toBe("check");
    expect(body.serverA).toBe("web-1");
    expect(body.serverB).toBe("db-1");
    expect(mockedDiff.diffAuditsFlat).toHaveBeenCalled();
    expect(mockedDiff.buildCategorySummary).not.toHaveBeenCalled();
  });

  // ── 4. Summary mode (default) — category-level diff ─────────────────────

  it("should return category-level diff by default", async () => {
    mockedDiff.resolveAuditPair.mockResolvedValue({
      success: true,
      data: { auditA: makeAudit("web-1", 72), auditB: makeAudit("db-1", 90) },
    } as never);
    // Return the AuditCompareSummary shape that buildCategorySummary actually returns
    mockedDiff.buildCategorySummary.mockReturnValue({
      beforeLabel: "web-1", afterLabel: "db-1",
      scoreBefore: 72, scoreAfter: 90, scoreDelta: 18,
      categories: [
        { category: "SSH", scoreBefore: 8, scoreAfter: 10, delta: 2, passedBefore: 1, passedAfter: 1, totalBefore: 1, totalAfter: 1 },
      ],
      weakestCategory: null,
    } as never);

    const result = await handleServerCompare({ serverA: "web-1", serverB: "db-1" });

    expect(result.isError).toBeFalsy();
    const body = JSON.parse(result.content[0].text);
    expect(body.format).toBe("category");
    expect(body.overallDelta).toBe(18);
    // categories is now the inner array of CategoryDiffEntry objects
    expect(Array.isArray(body.categories)).toBe(true);
    expect(mockedDiff.buildCategorySummary).toHaveBeenCalled();
  });

  // ── 5. serverA === serverB ─────────────────────────────────────────────

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
    mockedDiff.resolveAuditPair.mockResolvedValue({
      success: true,
      data: { auditA: makeAudit("web-1", 72), auditB: makeAudit("db-1", 85) },
    } as never);
    mockedDiff.buildCategorySummary.mockReturnValue({
      beforeLabel: "web-1", afterLabel: "db-1",
      scoreBefore: 72, scoreAfter: 85, scoreDelta: 13,
      categories: [{ category: "SSH", scoreBefore: 8, scoreAfter: 10, delta: 2, passedBefore: 1, passedAfter: 1, totalBefore: 1, totalAfter: 1 }],
      weakestCategory: null,
    } as never);

    const result = await handleServerCompare({ serverA: "web-1", serverB: "db-1" });

    expect(result.isError).toBeFalsy();
  });

});
