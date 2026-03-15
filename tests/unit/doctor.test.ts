import { spawnSync } from "child_process";
import { existsSync, accessSync } from "fs";
import axios from "axios";

jest.mock("child_process", () => ({
  spawnSync: jest.fn(),
}));

jest.mock("fs", () => ({
  existsSync: jest.fn(),
  accessSync: jest.fn(),
  readFileSync: jest.fn(() => "[]"),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  constants: { R_OK: 4, W_OK: 2 },
}));

jest.mock("os", () => ({
  homedir: () => "/home/test",
}));

jest.mock("../../src/utils/ssh", () => ({
  checkSshAvailable: jest.fn(),
}));

jest.mock("axios");

jest.mock("../../src/utils/serverSelect", () => ({
  resolveServer: jest.fn(),
}));

jest.mock("../../src/core/doctor", () => ({
  ...jest.requireActual("../../src/core/doctor"),
  runServerDoctor: jest.fn(),
}));

jest.mock("../../src/core/doctor-fix", () => ({
  runDoctorFix: jest.fn(),
}));

// Mock ora so spinner.start/stop don't throw in tests
jest.mock("ora", () => {
  const spinner = { start: jest.fn().mockReturnThis(), stop: jest.fn().mockReturnThis() };
  return jest.fn(() => spinner);
});

import { checkSshAvailable } from "../../src/utils/ssh";
import { resolveServer } from "../../src/utils/serverSelect";
import { runServerDoctor } from "../../src/core/doctor";
import { runDoctorFix } from "../../src/core/doctor-fix";
import { runDoctorChecks, doctorCommand, checkProviderTokens } from "../../src/commands/doctor";

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;
const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockedAccessSync = accessSync as jest.MockedFunction<typeof accessSync>;
const mockedCheckSsh = checkSshAvailable as jest.MockedFunction<typeof checkSshAvailable>;
const mockedResolveServer = resolveServer as jest.MockedFunction<typeof resolveServer>;
const mockedRunServerDoctor = runServerDoctor as jest.MockedFunction<typeof runServerDoctor>;
const mockedRunDoctorFix = runDoctorFix as jest.MockedFunction<typeof runDoctorFix>;

describe("doctorCommand — local mode (no server arg)", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("should pass Node.js check when version >= 20", () => {
    mockedSpawnSync.mockReturnValue({ status: 0, stdout: Buffer.from("10.0.0"), stderr: Buffer.from(""), pid: 1, output: [], signal: null });
    mockedCheckSsh.mockReturnValue(true);
    mockedExistsSync.mockReturnValue(true);
    mockedAccessSync.mockImplementation(() => {});

    const results = runDoctorChecks("0.6.0");
    const nodeCheck = results.find((r) => r.name === "Node.js");
    expect(nodeCheck?.status).toBe("pass");
    expect(nodeCheck?.detail).toContain(process.version);
  });

  it("should pass npm check when npm is available", () => {
    mockedSpawnSync.mockReturnValue({ status: 0, stdout: Buffer.from("10.0.0"), stderr: Buffer.from(""), pid: 1, output: [], signal: null });
    mockedCheckSsh.mockReturnValue(true);
    mockedExistsSync.mockReturnValue(true);
    mockedAccessSync.mockImplementation(() => {});

    const results = runDoctorChecks("0.6.0");
    const npmCheck = results.find((r) => r.name === "npm");
    expect(npmCheck?.status).toBe("pass");
    expect(npmCheck?.detail).toContain("v10.0.0");
  });

  it("should fail npm check when npm is not found", () => {
    mockedSpawnSync.mockReturnValue({ status: 1, stdout: Buffer.from(""), stderr: Buffer.from("npm: command not found"), pid: 1, output: [], signal: null });
    mockedCheckSsh.mockReturnValue(true);
    mockedExistsSync.mockReturnValue(true);
    mockedAccessSync.mockImplementation(() => {});

    const results = runDoctorChecks("0.6.0");
    const npmCheck = results.find((r) => r.name === "npm");
    expect(npmCheck?.status).toBe("fail");
    expect(npmCheck?.detail).toBe("not found");
  });

  it("should pass SSH check when available", () => {
    mockedSpawnSync.mockReturnValue({ status: 0, stdout: Buffer.from("10.0.0"), stderr: Buffer.from(""), pid: 1, output: [], signal: null });
    mockedCheckSsh.mockReturnValue(true);
    mockedExistsSync.mockReturnValue(true);
    mockedAccessSync.mockImplementation(() => {});

    const results = runDoctorChecks("0.6.0");
    const sshCheck = results.find((r) => r.name === "SSH Client");
    expect(sshCheck?.status).toBe("pass");
  });

  it("should warn SSH check when not available", () => {
    mockedSpawnSync.mockReturnValue({ status: 0, stdout: Buffer.from("10.0.0"), stderr: Buffer.from(""), pid: 1, output: [], signal: null });
    mockedCheckSsh.mockReturnValue(false);
    mockedExistsSync.mockReturnValue(true);
    mockedAccessSync.mockImplementation(() => {});

    const results = runDoctorChecks("0.6.0");
    const sshCheck = results.find((r) => r.name === "SSH Client");
    expect(sshCheck?.status).toBe("warn");
  });

  it("should show kastell version when provided", () => {
    mockedSpawnSync.mockReturnValue({ status: 0, stdout: Buffer.from("10.0.0"), stderr: Buffer.from(""), pid: 1, output: [], signal: null });
    mockedCheckSsh.mockReturnValue(true);
    mockedExistsSync.mockReturnValue(true);
    mockedAccessSync.mockImplementation(() => {});

    const results = runDoctorChecks("0.6.0");
    const versionCheck = results.find((r) => r.name === "kastell");
    expect(versionCheck?.status).toBe("pass");
    expect(versionCheck?.detail).toBe("v0.6.0");
  });

  it("should warn kastell version when not provided", () => {
    mockedSpawnSync.mockReturnValue({ status: 0, stdout: Buffer.from("10.0.0"), stderr: Buffer.from(""), pid: 1, output: [], signal: null });
    mockedCheckSsh.mockReturnValue(true);
    mockedExistsSync.mockReturnValue(true);
    mockedAccessSync.mockImplementation(() => {});

    const results = runDoctorChecks();
    const versionCheck = results.find((r) => r.name === "kastell");
    expect(versionCheck?.status).toBe("warn");
    expect(versionCheck?.detail).toBe("version unknown");
  });

  it("should warn when config dir does not exist", () => {
    mockedSpawnSync.mockReturnValue({ status: 0, stdout: Buffer.from("10.0.0"), stderr: Buffer.from(""), pid: 1, output: [], signal: null });
    mockedCheckSsh.mockReturnValue(true);
    mockedExistsSync.mockReturnValue(false);
    mockedAccessSync.mockImplementation(() => {});

    const results = runDoctorChecks("0.6.0");
    const configCheck = results.find((r) => r.name === "Config Dir");
    expect(configCheck?.status).toBe("warn");
  });

  it("should fail when config dir is not writable", () => {
    mockedSpawnSync.mockReturnValue({ status: 0, stdout: Buffer.from("10.0.0"), stderr: Buffer.from(""), pid: 1, output: [], signal: null });
    mockedCheckSsh.mockReturnValue(true);
    mockedExistsSync.mockReturnValue(true);
    mockedAccessSync.mockImplementation(() => {
      throw new Error("EACCES");
    });

    const results = runDoctorChecks("0.6.0");
    const configCheck = results.find((r) => r.name === "Config Dir");
    expect(configCheck?.status).toBe("fail");
  });

  it("should display all checks and summary — new signature (undefined, options, version)", async () => {
    mockedSpawnSync.mockReturnValue({ status: 0, stdout: Buffer.from("10.0.0"), stderr: Buffer.from(""), pid: 1, output: [], signal: null });
    mockedCheckSsh.mockReturnValue(true);
    mockedExistsSync.mockReturnValue(true);
    mockedAccessSync.mockImplementation(() => {});

    await doctorCommand(undefined, {}, "0.6.0");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Kastell Doctor");
    expect(output).toContain("Node.js");
    expect(output).toContain("npm");
  });

  it("should show info message with --check-tokens when no servers — new signature", async () => {
    mockedSpawnSync.mockReturnValue({ status: 0, stdout: Buffer.from("10.0.0"), stderr: Buffer.from(""), pid: 1, output: [], signal: null });
    mockedCheckSsh.mockReturnValue(true);
    mockedExistsSync.mockReturnValue(true);
    mockedAccessSync.mockImplementation(() => {});

    await doctorCommand(undefined, { checkTokens: true }, "0.6.0");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("No servers registered");
  });

  it("should fail Node.js check when version < 20", () => {
    const original = process.version;
    Object.defineProperty(process, "version", { value: "v18.0.0", configurable: true });

    mockedSpawnSync.mockReturnValue({ status: 0, stdout: Buffer.from("10.0.0"), stderr: Buffer.from(""), pid: 1, output: [], signal: null });
    mockedCheckSsh.mockReturnValue(true);
    mockedExistsSync.mockReturnValue(true);
    mockedAccessSync.mockImplementation(() => {});

    const results = runDoctorChecks("0.6.0");
    const nodeCheck = results.find((r) => r.name === "Node.js");
    expect(nodeCheck?.status).toBe("fail");
    expect(nodeCheck?.detail).toContain("requires >= 20");

    Object.defineProperty(process, "version", { value: original, configurable: true });
  });

  it("should pass servers check when servers registered", () => {
    mockedSpawnSync.mockReturnValue({ status: 0, stdout: Buffer.from("10.0.0"), stderr: Buffer.from(""), pid: 1, output: [], signal: null });
    mockedCheckSsh.mockReturnValue(true);
    mockedExistsSync.mockReturnValue(true);
    mockedAccessSync.mockImplementation(() => {});

    const fs = require("fs");
    fs.readFileSync.mockReturnValueOnce(
      JSON.stringify([
        {
          id: "1",
          name: "test",
          provider: "hetzner",
          ip: "1.2.3.4",
          region: "nbg1",
          size: "cax11",
          createdAt: "2026-01-01",
          mode: "coolify" as const,
        },
      ]),
    );

    const results = runDoctorChecks("0.6.0");
    const serversCheck = results.find((r) => r.name === "Servers");
    expect(serversCheck?.status).toBe("pass");
    expect(serversCheck?.detail).toContain("1 registered");
  });

  it("should show error summary when failures exist", async () => {
    mockedSpawnSync.mockReturnValue({ status: 0, stdout: Buffer.from("10.0.0"), stderr: Buffer.from(""), pid: 1, output: [], signal: null });
    mockedCheckSsh.mockReturnValue(true);
    mockedExistsSync.mockReturnValue(true);
    mockedAccessSync.mockImplementation(() => {
      throw new Error("EACCES");
    });

    await doctorCommand(undefined, {}, "0.6.0");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("check(s) failed");
  });

  it("should show all-pass message when no failures and no warnings", async () => {
    mockedSpawnSync.mockReturnValue({ status: 0, stdout: Buffer.from("10.0.0"), stderr: Buffer.from(""), pid: 1, output: [], signal: null });
    mockedCheckSsh.mockReturnValue(true);
    mockedExistsSync.mockReturnValue(true);
    mockedAccessSync.mockImplementation(() => {});

    const fs = require("fs");
    fs.readFileSync.mockReturnValueOnce(
      JSON.stringify([
        {
          id: "1",
          name: "test",
          provider: "hetzner",
          ip: "1.2.3.4",
          region: "nbg1",
          size: "cax11",
          createdAt: "2026-01-01",
          mode: "coolify" as const,
        },
      ]),
    );

    await doctorCommand(undefined, {}, "0.6.0");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("All checks passed!");
  });

  it("does not call resolveServer when no server argument given", async () => {
    mockedSpawnSync.mockReturnValue({ status: 0, stdout: Buffer.from("10.0.0"), stderr: Buffer.from(""), pid: 1, output: [], signal: null });
    mockedCheckSsh.mockReturnValue(true);
    mockedExistsSync.mockReturnValue(true);
    mockedAccessSync.mockImplementation(() => {});

    await doctorCommand(undefined, {}, "0.6.0");

    expect(mockedResolveServer).not.toHaveBeenCalled();
    expect(mockedRunServerDoctor).not.toHaveBeenCalled();
  });
});

describe("doctorCommand — server mode", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  const fakeServer = {
    id: "srv-1",
    name: "my-server",
    ip: "1.2.3.4",
    provider: "hetzner",
    region: "nbg1",
    size: "cax11",
    createdAt: "2026-01-01",
    mode: "coolify" as const,
  };

  const fakeResult = {
    serverName: "my-server",
    serverIp: "1.2.3.4",
    findings: [
      {
        id: "DISK_TREND",
        severity: "critical" as const,
        description: "Disk projected full in 1 day",
        command: "df -h /",
      },
      {
        id: "STALE_PACKAGES",
        severity: "warning" as const,
        description: "20 packages available for upgrade",
        command: "sudo apt update",
      },
    ],
    ranAt: new Date().toISOString(),
    usedFreshData: false,
  };

  it("calls resolveServer with server arg and dispatches to runServerDoctor", async () => {
    mockedResolveServer.mockResolvedValue(fakeServer);
    mockedRunServerDoctor.mockResolvedValue({ success: true, data: fakeResult });

    await doctorCommand("my-server", {}, "1.0.0");

    expect(mockedResolveServer).toHaveBeenCalledWith("my-server", expect.any(String));
    expect(mockedRunServerDoctor).toHaveBeenCalledWith("1.2.3.4", "my-server", { fresh: undefined });
  });

  it("returns without calling runServerDoctor when resolveServer returns undefined", async () => {
    mockedResolveServer.mockResolvedValue(undefined);

    await doctorCommand("nonexistent", {}, "1.0.0");

    expect(mockedResolveServer).toHaveBeenCalled();
    expect(mockedRunServerDoctor).not.toHaveBeenCalled();
  });

  it("passes fresh=true to runServerDoctor when --fresh flag set", async () => {
    mockedResolveServer.mockResolvedValue(fakeServer);
    mockedRunServerDoctor.mockResolvedValue({ success: true, data: { ...fakeResult, usedFreshData: true } });

    await doctorCommand("my-server", { fresh: true }, "1.0.0");

    expect(mockedRunServerDoctor).toHaveBeenCalledWith("1.2.3.4", "my-server", { fresh: true });
  });

  it("outputs JSON via console.log when --json flag set", async () => {
    mockedResolveServer.mockResolvedValue(fakeServer);
    mockedRunServerDoctor.mockResolvedValue({ success: true, data: fakeResult });

    await doctorCommand("my-server", { json: true }, "1.0.0");

    const allOutput = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(allOutput).toContain('"serverName"');
    expect(allOutput).toContain('"findings"');
  });

  it("logs error when runServerDoctor returns success=false", async () => {
    mockedResolveServer.mockResolvedValue(fakeServer);
    mockedRunServerDoctor.mockResolvedValue({ success: false, error: "SSH connection failed" });

    await doctorCommand("my-server", {}, "1.0.0");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("SSH connection failed");
  });

  it("displays findings grouped by severity with descriptions", async () => {
    mockedResolveServer.mockResolvedValue(fakeServer);
    mockedRunServerDoctor.mockResolvedValue({ success: true, data: fakeResult });

    await doctorCommand("my-server", {}, "1.0.0");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("my-server");
    expect(output).toContain("1.2.3.4");
    expect(output).toContain("Disk projected full in 1 day");
    expect(output).toContain("20 packages available for upgrade");
  });

  it("shows 'No issues detected' when findings array is empty", async () => {
    mockedResolveServer.mockResolvedValue(fakeServer);
    mockedRunServerDoctor.mockResolvedValue({
      success: true,
      data: { ...fakeResult, findings: [] },
    });

    await doctorCommand("my-server", {}, "1.0.0");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("No issues detected");
  });

  it("shows cached data note when usedFreshData is false", async () => {
    mockedResolveServer.mockResolvedValue(fakeServer);
    mockedRunServerDoctor.mockResolvedValue({
      success: true,
      data: { ...fakeResult, findings: [], usedFreshData: false },
    });

    await doctorCommand("my-server", {}, "1.0.0");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("--fresh");
  });

  it("shows summary line with finding counts", async () => {
    mockedResolveServer.mockResolvedValue(fakeServer);
    mockedRunServerDoctor.mockResolvedValue({ success: true, data: fakeResult });

    await doctorCommand("my-server", {}, "1.0.0");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    // Summary should mention finding count
    expect(output).toMatch(/\d+\s+finding/i);
  });
});

describe("doctorCommand — --fix mode", () => {
  let consoleSpy: jest.SpyInstance;

  const fakeServer = {
    id: "srv-1",
    name: "my-server",
    ip: "1.2.3.4",
    provider: "hetzner",
    region: "nbg1",
    size: "cax11",
    createdAt: "2026-01-01",
    mode: "coolify" as const,
  };

  const fakeResultWithFixable = {
    serverName: "my-server",
    serverIp: "1.2.3.4",
    findings: [
      {
        id: "STALE_PACKAGES",
        severity: "warning" as const,
        description: "15 packages to upgrade",
        command: "sudo apt update",
        fixCommand: "sudo apt update && sudo apt upgrade -y",
      },
      {
        id: "DISK_TREND",
        severity: "warning" as const,
        description: "Disk full in 5 days",
        command: "df -h",
      },
    ],
    ranAt: new Date().toISOString(),
    usedFreshData: true,
  };

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("shows error and returns when --fix is used without a server argument", async () => {
    await doctorCommand(undefined, { fix: true }, "1.0.0");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("--fix requires a server argument");
    expect(mockedResolveServer).not.toHaveBeenCalled();
    expect(mockedRunDoctorFix).not.toHaveBeenCalled();
  });

  it("calls runServerDoctor with fresh=true when --fix is set", async () => {
    mockedResolveServer.mockResolvedValue(fakeServer);
    mockedRunServerDoctor.mockResolvedValue({ success: true, data: fakeResultWithFixable });
    mockedRunDoctorFix.mockResolvedValue({ applied: ["STALE_PACKAGES"], skipped: ["DISK_TREND"], failed: [] });

    await doctorCommand("my-server", { fix: true }, "1.0.0");

    expect(mockedRunServerDoctor).toHaveBeenCalledWith("1.2.3.4", "my-server", { fresh: true });
  });

  it("calls runDoctorFix with force=false in interactive mode", async () => {
    mockedResolveServer.mockResolvedValue(fakeServer);
    mockedRunServerDoctor.mockResolvedValue({ success: true, data: fakeResultWithFixable });
    mockedRunDoctorFix.mockResolvedValue({ applied: [], skipped: [], failed: [] });

    await doctorCommand("my-server", { fix: true }, "1.0.0");

    expect(mockedRunDoctorFix).toHaveBeenCalledWith(
      "1.2.3.4",
      fakeResultWithFixable.findings,
      { dryRun: false, force: false },
    );
  });

  it("passes force=true to runDoctorFix when --fix --force", async () => {
    mockedResolveServer.mockResolvedValue(fakeServer);
    mockedRunServerDoctor.mockResolvedValue({ success: true, data: fakeResultWithFixable });
    mockedRunDoctorFix.mockResolvedValue({ applied: ["STALE_PACKAGES"], skipped: [], failed: [] });

    await doctorCommand("my-server", { fix: true, force: true }, "1.0.0");

    expect(mockedRunDoctorFix).toHaveBeenCalledWith(
      "1.2.3.4",
      fakeResultWithFixable.findings,
      { dryRun: false, force: true },
    );
  });

  it("prints fix commands without calling runDoctorFix when --fix --dry-run", async () => {
    mockedResolveServer.mockResolvedValue(fakeServer);
    mockedRunServerDoctor.mockResolvedValue({ success: true, data: fakeResultWithFixable });

    await doctorCommand("my-server", { fix: true, dryRun: true }, "1.0.0");

    expect(mockedRunDoctorFix).not.toHaveBeenCalled();
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toMatch(/dry-run/i);
  });

  it("displays applied/skipped/failed counts after fix", async () => {
    mockedResolveServer.mockResolvedValue(fakeServer);
    mockedRunServerDoctor.mockResolvedValue({ success: true, data: fakeResultWithFixable });
    mockedRunDoctorFix.mockResolvedValue({
      applied: ["STALE_PACKAGES"],
      skipped: ["DISK_TREND"],
      failed: ["DOCKER_DISK: exit 1 — docker not found"],
    });

    await doctorCommand("my-server", { fix: true }, "1.0.0");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toMatch(/fixed.*1/i);
    expect(output).toMatch(/skipped.*1/i);
    expect(output).toMatch(/failed.*1/i);
  });
});

describe("checkProviderTokens", () => {
  let consoleSpy: jest.SpyInstance;
  const originalEnv = process.env;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    process.env = originalEnv;
  });

  it("should show info message when no servers registered", async () => {
    const fs = require("fs");
    fs.readFileSync.mockReturnValue("[]");

    await checkProviderTokens();

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("No servers registered");
    expect(output).toContain("Token check skipped");
  });

  it("should show warning when token is not set in environment", async () => {
    const fs = require("fs");
    fs.readFileSync.mockReturnValue(
      JSON.stringify([
        {
          id: "1",
          name: "test",
          provider: "hetzner",
          ip: "1.2.3.4",
          region: "nbg1",
          size: "cax11",
          createdAt: "2026-01-01",
          mode: "coolify" as const,
        },
      ]),
    );
    delete process.env.HETZNER_TOKEN;

    await checkProviderTokens();

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("HETZNER_TOKEN not set");
  });

  it("should show success when token is valid", async () => {
    const fs = require("fs");
    fs.readFileSync.mockReturnValue(
      JSON.stringify([
        {
          id: "1",
          name: "test",
          provider: "hetzner",
          ip: "1.2.3.4",
          region: "nbg1",
          size: "cax11",
          createdAt: "2026-01-01",
          mode: "coolify" as const,
        },
      ]),
    );
    process.env.HETZNER_TOKEN = "valid-token";
    mockedAxios.get.mockResolvedValueOnce({ data: { servers: [] } });

    await checkProviderTokens();

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("Hetzner");
    expect(output).toContain("Token is valid");
  });

  it("should show error when token is invalid", async () => {
    const fs = require("fs");
    fs.readFileSync.mockReturnValue(
      JSON.stringify([
        {
          id: "1",
          name: "test",
          provider: "digitalocean",
          ip: "1.2.3.4",
          region: "nyc1",
          size: "s-1vcpu-1gb",
          createdAt: "2026-01-01",
          mode: "coolify" as const,
        },
      ]),
    );
    process.env.DIGITALOCEAN_TOKEN = "invalid-token";
    mockedAxios.get.mockRejectedValueOnce(new Error("Unauthorized"));

    await checkProviderTokens();

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("DigitalOcean");
    expect(output).toContain("Token is invalid");
  });

  it("should check multiple providers when servers from different providers exist", async () => {
    const fs = require("fs");
    fs.readFileSync.mockReturnValue(
      JSON.stringify([
        {
          id: "1",
          name: "test1",
          provider: "hetzner",
          ip: "1.2.3.4",
          region: "nbg1",
          size: "cax11",
          createdAt: "2026-01-01",
          mode: "coolify" as const,
        },
        {
          id: "2",
          name: "test2",
          provider: "vultr",
          ip: "5.6.7.8",
          region: "ewr",
          size: "vc2-1c-1gb",
          createdAt: "2026-01-01",
          mode: "coolify" as const,
        },
      ]),
    );
    process.env.HETZNER_TOKEN = "valid-hetzner";
    process.env.VULTR_TOKEN = "valid-vultr";
    mockedAxios.get.mockResolvedValue({ data: {} });

    await checkProviderTokens();

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("Hetzner");
    expect(output).toContain("Vultr");
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  it("should handle network error gracefully", async () => {
    const fs = require("fs");
    fs.readFileSync.mockReturnValue(
      JSON.stringify([
        {
          id: "1",
          name: "test",
          provider: "linode",
          ip: "1.2.3.4",
          region: "us-east",
          size: "g6-nanode-1",
          createdAt: "2026-01-01",
          mode: "coolify" as const,
        },
      ]),
    );
    process.env.LINODE_TOKEN = "some-token";
    mockedAxios.get.mockRejectedValueOnce(new Error("Network Error"));

    await checkProviderTokens();

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("Linode");
    expect(output).toContain("Token is invalid");
  });

  it("should skip unknown providers with warning", async () => {
    const fs = require("fs");
    fs.readFileSync.mockReturnValue(
      JSON.stringify([
        {
          id: "1",
          name: "test",
          provider: "unknown-provider",
          ip: "1.2.3.4",
          region: "region1",
          size: "size1",
          createdAt: "2026-01-01",
          mode: "coolify" as const,
        },
      ]),
    );

    await checkProviderTokens();

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("Unknown provider");
  });

  it("should deduplicate providers when multiple servers use same provider", async () => {
    const fs = require("fs");
    fs.readFileSync.mockReturnValue(
      JSON.stringify([
        {
          id: "1",
          name: "test1",
          provider: "hetzner",
          ip: "1.2.3.4",
          region: "nbg1",
          size: "cax11",
          createdAt: "2026-01-01",
          mode: "coolify" as const,
        },
        {
          id: "2",
          name: "test2",
          provider: "hetzner",
          ip: "5.6.7.8",
          region: "fsn1",
          size: "cax21",
          createdAt: "2026-01-01",
          mode: "coolify" as const,
        },
      ]),
    );
    process.env.HETZNER_TOKEN = "valid-token";
    mockedAxios.get.mockResolvedValue({ data: {} });

    await checkProviderTokens();

    // Should only call API once for hetzner, not twice
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it("should use correct API endpoint for each provider", async () => {
    const fs = require("fs");
    fs.readFileSync.mockReturnValue(
      JSON.stringify([
        {
          id: "1",
          name: "test",
          provider: "digitalocean",
          ip: "1.2.3.4",
          region: "nyc1",
          size: "s-1vcpu-1gb",
          createdAt: "2026-01-01",
          mode: "coolify" as const,
        },
      ]),
    );
    process.env.DIGITALOCEAN_TOKEN = "test-token";
    mockedAxios.get.mockResolvedValueOnce({ data: {} });

    await checkProviderTokens();

    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://api.digitalocean.com/v2/account",
      expect.objectContaining({
        headers: { Authorization: "Bearer test-token" },
      }),
    );
  });

  it("should show title for provider token validation section", async () => {
    const fs = require("fs");
    fs.readFileSync.mockReturnValue(
      JSON.stringify([
        {
          id: "1",
          name: "test",
          provider: "hetzner",
          ip: "1.2.3.4",
          region: "nbg1",
          size: "cax11",
          createdAt: "2026-01-01",
          mode: "coolify" as const,
        },
      ]),
    );
    delete process.env.HETZNER_TOKEN;

    await checkProviderTokens();

    const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(output).toContain("Provider Token Validation");
  });
});
