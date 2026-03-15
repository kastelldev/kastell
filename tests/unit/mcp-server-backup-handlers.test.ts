import { jest } from "@jest/globals";

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock("../../src/core/backup");
jest.mock("../../src/core/snapshot");
jest.mock("../../src/core/manage");
jest.mock("../../src/utils/modeGuard");
jest.mock("../../src/adapters/factory", () => ({
  resolvePlatform: jest.fn(),
}));
jest.mock("../../src/mcp/utils", () => ({
  mcpSuccess: jest.fn((data: Record<string, unknown>) => ({
    content: [{ type: "text", text: JSON.stringify(data) }],
  })),
  mcpError: jest.fn((error: string, hint?: string, suggested_actions?: unknown) => ({
    content: [{ type: "text", text: JSON.stringify({ error, hint, suggested_actions }) }],
    isError: true,
  })),
  requireProviderToken: jest.fn(),
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import * as backup from "../../src/core/backup";
import * as snapshot from "../../src/core/snapshot";
import * as manage from "../../src/core/manage";
import * as modeGuard from "../../src/utils/modeGuard";
import * as factory from "../../src/adapters/factory";
import * as mcpUtils from "../../src/mcp/utils";

import {
  handleBackupCreate,
  handleBackupList,
  handleBackupRestore,
  handleSnapshotCreate,
  handleSnapshotList,
  handleSnapshotDelete,
} from "../../src/mcp/tools/serverBackup.handlers";
import type { ServerRecord } from "../../src/types/index";

// ─── Type helpers ─────────────────────────────────────────────────────────────

const mockedBackup = backup as jest.Mocked<typeof backup>;
const mockedSnapshot = snapshot as jest.Mocked<typeof snapshot>;
const mockedManage = manage as jest.Mocked<typeof manage>;
const mockedModeGuard = modeGuard as jest.Mocked<typeof modeGuard>;
const mockedFactory = factory as jest.Mocked<typeof factory>;
const mockedMcpUtils = mcpUtils as jest.Mocked<typeof mcpUtils>;

// ─── Test Fixtures ────────────────────────────────────────────────────────────

const mockServer: ServerRecord = {
  id: "hetzner-123",
  name: "test-server",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cx11",
  createdAt: "2024-01-01T00:00:00Z",
  mode: "coolify",
  platform: "coolify",
};

const mockManualServer: ServerRecord = {
  ...mockServer,
  id: "manual-abc",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.resetAllMocks();
  mockedMcpUtils.mcpSuccess.mockImplementation((data: Record<string, unknown>) => ({
    content: [{ type: "text", text: JSON.stringify(data) }],
  }));
  mockedMcpUtils.mcpError.mockImplementation(
    (error: string, hint?: string, suggested_actions?: Array<{ command: string; reason: string }>) => ({
      content: [{ type: "text", text: JSON.stringify({ error, hint, suggested_actions }) }],
      isError: true,
    }),
  );
});

// ─── handleBackupCreate ───────────────────────────────────────────────────────

describe("handleBackupCreate", () => {
  it("calls createBackup for platform server", async () => {
    mockedModeGuard.isBareServer.mockReturnValue(false);
    mockedFactory.resolvePlatform.mockReturnValue("coolify");
    mockedBackup.createBackup.mockResolvedValue({
      success: true,
      backupPath: "/backups/test-server/2024-01-01",
      manifest: { serverName: "test-server", provider: "hetzner", timestamp: "2024-01-01T00:00:00Z", coolifyVersion: "4.0.0", files: ["db.sql"] },
    });

    await handleBackupCreate(mockServer);

    expect(mockedBackup.createBackup).toHaveBeenCalledWith("1.2.3.4", "test-server", "hetzner", "coolify");
  });

  it("calls createBareBackup for bare server", async () => {
    mockedModeGuard.isBareServer.mockReturnValue(true);
    mockedFactory.resolvePlatform.mockReturnValue(undefined);
    mockedBackup.createBareBackup.mockResolvedValue({
      success: true,
      backupPath: "/backups/test-server/2024-01-01",
      manifest: { serverName: "test-server", provider: "hetzner", timestamp: "2024-01-01T00:00:00Z", coolifyVersion: "N/A", files: [] },
    });

    await handleBackupCreate(mockServer);

    expect(mockedBackup.createBareBackup).toHaveBeenCalledWith("1.2.3.4", "test-server", "hetzner");
  });

  it("returns mcpSuccess with backup path on success", async () => {
    mockedModeGuard.isBareServer.mockReturnValue(false);
    mockedFactory.resolvePlatform.mockReturnValue("coolify");
    mockedBackup.createBackup.mockResolvedValue({
      success: true,
      backupPath: "/backups/test-server/2024-01-01",
      manifest: { serverName: "test-server", provider: "hetzner", timestamp: "2024-01-01T00:00:00Z", coolifyVersion: "4.0.0", files: ["db.sql"] },
    });

    const result = await handleBackupCreate(mockServer);

    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.success).toBe(true);
    expect(payload.backupPath).toBe("/backups/test-server/2024-01-01");
  });

  it("returns error when createBackup fails", async () => {
    mockedModeGuard.isBareServer.mockReturnValue(false);
    mockedFactory.resolvePlatform.mockReturnValue("coolify");
    mockedBackup.createBackup.mockResolvedValue({
      success: false,
      error: "SSH connection failed",
    });

    const result = await handleBackupCreate(mockServer);

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toBe("SSH connection failed");
  });
});

// ─── handleBackupList ─────────────────────────────────────────────────────────

describe("handleBackupList", () => {
  it("returns empty list when no backups exist", async () => {
    mockedBackup.listBackups.mockReturnValue([]);

    const result = await handleBackupList(mockServer);

    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.backups).toEqual([]);
    expect(payload.message).toMatch(/no backups/i);
  });

  it("returns list of backups when they exist", async () => {
    mockedBackup.listBackups.mockReturnValue(["2024-01-01_120000", "2024-01-02_120000"]);
    mockedBackup.getBackupDir.mockReturnValue("/home/user/.kastell/backups/test-server");
    mockedBackup.loadManifest.mockReturnValue({
      serverName: "test-server",
      provider: "hetzner",
      timestamp: "2024-01-01T12:00:00Z",
      coolifyVersion: "4.0.0",
      files: ["db.sql", "config.tar.gz"],
    });

    const result = await handleBackupList(mockServer);

    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.backupCount).toBe(2);
    expect(payload.backups).toHaveLength(2);
  });
});

// ─── handleBackupRestore ──────────────────────────────────────────────────────

describe("handleBackupRestore", () => {
  it("returns error when safe mode is active", async () => {
    mockedManage.isSafeMode.mockReturnValue(true);

    const result = await handleBackupRestore(mockServer, "2024-01-01_120000");

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toMatch(/safe_mode/i);
  });

  it("returns error when backupId is not provided", async () => {
    mockedManage.isSafeMode.mockReturnValue(false);

    const result = await handleBackupRestore(mockServer, undefined);

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toMatch(/backupId/i);
  });

  it("calls restoreBackup for platform server", async () => {
    mockedManage.isSafeMode.mockReturnValue(false);
    mockedModeGuard.isBareServer.mockReturnValue(false);
    mockedBackup.restoreBackup.mockResolvedValue({
      success: true,
      steps: [{ name: "step1", status: "success" }, { name: "step2", status: "success" }],
    });

    await handleBackupRestore(mockServer, "2024-01-01_120000");

    expect(mockedBackup.restoreBackup).toHaveBeenCalledWith("1.2.3.4", "test-server", "2024-01-01_120000");
  });

  it("calls restoreBareBackup for bare server", async () => {
    mockedManage.isSafeMode.mockReturnValue(false);
    mockedModeGuard.isBareServer.mockReturnValue(true);
    mockedBackup.restoreBareBackup.mockResolvedValue({
      success: true,
      steps: [{ name: "step1", status: "success" }],
    });

    await handleBackupRestore(mockServer, "2024-01-01_120000");

    expect(mockedBackup.restoreBareBackup).toHaveBeenCalledWith("1.2.3.4", "test-server", "2024-01-01_120000");
  });

  it("returns mcpSuccess on successful restore", async () => {
    mockedManage.isSafeMode.mockReturnValue(false);
    mockedModeGuard.isBareServer.mockReturnValue(false);
    mockedBackup.restoreBackup.mockResolvedValue({
      success: true,
      steps: [{ name: "step1", status: "success" }, { name: "step2", status: "success" }],
    });

    const result = await handleBackupRestore(mockServer, "2024-01-01_120000");

    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.success).toBe(true);
    expect(payload.backupId).toBe("2024-01-01_120000");
  });

  it("returns error when restoreBackup fails", async () => {
    mockedManage.isSafeMode.mockReturnValue(false);
    mockedModeGuard.isBareServer.mockReturnValue(false);
    mockedBackup.restoreBackup.mockResolvedValue({
      success: false,
      error: "Restore failed",
      steps: [] as Array<{ name: string; status: "success" | "failure"; error?: string }>,
    });

    const result = await handleBackupRestore(mockServer, "2024-01-01_120000");

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toBe("Restore failed");
  });
});

// ─── handleSnapshotCreate ─────────────────────────────────────────────────────

describe("handleSnapshotCreate", () => {
  it("returns error when safe mode is active", async () => {
    mockedManage.isSafeMode.mockReturnValue(true);

    const result = await handleSnapshotCreate(mockServer);

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toMatch(/safe_mode/i);
  });

  it("returns error for manual server (no provider ID)", async () => {
    mockedManage.isSafeMode.mockReturnValue(false);

    const result = await handleSnapshotCreate(mockManualServer);

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toMatch(/manual/i);
  });

  it("returns error when provider token is missing", async () => {
    mockedManage.isSafeMode.mockReturnValue(false);
    mockedMcpUtils.requireProviderToken.mockReturnValue({
      error: {
        content: [{ type: "text", text: JSON.stringify({ error: "No token" }) }],
        isError: true,
      },
    });

    const result = await handleSnapshotCreate(mockServer);

    expect(result.isError).toBe(true);
  });

  it("calls createSnapshot with server and token", async () => {
    mockedManage.isSafeMode.mockReturnValue(false);
    mockedMcpUtils.requireProviderToken.mockReturnValue({ token: "test-token" });
    mockedSnapshot.createSnapshot.mockResolvedValue({
      success: true,
      snapshot: { id: "snap-1", serverId: "123", name: "snap-1", status: "active", sizeGb: 20, createdAt: "2024-01-01T00:00:00Z", costPerMonth: "$0.02" },
      costEstimate: "$0.02/month",
    });

    await handleSnapshotCreate(mockServer);

    expect(mockedSnapshot.createSnapshot).toHaveBeenCalledWith(mockServer, "test-token");
  });

  it("returns mcpSuccess when snapshot created", async () => {
    mockedManage.isSafeMode.mockReturnValue(false);
    mockedMcpUtils.requireProviderToken.mockReturnValue({ token: "test-token" });
    mockedSnapshot.createSnapshot.mockResolvedValue({
      success: true,
      snapshot: { id: "snap-1", serverId: "123", name: "snap-1", status: "active", sizeGb: 20, createdAt: "2024-01-01T00:00:00Z", costPerMonth: "$0.02" },
      costEstimate: "$0.02/month",
    });

    const result = await handleSnapshotCreate(mockServer);

    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.success).toBe(true);
    expect(payload.snapshot).toBeDefined();
  });
});

// ─── handleSnapshotList ───────────────────────────────────────────────────────

describe("handleSnapshotList", () => {
  it("returns error for manual server", async () => {
    const result = await handleSnapshotList(mockManualServer);

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toMatch(/manual/i);
  });

  it("returns error when provider token missing", async () => {
    mockedMcpUtils.requireProviderToken.mockReturnValue({
      error: {
        content: [{ type: "text", text: JSON.stringify({ error: "No token" }) }],
        isError: true,
      },
    });

    const result = await handleSnapshotList(mockServer);

    expect(result.isError).toBe(true);
  });

  it("returns empty list when no snapshots", async () => {
    mockedMcpUtils.requireProviderToken.mockReturnValue({ token: "test-token" });
    mockedSnapshot.listSnapshots.mockResolvedValue({ snapshots: [] });

    const result = await handleSnapshotList(mockServer);

    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.snapshots).toEqual([]);
    expect(payload.message).toMatch(/no snapshots/i);
  });

  it("returns snapshot list when snapshots exist", async () => {
    mockedMcpUtils.requireProviderToken.mockReturnValue({ token: "test-token" });
    mockedSnapshot.listSnapshots.mockResolvedValue({
      snapshots: [
        { id: "snap-1", serverId: "123", name: "snap-1", status: "active", sizeGb: 20, createdAt: "2024-01-01T00:00:00Z", costPerMonth: "$0.02" },
      ],
    });

    const result = await handleSnapshotList(mockServer);

    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.snapshotCount).toBe(1);
  });
});

// ─── handleSnapshotDelete ─────────────────────────────────────────────────────

describe("handleSnapshotDelete", () => {
  it("returns error when safe mode is active", async () => {
    mockedManage.isSafeMode.mockReturnValue(true);

    const result = await handleSnapshotDelete(mockServer, "snap-1");

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toMatch(/safe_mode/i);
  });

  it("returns error for manual server", async () => {
    mockedManage.isSafeMode.mockReturnValue(false);

    const result = await handleSnapshotDelete(mockManualServer, "snap-1");

    expect(result.isError).toBe(true);
  });

  it("returns error when snapshotId is not provided", async () => {
    mockedManage.isSafeMode.mockReturnValue(false);
    mockedMcpUtils.requireProviderToken.mockReturnValue({ token: "test-token" });

    const result = await handleSnapshotDelete(mockServer, undefined);

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toMatch(/snapshotId/i);
  });

  it("calls deleteSnapshot with server, token and snapshotId", async () => {
    mockedManage.isSafeMode.mockReturnValue(false);
    mockedMcpUtils.requireProviderToken.mockReturnValue({ token: "test-token" });
    mockedSnapshot.deleteSnapshot.mockResolvedValue({ success: true });

    await handleSnapshotDelete(mockServer, "snap-1");

    expect(mockedSnapshot.deleteSnapshot).toHaveBeenCalledWith(mockServer, "test-token", "snap-1");
  });

  it("returns mcpSuccess when snapshot deleted", async () => {
    mockedManage.isSafeMode.mockReturnValue(false);
    mockedMcpUtils.requireProviderToken.mockReturnValue({ token: "test-token" });
    mockedSnapshot.deleteSnapshot.mockResolvedValue({ success: true });

    const result = await handleSnapshotDelete(mockServer, "snap-1");

    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.success).toBe(true);
    expect(payload.snapshotId).toBe("snap-1");
  });

  it("returns error when deleteSnapshot fails", async () => {
    mockedManage.isSafeMode.mockReturnValue(false);
    mockedMcpUtils.requireProviderToken.mockReturnValue({ token: "test-token" });
    mockedSnapshot.deleteSnapshot.mockResolvedValue({ success: false, error: "Snapshot not found" });

    const result = await handleSnapshotDelete(mockServer, "snap-1");

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toBe("Snapshot not found");
  });
});
