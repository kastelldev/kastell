/**
 * MCP structuredContent + outputSchema Verification Tests
 *
 * Purpose: Verify that MCP tools return structuredContent that validates
 * against their outputSchema, and _kastell_version appears in content.text only.
 */

jest.mock("../../src/utils/config.js");
jest.mock("../../src/core/audit/index.js");
jest.mock("../../src/core/manage.js");
jest.mock("../../src/core/provision.js");
jest.mock("../../src/core/status.js");
jest.mock("../../src/adapters/factory.js");
jest.mock("../../src/core/tokens.js");
jest.mock("../../src/core/lock/index.js");
jest.mock("../../src/core/maintain.js");
jest.mock("../../src/core/update.js");
jest.mock("../../src/utils/ssh.js");
jest.mock("../../src/mcp/utils.js", () => ({
  ...jest.requireActual("../../src/mcp/utils.js"),
  mcpLog: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../src/utils/version.js", () => ({ getKastellVersion: () => "2.2.0" }));

import { z } from "zod";
import { normalizeObjectSchema, safeParseAsync } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import * as configUtils from "../../src/utils/config.js";
import * as coreAudit from "../../src/core/audit/index.js";
import * as coreManage from "../../src/core/manage.js";
import * as coreProvision from "../../src/core/provision.js";
import * as coreStatus from "../../src/core/status.js";
import * as coreLock from "../../src/core/lock/index.js";
import * as coreMaintain from "../../src/core/maintain.js";
import * as coreUpdate from "../../src/core/update.js";
import * as adapterFactory from "../../src/adapters/factory.js";
import * as coreTokens from "../../src/core/tokens.js";

import { handleServerAudit } from "../../src/mcp/tools/serverAudit.js";
import { handleServerProvision } from "../../src/mcp/tools/serverProvision.js";
import { handleServerLock } from "../../src/mcp/tools/serverLock.js";
import { handleServerInfo } from "../../src/mcp/tools/serverInfo.js";
import { handleServerManage } from "../../src/mcp/tools/serverManage.js";
import { handleServerMaintain } from "../../src/mcp/tools/serverMaintain.js";
import { handleServerDoctor } from "../../src/mcp/tools/serverDoctor.js";
import { handleServerFleet } from "../../src/mcp/tools/serverFleet.js";
import { handleServerCompare } from "../../src/mcp/tools/serverCompare.js";
import { handleServerPlugin } from "../../src/mcp/tools/serverPlugin.js";
import { handleServerLogs } from "../../src/mcp/tools/serverLogs.js";
import { handleServerGuard } from "../../src/mcp/tools/serverGuard.js";

import { serverAuditOutputSchema } from "../../src/mcp/tools/serverAudit.js";
import { serverProvisionOutputSchema } from "../../src/mcp/tools/serverProvision.js";
import { serverLockOutputSchema } from "../../src/mcp/tools/serverLock.js";
import { serverInfoOutputSchema } from "../../src/mcp/tools/serverInfo.js";
import { serverManageOutputSchema } from "../../src/mcp/tools/serverManage.js";
import { serverMaintainOutputSchema } from "../../src/mcp/tools/serverMaintain.js";
import { serverDoctorOutputSchema } from "../../src/mcp/tools/serverDoctor.js";
import { serverFleetOutputSchema } from "../../src/mcp/tools/serverFleet.js";
import { serverCompareOutputSchema } from "../../src/mcp/tools/serverCompare.js";
import { serverPluginOutputSchema } from "../../src/mcp/tools/serverPlugin.js";
import { serverLogsOutputSchema } from "../../src/mcp/tools/serverLogs.js";
import { serverGuardOutputSchema } from "../../src/mcp/tools/serverGuard.js";
import { serverBackupOutputSchema } from "../../src/mcp/tools/serverBackup.js";
import { serverEvidenceOutputSchema } from "../../src/mcp/tools/serverEvidence.js";
import { serverFixOutputSchema } from "../../src/mcp/tools/serverFix.js";
import { serverExplainOutputSchema } from "../../src/mcp/tools/serverExplain.js";
import { serverSecureOutputSchema } from "../../src/mcp/tools/serverSecure.js";

import { mcpSuccess } from "../../src/mcp/utils.js";
import type { McpResponse } from "../../src/mcp/utils.js";

const mockedConfig = configUtils as jest.Mocked<typeof configUtils>;
const mockedCoreAudit = coreAudit as jest.Mocked<typeof coreAudit>;
const mockedCoreManage = coreManage as jest.Mocked<typeof coreManage>;
const mockedCoreProvision = coreProvision as jest.Mocked<typeof coreProvision>;
const mockedCoreStatus = coreStatus as jest.Mocked<typeof coreStatus>;
const mockedCoreLock = coreLock as jest.Mocked<typeof coreLock>;
const mockedCoreMaintain = coreMaintain as jest.Mocked<typeof coreMaintain>;
const mockedCoreUpdate = coreUpdate as jest.Mocked<typeof coreUpdate>;
const mockedAdapterFactory = adapterFactory as jest.Mocked<typeof adapterFactory>;
const mockedCoreTokens = coreTokens as jest.Mocked<typeof coreTokens>;

const sampleServer = {
  id: "htz-001",
  name: "my-server",
  provider: "hetzner" as const,
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-03-01T00:00:00Z",
  mode: "coolify" as const,
  platform: "coolify" as const,
};

const sampleAuditResult = {
  serverIp: "1.2.3.4",
  serverName: "my-server",
  platform: "coolify" as const,
  overallScore: 72,
  auditVersion: "1.10",
  timestamp: "2026-03-22T00:00:00.000Z",
  categories: [
    { name: "SSH", score: 8, maxScore: 10, weight: 1, checks: [] },
  ],
  quickWins: [],
  skippedCategories: [],
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function validateAgainstSchema(schema: z.ZodType, data: unknown): { valid: boolean; errors?: string[] } {
  const result = schema.safeParse(data);
  if (result.success) return { valid: true };
  return {
    valid: false,
    errors: result.error.issues.map((e) => `${String(e.path)}: ${e.message}`),
  };
}

function assertStructuredContent(response: McpResponse): Record<string, unknown> {
  expect(response.structuredContent).toBeDefined();
  return response.structuredContent as Record<string, unknown>;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("structuredContent verification", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.KASTELL_SAFE_MODE = "false";
    mockedCoreManage.isSafeMode.mockReturnValue(false);
  });

  afterEach(() => {
    delete process.env.KASTELL_SAFE_MODE;
  });

  // These tools are verified to return structuredContent:
  // - server_audit: format=summary → validates against auditOutputSchema
  // - server_provision: success path → validates against provisionOutputSchema
  // - server_doctor: fresh=false (no SSH) → validates against doctorOutputSchema
  // - server_fleet: single server → validates against fleetOutputSchema
  // - server_plugin: list action → validates against pluginOutputSchema

  describe("mcpSuccess _kastell_version", () => {
    it("should include _kastell_version in content.text", () => {
      const response = mcpSuccess({ success: true, server: "test" });
      const parsed = JSON.parse(response.content[0].text);
      expect(parsed).toHaveProperty("_kastell_version");
    });

    it("should NOT include _kastell_version in structuredContent", () => {
      const response = mcpSuccess({ success: true, server: "test" });
      expect(response.structuredContent).not.toHaveProperty("_kastell_version");
      expect(response.structuredContent).toHaveProperty("result");
      expect((response.structuredContent as Record<string, unknown>).result).toHaveProperty("success", true);
    });
  });

  describe("server_audit", () => {
    it("should return structuredContent validating against audit schema", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedConfig.findServer.mockReturnValue(sampleServer);
      mockedCoreAudit.runAudit.mockResolvedValue({ success: true, data: sampleAuditResult });

      const result = await handleServerAudit({ format: "summary" });
      const sc = assertStructuredContent(result);
      const validation = validateAgainstSchema(serverAuditOutputSchema, sc);
      expect(validation.valid).toBe(true);
    });
  });

  describe("server_provision", () => {
    it("should return structuredContent validating against provision schema", async () => {
      mockedCoreProvision.provisionServer.mockResolvedValue({
        success: true,
        server: { id: "htz-new", name: "staging", provider: "hetzner", ip: "10.0.0.1", region: "nbg1", size: "cax11", createdAt: new Date().toISOString(), mode: "coolify" },
      });

      const result = await handleServerProvision({ provider: "hetzner", name: "staging", region: "nbg1", size: "cax11", mode: "coolify" });
      const sc = assertStructuredContent(result);
      const validation = validateAgainstSchema(serverProvisionOutputSchema, sc);
      expect(validation.valid).toBe(true);
    });
  });

  describe("server_doctor", () => {
    it("should return structuredContent validating against doctor schema", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedConfig.findServer.mockReturnValue(sampleServer);
      mockedAdapterFactory.resolvePlatform.mockReturnValue("coolify");

      const result = await handleServerDoctor({ server: "my-server", fresh: false });
      const sc = assertStructuredContent(result);
      const validation = validateAgainstSchema(serverDoctorOutputSchema, sc);
      expect(validation.valid).toBe(true);
    });
  });

  describe("server_fleet", () => {
    it("should return structuredContent validating against fleet schema", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedCoreStatus.checkServerStatus.mockResolvedValue({ server: sampleServer, serverStatus: "running", platformStatus: "running" });

      const result = await handleServerFleet({});
      const sc = assertStructuredContent(result);
      const validation = validateAgainstSchema(serverFleetOutputSchema, sc);
      expect(validation.valid).toBe(true);
    });
  });

  describe("server_plugin", () => {
    it("should return structuredContent validating against plugin schema", async () => {
      const result = await handleServerPlugin({ action: "list" });
      const sc = assertStructuredContent(result);
      const validation = validateAgainstSchema(serverPluginOutputSchema, sc);
      expect(validation.valid).toBe(true);
    });
  });
});

describe("MCP SDK round-trip verification", () => {
  const allSchemas: Array<{ name: string; schema: z.ZodType }> = [
    { name: "serverAudit", schema: serverAuditOutputSchema },
    { name: "serverProvision", schema: serverProvisionOutputSchema },
    { name: "serverLock", schema: serverLockOutputSchema },
    { name: "serverInfo", schema: serverInfoOutputSchema },
    { name: "serverManage", schema: serverManageOutputSchema },
    { name: "serverMaintain", schema: serverMaintainOutputSchema },
    { name: "serverDoctor", schema: serverDoctorOutputSchema },
    { name: "serverFleet", schema: serverFleetOutputSchema },
    { name: "serverCompare", schema: serverCompareOutputSchema },
    { name: "serverPlugin", schema: serverPluginOutputSchema },
    { name: "serverLogs", schema: serverLogsOutputSchema },
    { name: "serverGuard", schema: serverGuardOutputSchema },
    { name: "serverBackup", schema: serverBackupOutputSchema },
    { name: "serverEvidence", schema: serverEvidenceOutputSchema },
    { name: "serverFix", schema: serverFixOutputSchema },
    { name: "serverExplain", schema: serverExplainOutputSchema },
    { name: "serverSecure", schema: serverSecureOutputSchema },
  ];

  it.each(allSchemas)("$name outputSchema should survive normalizeObjectSchema", ({ schema }) => {
    const normalized = normalizeObjectSchema(schema);
    expect(normalized).toBeDefined();
    expect(normalized).not.toBeUndefined();
  });

  it("should validate structuredContent through SDK safeParseAsync", async () => {
    const response = mcpSuccess({ action: "list" as const, plugins: [], count: 0 });
    const sc = response.structuredContent;
    const normalized = normalizeObjectSchema(serverPluginOutputSchema);
    expect(normalized).toBeDefined();
    const parseResult = await safeParseAsync(normalized!, sc);
    expect(parseResult.success).toBe(true);
  });

  it("should validate discriminatedUnion structuredContent through SDK safeParseAsync", async () => {
    const response = mcpSuccess({ action: "list", servers: [], total: 0, message: "No servers", suggested_actions: [{ command: "kastell init", reason: "Deploy your first server" }] });
    const sc = response.structuredContent;
    const normalized = normalizeObjectSchema(serverInfoOutputSchema);
    expect(normalized).toBeDefined();
    const parseResult = await safeParseAsync(normalized!, sc);
    expect(parseResult.success).toBe(true);
  });

  it("should validate serverInfo sizes action through SDK safeParseAsync", async () => {
    const response = mcpSuccess({
      action: "sizes",
      provider: "hetzner",
      region: "nbg1",
      mode: "coolify",
      sizes: [
        { id: "cax11", name: "CAX11", vcpu: 2, ram: "4 GB", disk: "40 GB", price: "€3.79/mo" },
        { id: "cax21", name: "CAX21", vcpu: 4, ram: "8 GB", disk: "80 GB", price: "€7.49/mo" },
      ],
      total: 2,
      suggested_actions: [{ command: "kastell provision", reason: "Create a server" }],
    });
    const sc = response.structuredContent;
    const normalized = normalizeObjectSchema(serverInfoOutputSchema);
    expect(normalized).toBeDefined();
    const parseResult = await safeParseAsync(normalized!, sc);
    expect(parseResult.success).toBe(true);
  });

  it("should validate single bare serverInfo health through SDK safeParseAsync", async () => {
    const response = mcpSuccess({
      action: "health",
      server: "bare-node",
      ip: "9.10.11.12",
      mode: "bare",
      sshReachable: true,
      suggested_actions: [{ command: "ssh root@9.10.11.12", reason: "Connect to your bare server" }],
    });
    const normalized = normalizeObjectSchema(serverInfoOutputSchema);
    expect(normalized).toBeDefined();
    const parseResult = await safeParseAsync(normalized!, response.structuredContent);
    expect(parseResult.success).toBe(true);
  });
});
