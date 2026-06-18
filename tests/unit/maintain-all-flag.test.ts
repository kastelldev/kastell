import axios from "axios";
import * as config from "../../src/utils/config";
import * as sshUtils from "../../src/utils/ssh";
import * as providerFactory from "../../src/utils/providerFactory";
import * as serverSelect from "../../src/utils/serverSelect";
import { maintainCommand } from "../../src/commands/maintain";
import * as inquirerPrompts from "@inquirer/prompts";

jest.mock("../../src/utils/config");
jest.mock("../../src/utils/ssh");
jest.mock("../../src/utils/providerFactory");
jest.mock("../../src/utils/serverSelect");
jest.mock("@inquirer/prompts", () => ({
  confirm: jest.fn(),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedConfig = config as jest.Mocked<typeof config>;
const mockedSsh = sshUtils as jest.Mocked<typeof sshUtils>;
const mockedProviderFactory = providerFactory as jest.Mocked<typeof providerFactory>;
const mockedServerSelect = serverSelect as jest.Mocked<typeof serverSelect>;
const mockedInquirerConfirm = inquirerPrompts.confirm as jest.MockedFunction<
  typeof inquirerPrompts.confirm
>;

const coolifyServer = {
  id: "123",
  name: "coolify-test",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00.000Z",
  mode: "coolify" as const,
};

const dokployServer = {
  id: "456",
  name: "dokploy-prod",
  provider: "digitalocean",
  ip: "5.6.7.8",
  region: "nyc1",
  size: "s-2vcpu-4gb",
  createdAt: "2026-01-02T00:00:00.000Z",
  mode: "coolify" as const,
  platform: "dokploy" as const,
};

const bareServer = {
  id: "789",
  name: "bare-test",
  provider: "hetzner",
  ip: "9.9.9.9",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00.000Z",
  mode: "bare" as const,
};

const mockProvider = {
  name: "hetzner",
  displayName: "Hetzner Cloud",
  getSnapshotCostEstimate: jest.fn().mockRejectedValue(new Error("snapshot off")),
  createSnapshot: jest.fn(),
};

describe("maintainCommand — --all flag (maintainAll)", () => {
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
    (mockedProviderFactory.createProviderWithToken as jest.Mock).mockReset();
    (mockProvider.getSnapshotCostEstimate as jest.Mock).mockReset();
    (mockProvider.createSnapshot as jest.Mock).mockReset();
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    setIsTTY(true);
    mockedInquirerConfirm.mockReset();
    // Default: destructive guard accepts
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

  it("should skip bare server in --all dry-run and show warning", async () => {
    mockedConfig.getServers.mockReturnValue([coolifyServer, bareServer]);

    await maintainCommand(undefined, { all: true, dryRun: true });

    const output = [...consoleLogSpy.mock.calls, ...consoleErrorSpy.mock.calls]
      .map((c) => c.join(" "))
      .join("\n");
    // Bare server should be skipped with warning
    expect(output).toContain("bare-test");
    expect(output).toContain("not available for bare servers");
    // Coolify server should still dry-run
    expect(output).toContain("coolify-test");
  });

  it("should show dry-run steps for dokploy platform server", async () => {
    mockedConfig.getServers.mockReturnValue([dokployServer]);

    await maintainCommand(undefined, { all: true, dryRun: true });

    const output = [...consoleLogSpy.mock.calls, ...consoleErrorSpy.mock.calls]
      .map((c) => c.join(" "))
      .join("\n");
    expect(output).toContain("dokploy-prod");
    expect(output).toContain("Dokploy");
    expect(output).toContain("Dry Run");
  });

  it("should skip server missing provider token in --all and mark failure", async () => {
    mockedConfig.getServers.mockReturnValue([coolifyServer]);
    // collectProviderTokens returns empty map (no token available)
    mockedServerSelect.collectProviderTokens.mockResolvedValue(new Map());

    await maintainCommand(undefined, { all: true });

    const output = [...consoleLogSpy.mock.calls, ...consoleErrorSpy.mock.calls]
      .map((c) => c.join(" "))
      .join("\n");
    expect(output).toContain("no API token available");
    expect(process.exitCode).toBe(1);
  });

  it("should refuse --all in non-TTY mode without --force and set exit code", async () => {
    setIsTTY(false);
    mockedConfig.getServers.mockReturnValue([coolifyServer]);

    await maintainCommand(undefined, { all: true });

    const output = [...consoleLogSpy.mock.calls, ...consoleErrorSpy.mock.calls]
      .map((c) => c.join(" "))
      .join("\n");
    expect(output).toContain("--force");
    expect(process.exitCode).toBe(1);
  });

  it("should respect --force in --all non-TTY mode (proceeds without prompt)", async () => {
    setIsTTY(false);
    mockedConfig.getServers.mockReturnValue([coolifyServer]);
    mockedServerSelect.collectProviderTokens.mockResolvedValue(
      new Map([["hetzner", "test-token"]]),
    );

    (mockedProviderFactory.createProviderWithToken as jest.Mock).mockReturnValue(mockProvider);

    // Step 1: getServerStatus throws to keep test short
    mockedAxios.get.mockRejectedValueOnce(new Error("status fail"));

    await maintainCommand(undefined, { all: true, force: true });

    // The destructive guard was bypassed via --force (no confirm called)
    expect(mockedInquirerConfirm).not.toHaveBeenCalled();
    // Maintenance was attempted on the server
    expect(mockedServerSelect.collectProviderTokens).toHaveBeenCalled();
  });

  it("should skip --all dry-run when all servers are bare (no maintenance report)", async () => {
    mockedConfig.getServers.mockReturnValue([bareServer]);

    await maintainCommand(undefined, { all: true, dryRun: true });

    const output = [...consoleLogSpy.mock.calls, ...consoleErrorSpy.mock.calls]
      .map((c) => c.join(" "))
      .join("\n");
    expect(output).toContain("bare-test");
    // No maintenance report in pure dry-run path
    expect(output).not.toContain("Maintenance Report");
  });
});
