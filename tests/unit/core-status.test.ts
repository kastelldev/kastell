import axios from "axios";
import * as providerFactory from "../../src/utils/providerFactory";
import {
  getCloudServerStatus,
  checkServerStatus,
  checkAllServersStatus,
} from "../../src/core/status";
import type { CloudProvider } from "../../src/providers/base";

jest.mock("../../src/utils/providerFactory");

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedProviderFactory = providerFactory as jest.Mocked<typeof providerFactory>;

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

const mockProvider: CloudProvider = {
  name: "hetzner",
  displayName: "Hetzner Cloud",
  validateToken: jest.fn().mockResolvedValue(true),
  getRegions: jest.fn().mockReturnValue([]),
  getServerSizes: jest.fn().mockReturnValue([]),
  getAvailableLocations: jest.fn().mockResolvedValue([]),
  getAvailableServerTypes: jest.fn().mockResolvedValue([]),
  uploadSshKey: jest.fn(),
  createServer: jest.fn(),
  getServerStatus: jest.fn(),
  getServerDetails: jest.fn(),
  destroyServer: jest.fn(),
  rebootServer: jest.fn(),
  createSnapshot: jest.fn(),
  listSnapshots: jest.fn(),
  deleteSnapshot: jest.fn(),
  restoreSnapshot: jest.fn(),
  getSnapshotCostEstimate: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("getCloudServerStatus", () => {
  it("should return provider status for cloud servers", async () => {
    (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    const result = await getCloudServerStatus(sampleServer, "test-token");

    expect(result).toBe("running");
    expect(mockedProviderFactory.createProviderWithToken).toHaveBeenCalledWith("hetzner", "test-token");
    expect(mockProvider.getServerStatus).toHaveBeenCalledWith("123");
  });

  it("should return 'unknown (manual)' for manually added servers", async () => {
    const manualServer = { ...sampleServer, id: "manual-abc123" };

    const result = await getCloudServerStatus(manualServer, "");

    expect(result).toBe("unknown (manual)");
    expect(mockedProviderFactory.createProviderWithToken).not.toHaveBeenCalled();
  });

  it("should propagate provider errors", async () => {
    (mockProvider.getServerStatus as jest.Mock).mockRejectedValue(new Error("Unauthorized"));
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    await expect(getCloudServerStatus(sampleServer, "bad-token")).rejects.toThrow("Unauthorized");
  });
});

describe("checkServerStatus", () => {
  it("should return combined status when both checks succeed", async () => {
    (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
    mockedAxios.get.mockResolvedValueOnce({ status: 200 });

    const result = await checkServerStatus(sampleServer, "test-token");

    expect(result).toEqual({
      server: sampleServer,
      serverStatus: "running",
      platformStatus: "running",
      // no error field
    });
  });

  it("should return 'not reachable' coolify when health check fails", async () => {
    (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
    mockedAxios.get.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await checkServerStatus(sampleServer, "test-token");

    expect(result.serverStatus).toBe("running");
    expect(result.platformStatus).toBe("not reachable");
    expect(result.error).toBeUndefined();
  });

  it("should return error result when provider throws", async () => {
    (mockProvider.getServerStatus as jest.Mock).mockRejectedValue(new Error("API failure"));
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    const result = await checkServerStatus(sampleServer, "bad-token");

    expect(result.serverStatus).toBe("error");
    expect(result.platformStatus).toBe("unknown");
    expect(result.error).toBe("API failure");
  });

  it("should handle non-Error exceptions", async () => {
    (mockProvider.getServerStatus as jest.Mock).mockRejectedValue("string error");
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    const result = await checkServerStatus(sampleServer, "bad-token");

    expect(result.serverStatus).toBe("error");
    expect(result.error).toBe("string error");
  });

  it("should work with manual servers", async () => {
    const manualServer = { ...sampleServer, id: "manual-xyz" };
    mockedAxios.get.mockResolvedValueOnce({ status: 200 });

    const result = await checkServerStatus(manualServer, "");

    expect(result.serverStatus).toBe("unknown (manual)");
    expect(result.platformStatus).toBe("running");
  });
});

describe("checkAllServersStatus", () => {
  it("should check all servers in parallel", async () => {
    (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
    mockedAxios.get.mockResolvedValue({ status: 200 });

    const tokenMap = new Map([
      ["hetzner", "h-token"],
      ["digitalocean", "do-token"],
    ]);

    const results = await checkAllServersStatus([sampleServer, sampleServer2], tokenMap);

    expect(results).toHaveLength(2);
    expect(results[0].server.name).toBe("coolify-test");
    expect(results[1].server.name).toBe("coolify-prod");
    expect(results[0].serverStatus).toBe("running");
    expect(results[1].serverStatus).toBe("running");
  });

  it("should handle mixed results (success + error)", async () => {
    const runningProvider: CloudProvider = {
      ...mockProvider,
      getServerStatus: jest.fn().mockResolvedValue("running"),
    };
    const errorProvider: CloudProvider = {
      ...mockProvider,
      getServerStatus: jest.fn().mockRejectedValue(new Error("API down")),
    };

    mockedProviderFactory.createProviderWithToken
      .mockReturnValueOnce(runningProvider)
      .mockReturnValueOnce(errorProvider);
    mockedAxios.get.mockResolvedValue({ status: 200 });

    const tokenMap = new Map([
      ["hetzner", "h-token"],
      ["digitalocean", "do-token"],
    ]);

    const results = await checkAllServersStatus([sampleServer, sampleServer2], tokenMap);

    expect(results[0].serverStatus).toBe("running");
    expect(results[0].error).toBeUndefined();
    expect(results[1].serverStatus).toBe("error");
    expect(results[1].error).toBe("API down");
  });

  it("should return unknown (no token) for missing provider tokens", async () => {
    mockedAxios.get.mockResolvedValue({ status: 200 });

    const tokenMap = new Map<string, string>(); // empty map

    const results = await checkAllServersStatus([sampleServer], tokenMap);

    expect(mockedProviderFactory.createProviderWithToken).not.toHaveBeenCalled();
    expect(results[0].serverStatus).toBe("unknown (no token)");
  });

  it("should return empty array for empty server list", async () => {
    const results = await checkAllServersStatus([], new Map());

    expect(results).toEqual([]);
  });
});

// ---- Bare mode tests ----

describe("checkServerStatus - bare mode", () => {
  it("should return platformStatus='n/a' for bare server without calling adapter healthCheck", async () => {
    const bareServer = { ...sampleServer, mode: "bare" as const };
    (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    const result = await checkServerStatus(bareServer, "test-token");

    expect(result.platformStatus).toBe("n/a");
    expect(result.serverStatus).toBe("running");
    expect(result.error).toBeUndefined();
    // axios.get should NOT have been called (no Coolify health check for bare servers)
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("should call adapter healthCheck for coolify server", async () => {
    const coolifyServer = { ...sampleServer, mode: "coolify" as const };
    (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
    mockedAxios.get.mockResolvedValueOnce({ status: 200 });

    const result = await checkServerStatus(coolifyServer, "test-token");

    expect(result.platformStatus).toBe("running");
    expect(mockedAxios.get).toHaveBeenCalled();
  });

  it("should handle mixed bare+coolify servers in checkAllServersStatus", async () => {
    const bareServer = { ...sampleServer, id: "bare-1", name: "bare-one", mode: "bare" as const };
    const coolifyServer = { ...sampleServer2, mode: "coolify" as const };

    (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
    // Only coolify server triggers axios.get
    mockedAxios.get.mockResolvedValueOnce({ status: 200 });

    const tokenMap = new Map([
      ["hetzner", "h-token"],
      ["digitalocean", "do-token"],
    ]);

    const results = await checkAllServersStatus([bareServer, coolifyServer], tokenMap);

    expect(results[0].platformStatus).toBe("n/a"); // bare
    expect(results[1].platformStatus).toBe("running"); // coolify
    // axios.get called only once (for coolify server)
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });
});
