/**
 * Adapter contract conformance suite.
 *
 * Runs identical behavioral assertions against every PlatformAdapter
 * implementation to verify they satisfy the interface contract invariants.
 * Implementation-specific tests remain in their own files (coolify-adapter,
 * dokploy-adapter); this suite covers cross-adapter behavioral guarantees.
 */

import { CoolifyAdapter } from "../../src/adapters/coolify";
import { DokployAdapter } from "../../src/adapters/dokploy";
import type { PlatformAdapter } from "../../src/adapters/interface";

// --- Module-level mocks (hoisted by Jest) ---

jest.mock("../../src/utils/ssh", () => ({
  assertValidIp: jest.fn(),
  sshExec: jest.fn(),
}));

jest.mock("../../src/core/backup", () => ({
  formatTimestamp: jest.fn(),
  getBackupDir: jest.fn(),
  scpDownload: jest.fn(),
  scpUpload: jest.fn(), // Required for DokployAdapter.restoreBackup and CoolifyAdapter.restoreBackup
  buildStopCoolifyCommand: jest.fn(() => "stop"),
  buildStartCoolifyCommand: jest.fn(() => "start"),
  buildStartDbCommand: jest.fn(() => "startdb"),
  buildRestoreDbCommand: jest.fn(() => "restoredb"),
  buildRestoreConfigCommand: jest.fn(() => "restoreconfig"),
  buildCleanupCommand: jest.fn(() => "cleanup"),
  tryRestartCoolify: jest.fn(),
}));

jest.mock("../../src/utils/errorMapper", () => ({
  getErrorMessage: jest.fn(),
  mapSshError: jest.fn(),
  sanitizeStderr: jest.fn(),
}));

jest.mock("fs", () => ({
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

// --- Import mocked functions after jest.mock declarations ---

import { assertValidIp, sshExec } from "../../src/utils/ssh";
import {
  formatTimestamp,
  getBackupDir,
  scpDownload,
  scpUpload,
} from "../../src/core/backup";
import { getErrorMessage, mapSshError, sanitizeStderr } from "../../src/utils/errorMapper";
import axios from "axios";

const mockSshExec = sshExec as jest.MockedFunction<typeof sshExec>;
const mockAssertValidIp = assertValidIp as jest.MockedFunction<typeof assertValidIp>;
const mockAxiosGet = axios.get as jest.MockedFunction<typeof axios.get>;
const mockScpDownload = scpDownload as jest.MockedFunction<typeof scpDownload>;
const mockScpUpload = scpUpload as jest.MockedFunction<typeof scpUpload>;
const mockFormatTimestamp = formatTimestamp as jest.MockedFunction<typeof formatTimestamp>;
const mockGetBackupDir = getBackupDir as jest.MockedFunction<typeof getBackupDir>;
const mockGetErrorMessage = getErrorMessage as jest.MockedFunction<typeof getErrorMessage>;
const mockMapSshError = mapSshError as jest.MockedFunction<typeof mapSshError>;
const mockSanitizeStderr = sanitizeStderr as jest.MockedFunction<typeof sanitizeStderr>;

// --- Adapter factory registry ---

const ADAPTERS: Array<{ adapterName: string; factory: () => PlatformAdapter }> = [
  { adapterName: "CoolifyAdapter", factory: () => new CoolifyAdapter() },
  { adapterName: "DokployAdapter", factory: () => new DokployAdapter() },
];

// --- Shared contract conformance suite ---

describe.each(ADAPTERS)("PlatformAdapter contract — $adapterName", ({ factory }) => {
  let adapter: PlatformAdapter;

  beforeEach(() => {
    adapter = factory();
    // resetAllMocks clears both call history AND return value queues,
    // preventing mock state leakage between tests in the same describe.each run.
    jest.resetAllMocks();
    // Re-apply implementations that were cleared by resetAllMocks.
    mockGetErrorMessage.mockImplementation((e: unknown) =>
      e instanceof Error ? e.message : String(e),
    );
    mockMapSshError.mockReturnValue("");
    mockSanitizeStderr.mockImplementation((s: string) => s);
    mockFormatTimestamp.mockReturnValue("2026-01-01_00-00-00");
    mockGetBackupDir.mockImplementation((name: string) => `/tmp/backups/${name}`);
  });

  // ─── name property ───────────────────────────────────────────────────────────

  it("name is a non-empty string", () => {
    expect(typeof adapter.name).toBe("string");
    expect(adapter.name.length).toBeGreaterThan(0);
  });

  it("name is lowercase", () => {
    expect(adapter.name).toBe(adapter.name.toLowerCase());
  });

  // ─── getCloudInit ─────────────────────────────────────────────────────────────

  it("getCloudInit returns a bash script string starting with #!/bin/bash", () => {
    const script = adapter.getCloudInit("test-server");
    expect(typeof script).toBe("string");
    expect(script).toMatch(/^#!\/bin\/bash/);
  });

  it("getCloudInit sanitizes unsafe characters from serverName", () => {
    const script = adapter.getCloudInit("unsafe!@#$");
    const serverLine = script.split("\n").find((l) => l.includes("Server:"));
    expect(serverLine).toBeDefined();
    expect(serverLine).not.toMatch(/[!@#$]/);
  });

  // ─── healthCheck ──────────────────────────────────────────────────────────────

  it("healthCheck calls assertValidIp with the provided IP", async () => {
    mockAxiosGet.mockResolvedValueOnce({ status: 200, data: {} });
    await adapter.healthCheck("1.2.3.4");
    expect(mockAssertValidIp).toHaveBeenCalledWith("1.2.3.4");
  });

  it("healthCheck returns { status: 'running' } when HTTP succeeds", async () => {
    mockAxiosGet.mockResolvedValueOnce({ status: 200, data: {} });
    const result = await adapter.healthCheck("1.2.3.4");
    expect(result.status).toBe("running");
  });

  it("healthCheck returns { status: 'not reachable' } on network error", async () => {
    mockAxiosGet.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await adapter.healthCheck("1.2.3.4");
    expect(result.status).toBe("not reachable");
  });

  it("healthCheck never throws", async () => {
    mockAxiosGet.mockRejectedValueOnce(new Error("timeout"));
    await expect(adapter.healthCheck("1.2.3.4")).resolves.toBeDefined();
  });

  // ─── createBackup ─────────────────────────────────────────────────────────────

  it("createBackup calls assertValidIp before any SSH calls", async () => {
    mockSshExec.mockRejectedValueOnce(new Error("connection refused"));
    await adapter.createBackup("1.2.3.4", "srv", "hetzner");
    expect(mockAssertValidIp).toHaveBeenCalledWith("1.2.3.4");
  });

  it("createBackup never throws on SSH exception", async () => {
    mockSshExec.mockRejectedValueOnce(new Error("SSH failed"));
    const result = await adapter.createBackup("1.2.3.4", "srv", "hetzner");
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe("string");
  });

  it("createBackup returns manifest with serverName and provider on success", async () => {
    // version + pg_dump + config tar + cleanup (4 sshExec calls)
    mockSshExec
      .mockResolvedValueOnce({ code: 0, stdout: "1.0.0\n", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
    // db download + config download (2 scpDownload calls)
    mockScpDownload
      .mockResolvedValueOnce({ code: 0, stderr: "" })
      .mockResolvedValueOnce({ code: 0, stderr: "" });

    const result = await adapter.createBackup("1.2.3.4", "my-server", "hetzner");
    expect(result.success).toBe(true);
    expect(result.manifest?.serverName).toBe("my-server");
    expect(result.manifest?.provider).toBe("hetzner");
  });

  // ─── getStatus ────────────────────────────────────────────────────────────────

  it("getStatus calls assertValidIp", async () => {
    mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "1.0.0\n", stderr: "" });
    mockAxiosGet.mockResolvedValueOnce({ status: 200, data: {} });
    await adapter.getStatus("1.2.3.4");
    expect(mockAssertValidIp).toHaveBeenCalledWith("1.2.3.4");
  });

  it("getStatus platformVersion is 'unknown' when SSH command returns non-zero", async () => {
    mockSshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "error" });
    mockAxiosGet.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await adapter.getStatus("1.2.3.4");
    expect(result.platformVersion).toBe("unknown");
  });

  it("getStatus returns a valid status field", async () => {
    mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "1.0.0\n", stderr: "" });
    mockAxiosGet.mockResolvedValueOnce({ status: 200, data: {} });
    const result = await adapter.getStatus("1.2.3.4");
    expect(["running", "not reachable"]).toContain(result.status);
  });

  // ─── update ───────────────────────────────────────────────────────────────────

  it("update calls assertValidIp", async () => {
    mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "done", stderr: "" });
    await adapter.update("1.2.3.4");
    expect(mockAssertValidIp).toHaveBeenCalledWith("1.2.3.4");
  });

  it("update returns { success: true } on exit code 0", async () => {
    mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "done", stderr: "" });
    const result = await adapter.update("1.2.3.4");
    expect(result.success).toBe(true);
  });

  it("update returns { success: false } on non-zero exit code", async () => {
    mockSshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "failed" });
    const result = await adapter.update("1.2.3.4");
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe("string");
  });

  it("update never throws on SSH exception", async () => {
    mockSshExec.mockRejectedValueOnce(new Error("SSH failed"));
    await expect(adapter.update("1.2.3.4")).resolves.toMatchObject({ success: false });
  });

  // ─── restoreBackup (optional method) ─────────────────────────────────────────

  it("restoreBackup calls assertValidIp if the method exists", async () => {
    if (typeof adapter.restoreBackup !== "function") return;

    // scpUpload x2 (db + config) + stop + startdb + restoredb + restoreconfig + start + cleanup
    mockScpUpload
      .mockResolvedValueOnce({ code: 0, stderr: "" })
      .mockResolvedValueOnce({ code: 0, stderr: "" });
    mockSshExec
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // stop
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // startdb
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // restoredb
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // restoreconfig
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // start
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // cleanup

    await adapter.restoreBackup("1.2.3.4", "/tmp/backup", {
      serverName: "srv",
      provider: "hetzner",
      timestamp: "2026-01-01_00-00-00",
      coolifyVersion: "1.0.0",
      files: [],
    });
    expect(mockAssertValidIp).toHaveBeenCalledWith("1.2.3.4");
  });

  it("restoreBackup never throws if the method exists", async () => {
    if (typeof adapter.restoreBackup !== "function") return;

    // scpUpload will fail — triggers early return before sshExec calls
    mockScpUpload.mockRejectedValueOnce(new Error("SSH exploded"));

    await expect(
      adapter.restoreBackup("1.2.3.4", "/tmp/backup", {
        serverName: "srv",
        provider: "hetzner",
        timestamp: "2026-01-01_00-00-00",
        coolifyVersion: "1.0.0",
        files: [],
      }),
    ).resolves.toMatchObject({ success: false });
  });
});
