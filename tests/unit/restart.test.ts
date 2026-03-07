import inquirer from "inquirer";
import { restartCommand } from "../../src/commands/restart";
import * as coreManage from "../../src/core/manage";
import * as coreStatus from "../../src/core/status";
import * as coreTokens from "../../src/core/tokens";
import * as serverSelect from "../../src/utils/serverSelect";

jest.mock("../../src/core/manage");
jest.mock("../../src/core/status");
jest.mock("../../src/core/tokens");
jest.mock("../../src/utils/serverSelect");

const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;
const mockedCoreManage = coreManage as jest.Mocked<typeof coreManage>;
const mockedCoreStatus = coreStatus as jest.Mocked<typeof coreStatus>;
const mockedCoreTokens = coreTokens as jest.Mocked<typeof coreTokens>;
const mockedServerSelect = serverSelect as jest.Mocked<typeof serverSelect>;

const sampleServer = {
  id: "123",
  name: "coolify-test",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("restartCommand", () => {
  let consoleSpy: jest.SpyInstance;
  const originalSetTimeout = global.setTimeout;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
    // Make setTimeout instant
    global.setTimeout = ((fn: Function) => {
      fn();
      return 0;
    }) as any;

    mockedCoreTokens.getProviderToken.mockReturnValue("test-token");
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    global.setTimeout = originalSetTimeout;
  });

  it("should return when no server found", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(undefined);

    await restartCommand("nonexistent");

    // resolveServer returns undefined (it logs "Server not found" internally)
    expect(mockedCoreManage.rebootServer).not.toHaveBeenCalled();
  });

  it("should return when no servers exist", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(undefined);

    await restartCommand();

    expect(mockedCoreManage.rebootServer).not.toHaveBeenCalled();
  });

  it("should cancel when user declines", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt.mockResolvedValueOnce({ confirm: false });

    await restartCommand("1.2.3.4");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Restart cancelled");
    expect(mockedCoreManage.rebootServer).not.toHaveBeenCalled();
  });

  it("should reboot server successfully", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt.mockResolvedValueOnce({ confirm: true });
    mockedCoreManage.rebootServer.mockResolvedValue({ success: true, server: sampleServer });
    // Polling: server comes back running
    mockedCoreStatus.getCloudServerStatus.mockResolvedValue("running");

    await restartCommand("1.2.3.4");

    expect(mockedCoreManage.rebootServer).toHaveBeenCalledWith("coolify-test");
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("restarted successfully");
  });

  it("should handle reboot error from core", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt.mockResolvedValueOnce({ confirm: true });
    mockedCoreManage.rebootServer.mockResolvedValue({
      success: false,
      server: sampleServer,
      error: "API Error",
    });

    await restartCommand("1.2.3.4");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).not.toContain("restarted successfully");
  });

  it("should show timeout warning when server does not come back", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt.mockResolvedValueOnce({ confirm: true });
    mockedCoreManage.rebootServer.mockResolvedValue({ success: true, server: sampleServer });
    // All polling attempts return non-running status
    mockedCoreStatus.getCloudServerStatus.mockResolvedValue("off");

    await restartCommand("1.2.3.4");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("may still be rebooting");
    expect(output).toContain("Check status later");
  });

  it("should not reboot manually added servers", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt.mockResolvedValueOnce({ confirm: true });
    mockedCoreManage.rebootServer.mockResolvedValue({
      success: false,
      server: sampleServer,
      error: `Server "coolify-test" was manually added. Reboot is only available for cloud-provisioned servers.`,
    });

    await restartCommand("1.2.3.4");

    // No polling should happen since reboot failed
    expect(mockedCoreStatus.getCloudServerStatus).not.toHaveBeenCalled();
  });

  // ---- DX-01: --dry-run support ----

  it("should show dry-run preview without rebooting or prompts", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);

    await restartCommand("1.2.3.4", { dryRun: true });

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Dry Run");
    expect(output).toContain("coolify-test");
    expect(output).toContain("1.2.3.4");
    expect(output).toContain("No changes applied");
    // No side effects
    expect(mockedCoreManage.rebootServer).not.toHaveBeenCalled();
    // No confirmation prompts
    expect(mockedInquirer.prompt).not.toHaveBeenCalled();
  });

  it("should show provider and action in dry-run output", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);

    await restartCommand("1.2.3.4", { dryRun: true });

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("hetzner");
    expect(output).toContain("Reboot server via provider API");
  });

  // ---- BUG-8: restart bare message ----

  it("should show SSH info (not Coolify URL) after restarting a bare server (BUG-8)", async () => {
    const bareServer = { ...sampleServer, mode: "bare" as const };
    mockedServerSelect.resolveServer.mockResolvedValue(bareServer);
    mockedInquirer.prompt.mockResolvedValueOnce({ confirm: true });
    mockedCoreManage.rebootServer.mockResolvedValue({ success: true, server: bareServer });
    mockedCoreStatus.getCloudServerStatus.mockResolvedValue("running");

    await restartCommand("1.2.3.4");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("ssh root@1.2.3.4");
    expect(output).not.toContain("Access Coolify");
  });

  it("should show Coolify URL (not SSH info) after restarting a Coolify server (BUG-8 non-regression)", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt.mockResolvedValueOnce({ confirm: true });
    mockedCoreManage.rebootServer.mockResolvedValue({ success: true, server: sampleServer });
    mockedCoreStatus.getCloudServerStatus.mockResolvedValue("running");

    await restartCommand("1.2.3.4");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Access Coolify");
    expect(output).not.toContain("ssh root@");
  });
});
