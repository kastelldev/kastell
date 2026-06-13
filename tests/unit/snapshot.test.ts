import inquirer from "inquirer";
import * as config from "../../src/utils/config";
import * as errorMapper from "../../src/utils/errorMapper";
import * as serverSelect from "../../src/utils/serverSelect";
import * as providerFactory from "../../src/utils/providerFactory";
import * as inquirerPrompts from "@inquirer/prompts";
import { snapshotCommand } from "../../src/commands/snapshot";
import { restoreSnapshot } from "../../src/core/snapshot";
import { createConsoleSpy } from "../helpers/consoleSpy.js";

jest.mock("inquirer");
jest.mock("../../src/utils/config");
jest.mock("../../src/utils/serverSelect");
jest.mock("../../src/utils/providerFactory");
jest.mock("@inquirer/prompts", () => ({
  confirm: jest.fn(),
}));

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedServerSelect = serverSelect as jest.Mocked<typeof serverSelect>;
const mockedProviderFactory = providerFactory as jest.Mocked<typeof providerFactory>;
const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;
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
  validateToken: jest.fn(),
  getRegions: jest.fn(),
  getServerSizes: jest.fn(),
  getAvailableLocations: jest.fn(),
  getAvailableServerTypes: jest.fn(),
  uploadSshKey: jest.fn(),
  createServer: jest.fn(),
  getServerStatus: jest.fn(),
  getServerDetails: jest.fn(),
  destroyServer: jest.fn(),
  rebootServer: jest.fn(),
  createSnapshot: jest.fn(),
  listSnapshots: jest.fn(),
  deleteSnapshot: jest.fn(),
  restoreSnapshot: jest.fn(),
  getSnapshotCostEstimate: jest.fn(),
  findServerByIp: jest.fn().mockResolvedValue(null),
};

const sampleSnapshot = {
  id: "snap-123",
  serverId: "123",
  name: "kastell-1708765432",
  status: "available",
  sizeGb: 5.2,
  createdAt: "2026-02-24T00:00:00Z",
  mode: "coolify" as const,
  costPerMonth: "\u20ac0.03/mo",
};

describe("snapshotCommand", () => {
  const spy = createConsoleSpy();
  let stderrSpy: jest.SpyInstance;
  const originalIsTTY = process.stdin.isTTY;
  const originalExitCode = process.exitCode;

  function setIsTTY(value: boolean | undefined): void {
    Object.defineProperty(process.stdin, "isTTY", { value, configurable: true, writable: true });
  }

  beforeEach(() => {
    spy.setup();
    stderrSpy = jest.spyOn(console, "error").mockImplementation();
    // P139 LESSONS: mockReset clears call history AND mockReturnValue/Once queues
    mockedInquirerConfirm.mockReset();
    mockedInquirer.prompt.mockReset();
    // Default: confirmOrCancel returns true (accept)
    mockedInquirerConfirm.mockResolvedValue(true);
    // Default: TTY mode for pre-existing tests
    setIsTTY(true);
    jest.clearAllMocks();
    process.exitCode = undefined;
    process.env.KASTELL_SAFE_MODE = "false";
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
    mockedServerSelect.promptApiToken.mockResolvedValue("test-token");
  });

  afterEach(() => {
    spy.restore();
    stderrSpy?.mockRestore();
    setIsTTY(originalIsTTY);
    process.exitCode = originalExitCode;
    process.exitCode = undefined;
  });

  it("should default to list subcommand", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockProvider.listSnapshots.mockResolvedValue([]);
    await snapshotCommand();
    expect(mockProvider.listSnapshots).toHaveBeenCalled();
  });

  it("should show error for invalid subcommand", async () => {
    await snapshotCommand("invalid");
    const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("Invalid subcommand");
  });

  // CREATE tests
  describe("create", () => {
    it("should return when no server found", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(undefined);
      await snapshotCommand("create");
      expect(mockProvider.createSnapshot).not.toHaveBeenCalled();
    });

    it("should show cost estimate and create snapshot", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockProvider.getSnapshotCostEstimate.mockResolvedValue("\u20ac0.24/mo");
      mockProvider.createSnapshot.mockResolvedValue(sampleSnapshot);

      await snapshotCommand("create", "test");
      expect(mockProvider.createSnapshot).toHaveBeenCalled();
    });

    it("should cancel when user declines", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockProvider.getSnapshotCostEstimate.mockResolvedValue("\u20ac0.24/mo");
      mockedInquirerConfirm.mockResolvedValueOnce(false);

      await snapshotCommand("create", "test");
      expect(mockProvider.createSnapshot).not.toHaveBeenCalled();
    });

    it("should skip confirmation with --force", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockProvider.getSnapshotCostEstimate.mockResolvedValue("\u20ac0.24/mo");
      mockProvider.createSnapshot.mockResolvedValue(sampleSnapshot);

      await snapshotCommand("create", "test", { force: true });
      expect(mockProvider.createSnapshot).toHaveBeenCalled();
      expect(mockedInquirerConfirm).not.toHaveBeenCalled();
    });

    it("should show dry-run info", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockProvider.getSnapshotCostEstimate.mockResolvedValue("\u20ac0.24/mo");

      await snapshotCommand("create", "test", { dryRun: true });
      const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: unknown[]) => c.join(" ")).join("\n");
      expect(output).toContain("Dry Run");
      expect(mockProvider.createSnapshot).not.toHaveBeenCalled();
    });

    it("should handle create failure", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockProvider.getSnapshotCostEstimate.mockResolvedValue("\u20ac0.24/mo");
      mockProvider.createSnapshot.mockRejectedValue(new Error("API error"));

      await snapshotCommand("create", "test");
      const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: unknown[]) => c.join(" ")).join("\n");
      expect(output).toContain("API error");
    });

    it("should handle cost estimate failure gracefully", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockProvider.getSnapshotCostEstimate.mockRejectedValue(new Error("fail"));
      mockProvider.createSnapshot.mockResolvedValue(sampleSnapshot);
      mockedInquirer.prompt.mockResolvedValue({ confirm: true });

      await snapshotCommand("create", "test");
      // Should still proceed despite cost estimate failure
      expect(mockProvider.createSnapshot).toHaveBeenCalled();
    });
  });

  // LIST tests
  describe("list", () => {
    it("should return when no server found", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(undefined);
      await snapshotCommand("list");
      expect(mockProvider.listSnapshots).not.toHaveBeenCalled();
    });

    it("should display snapshots", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockProvider.listSnapshots.mockResolvedValue([sampleSnapshot]);

      await snapshotCommand("list", "test");
      // Spinner .succeed() is not captured by consoleSpy (ora writes to stream directly)
      // Verify step output from logger.step which IS captured
      const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: unknown[]) => c.join(" ")).join("\n");
      expect(output).toContain("snap-123");
      expect(output).toContain("5.2 GB");
    });

    it("should show empty message", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockProvider.listSnapshots.mockResolvedValue([]);

      await snapshotCommand("list", "test");
      // Spinner .succeed() messages are not captured by consoleSpy
      // Verify that listSnapshots was called and no step output was generated
      expect(mockProvider.listSnapshots).toHaveBeenCalledWith("123");
    });

    it("should handle list error", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockProvider.listSnapshots.mockRejectedValue(new Error("API error"));

      await snapshotCommand("list", "test");
      const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: unknown[]) => c.join(" ")).join("\n");
      expect(output).toContain("API error");
    });
  });

  // LIST --all tests
  describe("list --all", () => {
    it("should show no servers message", async () => {
      mockedConfig.getServers.mockReturnValue([]);
      await snapshotCommand("list", undefined, { all: true });
      const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: unknown[]) => c.join(" ")).join("\n");
      expect(output).toContain("No servers found");
    });

    it("should list snapshots for all servers", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedServerSelect.collectProviderTokens.mockResolvedValue(
        new Map([["hetzner", "token"]]),
      );
      mockProvider.listSnapshots.mockResolvedValue([sampleSnapshot]);

      await snapshotCommand("list", undefined, { all: true });
      expect(mockProvider.listSnapshots).toHaveBeenCalled();
    });

    it("should handle per-server error in list all", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedServerSelect.collectProviderTokens.mockResolvedValue(
        new Map([["hetzner", "token"]]),
      );
      mockProvider.listSnapshots.mockRejectedValue(new Error("fail"));

      await snapshotCommand("list", undefined, { all: true });
      const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: unknown[]) => c.join(" ")).join("\n");
      expect(output).toContain("fail");
    });
  });

  // DELETE tests
  describe("delete", () => {
    it("should return when no server found", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(undefined);
      await snapshotCommand("delete");
      expect(mockProvider.deleteSnapshot).not.toHaveBeenCalled();
    });

    it("should show no snapshots message", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockProvider.listSnapshots.mockResolvedValue([]);

      await snapshotCommand("delete", "test");
      // Spinner .succeed() messages are not captured by consoleSpy
      // Verify that listSnapshots was called and deleteSnapshot was NOT called
      expect(mockProvider.listSnapshots).toHaveBeenCalledWith("123");
      expect(mockProvider.deleteSnapshot).not.toHaveBeenCalled();
    });

    it("should delete snapshot with confirmation", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockProvider.listSnapshots.mockResolvedValue([sampleSnapshot]);
      mockedInquirer.prompt.mockResolvedValueOnce({ selectedId: "snap-123" });

      await snapshotCommand("delete", "test");
      expect(mockProvider.deleteSnapshot).toHaveBeenCalledWith("snap-123");
    });

    it("should cancel delete on decline", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockProvider.listSnapshots.mockResolvedValue([sampleSnapshot]);
      mockedInquirer.prompt.mockResolvedValueOnce({ selectedId: "snap-123" });
      mockedInquirerConfirm.mockResolvedValueOnce(false);

      await snapshotCommand("delete", "test");
      expect(mockProvider.deleteSnapshot).not.toHaveBeenCalled();
    });

    it("should handle delete error", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockProvider.listSnapshots.mockResolvedValue([sampleSnapshot]);
      mockedInquirer.prompt.mockResolvedValueOnce({ selectedId: "snap-123" });
      mockProvider.deleteSnapshot.mockRejectedValue(new Error("API error"));

      await snapshotCommand("delete", "test");
      const output = [...spy.getCalls(), ...stderrSpy.mock.calls].map((c: unknown[]) => c.join(" ")).join("\n");
      expect(output).toContain("API error");
    });

    it("should skip confirmation with --force", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockProvider.listSnapshots.mockResolvedValue([sampleSnapshot]);
      mockedInquirer.prompt.mockResolvedValueOnce({ selectedId: "snap-123" });

      await snapshotCommand("delete", "test", { force: true });
      expect(mockProvider.deleteSnapshot).toHaveBeenCalledWith("snap-123");
    });

    it("should handle list failure in delete", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
      mockProvider.listSnapshots.mockRejectedValue(new Error("list fail"));

      await snapshotCommand("delete", "test");
      expect(mockProvider.deleteSnapshot).not.toHaveBeenCalled();
    });
  });

  // ---- Exit-code policy ----

  it("should set process.exitCode to 1 for invalid subcommand", async () => {
    await snapshotCommand("invalid");

    expect(process.exitCode).toBe(1);
  });

  it("should set process.exitCode to 1 when SAFE_MODE blocks create", async () => {
    process.env.KASTELL_SAFE_MODE = "true";
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);

    await snapshotCommand("create", "test");

    expect(process.exitCode).toBe(1);
    process.env.KASTELL_SAFE_MODE = "false";
  });

  it("should set process.exitCode to 1 when create core fails", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockProvider.getSnapshotCostEstimate.mockResolvedValue("€0.24/mo");
    mockProvider.createSnapshot.mockRejectedValue(new Error("API error"));

    await snapshotCommand("create", "test");

    expect(process.exitCode).toBe(1);
  });

  it("should leave process.exitCode unset when create user declines", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockProvider.getSnapshotCostEstimate.mockResolvedValue("€0.24/mo");
    mockedInquirerConfirm.mockResolvedValueOnce(false);

    await snapshotCommand("create", "test");

    expect(process.exitCode).toBeUndefined();
  });

  it("should leave process.exitCode unset when create succeeds", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockProvider.getSnapshotCostEstimate.mockResolvedValue("€0.24/mo");
    mockProvider.createSnapshot.mockResolvedValue(sampleSnapshot);
    mockedInquirer.prompt.mockResolvedValue({ confirm: true });

    await snapshotCommand("create", "test");

    expect(process.exitCode).toBeUndefined();
  });

  it("should set process.exitCode to 1 when list core fails", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockProvider.listSnapshots.mockRejectedValue(new Error("API error"));

    await snapshotCommand("list", "test");

    expect(process.exitCode).toBe(1);
  });

  it("should leave process.exitCode unset when list is empty (informational)", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockProvider.listSnapshots.mockResolvedValue([]);

    await snapshotCommand("list", "test");

    expect(process.exitCode).toBeUndefined();
  });

  it("should leave process.exitCode unset when list --all has no servers (informational)", async () => {
    mockedConfig.getServers.mockReturnValue([]);

    await snapshotCommand("list", undefined, { all: true });

    expect(process.exitCode).toBeUndefined();
  });

  it("should set process.exitCode to 1 when list --all has per-server error", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedServerSelect.collectProviderTokens.mockResolvedValue(
      new Map([["hetzner", "token"]]),
    );
    mockProvider.listSnapshots.mockRejectedValue(new Error("fail"));

    await snapshotCommand("list", undefined, { all: true });

    expect(process.exitCode).toBe(1);
  });

  it("should set process.exitCode to 1 when list --all has a target missing a provider token", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedServerSelect.collectProviderTokens.mockResolvedValue(new Map());

    await snapshotCommand("list", undefined, { all: true });

    expect(process.exitCode).toBe(1);
  });

  it("should set process.exitCode to 1 when delete core fails", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockProvider.listSnapshots.mockResolvedValue([sampleSnapshot]);
    mockedInquirer.prompt
      .mockResolvedValueOnce({ selectedId: "snap-123" })
      .mockResolvedValueOnce({ confirm: true });
    mockProvider.deleteSnapshot.mockRejectedValue(new Error("API error"));

    await snapshotCommand("delete", "test");

    expect(process.exitCode).toBe(1);
  });

  it("should set process.exitCode to 1 when delete list core fails", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockProvider.listSnapshots.mockRejectedValue(new Error("list fail"));

    await snapshotCommand("delete", "test");

    expect(process.exitCode).toBe(1);
  });

  it("should leave process.exitCode unset when delete user declines", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockProvider.listSnapshots.mockResolvedValue([sampleSnapshot]);
    mockedInquirer.prompt.mockResolvedValueOnce({ selectedId: "snap-123" });
    mockedInquirerConfirm.mockResolvedValueOnce(false);

    await snapshotCommand("delete", "test");

    expect(process.exitCode).toBeUndefined();
  });

  it("should leave process.exitCode unset when delete has no snapshots (informational)", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockProvider.listSnapshots.mockResolvedValue([]);

    await snapshotCommand("delete", "test");

    expect(process.exitCode).toBeUndefined();
  });

  it("should leave process.exitCode unset when delete succeeds", async () => {
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockProvider.listSnapshots.mockResolvedValue([sampleSnapshot]);
    mockedInquirer.prompt
      .mockResolvedValueOnce({ selectedId: "snap-123" })
      .mockResolvedValueOnce({ confirm: true });
    mockProvider.deleteSnapshot.mockResolvedValue({ success: true });

    await snapshotCommand("delete", "test");

    expect(process.exitCode).toBeUndefined();
  });

  it("should set process.exitCode to 1 when SAFE_MODE blocks restore", async () => {
    process.env.KASTELL_SAFE_MODE = "true";
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);

    await snapshotCommand("restore", "test");

    expect(process.exitCode).toBe(1);
    process.env.KASTELL_SAFE_MODE = "false";
  });

  it("should set process.exitCode to 1 when restore server-name confirmation does not match", async () => {
    process.env.KASTELL_SAFE_MODE = "false";
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockProvider.listSnapshots.mockResolvedValue([sampleSnapshot]);
    mockedInquirer.prompt.mockResolvedValueOnce({ selectedId: "snap-123" });
    mockedInquirer.prompt.mockResolvedValueOnce({ confirmName: "wrong-name" });

    await snapshotCommand("restore", "test");

    expect(process.exitCode).toBe(1);
  });

  it("should set process.exitCode to 1 when restore core fails", async () => {
    process.env.KASTELL_SAFE_MODE = "false";
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockProvider.listSnapshots.mockResolvedValue([sampleSnapshot]);
    mockedInquirer.prompt
      .mockResolvedValueOnce({ selectedId: "snap-123" })
      .mockResolvedValueOnce({ confirmName: "coolify-test" });
    mockProvider.restoreSnapshot.mockRejectedValue(new Error("API error"));

    await snapshotCommand("restore", "test");

    expect(process.exitCode).toBe(1);
  });

  it("should leave process.exitCode unset when restore user declines", async () => {
    process.env.KASTELL_SAFE_MODE = "false";
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockProvider.listSnapshots.mockResolvedValue([sampleSnapshot]);
    mockedInquirer.prompt.mockResolvedValueOnce({ selectedId: "snap-123" });
    mockedInquirerConfirm.mockResolvedValueOnce(false);

    await snapshotCommand("restore", "test");

    expect(process.exitCode).toBeUndefined();
  });

  it("should leave process.exitCode unset when restore has no snapshots (informational)", async () => {
    process.env.KASTELL_SAFE_MODE = "false";
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockProvider.listSnapshots.mockResolvedValue([]);

    await snapshotCommand("restore", "test");

    expect(process.exitCode).toBeUndefined();
  });


  // ---- Bare server regression tests ----

  describe("bare server regression (snapshot)", () => {
    const bareServer = {
      ...sampleServer,
      mode: "bare" as const,
    };

    it("should create snapshot for bare-mode server (snapshot regression)", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(bareServer);
      mockProvider.getSnapshotCostEstimate.mockResolvedValue("€0.24/mo");
      mockProvider.createSnapshot.mockResolvedValue({
        id: "snap-bare",
        serverId: "123",
        name: "kastell-bare-snap",
        status: "available",
        sizeGb: 3.0,
        createdAt: "2026-02-28T00:00:00Z",
        mode: "coolify" as const,
        costPerMonth: "€0.03/mo",
      });

      await snapshotCommand("create", "test");

      expect(mockProvider.createSnapshot).toHaveBeenCalled();
    });

    it("should list snapshots for bare-mode server (snapshot regression)", async () => {
      mockedServerSelect.resolveServer.mockResolvedValue(bareServer);
      mockProvider.listSnapshots.mockResolvedValue([]);

      await snapshotCommand("list");

      expect(mockProvider.listSnapshots).toHaveBeenCalled();
    });
  });
});

describe("restoreSnapshot", () => {
  const server = {
    id: "server-456",
    name: "test-server",
    provider: "hetzner",
    ip: "1.2.3.4",
    region: "nbg1",
    size: "cax11",
    createdAt: "2026-01-01T00:00:00.000Z",
    mode: "coolify" as const,
  };
  const apiToken = "test-api-token";
  const snapshotId = "snap-789";

  const mockRestoreProvider = {
    name: "hetzner",
    displayName: "Hetzner Cloud",
    validateToken: jest.fn(),
    getRegions: jest.fn(),
    getServerSizes: jest.fn(),
    getAvailableLocations: jest.fn(),
    getAvailableServerTypes: jest.fn(),
    uploadSshKey: jest.fn(),
    createServer: jest.fn(),
    getServerStatus: jest.fn(),
    getServerDetails: jest.fn(),
    destroyServer: jest.fn(),
    rebootServer: jest.fn(),
    createSnapshot: jest.fn(),
    listSnapshots: jest.fn(),
    deleteSnapshot: jest.fn(),
    restoreSnapshot: jest.fn(),
    getSnapshotCostEstimate: jest.fn(),
    findServerByIp: jest.fn().mockResolvedValue(null),
  };

  let getErrorMessageSpy: jest.SpyInstance;
  let mapProviderErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockRestoreProvider);
    getErrorMessageSpy = jest.spyOn(errorMapper, "getErrorMessage").mockReturnValue("provider error");
    mapProviderErrorSpy = jest.spyOn(errorMapper, "mapProviderError").mockReturnValue(undefined as unknown as string);
  });

  afterEach(() => {
    getErrorMessageSpy.mockRestore();
    mapProviderErrorSpy.mockRestore();
  });

  it("returns { success: true } when provider.restoreSnapshot resolves", async () => {
    mockRestoreProvider.restoreSnapshot.mockResolvedValue(undefined);

    const result = await restoreSnapshot(server, apiToken, snapshotId);

    expect(result).toEqual({ success: true });
  });

  it("returns { success: false, error, hint } when provider.restoreSnapshot rejects with hint", async () => {
    const err = new Error("rebuild failed");
    mockRestoreProvider.restoreSnapshot.mockRejectedValue(err);
    getErrorMessageSpy.mockReturnValue("rebuild failed");
    mapProviderErrorSpy.mockReturnValue("Check your snapshot ID");

    const result = await restoreSnapshot(server, apiToken, snapshotId);

    expect(result).toEqual({
      success: false,
      error: "rebuild failed",
      hint: "Check your snapshot ID",
    });
  });

  it("returns { success: false, error } without hint when mapProviderError returns undefined", async () => {
    const err = new Error("network error");
    mockRestoreProvider.restoreSnapshot.mockRejectedValue(err);
    getErrorMessageSpy.mockReturnValue("network error");
    mapProviderErrorSpy.mockReturnValue(undefined as unknown as string);

    const result = await restoreSnapshot(server, apiToken, snapshotId);

    expect(result).toEqual({ success: false, error: "network error" });
    expect(result).not.toHaveProperty("hint");
  });

  it("calls createProviderWithToken with correct provider and token", async () => {
    mockRestoreProvider.restoreSnapshot.mockResolvedValue(undefined);

    await restoreSnapshot(server, apiToken, snapshotId);

    expect(mockedProviderFactory.createProviderWithToken).toHaveBeenCalledWith(
      server.provider,
      apiToken,
    );
  });

  it("calls provider.restoreSnapshot with server.id and snapshotId", async () => {
    mockRestoreProvider.restoreSnapshot.mockResolvedValue(undefined);

    await restoreSnapshot(server, apiToken, snapshotId);

    expect(mockRestoreProvider.restoreSnapshot).toHaveBeenCalledWith(server.id, snapshotId);
  });
});
