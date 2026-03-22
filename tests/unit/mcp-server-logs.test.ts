import * as config from "../../src/utils/config";
import * as ssh from "../../src/utils/ssh";
import { handleServerLogs } from "../../src/mcp/tools/serverLogs";
import {
  buildLogCommand,
  buildMonitorCommand,
  parseMetrics,
  fetchServerLogs,
  fetchServerMetrics,
} from "../../src/core/logs";

jest.mock("../../src/utils/config");
jest.mock("../../src/utils/ssh");

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedSsh = ssh as jest.Mocked<typeof ssh>;

const sampleServer = {
  id: "123",
  name: "coolify-test",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-02-20T00:00:00Z",
  mode: "coolify" as const,
};

const sampleServer2 = {
  id: "456",
  name: "coolify-prod",
  provider: "digitalocean",
  ip: "5.6.7.8",
  region: "nyc1",
  size: "s-2vcpu-4gb",
  createdAt: "2026-02-21T00:00:00Z",
  mode: "coolify" as const,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedSsh.assertValidIp.mockImplementation(() => {});
});

// ─── Core: buildLogCommand ────────────────────────────────────────────────────

describe("buildLogCommand", () => {
  it("should build coolify log command", () => {
    expect(buildLogCommand("coolify", 50)).toBe("docker logs coolify --tail 50");
  });

  it("should build coolify log command with follow", () => {
    expect(buildLogCommand("coolify", 100, true)).toBe(
      "docker logs coolify --tail 100 --follow",
    );
  });

  it("should build docker journal command", () => {
    expect(buildLogCommand("docker", 30)).toBe("journalctl -u docker --no-pager -n 30");
  });

  it("should build docker journal command with follow", () => {
    expect(buildLogCommand("docker", 30, true)).toBe(
      "journalctl -u docker --no-pager -n 30 -f",
    );
  });

  it("should build system journal command", () => {
    expect(buildLogCommand("system", 200)).toBe("journalctl --no-pager -n 200");
  });

  it("should build system journal command with follow", () => {
    expect(buildLogCommand("system", 200, true)).toBe("journalctl --no-pager -n 200 -f");
  });
});

// ─── Core: buildMonitorCommand ────────────────────────────────────────────────

describe("buildMonitorCommand", () => {
  it("should build basic monitor command without containers", () => {
    const cmd = buildMonitorCommand(false);
    expect(cmd).toContain("top -bn1");
    expect(cmd).toContain("free -h");
    expect(cmd).toContain("df -h --total");
    expect(cmd).not.toContain("docker ps");
  });

  it("should include docker ps when containers requested", () => {
    const cmd = buildMonitorCommand(true);
    expect(cmd).toContain("docker ps");
    expect(cmd).toContain("---SEPARATOR---");
  });
});

// ─── Core: parseMetrics ───────────────────────────────────────────────────────

describe("parseMetrics", () => {
  it("should parse complete metrics output", () => {
    const stdout = [
      "top - 14:30:00 up 5 days",
      "%Cpu(s):  5.3 us,  2.1 sy,  0.0 ni, 92.0 id,  0.6 wa",
      "",
      "---SEPARATOR---",
      "              total        used        free",
      "Mem:          7.8Gi       2.5Gi       3.1Gi",
      "Swap:         2.0Gi       0.0Bi       2.0Gi",
      "---SEPARATOR---",
      "Filesystem      Size  Used Avail Use% Mounted on",
      "total            80G   45G   35G  57% -",
    ].join("\n");

    const metrics = parseMetrics(stdout);
    expect(metrics.cpu).toBe("8.0%");
    expect(metrics.ramUsed).toBe("2.5Gi");
    expect(metrics.ramTotal).toBe("7.8Gi");
    expect(metrics.diskUsed).toBe("45G");
    expect(metrics.diskTotal).toBe("80G");
    expect(metrics.diskPercent).toBe("57%");
  });

  it("should return N/A for missing data", () => {
    const metrics = parseMetrics("some random output");
    expect(metrics.cpu).toBe("N/A");
    expect(metrics.ramUsed).toBe("N/A");
    expect(metrics.ramTotal).toBe("N/A");
    expect(metrics.diskUsed).toBe("N/A");
  });

  it("should parse /dev/ disk lines when no total line", () => {
    const stdout = [
      "%Cpu(s):  0.0 us,  0.0 sy,  0.0 ni,100.0 id,  0.0 wa",
      "Mem:          4.0Gi       1.0Gi       2.5Gi",
      "/dev/sda1        40G   20G   18G  53% /",
    ].join("\n");

    const metrics = parseMetrics(stdout);
    expect(metrics.cpu).toBe("0.0%");
    expect(metrics.diskUsed).toBe("20G");
    expect(metrics.diskPercent).toBe("53%");
  });
});

// ─── Core: fetchServerLogs ────────────────────────────────────────────────────

describe("fetchServerLogs", () => {
  it("should return logs on success", async () => {
    mockedSsh.sshExec.mockResolvedValue({
      code: 0,
      stdout: "line1\nline2\nline3",
      stderr: "",
    });

    const result = await fetchServerLogs("1.2.3.4", "coolify", 50);
    expect(result.logs).toBe("line1\nline2\nline3");
    expect(result.service).toBe("coolify");
    expect(result.lines).toBe(50);
    expect(result.error).toBeUndefined();
  });

  it("should return error on non-zero exit code", async () => {
    mockedSsh.sshExec.mockResolvedValue({
      code: 1,
      stdout: "",
      stderr: "Connection refused",
    });

    const result = await fetchServerLogs("1.2.3.4", "coolify", 50);
    expect(result.error).toBe("Connection refused");
    expect(result.hint).toBeDefined();
  });

  it("should return error on SSH exception", async () => {
    mockedSsh.sshExec.mockRejectedValue(new Error("Host key verification failed"));

    const result = await fetchServerLogs("1.2.3.4", "coolify", 50);
    expect(result.error).toBe("Host key verification failed");
    expect(result.logs).toBe("");
  });

  it("should include partial logs on failure", async () => {
    mockedSsh.sshExec.mockResolvedValue({
      code: 1,
      stdout: "partial output",
      stderr: "error after partial",
    });

    const result = await fetchServerLogs("1.2.3.4", "system", 100);
    expect(result.logs).toBe("partial output");
    expect(result.error).toBe("error after partial");
  });
});

// ─── Core: fetchServerMetrics ─────────────────────────────────────────────────

describe("fetchServerMetrics", () => {
  const metricsOutput = [
    "%Cpu(s):  5.0 us,  2.0 sy,  0.0 ni, 93.0 id",
    "---SEPARATOR---",
    "Mem:          8.0Gi       3.0Gi       4.0Gi",
    "---SEPARATOR---",
    "total            100G   50G   50G  50% -",
  ].join("\n");

  it("should return parsed metrics on success", async () => {
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: metricsOutput, stderr: "" });

    const result = await fetchServerMetrics("1.2.3.4", false);
    expect(result.metrics.cpu).toBe("7.0%");
    expect(result.metrics.ramUsed).toBe("3.0Gi");
    expect(result.metrics.diskPercent).toBe("50%");
    expect(result.error).toBeUndefined();
    expect(result.containers).toBeUndefined();
  });

  it("should include containers when requested", async () => {
    const withContainers =
      metricsOutput +
      "\n---SEPARATOR---\n" +
      "NAMES         STATUS          PORTS\ncoolify       Up 2 days       0.0.0.0:8000->3000/tcp";

    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: withContainers, stderr: "" });

    const result = await fetchServerMetrics("1.2.3.4", true);
    expect(result.containers).toContain("coolify");
    expect(result.containers).toContain("Up 2 days");
  });

  it("should return N/A metrics on SSH failure", async () => {
    mockedSsh.sshExec.mockResolvedValue({
      code: 1,
      stdout: "",
      stderr: "Permission denied",
    });

    const result = await fetchServerMetrics("1.2.3.4", false);
    expect(result.metrics.cpu).toBe("N/A");
    expect(result.error).toBe("Permission denied");
  });

  it("should handle SSH exception", async () => {
    mockedSsh.sshExec.mockRejectedValue(new Error("Connection reset by peer"));

    const result = await fetchServerMetrics("1.2.3.4", false);
    expect(result.error).toBe("Connection reset by peer");
    expect(result.metrics.cpu).toBe("N/A");
  });
});

// ─── MCP Handler: handleServerLogs — logs ─────────────────────────────────────

describe("handleServerLogs — logs", () => {
  it("should return error when no servers exist", async () => {
    mockedConfig.getServers.mockReturnValue([]);

    const result = await handleServerLogs({ action: "logs" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toBe("No servers found");
    expect(data.suggested_actions).toBeDefined();
  });

  it("should auto-select single server", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "log output", stderr: "" });

    const result = await handleServerLogs({ action: "logs" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.server).toBe("coolify-test");
    expect(data.logs).toBe("log output");
    expect(data.service).toBe("coolify");
    expect(data.lines).toBe(50);
  });

  it("should require server selection when multiple servers exist", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer, sampleServer2]);

    const result = await handleServerLogs({ action: "logs" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("Multiple servers");
    expect(data.hint).toContain("Available:");
  });

  it("should return error when specified server not found", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(undefined);

    const result = await handleServerLogs({ action: "logs", server: "nonexistent" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("Server not found");
    expect(data.hint).toContain("coolify-test");
  });

  it("should find server by name", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer, sampleServer2]);
    mockedConfig.findServer.mockReturnValue(sampleServer);
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "logs here", stderr: "" });

    const result = await handleServerLogs({
      action: "logs",
      server: "coolify-test",
      service: "docker",
      lines: 100,
    });
    const data = JSON.parse(result.content[0].text);

    expect(data.server).toBe("coolify-test");
    expect(data.service).toBe("docker");
    expect(data.lines).toBe(100);
    expect(data.logs).toBe("logs here");
  });

  it("should return error with hint on SSH failure", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedSsh.sshExec.mockResolvedValue({
      code: 1,
      stdout: "",
      stderr: "Connection refused",
    });

    const result = await handleServerLogs({ action: "logs" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toBe("Connection refused");
    expect(data.suggested_actions).toBeDefined();
  });

  it("should suggest more lines when under 200", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "logs", stderr: "" });

    const result = await handleServerLogs({ action: "logs", lines: 50 });
    const data = JSON.parse(result.content[0].text);

    const fetchMore = data.suggested_actions.find(
      (a: { command: string }) => a.command.includes("lines: 200"),
    );
    expect(fetchMore).toBeDefined();
  });

  it("should not suggest more lines when already 200+", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "logs", stderr: "" });

    const result = await handleServerLogs({ action: "logs", lines: 200 });
    const data = JSON.parse(result.content[0].text);

    const fetchMore = data.suggested_actions.find(
      (a: { command: string }) => a.command.includes("lines: 200"),
    );
    expect(fetchMore).toBeUndefined();
  });

  it("should suggest system logs when viewing coolify logs", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "logs", stderr: "" });

    const result = await handleServerLogs({ action: "logs", service: "coolify" });
    const data = JSON.parse(result.content[0].text);

    const systemSuggestion = data.suggested_actions.find(
      (a: { command: string }) => a.command.includes("service: 'system'"),
    );
    expect(systemSuggestion).toBeDefined();
  });
});

// ─── MCP Handler: handleServerLogs — monitor ─────────────────────────────────

describe("handleServerLogs — monitor", () => {
  const metricsOutput = [
    "%Cpu(s): 10.0 us, 5.0 sy, 0.0 ni, 85.0 id",
    "---SEPARATOR---",
    "Mem:          16Gi       8.0Gi       6.0Gi",
    "---SEPARATOR---",
    "total            200G   100G   100G  50% -",
  ].join("\n");

  it("should return metrics for single server", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: metricsOutput, stderr: "" });

    const result = await handleServerLogs({ action: "monitor" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.server).toBe("coolify-test");
    expect(data.metrics.cpu).toBe("15.0%");
    expect(data.metrics.ramUsed).toBe("8.0Gi");
    expect(data.metrics.ramTotal).toBe("16Gi");
    expect(data.metrics.diskPercent).toBe("50%");
  });

  it("should suggest adding containers when not included", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: metricsOutput, stderr: "" });

    const result = await handleServerLogs({ action: "monitor", containers: false });
    const data = JSON.parse(result.content[0].text);

    const containerSuggestion = data.suggested_actions.find(
      (a: { command: string }) => a.command.includes("containers: true"),
    );
    expect(containerSuggestion).toBeDefined();
  });

  it("should not suggest containers when already included", async () => {
    const withContainers =
      metricsOutput +
      "\n---SEPARATOR---\n" +
      "NAMES    STATUS\ncoolify  Up 2d";
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: withContainers, stderr: "" });

    const result = await handleServerLogs({ action: "monitor", containers: true });
    const data = JSON.parse(result.content[0].text);

    const containerSuggestion = data.suggested_actions.find(
      (a: { command: string }) => a.command.includes("containers: true"),
    );
    expect(containerSuggestion).toBeUndefined();
    expect(data.containers).toContain("coolify");
  });

  it("should return error on SSH failure", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedSsh.sshExec.mockResolvedValue({
      code: 1,
      stdout: "",
      stderr: "Permission denied",
    });

    const result = await handleServerLogs({ action: "monitor" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toBe("Permission denied");
  });

  it("should find server by name for monitor", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer, sampleServer2]);
    mockedConfig.findServer.mockReturnValue(sampleServer2);
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: metricsOutput, stderr: "" });

    const result = await handleServerLogs({
      action: "monitor",
      server: "coolify-prod",
    });
    const data = JSON.parse(result.content[0].text);

    expect(data.server).toBe("coolify-prod");
    expect(data.ip).toBe("5.6.7.8");
  });
});

// ─── MCP Handler: error handling ──────────────────────────────────────────────

describe("handleServerLogs — error handling", () => {
  it("should catch unexpected errors and return isError", async () => {
    mockedConfig.getServers.mockImplementation(() => {
      throw new Error("Config file corrupted");
    });

    const result = await handleServerLogs({ action: "logs" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toBe("Config file corrupted");
  });

  it("should handle non-Error thrown values", async () => {
    mockedConfig.getServers.mockImplementation(() => {
      throw "unexpected string error";
    });

    const result = await handleServerLogs({ action: "logs" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toBe("unexpected string error");
  });
});

// ─── MCP Handler: bare mode behavior ──────────────────────────────────────────

const bareServer = {
  id: "789",
  name: "bare-server",
  provider: "hetzner",
  ip: "10.0.0.1",
  region: "nbg1",
  size: "cax11",
  mode: "bare" as const,
  createdAt: "2026-02-20T00:00:00Z",
};

describe("handleServerLogs — bare mode", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedConfig.getServers.mockReturnValue([bareServer]);
    mockedConfig.findServer.mockReturnValue(bareServer);
  });

  it("should block coolify service on bare server with error and hint", async () => {
    const result = await handleServerLogs({ action: "logs", server: "bare-server", service: "coolify" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.error).toContain("logs not available on bare servers");
    expect(data.hint).toBeDefined();
    expect(data.hint).toContain("system");
  });

  it("should include suggested action for system logs when coolify blocked", async () => {
    const result = await handleServerLogs({ action: "logs", server: "bare-server", service: "coolify" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(data.suggested_actions).toBeDefined();
    expect(data.suggested_actions.length).toBeGreaterThan(0);
    const systemAction = data.suggested_actions.find(
      (a: { command: string }) => a.command.includes("service: 'system'"),
    );
    expect(systemAction).toBeDefined();
  });

  it("should allow system service on bare server", async () => {
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "system logs here", stderr: "" });

    const result = await handleServerLogs({ action: "logs", server: "bare-server", service: "system" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.logs).toBe("system logs here");
    expect(data.service).toBe("system");
  });

  it("should allow docker service on bare server", async () => {
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "docker journal", stderr: "" });

    const result = await handleServerLogs({ action: "logs", server: "bare-server", service: "docker" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.service).toBe("docker");
  });

  it("should allow monitor on bare server (mode-independent)", async () => {
    const metricsOutput = [
      "%Cpu(s):  5.0 us,  2.0 sy,  0.0 ni, 93.0 id",
      "---SEPARATOR---",
      "Mem:          8.0Gi       3.0Gi       4.0Gi",
      "---SEPARATOR---",
      "total            100G   50G   50G  50% -",
    ].join("\n");
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: metricsOutput, stderr: "" });

    const result = await handleServerLogs({ action: "monitor", server: "bare-server" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.metrics).toBeDefined();
    expect(data.metrics.cpu).not.toBe("N/A");
  });
});

// ─── MCP Handler: malformed params ────────────────────────────────────────────

describe("handleServerLogs — malformed params", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedSsh.assertValidIp.mockImplementation(() => {});
  });

  it("returns mcpError when server param is empty string", async () => {
    // Arrange
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(undefined as never);

    // Act
    const result = await handleServerLogs({ action: "logs", server: "" });

    // Assert
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeTruthy();
  });

  it("returns mcpError when server param is null (as unknown)", async () => {
    // Arrange
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(undefined as never);

    // Act
    const result = await handleServerLogs({ action: "logs", server: null as unknown as string });

    // Assert
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeTruthy();
  });

  it("returns mcpError for unmatched server string", async () => {
    // Arrange
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(undefined as never);

    // Act
    const result = await handleServerLogs({ action: "logs", server: "999.999.999.999" });

    // Assert
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeTruthy();
  });

  it("returns mcpError when SSH core rejects with timeout", async () => {
    // Arrange
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(sampleServer as never);
    mockedSsh.sshExec.mockRejectedValue(new Error("SSH operation timed out after 30000ms"));

    // Act
    const result = await handleServerLogs({ action: "logs", server: "coolify-test" });

    // Assert
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("timed out");
  });
});
