import inquirer from "inquirer";
import { destroyCommand } from "../../src/commands/destroy";
import * as coreManage from "../../src/core/manage";
import * as serverSelect from "../../src/utils/serverSelect";
import * as coreBackup from "../../src/core/backup";
import * as inquirerPrompts from "@inquirer/prompts";

jest.mock("../../src/core/manage");
jest.mock("../../src/utils/serverSelect");
jest.mock("../../src/core/backup");
jest.mock("@inquirer/prompts", () => ({
  confirm: jest.fn(),
}));

const mockedCoreBackup = coreBackup as jest.Mocked<typeof coreBackup>;

const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;
const mockedCoreManage = coreManage as jest.Mocked<typeof coreManage>;
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
  let stderrSpy: jest.SpyInstance;
  const originalIsTTY = process.stdin.isTTY;
  const originalExitCode = process.exitCode;

  function setIsTTY(value: boolean | undefined): void {
    Object.defineProperty(process.stdin, "isTTY", { value, configurable: true, writable: true });
  }

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    stderrSpy = jest.spyOn(console, "error").mockImplementation();
    jest.clearAllMocks();
    // P139 LESSONS: mockReset clears mockReturnValueOnce queues that clearAllMocks leaves behind
    mockedInquirer.prompt.mockReset();
    mockedInquirerConfirm.mockReset();
    // Default: confirmOrCancel returns true (accept)
    mockedInquirerConfirm.mockResolvedValue(true);
    // Default: TTY mode for pre-existing tests (P142 destructive guard needs TTY to prompt)
    setIsTTY(true);
    // Default: no backups exist for servers
    mockedCoreBackup.listBackups.mockReturnValue([]);
    mockedCoreBackup.cleanupServerBackups.mockReturnValue({ removed: true, path: "/mock/path" });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stderrSpy.mockRestore();
    setIsTTY(originalIsTTY);
    process.exitCode = originalExitCode;
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
    mockedInquirerConfirm.mockResolvedValueOnce(false);

    await destroyCommand("1.2.3.4");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("cancelled");
    expect(mockedCoreManage.destroyCloudServer).not.toHaveBeenCalled();
  });

  it("should cancel when server name does not match", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt.mockResolvedValueOnce({ confirmName: "wrong-name" });

    await destroyCommand("1.2.3.4");

    const output = stderrSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("does not match");
    expect(mockedCoreManage.destroyCloudServer).not.toHaveBeenCalled();
  });

  it("should destroy server successfully", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt.mockResolvedValueOnce({ confirmName: "coolify-test" });
    mockedCoreManage.destroyCloudServer.mockResolvedValue(destroySuccessResult);

    await destroyCommand("1.2.3.4");

    expect(mockedCoreManage.destroyCloudServer).toHaveBeenCalledWith("coolify-test");
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    // logger.success output is captured (spinner.succeed text is from ora, not console.log)
    expect(output).toContain("removed from your cloud provider");
  });

  it("should handle API error during destroy", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt.mockResolvedValueOnce({ confirmName: "coolify-test" });
    // 1st confirmOrCancel: accept destroy. 2nd confirmOrCancel (local-remove): decline.
    mockedInquirerConfirm
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    mockedCoreManage.destroyCloudServer.mockResolvedValue({
      success: false,
      server: sampleServer,
      cloudDeleted: false,
      localRemoved: false,
      error: "API Error",
    });

    await destroyCommand("1.2.3.4");

    // logger.error("API Error") is captured via stderr spy
    const output = stderrSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("API Error");
  });

  it("should remove from local config when user confirms after API error", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt.mockResolvedValueOnce({ confirmName: "coolify-test" });
    // 1st confirmOrCancel: accept destroy. 2nd confirmOrCancel (local-remove): accept.
    mockedInquirerConfirm
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
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
    mockedInquirer.prompt.mockResolvedValueOnce({ confirmName: "coolify-test" });
    mockedCoreManage.destroyCloudServer.mockResolvedValue(destroyNotFoundResult);

    await destroyCommand("1.2.3.4");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Removed from local config");
  });

  it("should allow interactive server selection", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt.mockResolvedValueOnce({ confirmName: "coolify-test" });
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
    mockedInquirer.prompt.mockResolvedValueOnce({ confirmName: "coolify-test" });
    mockedCoreManage.destroyCloudServer.mockResolvedValue(destroySuccessResult);
    mockedCoreBackup.listBackups.mockReturnValue([]);

    await destroyCommand("1.2.3.4");

    // cleanupServerBackups should NOT be called
    expect(mockedCoreBackup.cleanupServerBackups).not.toHaveBeenCalled();
  });

  it("should keep backups when user declines cleanup prompt", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt
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
      .mockResolvedValueOnce({ confirmName: "coolify-test" })
      .mockResolvedValueOnce({ cleanBackups: false });
    mockedCoreManage.destroyCloudServer.mockResolvedValue(destroyNotFoundResult);
    mockedCoreBackup.listBackups.mockReturnValue(["2026-02-21_15-30-45-123"]);

    await destroyCommand("1.2.3.4");

    // Prompt was called once for confirmName, once for backups
    expect(mockedInquirer.prompt).toHaveBeenCalledTimes(2);
  });

  // ---- --force flag tests ----

  it("should skip both confirmations when --force is set", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedCoreManage.destroyCloudServer.mockResolvedValue(destroySuccessResult);

    await destroyCommand("1.2.3.4", { force: true });

    expect(mockedInquirer.prompt).not.toHaveBeenCalled();
    expect(mockedCoreManage.destroyCloudServer).toHaveBeenCalledWith("coolify-test");
  });

  it("should skip backup cleanup prompt when --force is set and backups exist", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedCoreManage.destroyCloudServer.mockResolvedValue(destroySuccessResult);
    mockedCoreBackup.listBackups.mockReturnValue(["2026-02-21_15-30-45-123"]);

    await destroyCommand("1.2.3.4", { force: true });

    // Only the backup info message is shown, no prompt asked
    expect(mockedCoreBackup.cleanupServerBackups).not.toHaveBeenCalled();
  });

  it("should force-remove from local config when cloud deletion fails with --force", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
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

    await destroyCommand("1.2.3.4", { force: true });

    expect(mockedCoreManage.removeServerRecord).toHaveBeenCalledWith("coolify-test");
    expect(mockedInquirer.prompt).not.toHaveBeenCalled();
  });

  it("should show error with hint when cloud deletion fails and result has hint", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt.mockResolvedValueOnce({ confirmName: "coolify-test" });
    // 1st confirmOrCancel: accept destroy. 2nd confirmOrCancel (local-remove): decline.
    mockedInquirerConfirm
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    mockedCoreManage.destroyCloudServer.mockResolvedValue({
      success: false,
      server: sampleServer,
      cloudDeleted: false,
      localRemoved: false,
      error: "API Timeout",
      hint: "Try again later",
    });

    await destroyCommand("1.2.3.4");

    const errOutput = stderrSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(errOutput).toContain("API Timeout");
    const outOutput = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(outOutput).toContain("Try again later");
  });

  it("should handle cleanup failure gracefully", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedInquirer.prompt
      .mockResolvedValueOnce({ confirmName: "coolify-test" })
      .mockResolvedValueOnce({ cleanBackups: true });
    mockedCoreManage.destroyCloudServer.mockResolvedValue(destroySuccessResult);
    mockedCoreBackup.listBackups.mockReturnValue(["2026-02-21_15-30-45-123"]);
    mockedCoreBackup.cleanupServerBackups.mockReturnValue({ removed: false, path: "/mock/path" });

    await destroyCommand("1.2.3.4");

    const output = stderrSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Failed to remove backups");
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
    mockedInquirer.prompt.mockResolvedValueOnce({ confirmName: "coolify-test" });
    mockedCoreManage.destroyCloudServer.mockResolvedValue(bareDestroyResult);

    await destroyCommand("1.2.3.4");

    expect(mockedCoreManage.destroyCloudServer).toHaveBeenCalledWith("coolify-test");
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("removed from your cloud provider");
  });

  // ---- P142 Task 9: 4-case destructive-guard matrix ----

  describe("P142 Task 9 — destructive guard matrix", () => {
    const originalIsTTY = process.stdin.isTTY;
    const originalExitCode = process.exitCode;

    function setIsTTY(value: boolean | undefined): void {
      Object.defineProperty(process.stdin, "isTTY", { value, configurable: true, writable: true });
    }

    beforeEach(() => {
      setIsTTY(originalIsTTY);
    });

    afterEach(() => {
      setIsTTY(originalIsTTY);
      process.exitCode = originalExitCode;
    });

    it("prompts the user in TTY mode without --force", async () => {
      setIsTTY(true);
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      // First confirm goes through @inquirer/prompts (mocked) returning true;
      // second interactive step (typed-name) goes through inquirer.prompt.
      mockedInquirer.prompt.mockResolvedValueOnce({ confirmName: "coolify-test" });
      mockedCoreManage.destroyCloudServer.mockResolvedValue(destroySuccessResult);

      await destroyCommand("1.2.3.4", { force: false });

      // TTY + no force -> typed-name prompt IS shown
      expect(mockedInquirer.prompt).toHaveBeenCalled();
      expect(mockedCoreManage.destroyCloudServer).toHaveBeenCalledWith("coolify-test");
      expect(process.exitCode ?? 0).not.toBe(1);
    });

    it("bypasses prompts in TTY mode with --force", async () => {
      setIsTTY(true);
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedCoreManage.destroyCloudServer.mockResolvedValue(destroySuccessResult);

      await destroyCommand("1.2.3.4", { force: true });

      // TTY + force -> NO inquirer prompts (typed-name skipped too)
      expect(mockedInquirer.prompt).not.toHaveBeenCalled();
      expect(mockedCoreManage.destroyCloudServer).toHaveBeenCalledWith("coolify-test");
      expect(process.exitCode ?? 0).not.toBe(1);
    });

    it("refuses the destroy and sets exit code 1 in non-TTY mode without --force", async () => {
      setIsTTY(false);
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);

      await destroyCommand("1.2.3.4", { force: false });

      // non-TTY + no force -> refuses BEFORE mutation, exit 1
      expect(mockedCoreManage.destroyCloudServer).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it("reaches the destroy mutation in non-TTY mode with --force", async () => {
      setIsTTY(false);
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockedCoreManage.destroyCloudServer.mockResolvedValue(destroySuccessResult);

      await destroyCommand("1.2.3.4", { force: true });

      // non-TTY + force -> bypasses guard, mutation runs
      expect(mockedCoreManage.destroyCloudServer).toHaveBeenCalledWith("coolify-test");
      expect(process.exitCode ?? 0).not.toBe(1);
    });
  });
});
