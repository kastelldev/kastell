import axios from "axios";
import * as config from "../../src/utils/config";
import * as serverSelect from "../../src/utils/serverSelect";
import { checkServerHealth, healthCommand } from "../../src/commands/health";

jest.mock("../../src/utils/config");
jest.mock("../../src/utils/serverSelect");
jest.mock("../../src/utils/ssh", () => ({
  assertValidIp: jest.fn(),
  sshExec: jest.fn(),
  removeStaleHostKey: jest.fn(),
  isHostKeyMismatch: jest.fn((stderr: string) =>
    /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(stderr),
  ),
  resolveSshPath: jest.fn().mockReturnValue("ssh"),
  checkSshAvailable: jest.fn().mockReturnValue(true),
  sanitizedEnv: jest.fn().mockReturnValue({}),
}));

import * as sshModule from "../../src/utils/ssh";
const mockedSsh = sshModule as jest.Mocked<typeof sshModule>;

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedConfig = config as jest.Mocked<typeof config>;
// serverSelect is imported but not directly used in these tests
void serverSelect;

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

const sampleServer2 = {
  id: "456",
  name: "coolify-prod",
  provider: "digitalocean",
  ip: "5.6.7.8",
  region: "nyc1",
  size: "s-2vcpu-4gb",
  createdAt: "2026-01-02T00:00:00.000Z",
  mode: "coolify" as const,
};

describe("healthCommand", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("should show message when no servers found", async () => {
    mockedConfig.getServers.mockReturnValue([]);
    await healthCommand();
    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("No servers found");
  });

  it("should return healthy for reachable server", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: {}, status: 200 });
    const result = await checkServerHealth(sampleServer);
    expect(result.status).toBe("healthy");
    expect(result.responseTime).toBeGreaterThanOrEqual(0);
  });

  // Note: checkCoolifyHealth returns "running" for any HTTP response (including 500)
  // since it uses validateStatus: () => true. So 5xx responses map to "healthy".
  it("should return healthy even for 500 status (core uses validateStatus: always true)", async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: {}, status: 500 });
    const result = await checkServerHealth(sampleServer);
    expect(result.status).toBe("healthy");
  });

  it("should return unreachable when connection fails", async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await checkServerHealth(sampleServer);
    expect(result.status).toBe("unreachable");
  });

  it("should display table for multiple servers", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer, sampleServer2]);
    mockedAxios.get
      .mockResolvedValueOnce({ data: {}, status: 200 })
      .mockRejectedValueOnce(new Error("timeout"));

    await healthCommand();

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("coolify-test");
    expect(output).toContain("coolify-prod");
    expect(output).toContain("healthy");
    expect(output).toContain("unreachable");
  });

  it("should show all healthy message when all servers are up", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedAxios.get.mockResolvedValueOnce({ data: {}, status: 200 });

    await healthCommand();

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("All 1 server(s) are healthy");
  });

  it("should show warning summary when some servers are down", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer, sampleServer2]);
    mockedAxios.get
      .mockResolvedValueOnce({ data: {}, status: 200 })
      .mockRejectedValueOnce(new Error("timeout"));

    await healthCommand();

    const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
    expect(output).toContain("1 healthy");
    expect(output).toContain("1 unreachable");
  });

  // ---- Bare mode tests ----

  describe("bare server SSH health check", () => {
    const bareServer = {
      ...sampleServer,
      id: "bare-123",
      name: "bare-test",
      ip: "9.9.9.9",
      mode: "bare" as const,
    };

    it("should check bare servers via SSH (not skip them)", async () => {
      mockedConfig.getServers.mockReturnValue([bareServer]);
      mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout: "ok", stderr: "" });

      await healthCommand();

      // SSH check performed (not axios.get)
      expect(mockedSsh.sshExec).toHaveBeenCalledWith(bareServer.ip, "echo ok");
      expect(mockedAxios.get).not.toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("bare-test");
      expect(output).toContain("healthy");
    });

    it("should health-check both coolify and bare servers in mixed list", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer, bareServer]);
      mockedAxios.get.mockResolvedValueOnce({ data: {}, status: 200 });
      mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout: "ok", stderr: "" });

      await healthCommand();

      // One HTTP check (coolify), one SSH check (bare)
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(1);
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("coolify-test");
      expect(output).toContain("bare-test");
      expect(output).toContain("healthy");
    });

    it("should show unreachable for bare server when SSH fails", async () => {
      mockedConfig.getServers.mockReturnValue([bareServer]);
      mockedSsh.sshExec.mockResolvedValueOnce({ code: 255, stdout: "", stderr: "Connection refused" });

      await healthCommand();

      expect(mockedAxios.get).not.toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("unreachable");
    });
  });

  // ---- BUG-6: health command query parameter ----

  describe("query parameter (BUG-6)", () => {
    it("should filter to matching server when query is provided", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer, sampleServer2]);
      mockedConfig.findServer.mockReturnValue(sampleServer);
      mockedAxios.get.mockResolvedValueOnce({ data: {}, status: 200 });

      await healthCommand("coolify-test");

      // Should only health-check the one matched server
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("coolify-test");
    });

    it("should show error when query matches no server", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer]);
      mockedConfig.findServer.mockReturnValue(undefined);

      await healthCommand("nonexistent");

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("Server not found");
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it("should check all servers when no query is provided (backward compat)", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer, sampleServer2]);
      mockedAxios.get
        .mockResolvedValueOnce({ data: {}, status: 200 })
        .mockResolvedValueOnce({ data: {}, status: 200 });

      await healthCommand();

      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });
  });
});
