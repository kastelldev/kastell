import inquirer from "inquirer";
import * as config from "../../src/utils/config";
import * as sshUtils from "../../src/utils/ssh";
import * as serverSelect from "../../src/utils/serverSelect";
import * as adapterFactory from "../../src/adapters/factory";
import * as coreUpdate from "../../src/core/update";
import { updateCommand } from "../../src/commands/update";

jest.mock("../../src/utils/config");
jest.mock("../../src/utils/ssh");
jest.mock("../../src/utils/serverSelect");
jest.mock("../../src/core/update");

const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;
const mockedConfig = config as jest.Mocked<typeof config>;
const mockedSsh = sshUtils as jest.Mocked<typeof sshUtils>;
const mockedServerSelect = serverSelect as jest.Mocked<typeof serverSelect>;
const mockedCoreUpdate = coreUpdate as jest.Mocked<typeof coreUpdate>;

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

describe("updateCommand", () => {
  let consoleSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
    jest.resetAllMocks();
    // Default: SSH available
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    // Default: updateServer succeeds
    mockedCoreUpdate.updateServer.mockResolvedValue({ success: true, output: "Updated" });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("should show error when SSH not available", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(false);
    await updateCommand();
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("SSH client not found");
  });

  it("should return when no server found", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(undefined);
    await updateCommand("nonexistent");
    expect(mockedServerSelect.resolveServer).toHaveBeenCalledWith(
      "nonexistent",
      "Select a server to update:",
    );
  });

  it("should cancel when user declines", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt.mockResolvedValueOnce({ confirm: false });

    await updateCommand("1.2.3.4");
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Update cancelled");
    expect(mockedCoreUpdate.updateServer).not.toHaveBeenCalled();
  });

  it("should call updateServer and show success output", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt.mockResolvedValueOnce({ confirm: true });
    mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
    mockedCoreUpdate.updateServer.mockResolvedValue({ success: true, output: "Coolify updated" });

    await updateCommand("1.2.3.4");

    expect(mockedCoreUpdate.updateServer).toHaveBeenCalledWith(
      sampleServer,
      "test-token",
      "coolify",
    );
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("update completed successfully");
  });

  it("should show error when updateServer returns failure", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt.mockResolvedValueOnce({ confirm: true });
    mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
    mockedCoreUpdate.updateServer.mockResolvedValue({ success: false, error: "SSH connection refused" });

    await updateCommand("1.2.3.4");
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Update failed");
  });

  // ---- DX-01: --dry-run support ----

  it("should show dry-run preview without calling core updateServer", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);

    await updateCommand("1.2.3.4", { dryRun: true });

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Dry Run");
    expect(output).toContain("coolify-test");
    expect(output).toContain("1.2.3.4");
    expect(output).toContain("No changes applied");
    expect(mockedCoreUpdate.updateServer).not.toHaveBeenCalled();
    expect(mockedInquirer.prompt).not.toHaveBeenCalled();
  });

  it("should show platform and action in dry-run output", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);

    await updateCommand("1.2.3.4", { dryRun: true });

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Run update script via SSH");
  });

  it("should show dry-run per server in --all mode", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);

    await updateCommand(undefined, { all: true, dryRun: true });

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Dry Run");
    expect(output).toContain("coolify-test");
    expect(output).toContain("No changes applied");
    expect(mockedCoreUpdate.updateServer).not.toHaveBeenCalled();
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
      mockedServerSelect.resolveServer.mockResolvedValue(bareServer);

      await updateCommand("9.9.9.9");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("bare");
      expect(mockedCoreUpdate.updateServer).not.toHaveBeenCalled();
      expect(mockedInquirer.prompt).not.toHaveBeenCalled();
    });

    it("should still update coolify server when passed", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedInquirer.prompt.mockResolvedValueOnce({ confirm: true });
      mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
      mockedCoreUpdate.updateServer.mockResolvedValue({ success: true });

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

    it("should update Dokploy server and call updateServer with dokploy platform", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(dokployServer);
      mockedInquirer.prompt.mockResolvedValueOnce({ confirm: true });
      mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
      mockedCoreUpdate.updateServer.mockResolvedValue({ success: true });

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
      mockedConfig.getServers.mockReturnValue([]);

      await updateCommand(undefined, { all: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("No servers found");
    });

    it("should cancel when user declines confirmation", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedInquirer.prompt.mockResolvedValueOnce({ confirm: false });

      await updateCommand(undefined, { all: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Update cancelled");
      expect(mockedServerSelect.collectProviderTokens).not.toHaveBeenCalled();
    });

    it("should update all servers sequentially on confirm", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer, sampleServer2]);
      mockedInquirer.prompt.mockResolvedValueOnce({ confirm: true });
      mockedServerSelect.collectProviderTokens.mockResolvedValue(
        new Map([
          ["hetzner", "h-token"],
          ["digitalocean", "do-token"],
        ]),
      );
      mockedCoreUpdate.updateServer.mockResolvedValue({ success: true, output: "Updated" });

      await updateCommand(undefined, { all: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(mockedCoreUpdate.updateServer).toHaveBeenCalledTimes(2);
      expect(output).toContain("All 2 server(s) updated successfully");
    });

    it("should report mixed results when some servers fail", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer, sampleServer2]);
      mockedInquirer.prompt.mockResolvedValueOnce({ confirm: true });
      mockedServerSelect.collectProviderTokens.mockResolvedValue(
        new Map([
          ["hetzner", "h-token"],
          ["digitalocean", "do-token"],
        ]),
      );

      mockedCoreUpdate.updateServer
        .mockResolvedValueOnce({ success: true, output: "OK" })
        .mockResolvedValueOnce({ success: false, error: "SSH failed" });

      await updateCommand(undefined, { all: true });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("1 succeeded");
      expect(output).toContain("1 failed");
    });

    it("should report failure when server is not running", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedInquirer.prompt.mockResolvedValueOnce({ confirm: true });
      mockedServerSelect.collectProviderTokens.mockResolvedValue(new Map([["hetzner", "h-token"]]));
      mockedCoreUpdate.updateServer.mockResolvedValue({
        success: false,
        error: "Server is not running (status: off)",
      });

      await updateCommand(undefined, { all: true });

      expect(mockedCoreUpdate.updateServer).toHaveBeenCalledWith(
        expect.objectContaining({ id: "123" }),
        "h-token",
        "coolify",
      );
    });

    it("should handle server verification error in --all", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedInquirer.prompt.mockResolvedValueOnce({ confirm: true });
      mockedServerSelect.collectProviderTokens.mockResolvedValue(new Map([["hetzner", "h-token"]]));
      mockedCoreUpdate.updateServer.mockResolvedValue({
        success: false,
        error: "API down",
      });

      await updateCommand(undefined, { all: true });

      expect(mockedCoreUpdate.updateServer).toHaveBeenCalled();
    });

    it("should skip bare servers and warn in --all mode", async () => {
      const bareServer = {
        ...sampleServer,
        id: "bare-123",
        name: "bare-test",
        ip: "9.9.9.9",
        mode: "bare" as const,
      };
      mockedConfig.getServers.mockReturnValue([sampleServer, bareServer]);
      mockedInquirer.prompt.mockResolvedValueOnce({ confirm: true });
      mockedServerSelect.collectProviderTokens.mockResolvedValue(
        new Map([["hetzner", "h-token"]]),
      );
      mockedCoreUpdate.updateServer.mockResolvedValue({ success: true, output: "Updated" });

      await updateCommand(undefined, { all: true });

      // Only 1 call (bare server skipped)
      expect(mockedCoreUpdate.updateServer).toHaveBeenCalledTimes(1);
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("bare");
    });
  });
});
