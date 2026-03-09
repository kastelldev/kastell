import inquirer from "inquirer";
import { destroyCommand } from "../../src/commands/destroy";
import * as coreManage from "../../src/core/manage";
import * as serverSelect from "../../src/utils/serverSelect";
import * as coreBackup from "../../src/core/backup";

jest.mock("../../src/core/manage");
jest.mock("../../src/utils/serverSelect");
jest.mock("../../src/core/backup");

const mockedCoreBackup = coreBackup as jest.Mocked<typeof coreBackup>;

const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;
const mockedCoreManage = coreManage as jest.Mocked<typeof coreManage>;
const mockedServerSelect = serverSelect as jest.Mocked<typeof serverSelect>;

const sampleServer = {
  id: "123",
  name: "coolify-test",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-02-20T00:00:00Z",
  mode: "coolify" as const,
};

const destroySuccessResult = {
  success: true,
  server: sampleServer,
  cloudDeleted: true,
  localRemoved: true,
};

const destroyNotFoundResult = {
  success: true,
  server: sampleServer,
  cloudDeleted: false,
  localRemoved: true,
  hint: "Server not found on hetzner (may have been deleted manually). Removed from local config.",
};

describe("destroyCommand", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
    // Default: no backups exist for servers
    mockedCoreBackup.listBackups.mockReturnValue([]);
    mockedCoreBackup.cleanupServerBackups.mockReturnValue({ removed: true, path: "/mock/path" });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("should show error when server not found by query", async () => {
    // resolveServer returns undefined — server lookup shows "Server not found" inside resolveServer
    // which is mocked, so we verify no further action is taken
    mockedServerSelect.resolveServer.mockResolvedValue(undefined);

    await destroyCommand("nonexistent");

    // No destroy attempted, no prompts asked
    expect(mockedCoreManage.destroyCloudServer).not.toHaveBeenCalled();
    expect(mockedInquirer.prompt).not.toHaveBeenCalled();
  });

  it("should show info when no servers exist and no query", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(undefined);

    await destroyCommand();

    // resolveServer returns undefined -> early return, no destroy called
    expect(mockedCoreManage.destroyCloudServer).not.toHaveBeenCalled();
  });

  it("should cancel when user declines first confirmation", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt.mockResolvedValueOnce({ confirm: false });

    await destroyCommand("1.2.3.4");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("cancelled");
    expect(mockedCoreManage.destroyCloudServer).not.toHaveBeenCalled();
  });

  it("should cancel when server name does not match", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt
      .mockResolvedValueOnce({ confirm: true })
      .mockResolvedValueOnce({ confirmName: "wrong-name" });

    await destroyCommand("1.2.3.4");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("does not match");
    expect(mockedCoreManage.destroyCloudServer).not.toHaveBeenCalled();
  });

  it("should destroy server successfully", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt
      .mockResolvedValueOnce({ confirm: true })
      .mockResolvedValueOnce({ confirmName: "coolify-test" });
    mockedCoreManage.destroyCloudServer.mockResolvedValue(destroySuccessResult);

    await destroyCommand("1.2.3.4");

    expect(mockedCoreManage.destroyCloudServer).toHaveBeenCalledWith("coolify-test");
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    // logger.success output is captured (spinner.succeed text is from ora, not console.log)
    expect(output).toContain("removed from your cloud provider");
  });

  it("should handle API error during destroy", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt
      .mockResolvedValueOnce({ confirm: true })
      .mockResolvedValueOnce({ confirmName: "coolify-test" })
      .mockResolvedValueOnce({ removeLocal: false });
    mockedCoreManage.destroyCloudServer.mockResolvedValue({
      success: false,
      server: sampleServer,
      cloudDeleted: false,
      localRemoved: false,
      error: "API Error",
    });

    await destroyCommand("1.2.3.4");

    // logger.error("API Error") is captured via console.log
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("API Error");
  });

  it("should remove from local config when user confirms after API error", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt
      .mockResolvedValueOnce({ confirm: true })
      .mockResolvedValueOnce({ confirmName: "coolify-test" })
      .mockResolvedValueOnce({ removeLocal: true });
    mockedCoreManage.destroyCloudServer.mockResolvedValue({
      success: false,
      server: sampleServer,
      cloudDeleted: false,
      localRemoved: false,
      error: "API Error",
    });
    mockedCoreManage.removeServerRecord.mockResolvedValue({
      success: true,
      server: sampleServer,
    });

    await destroyCommand("1.2.3.4");

    expect(mockedCoreManage.removeServerRecord).toHaveBeenCalledWith("coolify-test");
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Removed from local config");
  });

  it("should remove from local config when server not found on provider", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt
      .mockResolvedValueOnce({ confirm: true })
      .mockResolvedValueOnce({ confirmName: "coolify-test" });
    mockedCoreManage.destroyCloudServer.mockResolvedValue(destroyNotFoundResult);

    await destroyCommand("1.2.3.4");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Removed from local config");
  });

  it("should allow interactive server selection", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt
      .mockResolvedValueOnce({ confirm: true })
      .mockResolvedValueOnce({ confirmName: "coolify-test" });
    mockedCoreManage.destroyCloudServer.mockResolvedValue(destroySuccessResult);

    await destroyCommand();

    expect(mockedServerSelect.resolveServer).toHaveBeenCalledWith(
      undefined,
      "Select a server to destroy:",
    );
    expect(mockedCoreManage.destroyCloudServer).toHaveBeenCalledWith("coolify-test");
  });

  // ---- UX #11: backup cleanup prompt after destroy ----

  it("should prompt to clean backups when backups exist after successful destroy", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt
      .mockResolvedValueOnce({ confirm: true })
      .mockResolvedValueOnce({ confirmName: "coolify-test" })
      .mockResolvedValueOnce({ cleanBackups: true }); // backup cleanup prompt
    mockedCoreManage.destroyCloudServer.mockResolvedValue(destroySuccessResult);
    mockedCoreBackup.listBackups.mockReturnValue(["2026-02-21_15-30-45-123"]);

    await destroyCommand("1.2.3.4");

    expect(mockedCoreBackup.cleanupServerBackups).toHaveBeenCalledWith("coolify-test");
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Backups removed");
  });

  it("should not prompt to clean backups when no backups exist", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt
      .mockResolvedValueOnce({ confirm: true })
      .mockResolvedValueOnce({ confirmName: "coolify-test" });
    mockedCoreManage.destroyCloudServer.mockResolvedValue(destroySuccessResult);
    mockedCoreBackup.listBackups.mockReturnValue([]);

    await destroyCommand("1.2.3.4");

    // cleanupServerBackups should NOT be called
    expect(mockedCoreBackup.cleanupServerBackups).not.toHaveBeenCalled();
  });

  it("should keep backups when user declines cleanup prompt", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt
      .mockResolvedValueOnce({ confirm: true })
      .mockResolvedValueOnce({ confirmName: "coolify-test" })
      .mockResolvedValueOnce({ cleanBackups: false }); // user declines
    mockedCoreManage.destroyCloudServer.mockResolvedValue(destroySuccessResult);
    mockedCoreBackup.listBackups.mockReturnValue(["2026-02-21_15-30-45-123"]);

    await destroyCommand("1.2.3.4");

    expect(mockedCoreBackup.cleanupServerBackups).not.toHaveBeenCalled();
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Backups kept");
  });

  it("should prompt backup cleanup when server not found on provider (hint path)", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt
      .mockResolvedValueOnce({ confirm: true })
      .mockResolvedValueOnce({ confirmName: "coolify-test" })
      .mockResolvedValueOnce({ cleanBackups: false });
    mockedCoreManage.destroyCloudServer.mockResolvedValue(destroyNotFoundResult);
    mockedCoreBackup.listBackups.mockReturnValue(["2026-02-21_15-30-45-123"]);

    await destroyCommand("1.2.3.4");

    // Prompt was called once for first confirm, once for confirmName, once for backups
    expect(mockedInquirer.prompt).toHaveBeenCalledTimes(3);
  });

  // ---- DX-01: --dry-run support ----

  it("should show dry-run preview without calling destroyCloudServer or prompts", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);

    await destroyCommand("1.2.3.4", { dryRun: true });

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Dry Run");
    expect(output).toContain("coolify-test");
    expect(output).toContain("1.2.3.4");
    expect(output).toContain("No changes applied");
    // No side effects
    expect(mockedCoreManage.destroyCloudServer).not.toHaveBeenCalled();
    // No confirmation prompts triggered
    expect(mockedInquirer.prompt).not.toHaveBeenCalled();
  });

  it("should show provider info in dry-run output", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);

    await destroyCommand("1.2.3.4", { dryRun: true });

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("hetzner");
    expect(output).toContain("Delete from provider API");
    expect(output).toContain("Remove from local config");
  });

  // ---- BARE-03 regression: destroy works on bare servers ----

  it("should destroy bare-mode server successfully (BARE-03 regression)", async () => {
    const bareServer = { ...sampleServer, mode: "bare" as const };
    const bareDestroyResult = {
      success: true,
      server: bareServer,
      cloudDeleted: true,
      localRemoved: true,
    };

    mockedServerSelect.resolveServer.mockResolvedValue(bareServer);
    mockedInquirer.prompt
      .mockResolvedValueOnce({ confirm: true })
      .mockResolvedValueOnce({ confirmName: "coolify-test" });
    mockedCoreManage.destroyCloudServer.mockResolvedValue(bareDestroyResult);

    await destroyCommand("1.2.3.4");

    expect(mockedCoreManage.destroyCloudServer).toHaveBeenCalledWith("coolify-test");
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("removed from your cloud provider");
  });
});
