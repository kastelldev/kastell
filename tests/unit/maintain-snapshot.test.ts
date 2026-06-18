import axios from "axios";
import * as config from "../../src/utils/config";
import * as sshUtils from "../../src/utils/ssh";
import * as providerFactory from "../../src/utils/providerFactory";
import { maintainCommand } from "../../src/commands/maintain";
import * as inquirerPrompts from "@inquirer/prompts";

jest.mock("../../src/utils/config");
jest.mock("../../src/utils/ssh");
jest.mock("../../src/utils/providerFactory");
jest.mock("@inquirer/prompts", () => ({
  confirm: jest.fn(),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedConfig = config as jest.Mocked<typeof config>;
const mockedSsh = sshUtils as jest.Mocked<typeof sshUtils>;
const mockedProviderFactory = providerFactory as jest.Mocked<typeof providerFactory>;
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

const mockProvider = {
  name: "hetzner",
  displayName: "Hetzner Cloud",
  getSnapshotCostEstimate: jest.fn(),
  createSnapshot: jest.fn(),
};

describe("maintainCommand — snapshot step (offerSnapshot)", () => {
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  const originalSetTimeout = global.setTimeout;
  const originalIsTTY = process.stdin.isTTY;
  const originalExitCode = process.exitCode;

  function setIsTTY(value: boolean | undefined): void {
    Object.defineProperty(process.stdin, "isTTY", { value, configurable: true, writable: true });
  }

  beforeEach(() => {
    process.exitCode = 0;
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
    jest.clearAllMocks();
    // Reset all mockReturnValue defaults — clearAllMocks does not clear queues
    (mockProvider.getSnapshotCostEstimate as jest.Mock).mockReset();
    (mockProvider.createSnapshot as jest.Mock).mockReset();
    (mockedProviderFactory.createProviderWithToken as jest.Mock).mockReset();
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedConfig.findServers.mockReturnValue([sampleServer]);
    setIsTTY(true);
    // P141 pattern: confirmOrCancel auto-accepts (destructive guard passes)
    mockedInquirerConfirm.mockReset();
    mockedInquirerConfirm.mockResolvedValue(true);
    global.setTimeout = ((fn: () => void) => {
      fn();
      return 0;
    }) as unknown as typeof setTimeout;
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    setIsTTY(originalIsTTY);
    process.exitCode = originalExitCode;
    global.setTimeout = originalSetTimeout;
    process.exitCode = undefined;
  });

  it("should skip snapshot when cost estimate API throws (continues to maintenance)", async () => {
    const inquirer = await import("inquirer");
    (inquirer.default as { prompt: unknown }).prompt = jest
      .fn()
      .mockResolvedValueOnce({ apiToken: "test-token" });

    (mockedProviderFactory.createProviderWithToken as jest.Mock).mockReturnValue(mockProvider);
    (mockProvider.getSnapshotCostEstimate as jest.Mock).mockRejectedValue(new Error("API down"));

    // Step 1: getServerStatus throws
    mockedAxios.get.mockRejectedValueOnce(new Error("status fail"));

    await maintainCommand("1.2.3.4");

    const output = [...consoleLogSpy.mock.calls, ...consoleErrorSpy.mock.calls]
      .map((c) => c.join(" "))
      .join("\n");
    expect(output).toContain("Could not estimate snapshot cost");
    // Maintenance still attempted
    expect(output).toContain("Maintenance Report");
  });

  it("should create snapshot when user accepts and provider succeeds", async () => {
    const inquirer = await import("inquirer");
    const inqModule = inquirer.default as unknown as { prompt: jest.Mock };
    // Use mockImplementation so we can return based on the question content.
    inqModule.prompt = jest.fn(async (questions: Array<{ name: string }>) => {
      for (const q of questions) {
        if (q.name === "apiToken") return { apiToken: "test-token" };
        if (q.name === "createSnap") return { createSnap: true };
      }
      return {};
    });

    (mockedProviderFactory.createProviderWithToken as jest.Mock).mockReturnValue(mockProvider);
    (mockProvider.getSnapshotCostEstimate as jest.Mock).mockResolvedValue("$0.05/month");
    (mockProvider.createSnapshot as jest.Mock).mockResolvedValue({
      id: "snap-1",
      name: "kastell-maintain-123",
      createdAt: "2026-01-01T00:00:00Z",
      status: "available",
    });

    // Step 1: getServerStatus throws
    mockedAxios.get.mockRejectedValueOnce(new Error("status fail"));

    await maintainCommand("1.2.3.4");

    expect(mockProvider.getSnapshotCostEstimate).toHaveBeenCalledWith("123");
    expect(mockProvider.createSnapshot).toHaveBeenCalledWith(
      "123",
      expect.stringMatching(/^kastell-maintain-\d+$/),
    );
  });

  it("should skip snapshot creation when user declines the confirm prompt", async () => {
    const inquirer = await import("inquirer");
    const inqModule = inquirer.default as unknown as { prompt: jest.Mock };
    inqModule.prompt = jest.fn(async (questions: Array<{ name: string }>) => {
      for (const q of questions) {
        if (q.name === "apiToken") return { apiToken: "test-token" };
        if (q.name === "createSnap") return { createSnap: false };
      }
      return {};
    });

    (mockedProviderFactory.createProviderWithToken as jest.Mock).mockReturnValue(mockProvider);
    (mockProvider.getSnapshotCostEstimate as jest.Mock).mockResolvedValue("$0.10/month");

    mockedAxios.get.mockRejectedValueOnce(new Error("status fail"));

    await maintainCommand("1.2.3.4");

    expect(mockProvider.getSnapshotCostEstimate).toHaveBeenCalled();
    expect(mockProvider.createSnapshot).not.toHaveBeenCalled();
    const output = [...consoleLogSpy.mock.calls, ...consoleErrorSpy.mock.calls]
      .map((c) => c.join(" "))
      .join("\n");
    expect(output).toContain("Snapshot skipped");
  });

  it("should warn and continue when createSnapshot throws", async () => {
    const inquirer = await import("inquirer");
    const inqModule = inquirer.default as unknown as { prompt: jest.Mock };
    inqModule.prompt = jest.fn(async (questions: Array<{ name: string }>) => {
      for (const q of questions) {
        if (q.name === "apiToken") return { apiToken: "test-token" };
        if (q.name === "createSnap") return { createSnap: true };
      }
      return {};
    });

    (mockedProviderFactory.createProviderWithToken as jest.Mock).mockReturnValue(mockProvider);
    (mockProvider.getSnapshotCostEstimate as jest.Mock).mockResolvedValue("$0.05/month");
    (mockProvider.createSnapshot as jest.Mock).mockRejectedValue(new Error("Snapshot quota exceeded"));

    mockedAxios.get.mockRejectedValueOnce(new Error("status fail"));

    await maintainCommand("1.2.3.4");

    // Snapshot was attempted (provider called)
    expect(mockProvider.createSnapshot).toHaveBeenCalled();
    // Maintenance continues even when snapshot creation fails — observe by reaching
    // the maintenance report (which only renders when runMaintain completed)
    const output = [...consoleLogSpy.mock.calls, ...consoleErrorSpy.mock.calls]
      .map((c) => c.join(" "))
      .join("\n");
    expect(output).toContain("Maintenance Report");
  });
});
