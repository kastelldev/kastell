/**
 * MCP server_manage Integration Tests
 *
 * Purpose: Verify server_manage handler actions (add/remove/destroy) with
 * core manage functions mocked. All I/O boundaries (SSH, provider API, config)
 * are mocked — only handler logic + response shape is exercised.
 */

// Mock I/O boundaries before imports
jest.mock("axios");
jest.mock("../../../src/utils/config.js");
jest.mock("../../../src/utils/ssh.js");
jest.mock("../../../src/core/manage.js");
jest.mock("../../../src/adapters/factory.js", () => ({
  detectPlatform: jest.fn(),
}));
jest.mock("../../../src/mcp/utils.js", () => ({
  ...jest.requireActual("../../../src/mcp/utils.js"),
  mcpLog: jest.fn().mockResolvedValue(undefined),
}));

import * as configUtils from "../../../src/utils/config.js";
import * as coreManage from "../../../src/core/manage.js";
import * as sshUtils from "../../../src/utils/ssh.js";

import { handleServerManage } from "../../../src/mcp/tools/serverManage.js";

const mockedConfig = configUtils as jest.Mocked<typeof configUtils>;
const mockedCoreManage = coreManage as jest.Mocked<typeof coreManage>;
const mockedSsh = sshUtils as jest.Mocked<typeof sshUtils>;

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

const manualServer = {
  id: "manual-123456",
  name: "manual-server",
  provider: "hetzner" as const,
  ip: "5.6.7.8",
  region: "unknown",
  size: "unknown",
  createdAt: "2026-03-01T00:00:00Z",
  mode: "bare" as const,
};

describe("handleServerManage", () => {
  let originalSafeMode: string | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    originalSafeMode = process.env.KASTELL_SAFE_MODE;
    process.env.KASTELL_SAFE_MODE = "false";
    mockedCoreManage.isSafeMode.mockReturnValue(false);
    mockedSsh.checkSshAvailable.mockReturnValue(false);
  });

  afterEach(() => {
    if (originalSafeMode === undefined) delete process.env.KASTELL_SAFE_MODE;
    else process.env.KASTELL_SAFE_MODE = originalSafeMode;
  });

  // ─── action=add ────────────────────────────────────────────────────────────

  describe("action=add", () => {
    it("should register a server with provider, ip, and name", async () => {
      mockedConfig.getServers.mockReturnValue([]);
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
      });

      expect(mockedCoreManage.addServerRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "hetzner",
          ip: "10.0.0.2",
          name: "added-server",
          skipVerify: false,
          mode: "coolify",
        }),
      );
      expect(response.isError).toBeFalsy();
      const body = JSON.parse(response.content[0].text);
      expect(body.success).toBe(true);
      expect(body.server.name).toBe("added-server");
      expect(body.server.ip).toBe("10.0.0.2");
      expect(body.server.provider).toBe("hetzner");
    });

    it("should return mcpError when name fails regex validation", async () => {
      mockedConfig.getServers.mockReturnValue([]);
      // Invalid name — starts with number, exceeds max length, etc.
      mockedCoreManage.addServerRecord.mockResolvedValue({
        success: false,
        error: "Server name must be 3-63 characters",
      });

      const response = await handleServerManage({
        action: "add",
        provider: "hetzner",
        ip: "10.0.0.2",
        name: "123-invalid",
      });

      expect(response.isError).toBe(true);
      const body = JSON.parse(response.content[0].text);
      expect(body.error).toMatch(/name/i);
    });

    it("should skip SSH verification when skipVerify=true", async () => {
      mockedConfig.getServers.mockReturnValue([]);
      mockedCoreManage.addServerRecord.mockResolvedValue({
        success: true,
        server: {
          id: "manual-002",
          name: "no-verify-server",
          provider: "digitalocean",
          ip: "10.0.0.3",
          region: "nyc",
          size: "s-1vcpu-1gb",
          createdAt: new Date().toISOString(),
          mode: "coolify",
        },
        platformStatus: "skipped",
      });

      const response = await handleServerManage({
        action: "add",
        provider: "digitalocean",
        ip: "10.0.0.3",
        name: "no-verify-server",
        skipVerify: true,
      });

      expect(mockedCoreManage.addServerRecord).toHaveBeenCalledWith(
        expect.objectContaining({ skipVerify: true }),
      );
      expect(response.isError).toBeFalsy();
    });

    it("should use bare mode when mode=bare is specified", async () => {
      mockedConfig.getServers.mockReturnValue([]);
      mockedCoreManage.addServerRecord.mockResolvedValue({
        success: true,
        server: {
          id: "manual-003",
          name: "bare-server",
          provider: "vultr",
          ip: "10.0.0.4",
          region: "newark",
          size: "vh-2gb",
          createdAt: new Date().toISOString(),
          mode: "bare",
        },
        platformStatus: "skipped",
      });

      const response = await handleServerManage({
        action: "add",
        provider: "vultr",
        ip: "10.0.0.4",
        name: "bare-server",
        mode: "bare",
      });

      expect(mockedCoreManage.addServerRecord).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "bare" }),
      );
      expect(response.isError).toBeFalsy();
      const body = JSON.parse(response.content[0].text);
      expect(body.server.mode).toBe("bare");
    });
  });

  // ─── action=remove ─────────────────────────────────────────────────────────

  describe("action=remove", () => {
    it("should remove server from local config and leave cloud server running", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedConfig.findServer.mockReturnValue(sampleServer);
      mockedCoreManage.removeServerRecord.mockResolvedValue({
        success: true,
        server: sampleServer,
      });

      const response = await handleServerManage({
        action: "remove",
        server: "my-server",
      });

      expect(mockedCoreManage.removeServerRecord).toHaveBeenCalledWith("my-server");
      expect(response.isError).toBeFalsy();
      const body = JSON.parse(response.content[0].text);
      expect(body.success).toBe(true);
      expect(body.note).toMatch(/still running/i);
    });

    it("should return error when SAFE_MODE is enabled for remove", async () => {
      mockedCoreManage.isSafeMode.mockReturnValue(true);

      const response = await handleServerManage({
        action: "remove",
        server: "my-server",
      });

      expect(response.isError).toBe(true);
      const body = JSON.parse(response.content[0].text);
      expect(body.error).toMatch(/SAFE_MODE/i);
    });
  });

  // ─── action=destroy ───────────────────────────────────────────────────────

  describe("action=destroy", () => {
    it("should call provider API destroy and remove local config", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedConfig.findServer.mockReturnValue(sampleServer);
      mockedCoreManage.destroyCloudServer.mockResolvedValue({
        success: true,
        server: sampleServer,
        cloudDeleted: true,
        localRemoved: true,
      });

      const response = await handleServerManage({
        action: "destroy",
        server: "my-server",
      });

      expect(mockedCoreManage.destroyCloudServer).toHaveBeenCalledWith("my-server");
      expect(response.isError).toBeFalsy();
      const body = JSON.parse(response.content[0].text);
      expect(body.success).toBe(true);
      expect(body.cloudDeleted).toBe(true);
      expect(body.localRemoved).toBe(true);
    });

    it("should return mcpError when SAFE_MODE blocks destroy", async () => {
      mockedCoreManage.isSafeMode.mockReturnValue(true);

      const response = await handleServerManage({
        action: "destroy",
        server: "my-server",
      });

      expect(response.isError).toBe(true);
      const body = JSON.parse(response.content[0].text);
      expect(body.error).toMatch(/SAFE_MODE/i);
    });

    it("should return error when destroying a manually-added server (no cloud ID)", async () => {
      mockedConfig.getServers.mockReturnValue([manualServer]);
      mockedConfig.findServer.mockReturnValue(manualServer);
      mockedCoreManage.destroyCloudServer.mockResolvedValue({
        success: false,
        server: manualServer,
        cloudDeleted: false,
        localRemoved: false,
        error: `Server "manual-server" was manually added (no cloud provider ID). Use 'remove' action instead.`,
      });

      const response = await handleServerManage({
        action: "destroy",
        server: "manual-server",
      });

      expect(response.isError).toBe(true);
      const body = JSON.parse(response.content[0].text);
      expect(body.error).toMatch(/manually added/i);
      expect(body.error).toMatch(/remove/i);
    });
  });
});