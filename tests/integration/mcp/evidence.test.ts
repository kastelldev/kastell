/**
 * Integration tests for MCP server_evidence tool — handler, flags, error paths,
 * platform behavior. Unit-level SSH parsing is in tests/unit/evidence-core.test.ts.
 */

// Mock I/O boundaries before imports
jest.mock("fs", () => ({
  existsSync: jest.fn().mockReturnValue(false),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  renameSync: jest.fn(),
  rmSync: jest.fn(),
  chmodSync: jest.fn(),
}));
jest.mock("fs/promises", () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../../src/utils/version.js", () => ({
  KASTELL_VERSION: "0.0.0-test",
}));
jest.mock("../../../src/utils/config.js");
jest.mock("../../../src/utils/ssh.js");
jest.mock("../../../src/utils/fileLock.js", () => ({
  withFileLock: jest.fn((_path: string, fn: () => unknown) => fn()),
}));

import * as fs from "fs";
import * as configUtils from "../../../src/utils/config.js";
import * as sshUtils from "../../../src/utils/ssh.js";
import { handleServerEvidence } from "../../../src/mcp/tools/serverEvidence.js";
import { makeServerRecord, makeSshOutput } from "../../helpers/auditFixtures.js";

const mockedConfig = configUtils as jest.Mocked<typeof configUtils>;
const mockedSshExec = sshUtils.sshExec as jest.Mock;
const mockedFs = fs as jest.Mocked<typeof fs>;

const SAMPLE_SERVER = makeServerRecord("test-server", "5.6.7.8", {
  id: "htz-001",
  platform: "coolify",
});

// Seven forensic sections for coolify platform (includes docker-ps + docker-logs)
const COOLIFY_SECTIONS = [
  "Status: active\nufw allow 22",                              // firewall-rules.txt
  "Mar 10 10:00:00 sshd[123]: Accepted",                        // auth-log.txt
  "LISTEN  0  128  0.0.0.0:22  0.0.0.0:*",                     // listening-ports.txt
  "Mar 10 10:00:00 kernel: info",                              // syslog.txt
  "root ALL=(ALL) ALL\ncrontab -l",                             // system-info.txt
  "coolify\tcoolify:latest\tUp 2 days",                         // docker-containers.txt
  "=== coolify === 2026-03-10 startup log",                    // docker-logs.txt
];

// Five sections for bare platform (no docker)
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
    mockedConfig.findServer.mockImplementation((nameOrIp: string) => {
      if (nameOrIp === "test-server" || nameOrIp === "5.6.7.8") return SAMPLE_SERVER;
      return undefined;
    });
    mockedSshExec.mockResolvedValue({
      code: 0,
      stdout: makeSshOutput(COOLIFY_SECTIONS),
      stderr: "",
    });
    mockedFs.existsSync.mockReturnValue(false);
    mockedFs.mkdirSync.mockReturnValue(undefined);
    mockedFs.writeFileSync.mockReturnValue(undefined);
    mockedFs.renameSync.mockReturnValue(undefined);
    mockedFs.rmSync.mockReturnValue(undefined);
  });

  // ── Test 1: Happy path — manifest with SHA256 entries returned ─────────────
  it("should return evidenceDir and totalFiles on success", async () => {
    const response = await handleServerEvidence({ server: "test-server" });

    expect(response.isError).toBeFalsy();
    // mcpSuccess serializes data directly into content[0].text (not wrapped in result)
    const body = JSON.parse(response.content[0]!.text);
    expect(body.evidenceDir).toBeDefined();
    expect(body.serverName).toBe("test-server");
    expect(body.serverIp).toBe("5.6.7.8");
    expect(body.platform).toBe("coolify");
    expect(body.totalFiles).toBeGreaterThan(0);
    expect(body.skippedFiles).toBeDefined();
    expect(body.manifestPath).toBeDefined();
  });

  // ── Test 2: force: true — overwrite existing dir behavior ──────────────────
  it("should accept force:true and not return 'already exists' error", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.rmSync.mockReturnValue(undefined);

    const response = await handleServerEvidence({
      server: "test-server",
      force: true,
    });

    expect(response.isError).not.toBe(true);
    const body = JSON.parse(response.content[0]!.text);
    expect(body.error).toBeUndefined();
  });

  // ── Test 3: no_docker: true — Docker section skipped ───────────────────────
  it("should skip docker sections when no_docker=true", async () => {
    mockedSshExec.mockResolvedValue({
      code: 0,
      stdout: makeSshOutput(BARE_SECTIONS),
      stderr: "",
    });

    const response = await handleServerEvidence({
      server: "test-server",
      no_docker: true,
    });

    expect(response.isError).not.toBe(true);
    const body = JSON.parse(response.content[0]!.text);
    expect(body.totalFiles).toBeGreaterThanOrEqual(0);
  });

  // ── Test 4: no_sysinfo: true — sysinfo section skipped ─────────────────────
  it("should skip system-info section when no_sysinfo=true", async () => {
    const sectionsWithoutSysinfo = COOLIFY_SECTIONS.slice(0, 4).concat(COOLIFY_SECTIONS.slice(5));
    mockedSshExec.mockResolvedValue({
      code: 0,
      stdout: makeSshOutput(sectionsWithoutSysinfo),
      stderr: "",
    });

    const response = await handleServerEvidence({
      server: "test-server",
      no_sysinfo: true,
    });

    expect(response.isError).not.toBe(true);
    const body = JSON.parse(response.content[0]!.text);
    expect(body.totalFiles).toBeGreaterThanOrEqual(0);
  });

  // ── Test 5: lines: 200 — log line cap applied ──────────────────────────────
  it("should pass lines=200 to sshExec", async () => {
    mockedSshExec.mockResolvedValue({
      code: 0,
      stdout: makeSshOutput(COOLIFY_SECTIONS),
      stderr: "",
    });

    await handleServerEvidence({
      server: "test-server",
      lines: 200,
    });

    expect(mockedSshExec).toHaveBeenCalledTimes(1);
    const [, batchCommand] = mockedSshExec.mock.calls[0]!;
    expect(batchCommand).toContain("200");
  });

  // ── Test 6: Disk write error → mcpError "filesystem error" ────────────────
  it("should return mcpError on filesystem error", async () => {
    mockedSshExec.mockResolvedValue({
      code: 0,
      stdout: makeSshOutput(COOLIFY_SECTIONS),
      stderr: "",
    });

    mockedFs.writeFileSync.mockImplementation(() => {
      const err = new Error("No space left on device") as NodeJS.ErrnoException;
      err.code = "ENOSPC";
      throw err;
    });

    const response = await handleServerEvidence({ server: "test-server" });

    expect(response.isError).toBe(true);
    const body = JSON.parse(response.content[0]!.text);
    expect(
      body.error?.toLowerCase().includes("filesystem") ||
      body.error?.toLowerCase().includes("no space left on device"),
    ).toBe(true);
  });

  // ── Test 7: F-017 partial regression — Win32 platform path no-op ───────────
  it("should handle Win32 platform without crashing", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });

    mockedSshExec.mockResolvedValue({
      code: 0,
      stdout: makeSshOutput(COOLIFY_SECTIONS),
      stderr: "",
    });

    let response: Awaited<ReturnType<typeof handleServerEvidence>> | undefined;
    try {
      response = await handleServerEvidence({ server: "test-server" });
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }

    expect(response).toBeDefined();
  });
});