import { CoolifyAdapter } from "../../src/adapters/coolify";
import { COOLIFY_UPDATE_CMD } from "../../src/constants";

// Mock dependencies
jest.mock("../../src/utils/ssh", () => ({
  assertValidIp: jest.fn(),
  sshExec: jest.fn(),
}));

jest.mock("../../src/core/backup", () => ({
  formatTimestamp: jest.fn(() => "2026-01-01_00-00-00"),
  getBackupDir: jest.fn((name: string) => `/tmp/backups/${name}`),
  scpDownload: jest.fn(),
}));

jest.mock("../../src/utils/errorMapper", () => ({
  getErrorMessage: jest.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
  mapSshError: jest.fn(() => ""),
  sanitizeStderr: jest.fn((s: string) => s),
}));

jest.mock("fs", () => ({
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

import { assertValidIp, sshExec } from "../../src/utils/ssh";
import { scpDownload } from "../../src/core/backup";
import { mapSshError } from "../../src/utils/errorMapper";
import axios from "axios";

const mockSshExec = sshExec as jest.MockedFunction<typeof sshExec>;
const mockScpDownload = scpDownload as jest.MockedFunction<typeof scpDownload>;
const mockAssertValidIp = assertValidIp as jest.MockedFunction<typeof assertValidIp>;
const mockAxiosGet = axios.get as jest.MockedFunction<typeof axios.get>;
const mockMapSshError = mapSshError as jest.MockedFunction<typeof mapSshError>;

describe("CoolifyAdapter", () => {
  let adapter: CoolifyAdapter;

  beforeEach(() => {
    adapter = new CoolifyAdapter();
    jest.clearAllMocks();
  });

  describe("name", () => {
    it("should be 'coolify'", () => {
      expect(adapter.name).toBe("coolify");
    });
  });

  describe("getCloudInit", () => {
    it("should return a string starting with '#!/bin/bash'", () => {
      const result = adapter.getCloudInit("my-server");
      expect(result).toMatch(/^#!\/bin\/bash/);
    });

    it("should contain 'Coolify' in the output", () => {
      const result = adapter.getCloudInit("my-server");
      expect(result).toContain("Coolify");
    });

    it("should contain the sanitized server name", () => {
      const result = adapter.getCloudInit("my-server");
      expect(result).toContain("my-server");
    });

    it("should sanitize unsafe characters from server name", () => {
      const result = adapter.getCloudInit("unsafe!@#");
      // The sanitized name should appear in the Server echo line
      expect(result).toContain('Server: unsafe"');
      // The unsafe characters should NOT appear in the server name
      // (they may appear in the shebang/comments, but NOT after "Server: ")
      const serverLine = result.split("\n").find((l: string) => l.includes("Server:"));
      expect(serverLine).toBeDefined();
      expect(serverLine).not.toContain("!");
      expect(serverLine).not.toContain("@");
      expect(serverLine).not.toContain("#");
    });

    it("should contain Coolify install script URL", () => {
      const result = adapter.getCloudInit("test");
      expect(result).toContain("cdn.coollabs.io/coolify/install.sh");
    });
  });

  describe("healthCheck", () => {
    it("should call assertValidIp", async () => {
      mockAxiosGet.mockResolvedValueOnce({ status: 200, data: {} });
      await adapter.healthCheck("1.2.3.4");
      expect(mockAssertValidIp).toHaveBeenCalledWith("1.2.3.4");
    });

    it("should return { status: 'running' } when axios succeeds", async () => {
      mockAxiosGet.mockResolvedValueOnce({ status: 200, data: {} });
      const result = await adapter.healthCheck("1.2.3.4");
      expect(result).toEqual({ status: "running" });
    });

    it("should return { status: 'not reachable' } when axios throws", async () => {
      mockAxiosGet.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      const result = await adapter.healthCheck("1.2.3.4");
      expect(result).toEqual({ status: "not reachable" });
    });

    it("should make HTTP request to port 8000", async () => {
      mockAxiosGet.mockResolvedValueOnce({ status: 200, data: {} });
      await adapter.healthCheck("1.2.3.4");
      expect(mockAxiosGet).toHaveBeenCalledWith(
        "http://1.2.3.4:8000",
        expect.objectContaining({ timeout: 5000 }),
      );
    });
  });

  describe("createBackup", () => {
    const setupSuccessfulBackup = () => {
      // Version check
      mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "4.0.0-beta.123\n", stderr: "" });
      // pg_dump
      mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
      // config tar
      mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
      // db download
      mockScpDownload.mockResolvedValueOnce({ code: 0, stderr: "" });
      // config download
      mockScpDownload.mockResolvedValueOnce({ code: 0, stderr: "" });
      // cleanup
      mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
    };

    it("should return success when all steps pass", async () => {
      setupSuccessfulBackup();
      const result = await adapter.createBackup("1.2.3.4", "test-server", "hetzner");
      expect(result.success).toBe(true);
      expect(result.manifest).toBeDefined();
      expect(result.manifest?.serverName).toBe("test-server");
      expect(result.manifest?.provider).toBe("hetzner");
    });

    it("should return success: false when pg_dump fails", async () => {
      // Version check
      mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "4.0.0\n", stderr: "" });
      // pg_dump fails
      mockSshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "pg_dump failed" });

      const result = await adapter.createBackup("1.2.3.4", "test-server", "hetzner");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Database backup failed");
    });

    it("should return success: false when config tar fails", async () => {
      // Version check
      mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "4.0.0\n", stderr: "" });
      // pg_dump success
      mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
      // config tar fails
      mockSshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "tar failed" });

      const result = await adapter.createBackup("1.2.3.4", "test-server", "hetzner");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Config backup failed");
    });

    it("should call assertValidIp before any operations", async () => {
      setupSuccessfulBackup();
      await adapter.createBackup("1.2.3.4", "test-server", "hetzner");
      expect(mockAssertValidIp).toHaveBeenCalledWith("1.2.3.4");
    });

    it("should include coolify version in manifest", async () => {
      setupSuccessfulBackup();
      const result = await adapter.createBackup("1.2.3.4", "test-server", "hetzner");
      expect(result.manifest?.coolifyVersion).toBe("4.0.0-beta.123");
    });

    it("should use 'unknown' when version check fails", async () => {
      // Version check fails
      mockSshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "error" });
      // pg_dump
      mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
      // config tar
      mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
      // db download
      mockScpDownload.mockResolvedValueOnce({ code: 0, stderr: "" });
      // config download
      mockScpDownload.mockResolvedValueOnce({ code: 0, stderr: "" });
      // cleanup
      mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

      const result = await adapter.createBackup("1.2.3.4", "test-server", "hetzner");
      expect(result.manifest?.coolifyVersion).toBe("unknown");
    });

    it("should return success: false when db download fails", async () => {
      // Version check
      mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "4.0.0\n", stderr: "" });
      // pg_dump
      mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
      // config tar
      mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
      // db download fails
      mockScpDownload.mockResolvedValueOnce({ code: 1, stderr: "scp failed" });

      const result = await adapter.createBackup("1.2.3.4", "test-server", "hetzner");
      expect(result.success).toBe(false);
      expect(result.error).toContain("download database backup");
    });
  });

  describe("getStatus", () => {
    it("should return platformVersion and status when healthy", async () => {
      // Version command
      mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "4.0.0-beta.123\n", stderr: "" });
      // Health check (axios)
      mockAxiosGet.mockResolvedValueOnce({ status: 200, data: {} });

      const result = await adapter.getStatus("1.2.3.4");
      expect(result.platformVersion).toBe("4.0.0-beta.123");
      expect(result.status).toBe("running");
    });

    it("should return 'unknown' version when SSH fails", async () => {
      mockSshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "error" });
      mockAxiosGet.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const result = await adapter.getStatus("1.2.3.4");
      expect(result.platformVersion).toBe("unknown");
      expect(result.status).toBe("not reachable");
    });

    it("should call assertValidIp", async () => {
      mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "4.0.0\n", stderr: "" });
      mockAxiosGet.mockResolvedValueOnce({ status: 200, data: {} });

      await adapter.getStatus("1.2.3.4");
      expect(mockAssertValidIp).toHaveBeenCalledWith("1.2.3.4");
    });
  });

  describe("update", () => {
    it("should call sshExec with COOLIFY_UPDATE_CMD and return success on code 0", async () => {
      mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "Updated successfully", stderr: "" });
      const result = await adapter.update("1.2.3.4");
      expect(mockSshExec).toHaveBeenCalledWith("1.2.3.4", COOLIFY_UPDATE_CMD);
      expect(result).toEqual({ success: true, output: "Updated successfully" });
    });

    it("should return success:false with error on non-zero exit code", async () => {
      mockSshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "update failed" });
      const result = await adapter.update("1.2.3.4");
      expect(result.success).toBe(false);
      expect(result.error).toContain("exit code 1");
    });

    it("should return success:false with hint on SSH error", async () => {
      mockMapSshError.mockReturnValueOnce("SSH connection refused");
      mockSshExec.mockRejectedValueOnce(new Error("Connection refused"));
      const result = await adapter.update("1.2.3.4");
      expect(result.success).toBe(false);
      expect(result.hint).toBe("SSH connection refused");
    });
  });

  describe("getLogCommand", () => {
    it("should return docker logs coolify --tail 50 without follow", () => {
      const cmd = adapter.getLogCommand(50, false);
      expect(cmd).toBe("docker logs coolify --tail 50");
    });

    it("should return docker logs coolify --tail 100 --follow with follow", () => {
      const cmd = adapter.getLogCommand(100, true);
      expect(cmd).toBe("docker logs coolify --tail 100 --follow");
    });
  });
});
