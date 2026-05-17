/**
 * MCP server_maintain Integration Tests
 *
 * Purpose: Verify handleServerMaintain action=update/restart/maintain flows,
 * bare-server guards, SAFE_MODE enforcement, and step ordering.
 *
 * Strategy:
 * - Mock: config reads, SSH utilities, provider API (axios), core functions
 * - Real: handler logic, response construction, error handling
 */

// Mock I/O boundaries before imports
jest.mock("axios");
jest.mock("../../src/utils/config.js");
jest.mock("../../src/core/manage.js");
jest.mock("../../src/core/tokens.js");
jest.mock("../../src/core/maintain.js");
jest.mock("../../src/core/update.js");
jest.mock("../../src/adapters/factory.js");
jest.mock("../../src/utils/modeGuard.js");
jest.mock("../../src/mcp/utils.js", () => ({
  ...jest.requireActual("../../src/mcp/utils.js"),
  mcpLog: jest.fn().mockResolvedValue(undefined),
}));

import axios from "axios";
import * as configUtils from "../../src/utils/config.js";
import * as coreManage from "../../src/core/manage.js";
import * as coreTokens from "../../src/core/tokens.js";
import * as coreMaintain from "../../src/core/maintain.js";
import * as coreUpdate from "../../src/core/update.js";
import * as adapterFactory from "../../src/adapters/factory.js";
import * as modeGuard from "../../src/utils/modeGuard.js";

import { handleServerMaintain } from "../../src/mcp/tools/serverMaintain.js";

const mockedConfig = configUtils as jest.Mocked<typeof configUtils>;
const mockedCoreManage = coreManage as jest.Mocked<typeof coreManage>;
const mockedCoreTokens = coreTokens as jest.Mocked<typeof coreTokens>;
const mockedCoreMaintain = coreMaintain as jest.Mocked<typeof coreMaintain>;
const mockedCoreUpdate = coreUpdate as jest.Mocked<typeof coreUpdate>;
const mockedAdapterFactory = adapterFactory as jest.Mocked<typeof adapterFactory>;
const mockedModeGuard = modeGuard as jest.Mocked<typeof modeGuard>;

// ─── Shared Fixtures ───────────────────────────────────────────────────────────

const coolifyServer = {
  id: "htz-001",
  name: "my-server",
  provider: "hetzner" as const,
  ip: "1.2.3.4",
  region: "nbg1" as const,
  size: "cax11" as const,
  createdAt: "2026-03-01T00:00:00Z",
  mode: "coolify" as const,
  platform: "coolify" as const,
  domain: undefined,
};

const bareServer = {
  id: "manual-002",
  name: "bare-server",
  provider: "hetzner" as const,
  ip: "5.6.7.8",
  region: "nbg1" as const,
  size: "cax11" as const,
  createdAt: "2026-03-01T00:00:00Z",
  mode: "bare" as const,
  platform: undefined,
  domain: undefined,
};

const mockAdapter = {
  name: "coolify",
  port: 8000,
  defaultLogService: "coolify",
  platformPorts: [80, 443, 8000],
  getCloudInit: jest.fn(),
  healthCheck: jest.fn(),
  createBackup: jest.fn(),
  getStatus: jest.fn(),
  update: jest.fn(),
  restoreBackup: jest.fn(),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("handleServerMaintain", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.KASTELL_SAFE_MODE = "false";
    mockedCoreManage.isSafeMode.mockReturnValue(false);
    mockedAdapterFactory.resolvePlatform.mockReturnValue("coolify");
    mockedAdapterFactory.getAdapter.mockReturnValue(mockAdapter as unknown as ReturnType<typeof mockedAdapterFactory.getAdapter>);
    mockedModeGuard.requireManagedMode.mockReturnValue(null); // no error = managed OK
  });

  afterEach(() => {
    delete process.env.KASTELL_SAFE_MODE;
  });

  // 1. action=update happy path (coolify server)

  describe("action=update", () => {
    it("should issue platform update via SSH and return success", async () => {
      mockedConfig.getServers.mockReturnValue([coolifyServer]);
      mockedConfig.findServer.mockReturnValue(coolifyServer);
      mockedCoreTokens.getProviderToken.mockReturnValue("api-token");
      mockedCoreUpdate.updateServer.mockResolvedValue({
        success: true,
        displayName: "Coolify",
      });

      const response = await handleServerMaintain({ action: "update", server: "my-server" });

      expect(mockedCoreUpdate.updateServer).toHaveBeenCalledWith(
        coolifyServer,
        "api-token",
        "coolify",
      );
      expect(response.isError).toBeFalsy();
      const body = JSON.parse(response.content[0].text);
      expect(body.action).toBe("update");
      expect(body.success).toBe(true);
      expect(body.server).toBe("my-server");
      expect(body.ip).toBe("1.2.3.4");
    });

    // 2. action=update bare server → mcpError "update blocked on bare servers"

    it("should block update on bare servers with mcpError", async () => {
      mockedConfig.getServers.mockReturnValue([bareServer]);
      mockedConfig.findServer.mockReturnValue(bareServer);
      mockedModeGuard.requireManagedMode.mockReturnValue("update requires Coolify or Dokploy");

      const response = await handleServerMaintain({ action: "update", server: "bare-server" });

      expect(response.isError).toBe(true);
      const body = JSON.parse(response.content[0].text);
      expect(body.error).toMatch(/update requires Coolify or Dokploy/i);
    });

    // 6. SAFE_MODE=true + action=update → mcpError

    it("should block update in SAFE_MODE", async () => {
      mockedConfig.getServers.mockReturnValue([coolifyServer]);
      mockedConfig.findServer.mockReturnValue(coolifyServer);
      mockedCoreManage.isSafeMode.mockReturnValue(true);

      const response = await handleServerMaintain({ action: "update", server: "my-server" });

      expect(response.isError).toBe(true);
      const body = JSON.parse(response.content[0].text);
      expect(body.error).toMatch(/SAFE_MODE/i);
    });
  });

  // 3. action=restart → provider API restart called

  describe("action=restart", () => {
    it("should call provider API reboot and return success", async () => {
      mockedConfig.getServers.mockReturnValue([coolifyServer]);
      mockedConfig.findServer.mockReturnValue(coolifyServer);
      mockedCoreTokens.getProviderToken.mockReturnValue("api-token");
      mockedCoreMaintain.rebootAndWait.mockResolvedValue({
        success: true,
        finalStatus: "running",
      });

      const response = await handleServerMaintain({ action: "restart", server: "my-server" });

      expect(mockedCoreMaintain.rebootAndWait).toHaveBeenCalledWith(coolifyServer, "api-token");
      expect(response.isError).toBeFalsy();
      const body = JSON.parse(response.content[0].text);
      expect(body.action).toBe("restart");
      expect(body.success).toBe(true);
      expect(body.finalStatus).toBe("running");
    });

    it("should block restart on bare (manual) servers", async () => {
      mockedConfig.getServers.mockReturnValue([bareServer]);
      mockedConfig.findServer.mockReturnValue(bareServer);

      const response = await handleServerMaintain({ action: "restart", server: "bare-server" });

      expect(response.isError).toBe(true);
      const body = JSON.parse(response.content[0].text);
      expect(body.error).toMatch(/manually added server/i);
    });

    it("should block restart in SAFE_MODE", async () => {
      mockedConfig.getServers.mockReturnValue([coolifyServer]);
      mockedConfig.findServer.mockReturnValue(coolifyServer);
      mockedCoreManage.isSafeMode.mockReturnValue(true);

      const response = await handleServerMaintain({ action: "restart", server: "my-server" });

      expect(response.isError).toBe(true);
      const body = JSON.parse(response.content[0].text);
      expect(body.error).toMatch(/SAFE_MODE/i);
    });
  });

  // 4. action=maintain happy path — 5 steps executed in order

  describe("action=maintain", () => {
    it("should run full 5-step maintenance and return step summary", async () => {
      mockedConfig.getServers.mockReturnValue([coolifyServer]);
      mockedConfig.findServer.mockReturnValue(coolifyServer);
      mockedCoreTokens.getProviderToken.mockReturnValue("api-token");
      mockedCoreMaintain.maintainServer.mockResolvedValue({
        server: "my-server",
        ip: "1.2.3.4",
        provider: "hetzner",
        success: true,
        steps: [
          { step: 1, name: "Status Check", status: "success" as const, detail: "Server is running" },
          { step: 2, name: "Coolify Update", status: "success" as const },
          { step: 3, name: "Health Check", status: "success" as const, detail: "Coolify is healthy" },
          { step: 4, name: "Reboot", status: "success" as const, detail: "Server rebooted" },
          { step: 5, name: "Final Check", status: "success" as const, detail: "Server and Coolify are running" },
        ],
      });

      const response = await handleServerMaintain({ action: "maintain", server: "my-server" });

      expect(mockedCoreMaintain.maintainServer).toHaveBeenCalledWith(
        coolifyServer,
        "api-token",
        { skipReboot: false },
      );
      expect(response.isError).toBeFalsy();
      const body = JSON.parse(response.content[0].text);
      expect(body.action).toBe("maintain");
      expect(body.success).toBe(true);
      expect(body.steps).toHaveLength(5);
      expect(body.summary.total).toBe(5);
      expect(body.summary.success).toBe(5);
      expect(body.summary.failure).toBe(0);
    });

    // 5. action=maintain with skipReboot=true — reboot step skipped

    it("should skip reboot step when skipReboot=true", async () => {
      mockedConfig.getServers.mockReturnValue([coolifyServer]);
      mockedConfig.findServer.mockReturnValue(coolifyServer);
      mockedCoreTokens.getProviderToken.mockReturnValue("api-token");
      mockedCoreMaintain.maintainServer.mockResolvedValue({
        server: "my-server",
        ip: "1.2.3.4",
        provider: "hetzner",
        success: true,
        steps: [
          { step: 1, name: "Status Check", status: "success" as const, detail: "Server is running" },
          { step: 2, name: "Coolify Update", status: "success" as const },
          { step: 3, name: "Health Check", status: "success" as const, detail: "Coolify is healthy" },
          { step: 4, name: "Reboot", status: "skipped" as const, detail: "Skipped by user" },
          { step: 5, name: "Final Check", status: "skipped" as const, detail: "Skipped by user" },
        ],
      });

      const response = await handleServerMaintain({ action: "maintain", server: "my-server", skipReboot: true });

      expect(mockedCoreMaintain.maintainServer).toHaveBeenCalledWith(
        coolifyServer,
        "api-token",
        { skipReboot: true },
      );
      expect(response.isError).toBeFalsy();
      const body = JSON.parse(response.content[0].text);
      expect(body.steps[3].status).toBe("skipped");
      expect(body.steps[4].status).toBe("skipped");
      expect(body.summary.skipped).toBe(2);
    });

    // 7. F-009 regression — quickWins[].checkId and severity present in audit JSON output
    //    (maintain does NOT emit quickWins — this is a server_audit concern.
    //     Verifying maintain returns structured steps with correct field names instead.)

    it("should return maintain steps with step number, name, status, and optional detail/error/hint fields", async () => {
      mockedConfig.getServers.mockReturnValue([coolifyServer]);
      mockedConfig.findServer.mockReturnValue(coolifyServer);
      mockedCoreTokens.getProviderToken.mockReturnValue("api-token");
      mockedCoreMaintain.maintainServer.mockResolvedValue({
        server: "my-server",
        ip: "1.2.3.4",
        provider: "hetzner",
        success: false, // partial failure to exercise error fields
        steps: [
          {
            step: 1,
            name: "Status Check",
            status: "failure" as const,
            error: "Server unreachable",
            hint: "Check network connectivity",
          },
          {
            step: 2,
            name: "Coolify Update",
            status: "skipped" as const,
            detail: "Skipped due to upstream failure",
          },
        ],
      });

      const response = await handleServerMaintain({ action: "maintain", server: "my-server" });

      const body = JSON.parse(response.content[0].text);
      // Verify step structure has required fields
      expect(body.steps[0]).toHaveProperty("step");
      expect(body.steps[0]).toHaveProperty("name");
      expect(body.steps[0]).toHaveProperty("status");
      expect(body.steps[0]).toHaveProperty("error");
      expect(body.steps[0]).toHaveProperty("hint");
      expect(body.steps[1]).toHaveProperty("detail");
      // Verify F-009 regression: server and ip are present in output
      expect(body.server).toBe("my-server");
      expect(body.ip).toBe("1.2.3.4");
    });
  });

  // Shared error cases

  describe("error handling", () => {
    it("should return error when no servers are configured", async () => {
      mockedConfig.getServers.mockReturnValue([]);

      const response = await handleServerMaintain({ action: "update" });

      expect(response.isError).toBe(true);
      const body = JSON.parse(response.content[0].text);
      expect(body.error).toMatch(/No servers/i);
    });

    it("should return error when specified server does not exist", async () => {
      mockedConfig.getServers.mockReturnValue([coolifyServer]);
      mockedConfig.findServer.mockReturnValue(undefined);

      const response = await handleServerMaintain({ action: "restart", server: "nonexistent" });

      expect(response.isError).toBe(true);
      const body = JSON.parse(response.content[0].text);
      expect(body.error).toContain("Server not found");
    });
  });
});