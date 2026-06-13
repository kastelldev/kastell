import inquirer from "inquirer";
import { restartCommand } from "../../src/commands/restart";
import * as coreManage from "../../src/core/manage";
import * as coreStatus from "../../src/core/status";
import * as coreTokens from "../../src/core/tokens";
import * as serverSelect from "../../src/utils/serverSelect";
import * as inquirerPrompts from "@inquirer/prompts";
import { createConsoleSpy } from "../helpers/consoleSpy.js";

jest.mock("../../src/core/manage");
jest.mock("../../src/core/status");
jest.mock("../../src/core/tokens");
jest.mock("../../src/utils/serverSelect");
jest.mock("@inquirer/prompts", () => ({
  confirm: jest.fn(),
}));

const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;
const mockedCoreManage = coreManage as jest.Mocked<typeof coreManage>;
const mockedCoreStatus = coreStatus as jest.Mocked<typeof coreStatus>;
const mockedCoreTokens = coreTokens as jest.Mocked<typeof coreTokens>;
const mockedServerSelect = serverSelect as jest.Mocked<typeof serverSelect>;
const mockedInquirerConfirm = inquirerPrompts.confirm as jest.MockedFunction<
  typeof inquirerPrompts.confirm
>;

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

describe("restartCommand", () => {
  const spy = createConsoleSpy();
  let stderrSpy: jest.SpyInstance;
  const originalSetTimeout = global.setTimeout;
  const originalIsTTY = process.stdin.isTTY;
  const originalExitCode = process.exitCode;

  function setIsTTY(value: boolean | undefined): void {
    Object.defineProperty(process.stdin, "isTTY", { value, configurable: true, writable: true });
  }

  beforeEach(() => {
    // P142: deterministic reset to prevent cross-suite process.exitCode pollution
    process.exitCode = 0;
    spy.setup();
    stderrSpy = jest.spyOn(console, "error").mockImplementation();
    // P139 LESSONS: mockReset clears call history AND mockReturnValue/Once queues
    mockedInquirerConfirm.mockReset();
    mockedInquirer.prompt.mockReset();
    mockedServerSelect.resolveServer.mockReset();
    mockedCoreManage.rebootServer.mockReset();
    mockedCoreStatus.getCloudServerStatus.mockReset();
    // Default: confirmOrCancel returns true (accept)
    mockedInquirerConfirm.mockResolvedValue(true);
    // Default: TTY mode for pre-existing tests
    setIsTTY(true);
    // Make setTimeout instant
    global.setTimeout = ((fn: () => void) => {
      fn();
      return 0;
    }) as unknown as typeof setTimeout;

    mockedCoreTokens.getProviderToken.mockReturnValue("test-token");
  });

  afterEach(() => {
    spy.restore();
    stderrSpy.mockRestore();
    setIsTTY(originalIsTTY);
    process.exitCode = originalExitCode;
    global.setTimeout = originalSetTimeout;
  });

  it("should return when no server found", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(undefined);

    await restartCommand("nonexistent");

    expect(mockedCoreManage.rebootServer).not.toHaveBeenCalled();
  });

  it("should return when no servers exist", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(undefined);

    await restartCommand();

    expect(mockedCoreManage.rebootServer).not.toHaveBeenCalled();
  });

  it("should cancel when user declines", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirerConfirm.mockResolvedValueOnce(false);

    await restartCommand("1.2.3.4");

    const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("cancelled");
    expect(mockedCoreManage.rebootServer).not.toHaveBeenCalled();
  });

  it("should reboot server successfully", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedCoreManage.rebootServer.mockResolvedValue({ success: true, server: sampleServer });
    mockedCoreStatus.getCloudServerStatus.mockResolvedValue("running");

    await restartCommand("1.2.3.4");

    expect(mockedCoreManage.rebootServer).toHaveBeenCalledWith("coolify-test");
    const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("restarted successfully");
  });

  it("should handle reboot error from core", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedCoreManage.rebootServer.mockResolvedValue({
      success: false,
      server: sampleServer,
      error: "API Error",
    });

    await restartCommand("1.2.3.4");

    const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: any[]) => c.join(" ")).join("\n");
    expect(output).not.toContain("restarted successfully");
  });

  it("should show timeout warning when server does not come back", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedCoreManage.rebootServer.mockResolvedValue({ success: true, server: sampleServer });
    mockedCoreStatus.getCloudServerStatus.mockResolvedValue("off");

    await restartCommand("1.2.3.4");

    const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("may still be rebooting");
    expect(output).toContain("Check status later");
  });

  it("should not reboot manually added servers", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedCoreManage.rebootServer.mockResolvedValue({
      success: false,
      server: sampleServer,
      error: `Server "coolify-test" was manually added. Reboot is only available for cloud-provisioned servers.`,
    });

    await restartCommand("1.2.3.4");

    expect(mockedCoreStatus.getCloudServerStatus).not.toHaveBeenCalled();
  });

  it("should skip confirmation when --force is set", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedCoreManage.rebootServer.mockResolvedValue({ success: true, server: sampleServer });
    mockedCoreStatus.getCloudServerStatus.mockResolvedValue("running");

    await restartCommand("1.2.3.4", { force: true });

    expect(mockedInquirerConfirm).not.toHaveBeenCalled();
    expect(mockedCoreManage.rebootServer).toHaveBeenCalledWith("coolify-test");
  });

  it("should handle reboot error with hint", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedCoreManage.rebootServer.mockResolvedValue({
      success: false,
      server: sampleServer,
      error: "Provider API down",
      hint: "Check provider status page",
    });

    await restartCommand("1.2.3.4");

    const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Check provider status page");
  });

  it("should handle getCloudServerStatus exception during polling gracefully", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedCoreManage.rebootServer.mockResolvedValue({ success: true, server: sampleServer });
    mockedCoreStatus.getCloudServerStatus.mockRejectedValue(new Error("network error"));

    await restartCommand("1.2.3.4");

    const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("may still be rebooting");
  });

  it("should use null token when getProviderToken returns null", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedCoreManage.rebootServer.mockResolvedValue({ success: true, server: sampleServer });
    mockedCoreTokens.getProviderToken.mockReturnValue(undefined);
    mockedCoreStatus.getCloudServerStatus.mockResolvedValue("running");

    await restartCommand("1.2.3.4");

    expect(mockedCoreStatus.getCloudServerStatus).toHaveBeenCalledWith(sampleServer, "");
  });

  // ---- DX-01: --dry-run support ----

  it("should show dry-run preview without rebooting or prompts", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);

    await restartCommand("1.2.3.4", { dryRun: true });

    const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Dry Run");
    expect(output).toContain("coolify-test");
    expect(output).toContain("1.2.3.4");
    expect(output).toContain("No changes applied");
    expect(mockedCoreManage.rebootServer).not.toHaveBeenCalled();
    expect(mockedInquirerConfirm).not.toHaveBeenCalled();
  });

  it("should show provider and action in dry-run output", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);

    await restartCommand("1.2.3.4", { dryRun: true });

    const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("hetzner");
    expect(output).toContain("Reboot server via provider API");
  });

  // ---- BUG-8: restart bare message ----

  it("should show SSH info (not Coolify URL) after restarting a bare server (BUG-8)", async () => {
    const bareServer = { ...sampleServer, mode: "bare" as const };
    mockedServerSelect.resolveServer.mockResolvedValue(bareServer);
    mockedCoreManage.rebootServer.mockResolvedValue({ success: true, server: bareServer });
    mockedCoreStatus.getCloudServerStatus.mockResolvedValue("running");

    await restartCommand("1.2.3.4");

    const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("ssh root@1.2.3.4");
    expect(output).not.toContain("Access Coolify");
  });

  it("should show Coolify URL (not SSH info) after restarting a Coolify server (BUG-8 non-regression)", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedCoreManage.rebootServer.mockResolvedValue({ success: true, server: sampleServer });
    mockedCoreStatus.getCloudServerStatus.mockResolvedValue("running");

    await restartCommand("1.2.3.4");

    const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Access Coolify");
    expect(output).not.toContain("ssh root@");
  });

  // ---- P142 Task 9: 4-case destructive-guard matrix ----

  describe("P142 Task 9 — destructive guard matrix", () => {
    it("prompts the user in TTY mode without --force", async () => {
      setIsTTY(true);
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedCoreManage.rebootServer.mockResolvedValue({ success: true, server: sampleServer });
      mockedCoreStatus.getCloudServerStatus.mockResolvedValue("running");

      await restartCommand("1.2.3.4", { force: false });

      expect(mockedInquirerConfirm).toHaveBeenCalled();
      expect(mockedCoreManage.rebootServer).toHaveBeenCalledWith("coolify-test");
      expect(process.exitCode ?? 0).not.toBe(1);
    });

    it("bypasses prompts in TTY mode with --force", async () => {
      setIsTTY(true);
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedCoreManage.rebootServer.mockResolvedValue({ success: true, server: sampleServer });
      mockedCoreStatus.getCloudServerStatus.mockResolvedValue("running");

      await restartCommand("1.2.3.4", { force: true });

      expect(mockedInquirerConfirm).not.toHaveBeenCalled();
      expect(mockedCoreManage.rebootServer).toHaveBeenCalledWith("coolify-test");
      expect(process.exitCode ?? 0).not.toBe(1);
    });

    it("refuses the restart and sets exit code 1 in non-TTY mode without --force", async () => {
      setIsTTY(false);
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);

      await restartCommand("1.2.3.4", { force: false });

      expect(mockedCoreManage.rebootServer).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it("reaches the restart mutation in non-TTY mode with --force", async () => {
      setIsTTY(false);
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedCoreManage.rebootServer.mockResolvedValue({ success: true, server: sampleServer });
      mockedCoreStatus.getCloudServerStatus.mockResolvedValue("running");

      await restartCommand("1.2.3.4", { force: true });

      expect(mockedCoreManage.rebootServer).toHaveBeenCalledWith("coolify-test");
      expect(process.exitCode ?? 0).not.toBe(1);
    });
  });
});
