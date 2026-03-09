import inquirer from "inquirer";
import axios from "axios";
import * as config from "../../src/utils/config";
import * as sshUtils from "../../src/utils/ssh";
import * as serverSelect from "../../src/utils/serverSelect";
import * as providerFactory from "../../src/utils/providerFactory";
import * as adapterFactory from "../../src/adapters/factory";
import { updateCommand } from "../../src/commands/update";
import type { CloudProvider } from "../../src/providers/base";

jest.mock("../../src/utils/config");
jest.mock("../../src/utils/ssh");
jest.mock("../../src/utils/serverSelect");
jest.mock("../../src/utils/providerFactory");

const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;
const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedConfig = config as jest.Mocked<typeof config>;
const mockedSsh = sshUtils as jest.Mocked<typeof sshUtils>;
const mockedServerSelect = serverSelect as jest.Mocked<typeof serverSelect>;
const mockedProviderFactory = providerFactory as jest.Mocked<typeof providerFactory>;

const sampleServer = {
  id: "123",
  name: "coolify-test",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00.000Z",
  mode: "coolify" as const,
};

const sampleServer2 = {
  id: "456",
  name: "coolify-prod",
  provider: "digitalocean",
  ip: "5.6.7.8",
  region: "nyc1",
  size: "s-2vcpu-4gb",
  createdAt: "2026-02-21T00:00:00Z",
  mode: "coolify" as const,
};

const mockProvider: CloudProvider = {
  name: "hetzner",
  displayName: "Hetzner Cloud",
  validateToken: jest.fn().mockResolvedValue(true),
  getRegions: jest.fn().mockReturnValue([]),
  getServerSizes: jest.fn().mockReturnValue([]),
  getAvailableLocations: jest.fn().mockResolvedValue([]),
  getAvailableServerTypes: jest.fn().mockResolvedValue([]),
  uploadSshKey: jest.fn(),
  createServer: jest.fn(),
  getServerStatus: jest.fn(),
  getServerDetails: jest.fn(),
  destroyServer: jest.fn(),
  rebootServer: jest.fn(),
  createSnapshot: jest.fn(),
  listSnapshots: jest.fn(),
  deleteSnapshot: jest.fn(),
  getSnapshotCostEstimate: jest.fn(),
};

describe("updateCommand", () => {
  let consoleSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  // ---- Existing single-server tests (adapted for module mocks) ----

  it("should show error when SSH not available", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(false);
    await updateCommand();
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("SSH client not found");
  });

  it("should return when no server found", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedServerSelect.resolveServer.mockResolvedValue(undefined);
    await updateCommand("nonexistent");
    expect(mockedServerSelect.resolveServer).toHaveBeenCalledWith(
      "nonexistent",
      "Select a server to update:",
    );
  });

  it("should cancel when user declines", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt.mockResolvedValueOnce({ confirm: false });

    await updateCommand("1.2.3.4");
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Update cancelled");
  });

  it("should fail when server not running", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt.mockResolvedValueOnce({ confirm: true });
    mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
    (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("off");
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    await updateCommand("1.2.3.4");
    expect(mockedSsh.sshExec).not.toHaveBeenCalled();
  });

  it("should update successfully", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt.mockResolvedValueOnce({ confirm: true });
    mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
    (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "Coolify updated", stderr: "" });

    await updateCommand("1.2.3.4");
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("update completed successfully");
  });

  it("should handle update failure", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt.mockResolvedValueOnce({ confirm: true });
    mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
    (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    mockedSsh.sshExec.mockResolvedValue({ code: 1, stdout: "", stderr: "connection refused" });

    await updateCommand("1.2.3.4");
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Update failed");
  });

  it("should handle verify server error", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt.mockResolvedValueOnce({ confirm: true });
    mockedServerSelect.promptApiToken.mockResolvedValue("bad-token");
    (mockProvider.getServerStatus as jest.Mock).mockRejectedValue(new Error("Unauthorized"));
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    await updateCommand("1.2.3.4");
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Unauthorized");
    expect(mockedSsh.sshExec).not.toHaveBeenCalled();
  });

  // ---- DX-01: --dry-run support ----

  it("should show dry-run preview without calling SSH or prompts", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);

    await updateCommand("1.2.3.4", { dryRun: true });

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Dry Run");
    expect(output).toContain("coolify-test");
    expect(output).toContain("1.2.3.4");
    expect(output).toContain("No changes applied");
    // No side effects
    expect(mockedSsh.sshExec).not.toHaveBeenCalled();
    // No confirmation prompts
    expect(mockedInquirer.prompt).not.toHaveBeenCalled();
  });

  it("should show platform and action in dry-run output", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);

    await updateCommand("1.2.3.4", { dryRun: true });

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Run update script via SSH");
  });

  it("should show dry-run per server in --all mode", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedConfig.getServers.mockReturnValue([sampleServer]);

    await updateCommand(undefined, { all: true, dryRun: true });

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Dry Run");
    expect(output).toContain("coolify-test");
    expect(output).toContain("No changes applied");
    // No SSH or prompt calls
    expect(mockedSsh.sshExec).not.toHaveBeenCalled();
    expect(mockedInquirer.prompt).not.toHaveBeenCalled();
  });

  // ---- Bare mode tests ----

  describe("bare server guard", () => {
    const bareServer = {
      ...sampleServer,
      id: "bare-123",
      name: "bare-test",
      ip: "9.9.9.9",
      mode: "bare" as const,
    };

    it("should print error and return when server is bare", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedServerSelect.resolveServer.mockResolvedValue(bareServer);

      await updateCommand("9.9.9.9");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("bare");
      // SSH update should NOT have been called
      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
      expect(mockedInquirer.prompt).not.toHaveBeenCalled();
    });

    it("should still update coolify server when passed (existing behavior unchanged)", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedInquirer.prompt.mockResolvedValueOnce({ confirm: true });
      mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
      (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
      mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "Coolify updated", stderr: "" });

      await updateCommand("1.2.3.4");
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("update completed successfully");
    });
  });

  // ---- Dokploy server tests ----

  describe("dokploy server", () => {
    const dokployServer = {
      ...sampleServer,
      id: "dok-123",
      name: "dokploy-test",
      ip: "10.0.0.1",
      platform: "dokploy" as const,
    };

    it("should update Dokploy server (not skip)", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedServerSelect.resolveServer.mockResolvedValue(dokployServer);
      mockedInquirer.prompt.mockResolvedValueOnce({ confirm: true });
      mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
      (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
      mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

      const mockAdapter = {
        name: "dokploy",
        getCloudInit: jest.fn(() => ""),
        healthCheck: jest.fn(async () => ({ status: "running" as const })),
        createBackup: jest.fn(async () => ({ success: true })),
        getStatus: jest.fn(async () => ({ platformVersion: "1.0", status: "running" as const })),
        update: jest.fn(async () => ({ success: true })),

      };
      const spy = jest.spyOn(adapterFactory, "getAdapter").mockReturnValue(mockAdapter);

      await updateCommand("10.0.0.1");
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("update completed");
      expect(output).not.toContain("not yet supported");
      expect(mockAdapter.update).toHaveBeenCalledWith("10.0.0.1");
      spy.mockRestore();
    });

    it("should not skip Dokploy in --all mode", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.getServers.mockReturnValue([dokployServer]);
      mockedInquirer.prompt.mockResolvedValueOnce({ confirm: true });
      mockedServerSelect.collectProviderTokens.mockResolvedValue(new Map([["hetzner", "h-token"]]));
      (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
      mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

      const mockAdapter = {
        name: "dokploy",
        getCloudInit: jest.fn(() => ""),
        healthCheck: jest.fn(async () => ({ status: "running" as const })),
        createBackup: jest.fn(async () => ({ success: true })),
        getStatus: jest.fn(async () => ({ platformVersion: "1.0", status: "running" as const })),
        update: jest.fn(async () => ({ success: true })),

      };
      const spy = jest.spyOn(adapterFactory, "getAdapter").mockReturnValue(mockAdapter);

      await updateCommand(undefined, { all: true });
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).not.toContain("not yet supported");
      expect(mockAdapter.update).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  // ---- --all mode tests ----

  describe("--all mode", () => {
    it("should show error when SSH not available", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(false);

      await updateCommand(undefined, { all: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("SSH client not found");
    });

    it("should show info when no servers exist", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.getServers.mockReturnValue([]);

      await updateCommand(undefined, { all: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("No servers found");
    });

    it("should cancel when user declines confirmation", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedInquirer.prompt.mockResolvedValueOnce({ confirm: false });

      await updateCommand(undefined, { all: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Update cancelled");
      expect(mockedServerSelect.collectProviderTokens).not.toHaveBeenCalled();
    });

    it("should update all servers sequentially on confirm", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.getServers.mockReturnValue([sampleServer, sampleServer2]);
      mockedInquirer.prompt.mockResolvedValueOnce({ confirm: true });
      mockedServerSelect.collectProviderTokens.mockResolvedValue(
        new Map([
          ["hetzner", "h-token"],
          ["digitalocean", "do-token"],
        ]),
      );
      (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
      mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
      mockedSsh.sshExec.mockResolvedValue({
        code: 0,
        stdout: "Updated",
        stderr: "",
      });

      await updateCommand(undefined, { all: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      // sshExec called once per server
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(2);
      expect(output).toContain("All 2 server(s) updated successfully");
    });

    it("should report mixed results when some servers fail", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.getServers.mockReturnValue([sampleServer, sampleServer2]);
      mockedInquirer.prompt.mockResolvedValueOnce({ confirm: true });
      mockedServerSelect.collectProviderTokens.mockResolvedValue(
        new Map([
          ["hetzner", "h-token"],
          ["digitalocean", "do-token"],
        ]),
      );

      // First server: running, update succeeds
      const successProvider: CloudProvider = {
        ...mockProvider,
        getServerStatus: jest.fn().mockResolvedValue("running"),
      };
      // Second server: running but update fails
      const failProvider: CloudProvider = {
        ...mockProvider,
        getServerStatus: jest.fn().mockResolvedValue("running"),
      };

      mockedProviderFactory.createProviderWithToken
        .mockReturnValueOnce(successProvider)
        .mockReturnValueOnce(failProvider);

      mockedSsh.sshExec
        .mockResolvedValueOnce({ code: 0, stdout: "OK", stderr: "" })
        .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "fail" });

      await updateCommand(undefined, { all: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("1 succeeded");
      expect(output).toContain("1 failed");
    });

    it("should skip servers that are not running", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedInquirer.prompt.mockResolvedValueOnce({ confirm: true });
      mockedServerSelect.collectProviderTokens.mockResolvedValue(new Map([["hetzner", "h-token"]]));
      (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("off");
      mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

      await updateCommand(undefined, { all: true });

      // sshExec should NOT be called because server is "off"
      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
    });

    it("should handle server verification error in --all", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedInquirer.prompt.mockResolvedValueOnce({ confirm: true });
      mockedServerSelect.collectProviderTokens.mockResolvedValue(new Map([["hetzner", "h-token"]]));
      (mockProvider.getServerStatus as jest.Mock).mockRejectedValue(new Error("API down"));
      mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

      await updateCommand(undefined, { all: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("API down");
      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
    });

    it("should skip bare servers and warn in --all mode", async () => {
      const bareServer = {
        ...sampleServer,
        id: "bare-123",
        name: "bare-test",
        ip: "9.9.9.9",
        mode: "bare" as const,
      };
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.getServers.mockReturnValue([sampleServer, bareServer]);
      mockedInquirer.prompt.mockResolvedValueOnce({ confirm: true });
      mockedServerSelect.collectProviderTokens.mockResolvedValue(
        new Map([["hetzner", "h-token"]]),
      );
      (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
      mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "Updated", stderr: "" });

      await updateCommand(undefined, { all: true });

      // Only 1 sshExec call (bare server skipped)
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(1);
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("bare");
    });
  });
});
