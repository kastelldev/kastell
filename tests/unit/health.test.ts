/**
 * Tests for host key mismatch detection in health command (Task 2: quick-4)
 * Tests bare server SSH health checks and host key mismatch reporting.
 */
import * as config from "../../src/utils/config";
import * as ssh from "../../src/utils/ssh";
import { checkServerHealth, healthCommand } from "../../src/commands/health";

jest.mock("../../src/utils/config");
jest.mock("../../src/adapters/factory", () => ({
  resolvePlatform: jest.fn().mockImplementation((server: any) => {
    if (server.platform) return server.platform;
    if (server.mode === "bare") return undefined;
    return "coolify";
  }),
  getAdapter: jest.fn().mockReturnValue({
    healthCheck: jest.fn().mockResolvedValue({ status: "running" }),
  }),
}));
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

import * as adapterFactory from "../../src/adapters/factory";

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedSsh = ssh as jest.Mocked<typeof ssh>;
const mockedAdapterFactory = adapterFactory as jest.Mocked<typeof adapterFactory>;

const bareServer = {
  id: "bare-456",
  name: "bare-test",
  provider: "hetzner",
  ip: "9.9.9.9",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00.000Z",
  mode: "bare" as const,
};

const coolifyServer = {
  id: "123",
  name: "coolify-test",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00.000Z",
  mode: "coolify" as const,
};

describe("health command — bare server SSH checks", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.spyOn(console, "error").mockImplementation();
    jest.spyOn(console, "warn").mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("checkServerHealth — bare server", () => {
    it("should return 'healthy' when sshExec echo ok succeeds", async () => {
      mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout: "ok", stderr: "" });

      const result = await checkServerHealth(bareServer);

      expect(result.status).toBe("healthy");
      expect(mockedSsh.sshExec).toHaveBeenCalledWith(bareServer.ip, "echo ok");
    });

    it("should return 'host-key-mismatch' when sshExec stderr contains host key pattern", async () => {
      mockedSsh.sshExec.mockResolvedValueOnce({
        code: 255,
        stdout: "",
        stderr: "Host key verification failed.",
      });

      const result = await checkServerHealth(bareServer);

      expect(result.status).toBe("host-key-mismatch");
    });

    it("should return 'host-key-mismatch' when sshExec stderr contains REMOTE HOST IDENTIFICATION", async () => {
      mockedSsh.sshExec.mockResolvedValueOnce({
        code: 255,
        stdout: "",
        stderr: "REMOTE HOST IDENTIFICATION HAS CHANGED!",
      });

      const result = await checkServerHealth(bareServer);

      expect(result.status).toBe("host-key-mismatch");
    });

    it("should return 'unreachable' on other SSH failures", async () => {
      mockedSsh.sshExec.mockResolvedValueOnce({
        code: 255,
        stdout: "",
        stderr: "Connection refused",
      });

      const result = await checkServerHealth(bareServer);

      expect(result.status).toBe("unreachable");
    });

    it("should return 'unreachable' when sshExec throws", async () => {
      mockedSsh.sshExec.mockRejectedValueOnce(new Error("spawn ENOENT"));

      const result = await checkServerHealth(bareServer);

      expect(result.status).toBe("unreachable");
    });
  });

  describe("checkServerHealth — platform server (adapter-based)", () => {
    it("should use adapter healthCheck for platform servers (not sshExec)", async () => {
      const mockHealthCheck = jest.fn().mockResolvedValueOnce({ status: "running" });
      (mockedAdapterFactory.getAdapter as jest.Mock).mockReturnValueOnce({ healthCheck: mockHealthCheck });

      const result = await checkServerHealth(coolifyServer);

      expect(result.status).toBe("healthy");
      expect(mockedSsh.sshExec).not.toHaveBeenCalled();
    });

    it("should return unreachable when adapter healthCheck returns not reachable", async () => {
      const mockHealthCheck = jest.fn().mockResolvedValueOnce({ status: "not reachable" });
      (mockedAdapterFactory.getAdapter as jest.Mock).mockReturnValueOnce({ healthCheck: mockHealthCheck });

      const result = await checkServerHealth(coolifyServer);

      expect(result.status).toBe("unreachable");
    });
  });

  describe("healthCommand display — host key mismatch", () => {
    it("should display host key mismatch with distinct icon in table", async () => {
      mockedConfig.getServers.mockReturnValue([bareServer]);
      mockedSsh.sshExec.mockResolvedValueOnce({
        code: 255,
        stdout: "",
        stderr: "Host key verification failed.",
      });

      await healthCommand();

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("host key");
    });

    it("should show actionable fix hint when host key mismatch detected", async () => {
      mockedConfig.getServers.mockReturnValue([bareServer]);
      mockedSsh.sshExec.mockResolvedValueOnce({
        code: 255,
        stdout: "",
        stderr: "Host key verification failed.",
      });

      await healthCommand();

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("ssh-keygen -R");
    });

    it("should include host key mismatch in summary counts", async () => {
      mockedConfig.getServers.mockReturnValue([coolifyServer, bareServer]);
      const mockHealthCheck = jest.fn().mockResolvedValueOnce({ status: "running" });
      (mockedAdapterFactory.getAdapter as jest.Mock).mockReturnValueOnce({ healthCheck: mockHealthCheck });
      mockedSsh.sshExec.mockResolvedValueOnce({
        code: 255,
        stdout: "",
        stderr: "Host key verification failed.",
      });

      await healthCommand();

      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      // Should show healthy count and host-key mismatch count
      expect(output).toContain("1 healthy");
      expect(output).toContain("host key");
    });

    it("should check bare servers via SSH (not skip them)", async () => {
      mockedConfig.getServers.mockReturnValue([bareServer]);
      mockedSsh.sshExec.mockResolvedValueOnce({ code: 0, stdout: "ok", stderr: "" });

      await healthCommand();

      expect(mockedSsh.sshExec).toHaveBeenCalledTimes(1);
      const output = consoleSpy.mock.calls.map((c: any[]) => c.join(" ")).join("\n");
      expect(output).toContain("bare-test");
      expect(output).toContain("healthy");
    });
  });
});
