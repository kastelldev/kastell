import { removeCommand } from "../../src/commands/remove";
import * as config from "../../src/utils/config";
import * as serverSelect from "../../src/utils/serverSelect";
import inquirer from "inquirer";
import * as inquirerPrompts from "@inquirer/prompts";
import { createConsoleSpy } from "../helpers/consoleSpy.js";

jest.mock("../../src/utils/config");
jest.mock("../../src/utils/serverSelect");
jest.mock("inquirer");
jest.mock("@inquirer/prompts", () => ({
  confirm: jest.fn(),
}));

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedServerSelect = serverSelect as jest.Mocked<typeof serverSelect>;
const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;
const mockedInquirerConfirm = inquirerPrompts.confirm as jest.MockedFunction<
  typeof inquirerPrompts.confirm
>;

const mockServer = {
  id: "123",
  name: "coolify-test",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-02-23T10:00:00Z",
  mode: "coolify" as const,
};

describe("removeCommand", () => {
  const spy = createConsoleSpy();
  const originalIsTTY = process.stdin.isTTY;
  const originalExitCode = process.exitCode;

  function setIsTTY(value: boolean | undefined): void {
    Object.defineProperty(process.stdin, "isTTY", { value, configurable: true, writable: true });
  }

  beforeEach(() => {
    spy.setup();
    // P139 LESSONS: mockReset clears call history AND mockReturnValue/Once queues
    mockedInquirerConfirm.mockReset();
    mockedInquirer.prompt.mockReset();
    mockedConfig.removeServer.mockReset();
    mockedServerSelect.resolveServer.mockReset();
    // Default: confirmOrCancel returns true (accept)
    mockedInquirerConfirm.mockResolvedValue(true);
    // Default: TTY mode for pre-existing tests
    setIsTTY(true);
  });

  afterEach(() => {
    spy.restore();
    setIsTTY(originalIsTTY);
    process.exitCode = originalExitCode;
  });

  it("should remove server from config when confirmed", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(mockServer);
    mockedConfig.removeServer.mockResolvedValue(true);

    await removeCommand("coolify-test");

    expect(mockedServerSelect.resolveServer).toHaveBeenCalledWith(
      "coolify-test",
      "Select a server to remove:",
    );
    expect(mockedConfig.removeServer).toHaveBeenCalledWith("123");
    const output = spy.getCalls().map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("removed from local config");
    expect(output).toContain("cloud server is still running");
  });

  it("should cancel when user declines confirmation", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(mockServer);
    mockedInquirerConfirm.mockResolvedValueOnce(false);

    await removeCommand("coolify-test");

    expect(mockedConfig.removeServer).not.toHaveBeenCalled();
    const output = spy.getCalls().map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("cancelled");
  });

  it("should return early when no server found", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(undefined);

    await removeCommand("nonexistent");

    expect(mockedInquirerConfirm).not.toHaveBeenCalled();
    expect(mockedConfig.removeServer).not.toHaveBeenCalled();
  });

  it("should work without query (interactive selection)", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(mockServer);
    mockedConfig.removeServer.mockResolvedValue(true);

    await removeCommand();

    expect(mockedServerSelect.resolveServer).toHaveBeenCalledWith(
      undefined,
      "Select a server to remove:",
    );
    expect(mockedConfig.removeServer).toHaveBeenCalledWith("123");
  });

  // ---- DX-01: --dry-run support ----

  it("should show dry-run preview without removing or prompts", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(mockServer);

    await removeCommand("coolify-test", { dryRun: true });

    const output = spy.getCalls().map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Dry Run");
    expect(output).toContain("coolify-test");
    expect(output).toContain("1.2.3.4");
    expect(output).toContain("No changes applied");
    // No side effects
    expect(mockedConfig.removeServer).not.toHaveBeenCalled();
    // No confirmation prompts
    expect(mockedInquirerConfirm).not.toHaveBeenCalled();
  });

  it("should show config path and note in dry-run output", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(mockServer);

    await removeCommand("coolify-test", { dryRun: true });

    const output = spy.getCalls().map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Remove from local config");
    expect(output).toContain("NOT destroyed");
  });

  // ---- P142 Task 9: 4-case destructive-guard matrix ----

  describe("P142 Task 9 — destructive guard matrix", () => {
    it("prompts the user in TTY mode without --force", async () => {
      setIsTTY(true);
      mockedServerSelect.resolveServer.mockResolvedValue(mockServer);
      mockedConfig.removeServer.mockResolvedValue(true);

      await removeCommand("coolify-test", { force: false });

      expect(mockedInquirerConfirm).toHaveBeenCalled();
      expect(mockedConfig.removeServer).toHaveBeenCalledWith("123");
      expect(process.exitCode ?? 0).not.toBe(1);
    });

    it("bypasses prompts in TTY mode with --force", async () => {
      setIsTTY(true);
      mockedServerSelect.resolveServer.mockResolvedValue(mockServer);
      mockedConfig.removeServer.mockResolvedValue(true);

      await removeCommand("coolify-test", { force: true });

      expect(mockedInquirerConfirm).not.toHaveBeenCalled();
      expect(mockedConfig.removeServer).toHaveBeenCalledWith("123");
      expect(process.exitCode ?? 0).not.toBe(1);
    });

    it("refuses the remove and sets exit code 1 in non-TTY mode without --force", async () => {
      setIsTTY(false);
      mockedServerSelect.resolveServer.mockResolvedValue(mockServer);

      await removeCommand("coolify-test", { force: false });

      // non-TTY + no force -> refuses BEFORE mutation, exit 1
      expect(mockedConfig.removeServer).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it("reaches the remove mutation in non-TTY mode with --force", async () => {
      setIsTTY(false);
      mockedServerSelect.resolveServer.mockResolvedValue(mockServer);
      mockedConfig.removeServer.mockResolvedValue(true);

      await removeCommand("coolify-test", { force: true });

      // non-TTY + force -> bypasses guard, mutation runs
      expect(mockedConfig.removeServer).toHaveBeenCalledWith("123");
      expect(process.exitCode ?? 0).not.toBe(1);
    });
  });
});
