/**
 * Tests for checkServerHealth extracted to core/health.ts (38-01 Task 1)
 * Verifies the function is importable from core/ and returns expected shape.
 */

jest.mock("../../src/utils/ssh.js", () => ({
  assertValidIp: jest.fn(),
  sshExec: jest.fn(),
  isHostKeyMismatch: jest.fn((stderr: string) =>
    /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(stderr),
  ),
  removeStaleHostKey: jest.fn(),
  resolveSshPath: jest.fn().mockReturnValue("ssh"),
  checkSshAvailable: jest.fn().mockReturnValue(true),
  sanitizedEnv: jest.fn().mockReturnValue({}),
}));

jest.mock("../../src/adapters/factory.js", () => ({
  resolvePlatform: jest.fn().mockImplementation((server: any) => {
    if (server.platform) return server.platform;
    if (server.mode === "bare") return undefined;
    return "coolify";
  }),
  getAdapter: jest.fn().mockReturnValue({
    healthCheck: jest.fn().mockResolvedValue({ status: "running" }),
  }),
}));

jest.mock("../../src/utils/modeGuard.js", () => ({
  isBareServer: jest.fn((server: any) => server.mode === "bare"),
}));

jest.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
  },
  createSpinner: jest.fn(() => ({
    start: jest.fn(),
    stop: jest.fn(),
    succeed: jest.fn(),
    fail: jest.fn(),
  })),
}));

import { checkServerHealth } from "../../src/core/health.js";
import * as ssh from "../../src/utils/ssh.js";
import * as adapterFactory from "../../src/adapters/factory.js";
import * as modeGuard from "../../src/utils/modeGuard.js";

const mockedSsh = ssh as jest.Mocked<typeof ssh>;
const mockedAdapterFactory = adapterFactory as jest.Mocked<typeof adapterFactory>;
const mockedModeGuard = modeGuard as jest.Mocked<typeof modeGuard>;

const bareServer = {
  id: "bare-1",
  name: "bare-server",
  provider: "hetzner",
  ip: "9.9.9.9",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00.000Z",
  mode: "bare" as const,
};

const platformServer = {
  id: "platform-1",
  name: "coolify-server",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00.000Z",
  mode: "coolify" as const,
};

beforeEach(() => {
  jest.resetAllMocks();
  // Re-setup mocks after reset (resetAllMocks clears implementations)
  mockedModeGuard.isBareServer.mockImplementation((server: any) => server.mode === "bare");
  mockedSsh.isHostKeyMismatch.mockReturnValue(false);
  (mockedAdapterFactory.resolvePlatform as jest.Mock).mockImplementation((server: any) => {
    if (server.platform) return server.platform;
    if (server.mode === "bare") return undefined;
    return "coolify";
  });
  (mockedAdapterFactory.getAdapter as jest.Mock).mockReturnValue({
    healthCheck: jest.fn().mockResolvedValue({ status: "running" }),
  });
});

describe("checkServerHealth from core/health.ts", () => {
  it("is importable from src/core/health.ts", () => {
    expect(typeof checkServerHealth).toBe("function");
  });

  it("returns HealthResult with server, status, responseTime fields", async () => {
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "ok", stderr: "" });
    mockedSsh.isHostKeyMismatch.mockReturnValue(false);

    const result = await checkServerHealth(bareServer);

    expect(result).toHaveProperty("server");
    expect(result).toHaveProperty("status");
    expect(result).toHaveProperty("responseTime");
  });

  it("bare server: returns healthy when SSH echo ok succeeds", async () => {
    mockedSsh.sshExec.mockResolvedValue({ code: 0, stdout: "ok", stderr: "" });
    mockedSsh.isHostKeyMismatch.mockReturnValue(false);

    const result = await checkServerHealth(bareServer);

    expect(result.status).toBe("healthy");
    expect(result.responseTime).toBeGreaterThanOrEqual(0);
  });

  it("bare server: returns unreachable when SSH throws", async () => {
    mockedSsh.sshExec.mockRejectedValue(new Error("timeout"));

    const result = await checkServerHealth(bareServer);

    expect(result.status).toBe("unreachable");
  });

  it("platform server: uses adapter healthCheck (not sshExec)", async () => {
    const mockHealthCheck = jest.fn().mockResolvedValue({ status: "running" });
    (mockedAdapterFactory.getAdapter as jest.Mock).mockReturnValue({ healthCheck: mockHealthCheck });

    const result = await checkServerHealth(platformServer);

    expect(result.status).toBe("healthy");
    expect(mockedSsh.sshExec).not.toHaveBeenCalled();
  });
});
