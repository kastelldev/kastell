import * as config from "../../src/utils/config";
import * as sshUtils from "../../src/utils/ssh";
import { logsCommand, buildLogCommand } from "../../src/commands/logs";
import { buildMonitorCommand } from "../../src/core/logs";

jest.mock("../../src/utils/config");
jest.mock("../../src/utils/ssh");

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedSsh = sshUtils as jest.Mocked<typeof sshUtils>;

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

describe("buildMonitorCommand locale safety (BUGF-02)", () => {
  it("should include LANG=C LC_ALL=C prefix on metric commands", () => {
    const cmd = buildMonitorCommand(false);
    expect(cmd).toContain("LANG=C LC_ALL=C top");
    expect(cmd).toContain("LANG=C LC_ALL=C free");
    expect(cmd).toContain("LANG=C LC_ALL=C df");
  });

  it("should include LANG=C LC_ALL=C prefix with containers too", () => {
    const cmd = buildMonitorCommand(true);
    expect(cmd).toContain("LANG=C LC_ALL=C top");
    expect(cmd).toContain("LANG=C LC_ALL=C free");
    expect(cmd).toContain("LANG=C LC_ALL=C df");
    // docker ps does NOT need locale prefix
    expect(cmd).not.toContain("LANG=C LC_ALL=C docker");
  });
});

describe("logsCommand", () => {
  let consoleSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe("buildLogCommand", () => {
    it("should build coolify log command", () => {
      expect(buildLogCommand("coolify", 50, false)).toBe("docker logs coolify --tail 50");
    });

    it("should build coolify log command with follow", () => {
      expect(buildLogCommand("coolify", 100, true)).toBe("docker logs coolify --tail 100 --follow");
    });

    it("should build docker log command", () => {
      expect(buildLogCommand("docker", 30, false)).toBe("journalctl -u docker --no-pager -n 30");
    });

    it("should build system log command with follow", () => {
      expect(buildLogCommand("system", 50, true)).toBe("journalctl --no-pager -n 50 -f");
    });

    it("should build dokploy log command", () => {
      expect(buildLogCommand("dokploy" as any, 50, false)).toBe(
        "docker service logs dokploy_dokploy --tail 50",
      );
    });

    it("should build dokploy log command with follow", () => {
      expect(buildLogCommand("dokploy" as any, 100, true)).toBe(
        "docker service logs dokploy_dokploy --tail 100 --follow",
      );
    });
  });

  it("should show error when SSH not available", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(false);
    await logsCommand();
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("SSH client not found");
  });

  it("should return when no server found", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedConfig.findServers.mockReturnValue([]);
    await logsCommand("nonexistent");
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Server not found");
  });

  it("should show error for invalid --lines value", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedConfig.findServers.mockReturnValue([sampleServer]);
    await logsCommand("1.2.3.4", { lines: "abc" });
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Invalid --lines");
  });

  it("should show error for invalid service", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedConfig.findServers.mockReturnValue([sampleServer]);
    await logsCommand("1.2.3.4", { service: "invalid" });
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Invalid service");
  });

  it("should use sshExec for non-follow mode", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedConfig.findServers.mockReturnValue([sampleServer]);
    mockedSsh.sshExec.mockResolvedValue({
      code: 0,
      stdout: "log line 1\nlog line 2",
      stderr: "",
    });

    await logsCommand("1.2.3.4", { service: "coolify", lines: "20" });

    expect(mockedSsh.sshExec).toHaveBeenCalledWith("1.2.3.4", "docker logs coolify --tail 20");
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("log line 1");
  });

  it("should use sshStream for follow mode", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedConfig.findServers.mockReturnValue([sampleServer]);
    mockedSsh.sshStream.mockResolvedValue(0);

    await logsCommand("1.2.3.4", { follow: true });

    expect(mockedSsh.sshStream).toHaveBeenCalledWith(
      "1.2.3.4",
      "docker logs coolify --tail 50 --follow",
    );
  });

  it("should show error on non-zero sshExec exit code", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedConfig.findServers.mockReturnValue([sampleServer]);
    mockedSsh.sshExec.mockResolvedValue({ code: 1, stdout: "", stderr: "error" });

    await logsCommand("1.2.3.4");

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Failed to fetch logs");
  });

  it("should show error on non-zero sshStream exit code", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedConfig.findServers.mockReturnValue([sampleServer]);
    mockedSsh.sshStream.mockResolvedValue(1);

    await logsCommand("1.2.3.4", { follow: true });

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("Log stream ended with code 1");
  });

  it("should not show error for Ctrl+C exit (code 130) in follow mode", async () => {
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedConfig.findServers.mockReturnValue([sampleServer]);
    mockedSsh.sshStream.mockResolvedValue(130);

    await logsCommand("1.2.3.4", { follow: true });

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).not.toContain("Log stream ended");
  });

  // ---- Dokploy service tests ----

  describe("dokploy server", () => {
    const dokployServer = {
      id: "dok-123",
      name: "dokploy-test",
      provider: "hetzner",
      ip: "10.0.0.1",
      region: "nbg1",
      size: "cax11",
      createdAt: "2026-01-01T00:00:00.000Z",
      mode: "coolify" as const,
      platform: "dokploy" as const,
    };

    it("should accept 'dokploy' as valid service", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([dokployServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "dokploy log", stderr: "" });

      await logsCommand("10.0.0.1", { service: "dokploy" });

      expect(mockedSsh.sshExec).toHaveBeenCalledWith(
        "10.0.0.1",
        "docker service logs dokploy_dokploy --tail 50",
      );
    });

    it("should default to 'dokploy' service on Dokploy server", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([dokployServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

      await logsCommand("10.0.0.1");

      expect(mockedSsh.sshExec).toHaveBeenCalledWith(
        "10.0.0.1",
        expect.stringContaining("docker service logs dokploy_dokploy"),
      );
    });

    it("should error when using --service coolify on Dokploy server", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([dokployServer]);

      await logsCommand("10.0.0.1", { service: "coolify" });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Coolify logs are not available for Dokploy");
      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
    });

    it("should error when using --service dokploy on Coolify server", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([sampleServer]);

      await logsCommand("1.2.3.4", { service: "dokploy" });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Dokploy logs are not available for Coolify");
      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
    });
  });

  // ---- Bare mode tests ----

  describe("bare server + service guard", () => {
    const bareServer = {
      id: "bare-123",
      name: "bare-test",
      provider: "hetzner",
      ip: "9.9.9.9",
      region: "nbg1",
      size: "cax11",
      createdAt: "2026-01-01T00:00:00.000Z",
      mode: "bare" as const,
    };

    it("should error when service=coolify on bare server", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([bareServer]);

      await logsCommand("9.9.9.9", { service: "coolify" });

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("bare");
      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
    });

    it("should work when service=system on bare server", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([bareServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "system log", stderr: "" });

      await logsCommand("9.9.9.9", { service: "system" });

      expect(mockedSsh.sshExec).toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("system log");
    });

    it("should work when service=docker on bare server", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([bareServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "docker log", stderr: "" });

      await logsCommand("9.9.9.9", { service: "docker" });

      expect(mockedSsh.sshExec).toHaveBeenCalled();
    });

    it("should default to system service (not coolify) on bare server when no service specified", async () => {
      mockedSsh.checkSshAvailable.mockReturnValue(true);
      mockedConfig.findServers.mockReturnValue([bareServer]);
      mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

      await logsCommand("9.9.9.9");

      // Should use system logs, not coolify logs
      expect(mockedSsh.sshExec).toHaveBeenCalledWith("9.9.9.9", expect.stringContaining("journalctl"));
    });
  });
});
