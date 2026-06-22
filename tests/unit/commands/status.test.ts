/**
 * statusCommand (src/commands/status.ts) unit tests.
 * Covers: statusCommand, statusAll, autostartCoolify, printStatusTable, printStatusSummary.
 * Target: >= 90% stmts coverage.
 */

jest.mock("../../../src/utils/config");
jest.mock("../../../src/utils/serverSelect");
jest.mock("../../../src/utils/ssh");
jest.mock("../../../src/utils/logger", () => ({
  logger: {
    info: (msg: string) => console.log("info", msg),
    success: (msg: string) => console.log("success", msg),
    warning: (msg: string) => console.error("warning", msg),
    error: (msg: string) => console.error("error", msg),
  },
  createSpinner: jest.fn(() => ({
    start: jest.fn(),
    succeed: jest.fn(),
    fail: jest.fn(),
  })),
}));
jest.mock("../../../src/core/status");
jest.mock("../../../src/adapters/factory");
jest.mock("../../../src/utils/exitCode", () => ({
  markCommandFailed: jest.fn(() => { process.exitCode = 1; }),
}));
jest.mock("../../../src/utils/modeGuard", () => ({
  isBareServer: jest.fn().mockReturnValue(false),
  getServerModeLabel: jest.fn().mockReturnValue("coolify"),
  resolvePlatform: jest.fn().mockReturnValue("coolify"),
  requireManagedMode: jest.fn(),
}));
jest.mock("inquirer");

import inquirer from "inquirer";
import type { ServerRecord } from "../../../src/types/index";
import * as config from "../../../src/utils/config";
import * as serverSelect from "../../../src/utils/serverSelect";
import * as ssh from "../../../src/utils/ssh";
import * as status from "../../../src/core/status";
import * as adapterFactory from "../../../src/adapters/factory";
import * as exitCode from "../../../src/utils/exitCode";
import * as modeGuard from "../../../src/utils/modeGuard";
import { statusCommand } from "../../../src/commands/status";

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedServerSelect = serverSelect as jest.Mocked<typeof serverSelect>;
const mockedSsh = ssh as jest.Mocked<typeof ssh>;
const mockedStatus = status as jest.Mocked<typeof status>;
const mockedAdapterFactory = adapterFactory as jest.Mocked<typeof adapterFactory>;
const mockedExitCode = exitCode as jest.Mocked<typeof exitCode>;
const mockedModeGuard = modeGuard as jest.Mocked<typeof modeGuard>;
const mockedPrompt = inquirer.prompt as jest.MockedFunction<typeof inquirer.prompt>;

// ─── Console spy helpers ──────────────────────────────────────────────────────
let consoleLogSpy: jest.SpyInstance;
let consoleErrorSpy: jest.SpyInstance;
let stderrSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  stderrSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  mockedConfig.getServers.mockReturnValue([]);
  mockedServerSelect.resolveServer.mockReset();
  mockedServerSelect.collectProviderTokens.mockReset();
  mockedServerSelect.promptApiToken.mockReset();
  mockedSsh.checkSshAvailable.mockReturnValue(true);
  mockedStatus.getCloudServerStatus.mockReset();
  mockedStatus.checkAllServersStatus.mockReset();
  mockedStatus.restartCoolify.mockReset();
  mockedAdapterFactory.getAdapter.mockReset();
  mockedAdapterFactory.resolvePlatform.mockReset();
  mockedModeGuard.isBareServer.mockReturnValue(false);
  process.exitCode = undefined;
});

afterEach(() => {
  consoleLogSpy?.mockRestore();
  consoleErrorSpy?.mockRestore();
  stderrSpy?.mockRestore();
  process.exitCode = undefined;
});

// ─── Helper to make a ServerRecord ───────────────────────────────────────────
function makeServer(overrides: Partial<ServerRecord> = {}): ServerRecord {
  return {
    id: "srv-001",
    name: "test-srv",
    provider: "hetzner",
    ip: "1.2.3.4",
    region: "nbg1",
    size: "cax11",
    createdAt: "2026-01-01T00:00:00Z",
    mode: "coolify",
    ...overrides,
  };
}

// ─── Helper to make a mock PlatformAdapter ───────────────────────────────────
import type { PlatformAdapter } from "../../../src/adapters/interface";
function makeMockAdapter(healthStatus: "running" | "not reachable"): PlatformAdapter {
  return {
    name: "coolify",
    port: 8000,
    defaultLogService: "coolify",
    platformPorts: [80, 443, 8000],
    getCloudInit: jest.fn(),
    healthCheck: jest.fn().mockResolvedValue({ status: healthStatus }),
    createBackup: jest.fn(),
    getStatus: jest.fn(),
    update: jest.fn(),
  };
}

// ─── statusAll tests ─────────────────────────────────────────────────────────

describe("statusAll", () => {
  it("logs info and returns early when no servers registered", async () => {
    mockedConfig.getServers.mockReturnValue([]);

    // statusAll is called when options.all is true
    await statusCommand(undefined, { all: true });

    const logCalls = consoleLogSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(logCalls).toContain("No servers found");
  });

  it("collects tokens, checks all servers, prints table and summary", async () => {
    const servers = [makeServer({ name: "srv-a" }), makeServer({ name: "srv-b", ip: "2.3.4.5" })];
    mockedConfig.getServers.mockReturnValue(servers);
    mockedServerSelect.collectProviderTokens.mockResolvedValue(new Map([["hetzner", "tok-abc"]]));
    mockedStatus.checkAllServersStatus.mockResolvedValue([
      { server: servers[0], serverStatus: "running", platformStatus: "running" },
      { server: servers[1], serverStatus: "running", platformStatus: "stopped", error: "coolify down" },
    ]);

    await statusCommand(undefined, { all: true });

    expect(mockedServerSelect.collectProviderTokens).toHaveBeenCalledWith(servers);
    expect(mockedStatus.checkAllServersStatus).toHaveBeenCalledWith(servers, expect.any(Map));
    const logCalls = consoleLogSpy.mock.calls.join("\n");
    expect(logCalls).toContain("srv-a");
    expect(logCalls).toContain("srv-b");
  });

  it("logs success with bare server count when only bare servers exist", async () => {
    const servers = [makeServer({ name: "bare-srv", mode: "bare" })];
    mockedConfig.getServers.mockReturnValue(servers);
    mockedServerSelect.collectProviderTokens.mockResolvedValue(new Map());
    mockedStatus.checkAllServersStatus.mockResolvedValue([
      { server: servers[0], serverStatus: "running", platformStatus: "n/a" },
    ]);

    await statusCommand(undefined, { all: true });

    const logCalls = consoleLogSpy.mock.calls.join("\n");
    expect(logCalls).toContain("bare server(s) running");
  });

  it("logs warning with error count in summary when errors exist", async () => {
    const servers = [makeServer()];
    mockedConfig.getServers.mockReturnValue(servers);
    mockedServerSelect.collectProviderTokens.mockResolvedValue(new Map([["hetzner", "tok"]]));
    mockedStatus.checkAllServersStatus.mockResolvedValue([
      { server: servers[0], serverStatus: "error", platformStatus: "error", error: "provider timeout" },
    ]);

    await statusCommand(undefined, { all: true });

    const errCalls = consoleErrorSpy.mock.calls.join("\n");
    expect(errCalls).toContain("error(s)");
  });
});

// ─── autostartCoolify tests ──────────────────────────────────────────────────

describe("autostartCoolify", () => {
  it("logs warning and returns early when SSH not available", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(false);
    mockedPrompt.mockResolvedValue({ apiToken: "test-token" });
    const server = makeServer();

    // Call statusCommand with autostart — it calls autostartCoolify internally
    mockedServerSelect.resolveServer.mockResolvedValue(server);
    mockedServerSelect.promptApiToken.mockResolvedValue("tok");
    mockedStatus.getCloudServerStatus.mockResolvedValue("running");
    mockedAdapterFactory.resolvePlatform.mockReturnValue("coolify");
    mockedAdapterFactory.getAdapter.mockReturnValue(makeMockAdapter("running"));

    await statusCommand("test-srv", { autostart: true });

    const errCalls = consoleErrorSpy.mock.calls.join("\n");
    expect(errCalls).toContain("SSH not available");
  });

  it("restarts Coolify when server is running but platform is down", async () => {
    mockedPrompt.mockResolvedValue({ apiToken: "test-token" });
    const server = makeServer();
    mockedServerSelect.resolveServer.mockResolvedValue(server);
    mockedServerSelect.promptApiToken.mockResolvedValue("tok");
    mockedStatus.getCloudServerStatus.mockResolvedValue("running");
    mockedAdapterFactory.resolvePlatform.mockReturnValue("coolify");
    mockedAdapterFactory.getAdapter.mockReturnValue(makeMockAdapter("not reachable"));
    mockedStatus.restartCoolify.mockResolvedValue({ success: true, nowRunning: true });

    await statusCommand("test-srv", { autostart: true });

    expect(mockedStatus.restartCoolify).toHaveBeenCalledWith(server);
  });

  it("logs warning when restart succeeds but server still starting", async () => {
    mockedPrompt.mockResolvedValue({ apiToken: "test-token" });
    const server = makeServer();
    mockedServerSelect.resolveServer.mockResolvedValue(server);
    mockedServerSelect.promptApiToken.mockResolvedValue("tok");
    mockedStatus.getCloudServerStatus.mockResolvedValue("running");
    mockedAdapterFactory.resolvePlatform.mockReturnValue("coolify");
    mockedAdapterFactory.getAdapter.mockReturnValue(makeMockAdapter("not reachable"));
    mockedStatus.restartCoolify.mockResolvedValue({ success: true, nowRunning: false });

    await statusCommand("test-srv", { autostart: true });

    const errCalls = consoleErrorSpy.mock.calls.join("\n");
    expect(errCalls).toContain("still be starting");
  });

  it("logs error when restart fails", async () => {
    mockedPrompt.mockResolvedValue({ apiToken: "test-token" });
    const server = makeServer();
    mockedServerSelect.resolveServer.mockResolvedValue(server);
    mockedServerSelect.promptApiToken.mockResolvedValue("tok");
    mockedStatus.getCloudServerStatus.mockResolvedValue("running");
    mockedAdapterFactory.resolvePlatform.mockReturnValue("coolify");
    mockedAdapterFactory.getAdapter.mockReturnValue(makeMockAdapter("not reachable"));
    mockedStatus.restartCoolify.mockResolvedValue({ success: false, nowRunning: false, error: "SSH connection refused", hint: "Check if server is reachable" });

    await statusCommand("test-srv", { autostart: true });

    const errCalls = consoleErrorSpy.mock.calls.join("\n");
    expect(errCalls).toContain("SSH connection refused");
  });
});

// ─── statusCommand (single server) tests ─────────────────────────────────────

describe("statusCommand single server", () => {
  beforeEach(() => {
    // Default inquirer prompt mock (P141 pattern)
    mockedPrompt.mockResolvedValue({ apiToken: "test-token" });
  });

  it("resolves server and displays status info", async () => {
    const server = makeServer();
    mockedServerSelect.resolveServer.mockResolvedValue(server);
    mockedStatus.getCloudServerStatus.mockResolvedValue("running");
    mockedAdapterFactory.resolvePlatform.mockReturnValue("coolify");
    mockedAdapterFactory.getAdapter.mockReturnValue(makeMockAdapter("running"));

    await statusCommand("test-srv");

    const logCalls = consoleLogSpy.mock.calls.join("\n");
    expect(logCalls).toContain("Name:");
    expect(logCalls).toContain("test-srv");
    expect(logCalls).toContain("1.2.3.4");
    expect(logCalls).toContain("hetzner");
    expect(logCalls).toContain("nbg1");
    expect(logCalls).toContain("cax11");
    expect(logCalls).toContain("running");
  });

  it("returns early when resolveServer returns undefined", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(undefined);

    await statusCommand("unknown-srv");

    expect(mockedStatus.getCloudServerStatus).not.toHaveBeenCalled();
  });

  it("skips token prompt for manual servers", async () => {
    const server = makeServer({ id: "manual-abc" });
    mockedServerSelect.resolveServer.mockResolvedValue(server);
    mockedStatus.getCloudServerStatus.mockResolvedValue("unknown (manual)");

    await statusCommand("manual-srv");

    expect(mockedServerSelect.promptApiToken).not.toHaveBeenCalled();
    const logCalls = consoleLogSpy.mock.calls.join("\n");
    expect(logCalls).toContain("unknown (manual)");
  });

  it("shows bare server SSH info without platform", async () => {
    const server = makeServer({ mode: "bare" });
    mockedServerSelect.resolveServer.mockResolvedValue(server);
    mockedStatus.getCloudServerStatus.mockResolvedValue("running");
    mockedModeGuard.isBareServer.mockReturnValueOnce(true);

    await statusCommand("bare-srv");

    const logCalls = consoleLogSpy.mock.calls.join("\n");
    expect(logCalls).toContain("No platform installed");
    expect(logCalls).toContain("ssh root@1.2.3.4");
  });

  it("shows running platform with access URL", async () => {
    const server = makeServer();
    mockedServerSelect.resolveServer.mockResolvedValue(server);
    mockedStatus.getCloudServerStatus.mockResolvedValue("running");
    mockedAdapterFactory.resolvePlatform.mockReturnValue("coolify");
    mockedAdapterFactory.getAdapter.mockReturnValue(makeMockAdapter("running"));

    await statusCommand("test-srv");

    const logCalls = consoleLogSpy.mock.calls.join("\n");
    expect(logCalls).toContain("Coolify Status: running");
    expect(logCalls).toContain("http://1.2.3.4:8000");
    const errCalls = consoleErrorSpy.mock.calls.join("\n");
    expect(errCalls).toContain("Running on HTTP");
  });

  it("shows warning when platform is not reachable", async () => {
    const server = makeServer();
    mockedServerSelect.resolveServer.mockResolvedValue(server);
    mockedStatus.getCloudServerStatus.mockResolvedValue("running");
    mockedAdapterFactory.resolvePlatform.mockReturnValue("coolify");
    mockedAdapterFactory.getAdapter.mockReturnValue(makeMockAdapter("not reachable"));

    await statusCommand("test-srv");

    const errCalls = consoleErrorSpy.mock.calls.join("\n");
    expect(errCalls).toContain("not reachable");
    expect(errCalls).toContain("still be installing");
  });

  it("handles provider error and marks command failed", async () => {
    const server = makeServer();
    mockedServerSelect.resolveServer.mockResolvedValue(server);
    mockedStatus.getCloudServerStatus.mockRejectedValue(new Error("Provider API timeout"));

    await statusCommand("test-srv");

    const errCalls = consoleErrorSpy.mock.calls.join("\n");
    expect(errCalls).toContain("Provider API timeout");
    expect(mockedExitCode.markCommandFailed).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("handles non-Error thrown value", async () => {
    const server = makeServer();
    mockedServerSelect.resolveServer.mockResolvedValue(server);
    mockedStatus.getCloudServerStatus.mockRejectedValue("string error");

    await statusCommand("test-srv");

    const errCalls = consoleErrorSpy.mock.calls.join("\n");
    expect(errCalls).toContain("string error");
    expect(mockedExitCode.markCommandFailed).toHaveBeenCalled();
  });

  it("uses coolify as default platform when resolvePlatform returns undefined", async () => {
    const server = makeServer();
    mockedServerSelect.resolveServer.mockResolvedValue(server);
    mockedStatus.getCloudServerStatus.mockResolvedValue("running");
    mockedAdapterFactory.resolvePlatform.mockReturnValue(undefined);
    mockedAdapterFactory.getAdapter.mockReturnValue(makeMockAdapter("running"));

    await statusCommand("test-srv");

    const logCalls = consoleLogSpy.mock.calls.join("\n");
    expect(logCalls).toContain("Coolify Status: running");
  });
});

// ─── inquirer prompt mock edge case ──────────────────────────────────────────

describe("statusCommand inquirer prompt coverage", () => {
  it("handles inquirer prompt returning empty token", async () => {
    mockedPrompt.mockResolvedValue({ apiToken: "" });
    const server = makeServer({ id: "manual-" });
    mockedServerSelect.resolveServer.mockResolvedValue(server);
    mockedStatus.getCloudServerStatus.mockResolvedValue("unknown (manual)");

    // Should not throw — manual server skips prompt
    await statusCommand("manual-srv");

    const logCalls = consoleLogSpy.mock.calls.join("\n");
    expect(logCalls).toContain("unknown (manual)");
  });

  it("handles prompt cancellation gracefully", async () => {
    mockedPrompt.mockResolvedValue({ apiToken: undefined as unknown as string });
    mockedServerSelect.resolveServer.mockResolvedValue(undefined);

    // resolveServer returns undefined on cancel — returns early
    await statusCommand("test-srv");

    expect(mockedStatus.getCloudServerStatus).not.toHaveBeenCalled();
  });
});
