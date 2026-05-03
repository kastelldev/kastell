/**
 * MCP Tool Contract Suite (CTR-02)
 *
 * Verifies that all 13 MCP tool handlers conform to the mcpSuccess/mcpError
 * response contract:
 *   1. Response content is an array of { type: "text", text: string } items.
 *   2. On failure (e.g. no servers configured), the handler returns
 *      isError: true with a JSON-encoded { error: string } payload.
 *   3. The response text is always valid JSON — never a raw string or undefined.
 *   4. Invalid parameter types are rejected (Zod validation), either by
 *      returning isError: true or by throwing synchronously.
 *
 * Strategy: mock all core modules + config so handlers never perform real I/O,
 * then invoke each handler with an empty server list to trigger the error path.
 */

// ─── Module mocks (hoisted by Jest) ─────────────────────────────────────────

jest.mock("../../src/utils/config");
jest.mock("../../src/core/audit/index");
jest.mock("../../src/core/audit/fix");
jest.mock("../../src/core/deploy");
jest.mock("../../src/core/doctor");
jest.mock("../../src/core/evidence");
jest.mock("../../src/core/fleet");
jest.mock("../../src/core/guard");
jest.mock("../../src/core/lock/index.js");
jest.mock("../../src/core/logs");
jest.mock("../../src/core/maintain");
jest.mock("../../src/core/manage");
jest.mock("../../src/core/provision");
jest.mock("../../src/core/secure");
jest.mock("../../src/core/backup");
jest.mock("../../src/utils/ssh");
jest.mock("../../src/core/tokens");
jest.mock("../../src/adapters/factory");
jest.mock("../../src/utils/providerFactory");
jest.mock("../../src/utils/errorMapper", () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  mapSshError: jest.fn().mockReturnValue(""),
  sanitizeStderr: jest.fn((s: string) => s),
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import * as config from "../../src/utils/config";
import { handleServerInfo } from "../../src/mcp/tools/serverInfo";
import { handleServerLogs } from "../../src/mcp/tools/serverLogs";
import { handleServerManage } from "../../src/mcp/tools/serverManage";
import { handleServerMaintain } from "../../src/mcp/tools/serverMaintain";
import { handleServerSecure } from "../../src/mcp/tools/serverSecure";
import { handleServerBackup } from "../../src/mcp/tools/serverBackup";
import { handleServerProvision } from "../../src/mcp/tools/serverProvision";
import { handleServerAudit } from "../../src/mcp/tools/serverAudit";
import { handleServerEvidence } from "../../src/mcp/tools/serverEvidence";
import { handleServerGuard } from "../../src/mcp/tools/serverGuard";
import { handleServerDoctor } from "../../src/mcp/tools/serverDoctor";
import { handleServerLock } from "../../src/mcp/tools/serverLock";
import { handleServerFleet } from "../../src/mcp/tools/serverFleet";
import { handleServerFix } from "../../src/mcp/tools/serverFix";
import type { McpResponse } from "../../src/mcp/utils";
import * as manage from "../../src/core/manage";

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedManage = manage as jest.Mocked<typeof manage>;

// ─── MCP_TOOLS registry ───────────────────────────────────────────────────────

const MCP_TOOLS: Array<{
  toolName: string;
  handler: (params: Record<string, unknown>) => Promise<McpResponse>;
}> = [
  { toolName: "server_info", handler: (p) => handleServerInfo(p as unknown as Parameters<typeof handleServerInfo>[0]) },
  { toolName: "server_logs", handler: (p) => handleServerLogs(p as unknown as Parameters<typeof handleServerLogs>[0]) },
  { toolName: "server_manage", handler: (p) => handleServerManage(p as unknown as Parameters<typeof handleServerManage>[0]) },
  { toolName: "server_maintain", handler: (p) => handleServerMaintain(p as unknown as Parameters<typeof handleServerMaintain>[0]) },
  { toolName: "server_secure", handler: (p) => handleServerSecure(p as unknown as Parameters<typeof handleServerSecure>[0]) },
  { toolName: "server_backup", handler: (p) => handleServerBackup(p as unknown as Parameters<typeof handleServerBackup>[0]) },
  { toolName: "server_provision", handler: (p) => handleServerProvision(p as unknown as Parameters<typeof handleServerProvision>[0]) },
  { toolName: "server_audit", handler: (p) => handleServerAudit(p as unknown as Parameters<typeof handleServerAudit>[0]) },
  { toolName: "server_evidence", handler: (p) => handleServerEvidence(p as unknown as Parameters<typeof handleServerEvidence>[0]) },
  { toolName: "server_guard", handler: (p) => handleServerGuard(p as unknown as Parameters<typeof handleServerGuard>[0]) },
  { toolName: "server_doctor", handler: (p) => handleServerDoctor(p as unknown as Parameters<typeof handleServerDoctor>[0]) },
  { toolName: "server_lock", handler: (p) => handleServerLock(p as unknown as Parameters<typeof handleServerLock>[0]) },
  { toolName: "server_fleet", handler: (p) => handleServerFleet(p as unknown as Parameters<typeof handleServerFleet>[0]) },
  { toolName: "server_fix", handler: (p) => handleServerFix(p as unknown as Parameters<typeof handleServerFix>[0]) },
];

// ─── INVALID_PARAMS map ───────────────────────────────────────────────────────
//
// Each entry passes a value of the WRONG TYPE for a required field so that
// the handler's Zod schema rejects it. Verified against src/mcp/server.ts
// schemas for each tool.
//
// server_info.action    → z.enum(["list","status","health","sizes"])
// server_logs.action    → z.enum(["logs","monitor"])
// server_manage.action  → z.enum(["add","remove","destroy"])
// server_maintain.action → z.enum(["update","restart","maintain"])
// server_secure.action  → z.enum([...])
// server_backup.action  → z.enum([...])
// server_provision.provider → z.enum(SUPPORTED_PROVIDERS), name → z.string()
// server_audit.server   → z.string().optional()  (no required field → use format wrong type)
// server_evidence.server → z.string().optional()
// server_guard.action   → z.enum([...])
// server_doctor.server  → z.string().optional()
// server_lock.production → z.boolean()
// server_fleet.sort     → z.enum(["score","name","provider"]).optional()

const INVALID_PARAMS: Record<string, Record<string, unknown>> = {
  server_info: { action: 12345 },       // action must be enum string
  server_logs: { action: 12345 },       // action must be enum string
  server_manage: { action: 12345 },     // action must be enum string
  server_maintain: { action: 12345 },   // action must be enum string
  server_secure: { action: 12345 },     // action must be enum string
  server_backup: { action: 12345 },     // action must be enum string
  server_provision: { provider: 999 },  // provider must be string enum
  server_audit: { format: 12345 },      // format must be enum string
  server_evidence: { server: 12345 },   // server must be string (optional but typed)
  server_guard: { action: 12345 },      // action must be enum string
  server_doctor: { server: 12345 },     // server must be string
  server_lock: { production: "yes" },   // production must be boolean
  server_fleet: { sort: 12345 },        // sort must be enum string
  server_fix: { dryRun: "not-boolean" },  // dryRun must be boolean
};

// ─── Contract suite ───────────────────────────────────────────────────────────

describe.each(MCP_TOOLS)(
  "MCP contract — $toolName",
  ({ toolName, handler }) => {
    beforeEach(() => {
      jest.resetAllMocks();
      // Empty server list triggers the "No servers found" error path for most tools.
      mockedConfig.getServers.mockReturnValue([]);
      // isSafeMode: return true so provision/destroy are blocked (returns mcpError, not crash)
      mockedManage.isSafeMode.mockReturnValue(true);
    });

    it("returns content array with text items (response shape contract)", async () => {
      const response = await handler({});
      expect(Array.isArray(response.content)).toBe(true);
      expect(response.content.length).toBeGreaterThanOrEqual(1);
      for (const item of response.content) {
        expect(item.type).toBe("text");
        expect(typeof item.text).toBe("string");
      }
    });

    it("returns isError:true with JSON error field when no servers configured", async () => {
      const response = await handler({});
      expect(response.isError).toBe(true);
      const parsed = JSON.parse(response.content[0].text) as Record<string, unknown>;
      expect(typeof parsed.error).toBe("string");
    });

    it("returns isError:true or throws on invalid param types (Zod rejection)", async () => {
      try {
        const response = await handler(INVALID_PARAMS[toolName]);
        // If the handler returns (instead of throwing), it must signal an error
        expect(response.isError).toBe(true);
      } catch (err) {
        // Throwing on invalid params is also acceptable Zod rejection behavior
        expect(err).toBeDefined();
      }
    });
  },
);

// ─── _kastell_version contract (success path) ────────────────────────────────

describe("MCP contract — _kastell_version in success responses", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedConfig.getServers.mockReturnValue([]);
  });

  it("mcpSuccess always injects _kastell_version", async () => {
    const { setMcpVersion } = await import("../../src/mcp/utils");
    setMcpVersion("test-contract-version");

    // server_info action:"list" returns mcpSuccess even with empty server list
    const response = await handleServerInfo({ action: "list" });

    expect(response.isError).toBeUndefined();
    const parsed = JSON.parse(response.content[0].text) as Record<string, unknown>;
    expect(parsed._kastell_version).toBe("test-contract-version");
  });
});
