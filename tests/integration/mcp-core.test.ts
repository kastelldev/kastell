/**
 * MCP→Core Integration Tests
 *
 * Purpose: Verify that MCP tool handlers call the correct core functions and
 * return properly shaped responses. Core functions run real code but all I/O
 * boundaries (SSH, provider API, file system config) are mocked.
 *
 * Strategy (per D-12):
 * - Mock: config reads, SSH utilities, provider API calls (axios)
 * - Real: core function logic, response construction, error handling
 */

// Mock I/O boundaries before imports
jest.mock("../../src/utils/config.js");
jest.mock("../../src/core/audit/index.js");
jest.mock("../../src/core/lock.js");
jest.mock("../../src/core/manage.js");
jest.mock("../../src/core/provision.js");
jest.mock("../../src/core/status.js");
jest.mock("../../src/adapters/factory.js");
jest.mock("../../src/core/tokens.js");
jest.mock("../../src/utils/ssh.js");
jest.mock("../../src/core/audit/history.js");
jest.mock("../../src/mcp/utils.js", () => ({
  ...jest.requireActual("../../src/mcp/utils.js"),
  mcpLog: jest.fn().mockResolvedValue(undefined),
}));

import * as configUtils from "../../src/utils/config.js";
import * as coreAudit from "../../src/core/audit/index.js";
import * as coreLock from "../../src/core/lock.js";
import * as coreManage from "../../src/core/manage.js";
import * as coreProvision from "../../src/core/provision.js";
import * as coreStatus from "../../src/core/status.js";
import * as adapterFactory from "../../src/adapters/factory.js";
import * as coreTokens from "../../src/core/tokens.js";

import { handleServerAudit } from "../../src/mcp/tools/serverAudit.js";
import { handleServerProvision } from "../../src/mcp/tools/serverProvision.js";
import { handleServerLock } from "../../src/mcp/tools/serverLock.js";
import { handleServerInfo } from "../../src/mcp/tools/serverInfo.js";
import { handleServerManage } from "../../src/mcp/tools/serverManage.js";

const mockedConfig = configUtils as jest.Mocked<typeof configUtils>;
const mockedCoreAudit = coreAudit as jest.Mocked<typeof coreAudit>;
const mockedCoreLock = coreLock as jest.Mocked<typeof coreLock>;
const mockedCoreManage = coreManage as jest.Mocked<typeof coreManage>;
const mockedCoreProvision = coreProvision as jest.Mocked<typeof coreProvision>;
const mockedCoreStatus = coreStatus as jest.Mocked<typeof coreStatus>;
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
    {
      name: "SSH",
      score: 8,
      maxScore: 10,
      weight: 1,
      checks: [],
    },
  ],
  quickWins: [],
  skippedCategories: [],
};

describe("MCP→Core Integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.KASTELL_SAFE_MODE = "false";
    // Ensure safe mode defaults to false unless overridden per-test
    mockedCoreManage.isSafeMode.mockReturnValue(false);
  });

  afterEach(() => {
    delete process.env.KASTELL_SAFE_MODE;
  });

  // ─── 1. handleServerAudit ─────────────────────────────────────────────────

  describe("handleServerAudit", () => {
    it("should return error when no servers configured", async () => {
      mockedConfig.getServers.mockReturnValue([]);

      const response = await handleServerAudit({ format: "summary" });

      expect(response.isError).toBe(true);
      const body = JSON.parse(response.content[0].text);
      expect(body.error).toMatch(/No servers/i);
    });

    it("should call runAudit with correct args and return score on success", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedConfig.findServer.mockReturnValue(sampleServer);
      mockedCoreAudit.runAudit.mockResolvedValue({
        success: true,
        data: sampleAuditResult,
      });

      const auditHistory = require("../../src/core/audit/history.js");
      (auditHistory.loadAuditHistory as jest.Mock).mockReturnValue([]);
      (auditHistory.saveAuditHistory as jest.Mock).mockResolvedValue(undefined);
      (auditHistory.detectTrend as jest.Mock).mockReturnValue("first audit");

      const response = await handleServerAudit({ server: "my-server", format: "score" });

      expect(mockedCoreAudit.runAudit).toHaveBeenCalledWith("1.2.3.4", "my-server", "coolify");
      expect(response.isError).toBeFalsy();
      const body = JSON.parse(response.content[0].text);
      expect(body.score).toBe(72);
    });

    it("should return error when runAudit fails", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedConfig.findServer.mockReturnValue(sampleServer);
      mockedCoreAudit.runAudit.mockResolvedValue({
        success: false,
        error: "SSH connection failed",
        hint: "Check SSH key",
      });

      const response = await handleServerAudit({ server: "my-server" });

      expect(response.isError).toBe(true);
      const body = JSON.parse(response.content[0].text);
      expect(body.error).toBe("SSH connection failed");
    });

    it("should return error when server name does not match", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedConfig.findServer.mockReturnValue(undefined);

      const response = await handleServerAudit({ server: "nonexistent" });

      expect(response.isError).toBe(true);
      const body = JSON.parse(response.content[0].text);
      expect(body.error).toContain("Server not found");
    });
  });

  // ─── 2. handleServerProvision ──────────────────────────────────────────────

  describe("handleServerProvision", () => {
    it("should call provisionServer with correct config and return server info", async () => {
      mockedCoreProvision.provisionServer.mockResolvedValue({
        success: true,
        server: {
          id: "htz-new",
          name: "staging-server",
          provider: "hetzner",
          ip: "10.0.0.1",
          region: "nbg1",
          size: "cax11",
          createdAt: new Date().toISOString(),
          mode: "coolify",
        },
      });

      const response = await handleServerProvision({
        provider: "hetzner",
        name: "staging-server",
        region: "nbg1",
        size: "cax11",
        mode: "coolify",
      });

      expect(mockedCoreProvision.provisionServer).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "hetzner",
          name: "staging-server",
          region: "nbg1",
          size: "cax11",
          mode: "coolify",
        }),
      );
      expect(response.isError).toBeFalsy();
      const body = JSON.parse(response.content[0].text);
      expect(body.success).toBe(true);
      expect(body.server.name).toBe("staging-server");
      expect(body.server.provider).toBe("hetzner");
    });

    it("should return error when SAFE_MODE is enabled", async () => {
      // isSafeMode is mocked from coreManage — make it return true
      mockedCoreManage.isSafeMode.mockReturnValue(true);

      const response = await handleServerProvision({
        provider: "hetzner",
        name: "test-server",
      });

      expect(response.isError).toBe(true);
      const body = JSON.parse(response.content[0].text);
      expect(body.error).toMatch(/SAFE_MODE/);
    });

    it("should return error when provisionServer fails", async () => {
      mockedCoreProvision.provisionServer.mockResolvedValue({
        success: false,
        error: "Invalid API token",
      });

      const response = await handleServerProvision({
        provider: "hetzner",
        name: "staging-server",
      });

      expect(response.isError).toBe(true);
      const body = JSON.parse(response.content[0].text);
      expect(body.error).toBe("Invalid API token");
    });
  });

  // ─── 3. handleServerLock ──────────────────────────────────────────────────

  describe("handleServerLock", () => {
    it("should call applyLock for configured server with production flag", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedConfig.findServer.mockReturnValue(sampleServer);
      mockedCoreLock.applyLock.mockResolvedValue({
        success: true,
        steps: {
          sshHardening: true,
          fail2ban: true,
          banners: true,
          accountLock: true,
          sshCipher: true,
          ufw: true,
          cloudMeta: true,
          dns: true,
          sysctl: true,
          unattendedUpgrades: true,
          aptValidation: true,
          resourceLimits: true,
          serviceDisable: true,
          backupPermissions: true,
          pwquality: true,
          auditd: true,
          logRetention: true,
          aide: true,
          cronAccess: true,
          dockerHardening: true,
          sshFineTuning: true,
          loginDefs: true,
          faillock: true,
          sudoHardening: true,
        },
      });

      const response = await handleServerLock({
        server: "my-server",
        production: true,
      });

      expect(mockedCoreLock.applyLock).toHaveBeenCalledWith(
        "1.2.3.4",
        "my-server",
        "coolify",
        expect.objectContaining({ production: true }),
      );
      expect(response.isError).toBeFalsy();
      const body = JSON.parse(response.content[0].text);
      expect(body.success).toBe(true);
    });

    it("should return error without production=true and no dryRun", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedConfig.findServer.mockReturnValue(sampleServer);

      const response = await handleServerLock({ server: "my-server" });

      expect(response.isError).toBe(true);
      expect(mockedCoreLock.applyLock).not.toHaveBeenCalled();
    });

    it("should return error when no servers configured", async () => {
      mockedConfig.getServers.mockReturnValue([]);

      const response = await handleServerLock({ production: true });

      expect(response.isError).toBe(true);
      const body = JSON.parse(response.content[0].text);
      expect(body.error).toMatch(/No servers/i);
    });
  });

  // ─── 4. handleServerInfo ──────────────────────────────────────────────────

  describe("handleServerInfo", () => {
    it("should return server list for action=list", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);

      const response = await handleServerInfo({ action: "list" });

      expect(response.isError).toBeFalsy();
      const body = JSON.parse(response.content[0].text);
      expect(body.servers).toHaveLength(1);
      expect(body.servers[0].name).toBe("my-server");
      expect(body.total).toBe(1);
    });

    it("should return empty server list with message when no servers exist", async () => {
      mockedConfig.getServers.mockReturnValue([]);

      const response = await handleServerInfo({ action: "list" });

      expect(response.isError).toBeFalsy();
      const body = JSON.parse(response.content[0].text);
      expect(body.servers).toHaveLength(0);
      expect(body.total).toBe(0);
    });

    it("should call checkServerStatus for action=status with server name", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedConfig.findServer.mockReturnValue(sampleServer);
      mockedCoreTokens.getProviderToken.mockReturnValue("api-token");
      mockedCoreStatus.checkServerStatus.mockResolvedValue({
        server: sampleServer,
        serverStatus: "running",
        platformStatus: "running",
      });

      const response = await handleServerInfo({ action: "status", server: "my-server" });

      expect(mockedCoreStatus.checkServerStatus).toHaveBeenCalledWith(sampleServer, "api-token");
      expect(response.isError).toBeFalsy();
      const body = JSON.parse(response.content[0].text);
      expect(body.results[0].serverStatus).toBe("running");
    });

    it("should return error when action=status and server is not found", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedConfig.findServer.mockReturnValue(undefined);

      const response = await handleServerInfo({ action: "status", server: "nonexistent" });

      expect(response.isError).toBe(true);
      const body = JSON.parse(response.content[0].text);
      expect(body.error).toContain("Server not found");
    });

    it("should check adapter health for action=health with platform server", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedConfig.findServer.mockReturnValue(sampleServer);
      mockedAdapterFactory.resolvePlatform.mockReturnValue("coolify");

      const mockAdapter = {
        name: "coolify",
        port: 8000,
        defaultLogService: "coolify",
        platformPorts: [80, 443, 8000],
        getCloudInit: jest.fn(),
        healthCheck: jest.fn().mockResolvedValue({ status: "running" }),
        createBackup: jest.fn(),
        getStatus: jest.fn(),
        update: jest.fn(),
        restoreBackup: jest.fn(),
      };
      mockedAdapterFactory.getAdapter.mockReturnValue(mockAdapter as unknown as ReturnType<typeof mockedAdapterFactory.getAdapter>);

      const response = await handleServerInfo({ action: "health", server: "my-server" });

      expect(mockAdapter.healthCheck).toHaveBeenCalledWith("1.2.3.4", undefined);
      expect(response.isError).toBeFalsy();
      const body = JSON.parse(response.content[0].text);
      expect(body.platformStatus).toBe("running");
    });
  });

  // ─── 5. handleServerManage ────────────────────────────────────────────────

  describe("handleServerManage", () => {
    it("should call addServerRecord with provided config for action=add", async () => {
      mockedCoreManage.addServerRecord.mockResolvedValue({
        success: true,
        server: {
          id: "manual-001",
          name: "added-server",
          provider: "hetzner",
          ip: "10.0.0.2",
          region: "nbg1",
          size: "cax11",
          createdAt: new Date().toISOString(),
          mode: "coolify",
        },
        platformStatus: "skipped",
      });

      const response = await handleServerManage({
        action: "add",
        provider: "hetzner",
        ip: "10.0.0.2",
        name: "added-server",
        skipVerify: true,
        mode: "coolify",
      });

      expect(mockedCoreManage.addServerRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "hetzner",
          ip: "10.0.0.2",
          name: "added-server",
          skipVerify: true,
          mode: "coolify",
        }),
      );
      expect(response.isError).toBeFalsy();
      const body = JSON.parse(response.content[0].text);
      expect(body.success).toBe(true);
      expect(body.server.name).toBe("added-server");
    });

    it("should return error for action=add with missing provider", async () => {
      const response = await handleServerManage({
        action: "add",
        ip: "10.0.0.2",
        name: "added-server",
      });

      expect(response.isError).toBe(true);
      expect(mockedCoreManage.addServerRecord).not.toHaveBeenCalled();
      const body = JSON.parse(response.content[0].text);
      expect(body.error).toMatch(/provider/i);
    });

    it("should call removeServerRecord for action=remove", async () => {
      mockedCoreManage.removeServerRecord.mockResolvedValue({
        success: true,
        server: { name: "my-server", ip: "1.2.3.4", provider: "hetzner", id: "1", region: "nbg1", size: "cax11", createdAt: "2026-01-01T00:00:00Z", mode: "coolify" as const },
      });

      const response = await handleServerManage({
        action: "remove",
        server: "my-server",
      });

      expect(mockedCoreManage.removeServerRecord).toHaveBeenCalledWith("my-server");
      expect(response.isError).toBeFalsy();
      const body = JSON.parse(response.content[0].text);
      expect(body.success).toBe(true);
    });

    it("should return error for action=destroy in SAFE_MODE", async () => {
      mockedCoreManage.isSafeMode.mockReturnValue(true);

      const response = await handleServerManage({
        action: "destroy",
        server: "my-server",
      });

      expect(response.isError).toBe(true);
      const body = JSON.parse(response.content[0].text);
      expect(body.error).toMatch(/SAFE_MODE/);
    });
  });
});
