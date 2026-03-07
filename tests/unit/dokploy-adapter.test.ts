import { DokployAdapter } from "../../src/adapters/dokploy";
import { DOKPLOY_UPDATE_CMD } from "../../src/constants";

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

describe("DokployAdapter", () => {
  let adapter: DokployAdapter;

  beforeEach(() => {
    adapter = new DokployAdapter();
    jest.clearAllMocks();
  });

  describe("name", () => {
    it("should be 'dokploy'", () => {
      expect(adapter.name).toBe("dokploy");
    });
  });

  describe("getCloudInit", () => {
    it("should return a string starting with '#!/bin/bash'", () => {
      const result = adapter.getCloudInit("my-server");
      expect(result).toMatch(/^#!\/bin\/bash/);
    });

    it("should contain 'Dokploy' in the output (not 'Coolify')", () => {
      const result = adapter.getCloudInit("my-server");
      expect(result).toContain("Dokploy");
      expect(result).not.toContain("Coolify");
    });

    it("should contain the official Dokploy install script URL", () => {
      const result = adapter.getCloudInit("test");
      expect(result).toContain("dokploy.com/install.sh");
    });

    it("should contain the sanitized server name", () => {
      const result = adapter.getCloudInit("my-server");
      expect(result).toContain("my-server");
    });

    it("should sanitize unsafe characters from server name", () => {
      const result = adapter.getCloudInit("unsafe!@#");
      const serverLine = result.split("\n").find((l: string) => l.includes("Server:"));
      expect(serverLine).toBeDefined();
      expect(serverLine).not.toContain("!");
      expect(serverLine).not.toContain("@");
      expect(serverLine).not.toContain("#");
    });

    it("should contain Docker Swarm ports (2377, 7946, 4789) in firewall rules", () => {
      const result = adapter.getCloudInit("test");
      expect(result).toContain("2377");
      expect(result).toContain("7946");
      expect(result).toContain("4789");
    });

    it("should contain port 3000 in firewall rules", () => {
      const result = adapter.getCloudInit("test");
      expect(result).toContain("3000");
    });
  });

  describe("healthCheck", () => {
    it("should call assertValidIp", async () => {
      mockAxiosGet.mockResolvedValueOnce({ status: 200, data: {} });
      await adapter.healthCheck("1.2.3.4");
      expect(mockAssertValidIp).toHaveBeenCalledWith("1.2.3.4");
    });

    it("should return { status: 'running' } when axios GET to port 3000 succeeds", async () => {
      mockAxiosGet.mockResolvedValueOnce({ status: 200, data: {} });
      const result = await adapter.healthCheck("1.2.3.4");
      expect(result).toEqual({ status: "running" });
    });

    it("should return { status: 'not reachable' } when axios throws", async () => {
      mockAxiosGet.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      const result = await adapter.healthCheck("1.2.3.4");
      expect(result).toEqual({ status: "not reachable" });
    });

    it("should make HTTP request to port 3000 (not 8000)", async () => {
      mockAxiosGet.mockResolvedValueOnce({ status: 200, data: {} });
      await adapter.healthCheck("1.2.3.4");
      expect(mockAxiosGet).toHaveBeenCalledWith(
        "http://1.2.3.4:3000",
        expect.objectContaining({ timeout: 5000 }),
      );
    });
  });

  describe("createBackup", () => {
    const setupSuccessfulBackup = () => {
      // Version check
      mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "v0.26.6\n", stderr: "" });
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

    it("should call assertValidIp before any operations", async () => {
      setupSuccessfulBackup();
      await adapter.createBackup("1.2.3.4", "test-server", "hetzner");
      expect(mockAssertValidIp).toHaveBeenCalledWith("1.2.3.4");
    });

    it("should return success when all steps pass", async () => {
      setupSuccessfulBackup();
      const result = await adapter.createBackup("1.2.3.4", "test-server", "hetzner");
      expect(result.success).toBe(true);
      expect(result.manifest).toBeDefined();
      expect(result.manifest?.serverName).toBe("test-server");
      expect(result.manifest?.provider).toBe("hetzner");
    });

    it("should return success:false when pg_dump fails with 'Database backup failed'", async () => {
      // Version check
      mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "v0.26.6\n", stderr: "" });
      // pg_dump fails
      mockSshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "pg_dump failed" });

      const result = await adapter.createBackup("1.2.3.4", "test-server", "hetzner");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Database backup failed");
    });

    it("should return success:false when config tar fails with 'Config backup failed'", async () => {
      // Version check
      mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "v0.26.6\n", stderr: "" });
      // pg_dump success
      mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
      // config tar fails
      mockSshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "tar failed" });

      const result = await adapter.createBackup("1.2.3.4", "test-server", "hetzner");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Config backup failed");
    });

    it("should return success:false when db download fails", async () => {
      // Version check
      mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "v0.26.6\n", stderr: "" });
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

    it("should include version in manifest.coolifyVersion field (reused for backward compat)", async () => {
      setupSuccessfulBackup();
      const result = await adapter.createBackup("1.2.3.4", "test-server", "hetzner");
      expect(result.manifest?.coolifyVersion).toBe("v0.26.6");
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

    it("should include platform: 'dokploy' in manifest", async () => {
      setupSuccessfulBackup();
      const result = await adapter.createBackup("1.2.3.4", "test-server", "hetzner");
      expect(result.manifest?.platform).toBe("dokploy");
    });

    it("should use docker ps -qf name=dokploy-postgres for container resolution (Swarm naming)", async () => {
      setupSuccessfulBackup();
      await adapter.createBackup("1.2.3.4", "test-server", "hetzner");
      // pg_dump is the second sshExec call (index 1)
      const pgDumpCall = mockSshExec.mock.calls[1];
      expect(pgDumpCall[1]).toContain("docker ps -qf name=dokploy-postgres");
    });

    it("should use -U postgres -d dokploy for pg_dump (not -U coolify -d coolify)", async () => {
      setupSuccessfulBackup();
      await adapter.createBackup("1.2.3.4", "test-server", "hetzner");
      const pgDumpCall = mockSshExec.mock.calls[1];
      expect(pgDumpCall[1]).toContain("-U postgres -d dokploy");
      expect(pgDumpCall[1]).not.toContain("-U coolify");
      expect(pgDumpCall[1]).not.toContain("-d coolify");
    });
  });

  describe("getStatus", () => {
    it("should return platformVersion and status when healthy", async () => {
      // Version command
      mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "v0.26.6\n", stderr: "" });
      // Health check (axios)
      mockAxiosGet.mockResolvedValueOnce({ status: 200, data: {} });

      const result = await adapter.getStatus("1.2.3.4");
      expect(result.platformVersion).toBe("v0.26.6");
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
      mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "v0.26.6\n", stderr: "" });
      mockAxiosGet.mockResolvedValueOnce({ status: 200, data: {} });

      await adapter.getStatus("1.2.3.4");
      expect(mockAssertValidIp).toHaveBeenCalledWith("1.2.3.4");
    });
  });

  describe("update", () => {
    it("should call sshExec with DOKPLOY_UPDATE_CMD and return success on code 0", async () => {
      mockSshExec.mockResolvedValueOnce({ code: 0, stdout: "Updated successfully", stderr: "" });
      const result = await adapter.update("1.2.3.4");
      expect(mockSshExec).toHaveBeenCalledWith("1.2.3.4", DOKPLOY_UPDATE_CMD);
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
    it("should return docker service logs dokploy_dokploy --tail 50 without follow", () => {
      const cmd = adapter.getLogCommand(50, false);
      expect(cmd).toBe("docker service logs dokploy_dokploy --tail 50");
    });

    it("should return docker service logs dokploy_dokploy --tail 100 --follow with follow", () => {
      const cmd = adapter.getLogCommand(100, true);
      expect(cmd).toBe("docker service logs dokploy_dokploy --tail 100 --follow");
    });
  });
});
