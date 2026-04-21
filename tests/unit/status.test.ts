import { checkServerStatus } from "../../src/core/status.js";
import type { ServerRecord } from "../../src/types/index.js";
import * as providerFactory from "../../src/utils/providerFactory.js";
import * as adapterFactory from "../../src/adapters/factory.js";
import * as sshUtils from "../../src/utils/ssh.js";

jest.mock("../../src/utils/providerFactory.js");
jest.mock("../../src/adapters/factory.js");
jest.mock("../../src/utils/ssh.js");

const mockProvider = providerFactory as jest.Mocked<typeof providerFactory>;
const mockAdapter = adapterFactory as jest.Mocked<typeof adapterFactory>;
const mockSsh = sshUtils as jest.Mocked<typeof sshUtils>;

const mockServer: ServerRecord = {
  name: "test",
  ip: "1.2.3.4",
  provider: "hetzner",
  mode: "coolify",
  id: "123",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00Z",
};

describe("checkServerStatus", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return errorSource 'provider' when cloud status fails", async () => {
    mockProvider.createProviderWithToken.mockReturnValue({
      getServerStatus: jest.fn().mockRejectedValue(new Error("API timeout")),
    } as any);

    const result = await checkServerStatus(mockServer, "token-123");
    expect(result.errorSource).toBe("provider");
    expect(result.error).toContain("API timeout");
  });

  it("should return errorSource 'platform' when health check fails", async () => {
    mockProvider.createProviderWithToken.mockReturnValue({
      getServerStatus: jest.fn().mockResolvedValue("running"),
    } as any);
    mockAdapter.resolvePlatform.mockReturnValue("coolify");
    mockAdapter.getAdapter.mockReturnValue({
      healthCheck: jest.fn().mockRejectedValue(new Error("Connection refused")),
    } as any);

    const result = await checkServerStatus(mockServer, "token-123");
    expect(result.errorSource).toBe("platform");
    expect(result.error).toContain("Connection refused");
  });

  it("should not set errorSource on success", async () => {
    mockProvider.createProviderWithToken.mockReturnValue({
      getServerStatus: jest.fn().mockResolvedValue("running"),
    } as any);
    mockAdapter.resolvePlatform.mockReturnValue("coolify");
    mockAdapter.getAdapter.mockReturnValue({
      healthCheck: jest.fn().mockResolvedValue({ status: "running" }),
    } as any);

    const result = await checkServerStatus(mockServer, "token-123");
    expect(result.errorSource).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it("should handle manual server without token", async () => {
    const manualServer = { ...mockServer, id: "manual-abc" };
    mockAdapter.resolvePlatform.mockReturnValue("coolify");
    mockAdapter.getAdapter.mockReturnValue({
      healthCheck: jest.fn().mockResolvedValue({ status: "running" }),
    } as any);

    const result = await checkServerStatus(manualServer, "");
    expect(result.serverStatus).toBe("unknown (manual)");
    expect(result.errorSource).toBeUndefined();
  });
});
