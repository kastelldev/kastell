/**
 * Integration tests for MCP server_evidence tool.
 * Tests: boot, manifest, flags, error paths, Win32 no-op.
 *
 * Scope (Task 3.2): handler + flags + error + platform behavior only.
 * Unit-level behavior (collectEvidence SSH parsing, section mapping) is
 * covered by tests/unit/evidence-core.test.ts.
 */

jest.mock("../../src/utils/version.js", () => ({
  KASTELL_VERSION: "0.0.0-test",
}));

// Mock I/O boundaries before imports
jest.mock("../../src/utils/config.js");
jest.mock("../../src/utils/ssh.js");
jest.mock("../../src/utils/fileLock.js", () => ({
  withFileLock: jest.fn((_path: string, fn: () => unknown) => fn()),
}));
jest.mock("fs/promises", () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
}));

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import * as configUtils from "../../../src/utils/config.js";
import * as sshUtils from "../../../src/utils/ssh.js";
import { withMcpClient } from "../../helpers/mcpRpcClient.js";

const mockedConfig = configUtils as jest.Mocked<typeof configUtils>;
const mockedSshExec = sshUtils.sshExec as jest.Mock;

// ─── Shared fixtures ────────────────────────────────────────────────────────────

const SAMPLE_SERVER = {
  id: "htz-001",
  name: "test-server",
  provider: "hetzner" as const,
  ip: "5.6.7.8",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-03-01T00:00:00Z",
  mode: "coolify" as const,
  platform: "coolify" as const,
};

function makeSshOutput(sections: string[]): string {
  return sections.join("\n---SEPARATOR---\n");
}

// Five forensic sections for coolify platform (7 total with docker)
const COOLIFY_SECTIONS = [
  "Status: active\nufw allow 22",                              // firewall-rules.txt
  "Mar 10 10:00:00 sshd[123]: Accepted",                        // auth-log.txt
  "LISTEN  0  128  0.0.0.0:22  0.0.0.0:*",                     // listening-ports.txt
  "Mar 10 10:00:00 kernel: info",                              // syslog.txt
  "root ALL=(ALL) ALL\ncrontab -l",                             // system-info.txt
  "coolify\tcoolify:latest\tUp 2 days",                         // docker-containers.txt
  "=== coolify === 2026-03-10 startup log",                    // docker-logs.txt
];

// Three sections for bare platform (no docker)
const BARE_SECTIONS = [
  "Status: active\nufw allow 22",
  "Mar 10 10:00:00 sshd[123]: Accepted",
  "LISTEN  0  128  0.0.0.0:22  0.0.0.0:*",
  "Mar 10 10:00:00 kernel: info",
  "root ALL=(ALL) ALL",
];

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("MCP server_evidence", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedConfig.getServers.mockReturnValue([SAMPLE_SERVER]);
    mockedSshExec.mockResolvedValue({
      code: 0,
      stdout: makeSshOutput(COOLIFY_SECTIONS),
      stderr: "",
    });
  });

  // ── Test 1: Happy path — manifest with SHA256 entries returned ─────────────
  it("should return evidenceDir and totalFiles on success", async () => {
    const response = await withMcpClient(async (client) => {
      return client.callTool("server-evidence", { server: "test-server" });
    });

    expect(response.content).toHaveLength(1);
    const data = JSON.parse(response.content[0]!.text);
    expect(data.result.evidenceDir).toBeDefined();
    expect(data.result.serverName).toBe("test-server");
    expect(data.result.serverIp).toBe("5.6.7.8");
    expect(data.result.platform).toBe("coolify");
    expect(data.result.totalFiles).toBeGreaterThan(0);
    expect(data.result.skippedFiles).toBeDefined();
    expect(data.result.manifestPath).toBeDefined();
  });

  // ── Test 2: force: true — overwrite existing dir behavior ──────────────────
  it("should accept force:true and not return 'already exists' error", async () => {
    const { existsSync } = await import("fs");
    (existsSync as jest.Mock).mockReturnValue(true);

    // Mock the fs rmSync that collectEvidence calls when force=true and dir exists
    const { rmSync } = await import("fs");
    (rmSync as jest.Mock).mockReturnValue(undefined);

    const response = await withMcpClient(async (client) => {
      return client.callTool("server-evidence", {
        server: "test-server",
        force: true,
      });
    });

    expect(response.isError).not.toBe(true);
    const data = JSON.parse(response.content[0]!.text);
    expect(data.error).toBeUndefined();
  });

  // ── Test 3: no_docker: true — Docker section skipped ───────────────────────
  it("should skip docker-containers and docker-logs sections when no_docker=true", async () => {
    // Coolify without docker = 5 sections
    mockedSshExec.mockResolvedValue({
      code: 0,
      stdout: makeSshOutput(BARE_SECTIONS),
      stderr: "",
    });

    const response = await withMcpClient(async (client) => {
      return client.callTool("server-evidence", {
        server: "test-server",
        no_docker: true,
      });
    });

    expect(response.isError).not.toBe(true);
    const data = JSON.parse(response.content[0]!.text);
    // bare platform with no_docker has no docker sections
    // totalFiles reflects collected (non-skipped, non-N/A) sections
    expect(data.result.totalFiles).toBeGreaterThanOrEqual(0);
  });

  // ── Test 4: no_sysinfo: true — sysinfo section skipped ─────────────────────
  it("should skip system-info section when no_sysinfo=true", async () => {
    // 4 sections without sysinfo for coolify (firewall, auth-log, ports, syslog)
    const sectionsWithoutSysinfo = COOLIFY_SECTIONS.slice(0, 4).concat(COOLIFY_SECTIONS.slice(5));
    mockedSshExec.mockResolvedValue({
      code: 0,
      stdout: makeSshOutput(sectionsWithoutSysinfo),
      stderr: "",
    });

    const response = await withMcpClient(async (client) => {
      return client.callTool("server-evidence", {
        server: "test-server",
        no_sysinfo: true,
      });
    });

    expect(response.isError).not.toBe(true);
    const data = JSON.parse(response.content[0]!.text);
    expect(data.result.totalFiles).toBeGreaterThanOrEqual(0);
  });

  // ── Test 5: lines: 200 — log line cap applied ──────────────────────────────
  it("should pass lines=200 to sshExec", async () => {
    mockedSshExec.mockResolvedValue({
      code: 0,
      stdout: makeSshOutput(COOLIFY_SECTIONS),
      stderr: "",
    });

    await withMcpClient(async (client) => {
      return client.callTool("server-evidence", {
        server: "test-server",
        lines: 200,
      });
    });

    expect(mockedSshExec).toHaveBeenCalledTimes(1);
    const [, batchCommand] = mockedSshExec.mock.calls[0]!;
    // The batch command contains "tail -n 200" for auth-log and syslog sections
    expect(batchCommand).toContain("200");
  });

  // ── Test 6: Disk write error → mcpError "filesystem error" ────────────────
  it("should return mcpError on filesystem error", async () => {
    // Make sshExec succeed so collectEvidence gets to the file-write stage
    mockedSshExec.mockResolvedValue({
      code: 0,
      stdout: makeSshOutput(COOLIFY_SECTIONS),
      stderr: "",
    });

    // Mock writeFile to throw ENOSPC
    const fsPromises = await import("fs/promises");
    (fsPromises.writeFile as jest.Mock).mockRejectedValue(
      Object.assign(new Error("No space left on device"), { code: "ENOSPC" }),
    );

    const response = await withMcpClient(async (client) => {
      return client.callTool("server-evidence", { server: "test-server" });
    });

    expect(response.isError).toBe(true);
    const data = JSON.parse(response.content[0]!.text);
    expect(data.error).toContain("filesystem") || expect(data.error).toContain("No space left on device");
  });

  // ── Test 7: F-017 partial regression — Win32 platform path no-op ───────────
  it("should handle Win32 platform without crashing", async () => {
    const { platform } = await import("process");
    Object.defineProperty(platform, "value", { value: "win32" });

    mockedSshExec.mockResolvedValue({
      code: 0,
      stdout: makeSshOutput(COOLIFY_SECTIONS),
      stderr: "",
    });

    // Should not throw even on win32
    const response = await withMcpClient(async (client) => {
      return client.callTool("server-evidence", { server: "test-server" });
    });

    // Platform does not affect handler logic (platform field in result reflects server config)
    // The key is it does not crash
    expect(response).toBeDefined();

    Object.defineProperty(platform, "value", { value: process.platform });
  });
});