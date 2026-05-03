import type { ServerRecord } from "../../src/types/index";

// Mock all external dependencies so backupServer() can be tested in isolation
jest.mock("fs", () => ({
  mkdirSync: jest.fn(),
  existsSync: jest.fn(),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(),
  readdirSync: jest.fn(),
  rmSync: jest.fn(),
}));

jest.mock("child_process", () => ({
  spawn: jest.fn(),
  execSync: jest.fn(),
}));

jest.mock("../../src/utils/secureWrite", () => ({
  secureWriteFileSync: jest.fn(),
  secureMkdirSync: jest.fn(),
  clearCache: jest.fn(),
}));

jest.mock("../../src/utils/ssh", () => ({
  sshExec: jest.fn(),
  assertValidIp: jest.fn(),
  checkSshAvailable: jest.fn(),
  resolveScpPath: jest.fn().mockReturnValue("scp"),
  sanitizedEnv: jest.fn().mockReturnValue({}),
}));

jest.mock("../../src/utils/modeGuard", () => ({
  isBareServer: jest.fn(),
  getServerMode: jest.fn(),
  getServerModeLabel: jest.fn(),
  requireManagedMode: jest.fn(),
}));

jest.mock("../../src/adapters/factory", () => ({
  resolvePlatform: jest.fn(),
  getAdapter: jest.fn(),
}));

jest.mock("../../src/core/manage", () => ({
  isSafeMode: jest.fn().mockReturnValue(false),
}));

import { spawn } from "child_process";
import * as sshUtils from "../../src/utils/ssh";
import { MockChildProcess } from "../helpers/ssh-factories.js";
import { createMockSpawnProcess } from "../helpers/mockProcess.js";
import { isBareServer } from "../../src/utils/modeGuard";
import { resolvePlatform, getAdapter } from "../../src/adapters/factory";
import { backupServer } from "../../src/core/backup";

const mockedIsBareServer = isBareServer as jest.MockedFunction<typeof isBareServer>;
const mockedResolvePlatform = resolvePlatform as jest.MockedFunction<typeof resolvePlatform>;
const mockedGetAdapter = getAdapter as jest.MockedFunction<typeof getAdapter>;
const mockedSsh = sshUtils as jest.Mocked<typeof sshUtils>;
const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;

function createMockProcess(code: number = 0, stderrData: string = ""): ReturnType<typeof spawn> {
  return createMockSpawnProcess(code, stderrData, 10) as unknown as ReturnType<typeof spawn>;
}

const bareServer: ServerRecord = {
  id: "bare-1",
  name: "bare-server",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cx11",
  createdAt: "2026-01-01T00:00:00.000Z",
  mode: "bare",
};

const managedServer: ServerRecord = {
  id: "managed-1",
  name: "coolify-server",
  provider: "hetzner",
  ip: "5.6.7.8",
  region: "nbg1",
  size: "cx21",
  createdAt: "2026-01-01T00:00:00.000Z",
  mode: "coolify",
};

describe("backupServer", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedSsh.resolveScpPath.mockReturnValue("scp");
  });

  it("should call createBareBackup (sshExec + scp) when server is bare", async () => {
    mockedIsBareServer.mockReturnValue(true);
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // bare config tar
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // cleanup
    mockedSpawn.mockReturnValue(createMockProcess(0)); // scp download

    const result = await backupServer(bareServer);

    expect(result.success).toBe(true);
    expect(mockedGetAdapter).not.toHaveBeenCalled();
    // sshExec was called (bare backup path)
    expect(mockedSsh.sshExec).toHaveBeenCalled();
    const firstCall = mockedSsh.sshExec.mock.calls[0];
    expect(firstCall[1]).toContain("bare-config.tar.gz");
  });

  it("should call createBackup via adapter when server is managed (coolify)", async () => {
    mockedIsBareServer.mockReturnValue(false);
    mockedResolvePlatform.mockReturnValue("coolify");

    const mockCreateBackup = jest.fn().mockResolvedValue({
      success: true,
      backupPath: "/backups/coolify-server/ts",
      manifest: {
        serverName: "coolify-server",
        provider: "hetzner",
        timestamp: "2026-01-01_00-00-00-000",
        coolifyVersion: "4.0.0",
        files: ["coolify-backup.sql.gz", "coolify-config.tar.gz"],
      },
    });
    mockedGetAdapter.mockReturnValue({ name: "coolify", createBackup: mockCreateBackup } as unknown as ReturnType<typeof mockedGetAdapter>);

    const result = await backupServer(managedServer);

    expect(result.success).toBe(true);
    expect(mockedGetAdapter).toHaveBeenCalledWith("coolify");
    expect(mockCreateBackup).toHaveBeenCalledWith(managedServer.ip, managedServer.name, managedServer.provider);
    expect(mockedSsh.sshExec).not.toHaveBeenCalled();
  });

  it("should return success:false with error when no platform detected", async () => {
    mockedIsBareServer.mockReturnValue(false);
    mockedResolvePlatform.mockReturnValue(undefined);

    const result = await backupServer(managedServer);

    expect(result.success).toBe(false);
    expect(result.error).toContain("No platform detected");
    expect(result.error).toContain(managedServer.name);
    expect(mockedGetAdapter).not.toHaveBeenCalled();
    expect(mockedSsh.sshExec).not.toHaveBeenCalled();
  });

  it("should propagate BackupResult from bare backup on success", async () => {
    mockedIsBareServer.mockReturnValue(true);
    mockedSsh.assertValidIp.mockReturnValue(undefined);
    mockedSsh.sshExec
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
    mockedSpawn.mockReturnValue(createMockProcess(0));

    const result = await backupServer(bareServer);

    expect(result.success).toBe(true);
    expect(result.backupPath).toBeDefined();
    expect(result.manifest).toBeDefined();
    expect(result.manifest?.mode).toBe("bare");
  });

  it("should propagate BackupResult from adapter backup on failure", async () => {
    mockedIsBareServer.mockReturnValue(false);
    mockedResolvePlatform.mockReturnValue("coolify");

    const mockCreateBackup = jest.fn().mockResolvedValue({
      success: false,
      error: "pg_dump failed",
      hint: "Check postgres container",
    });
    mockedGetAdapter.mockReturnValue({ name: "coolify", createBackup: mockCreateBackup } as unknown as ReturnType<typeof mockedGetAdapter>);

    const result = await backupServer(managedServer);

    expect(result.success).toBe(false);
    expect(result.error).toBe("pg_dump failed");
    expect(result.hint).toBe("Check postgres container");
  });
});
