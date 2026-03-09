import { removeCommand } from "../../src/commands/remove";
import * as config from "../../src/utils/config";
import * as serverSelect from "../../src/utils/serverSelect";
import inquirer from "inquirer";

jest.mock("../../src/utils/config");
jest.mock("../../src/utils/serverSelect");
jest.mock("inquirer");

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedServerSelect = serverSelect as jest.Mocked<typeof serverSelect>;
const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;

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
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("should remove server from config when confirmed", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(mockServer);
    mockedInquirer.prompt.mockResolvedValue({ confirm: true });
    mockedConfig.removeServer.mockResolvedValue(true);

    await removeCommand("coolify-test");

    expect(mockedServerSelect.resolveServer).toHaveBeenCalledWith(
      "coolify-test",
      "Select a server to remove:",
    );
    expect(mockedConfig.removeServer).toHaveBeenCalledWith("123");
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("removed from local config");
    expect(output).toContain("cloud server is still running");
  });

  it("should cancel when user declines confirmation", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(mockServer);
    mockedInquirer.prompt.mockResolvedValue({ confirm: false });

    await removeCommand("coolify-test");

    expect(mockedConfig.removeServer).not.toHaveBeenCalled();
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Remove cancelled");
  });

  it("should return early when no server found", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(undefined);

    await removeCommand("nonexistent");

    expect(mockedInquirer.prompt).not.toHaveBeenCalled();
    expect(mockedConfig.removeServer).not.toHaveBeenCalled();
  });

  it("should work without query (interactive selection)", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(mockServer);
    mockedInquirer.prompt.mockResolvedValue({ confirm: true });
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

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Dry Run");
    expect(output).toContain("coolify-test");
    expect(output).toContain("1.2.3.4");
    expect(output).toContain("No changes applied");
    // No side effects
    expect(mockedConfig.removeServer).not.toHaveBeenCalled();
    // No confirmation prompts
    expect(mockedInquirer.prompt).not.toHaveBeenCalled();
  });

  it("should show config path and note in dry-run output", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(mockServer);

    await removeCommand("coolify-test", { dryRun: true });

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Remove from local config");
    expect(output).toContain("NOT destroyed");
  });

  it("should show server name and IP in confirmation prompt", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(mockServer);
    mockedInquirer.prompt.mockResolvedValue({ confirm: false });

    await removeCommand("coolify-test");

    const promptCall = mockedInquirer.prompt.mock.calls[0][0] as any[];
    expect(promptCall[0].message).toContain("coolify-test");
    expect(promptCall[0].message).toContain("1.2.3.4");
    expect(promptCall[0].message).toContain("will NOT be destroyed");
    expect(promptCall[0].default).toBe(false);
  });
});
