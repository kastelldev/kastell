import * as config from "../../src/utils/config";
import * as lockCore from "../../src/core/lock";
import { handleServerLock } from "../../src/mcp/tools/serverLock";

jest.mock("../../src/utils/config");
jest.mock("../../src/core/lock");

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedLock = lockCore as jest.Mocked<typeof lockCore>;

const sampleServer = {
  id: "123",
  name: "my-server",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-02-20T00:00:00Z",
};

const sampleLockResult = {
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
    dockerHardening: true,
    auditd: true,
    logRetention: true,
    aide: true,
  },
  scoreBefore: 55,
  scoreAfter: 88,
};

beforeEach(() => {
  jest.resetAllMocks();
});

describe("MCP server_lock tool", () => {
  describe("safety gate", () => {
    it("returns mcpError when production=false and dryRun=false (default)", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedConfig.findServer.mockReturnValue(sampleServer as never);

      const result = await handleServerLock({ server: "my-server" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain("production=true");
    });

    it("returns mcpError when production=false explicitly and dryRun=false", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedConfig.findServer.mockReturnValue(sampleServer as never);

      const result = await handleServerLock({ server: "my-server", production: false });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain("production=true");
    });

    it("does NOT call applyLock when safety gate blocks", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedConfig.findServer.mockReturnValue(sampleServer as never);

      await handleServerLock({ server: "my-server" });

      expect(mockedLock.applyLock).not.toHaveBeenCalled();
    });
  });

  describe("production mode", () => {
    it("calls applyLock with production=true and returns mcpSuccess", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedConfig.findServer.mockReturnValue(sampleServer as never);
      mockedLock.applyLock.mockResolvedValue(sampleLockResult);

      const result = await handleServerLock({ server: "my-server", production: true });

      expect(mockedLock.applyLock).toHaveBeenCalledWith(
        "1.2.3.4",
        "my-server",
        undefined,
        expect.objectContaining({ production: true, dryRun: false }),
      );
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.scoreBefore).toBe(55);
      expect(parsed.scoreAfter).toBe(88);
    });

    it("returns mcpError when applyLock returns success=false", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedConfig.findServer.mockReturnValue(sampleServer as never);
      mockedLock.applyLock.mockResolvedValue({
        success: false,
        steps: {
          sshHardening: false,
          fail2ban: false,
          banners: false,
          accountLock: false,
          sshCipher: false,
          ufw: false,
          cloudMeta: false,
          dns: false,
          sysctl: false,
          unattendedUpgrades: false,
          aptValidation: false,
          resourceLimits: false,
          serviceDisable: false,
          backupPermissions: false,
          pwquality: false,
          dockerHardening: false,
          auditd: false,
          logRetention: false,
          aide: false,
        },
        error: "No SSH keys found",
        hint: "Add an SSH key first",
      });

      const result = await handleServerLock({ server: "my-server", production: true });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain("No SSH keys found");
    });
  });

  describe("dry run mode", () => {
    it("calls applyLock with dryRun=true even without production=true", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedConfig.findServer.mockReturnValue(sampleServer as never);
      mockedLock.applyLock.mockResolvedValue({
        success: true,
        steps: {
          sshHardening: false,
          fail2ban: false,
          banners: false,
          accountLock: false,
          sshCipher: false,
          ufw: false,
          cloudMeta: false,
          dns: false,
          sysctl: false,
          unattendedUpgrades: false,
          aptValidation: false,
          resourceLimits: false,
          serviceDisable: false,
          backupPermissions: false,
          pwquality: false,
          dockerHardening: false,
          auditd: false,
          logRetention: false,
          aide: false,
        },
      });

      const result = await handleServerLock({ server: "my-server", dryRun: true });

      expect(mockedLock.applyLock).toHaveBeenCalledWith(
        "1.2.3.4",
        "my-server",
        undefined,
        expect.objectContaining({ dryRun: true }),
      );
      expect(result.isError).toBeUndefined();
    });
  });

  describe("platform resolution", () => {
    it("resolves platform from server.platform", async () => {
      const serverWithPlatform = { ...sampleServer, platform: "coolify" };
      mockedConfig.getServers.mockReturnValue([serverWithPlatform] as never);
      mockedConfig.findServer.mockReturnValue(serverWithPlatform as never);
      mockedLock.applyLock.mockResolvedValue(sampleLockResult);

      await handleServerLock({ server: "my-server", production: true });

      expect(mockedLock.applyLock).toHaveBeenCalledWith(
        "1.2.3.4",
        "my-server",
        "coolify",
        expect.anything(),
      );
    });

    it("falls back to server.mode when platform is not set", async () => {
      const serverWithMode = { ...sampleServer, mode: "dokploy" };
      mockedConfig.getServers.mockReturnValue([serverWithMode] as never);
      mockedConfig.findServer.mockReturnValue(serverWithMode as never);
      mockedLock.applyLock.mockResolvedValue(sampleLockResult);

      await handleServerLock({ server: "my-server", production: true });

      expect(mockedLock.applyLock).toHaveBeenCalledWith(
        "1.2.3.4",
        "my-server",
        "dokploy",
        expect.anything(),
      );
    });

    it("falls back to undefined when neither platform nor mode is set", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedConfig.findServer.mockReturnValue(sampleServer as never);
      mockedLock.applyLock.mockResolvedValue(sampleLockResult);

      await handleServerLock({ server: "my-server", production: true });

      expect(mockedLock.applyLock).toHaveBeenCalledWith(
        "1.2.3.4",
        "my-server",
        undefined,
        expect.anything(),
      );
    });
  });

  describe("server resolution", () => {
    it("returns mcpError when no servers found", async () => {
      mockedConfig.getServers.mockReturnValue([] as never);

      const result = await handleServerLock({ production: true });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain("No servers found");
    });

    it("returns mcpError when multiple servers and no server param", async () => {
      mockedConfig.getServers.mockReturnValue([
        sampleServer,
        { ...sampleServer, id: "456", name: "other-server" },
      ] as never);

      const result = await handleServerLock({ production: true });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain("Multiple servers");
    });

    it("returns mcpError when server not found by name", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedConfig.findServer.mockReturnValue(undefined as never);

      const result = await handleServerLock({ server: "nonexistent", production: true });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain("nonexistent");
    });

    it("auto-resolves single server when no server param given", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedLock.applyLock.mockResolvedValue(sampleLockResult);

      const result = await handleServerLock({ production: true });

      expect(result.isError).toBeUndefined();
      expect(mockedLock.applyLock).toHaveBeenCalledWith(
        "1.2.3.4",
        "my-server",
        undefined,
        expect.anything(),
      );
    });
  });

  describe("error handling", () => {
    it("returns mcpError when core function throws", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedConfig.findServer.mockReturnValue(sampleServer as never);
      mockedLock.applyLock.mockRejectedValue(new Error("SSH connection refused"));

      const result = await handleServerLock({ server: "my-server", production: true });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain("SSH connection refused");
    });
  });
});
