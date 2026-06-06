import axios from "axios";
import * as config from "../../src/utils/config";
import * as providerFactory from "../../src/utils/providerFactory";
import * as ssh from "../../src/utils/ssh";
import { handleServerInfo } from "../../src/mcp/tools/serverInfo";
import type { CloudProvider } from "../../src/providers/base";

jest.mock("../../src/utils/config");
jest.mock("../../src/utils/providerFactory");
jest.mock("../../src/utils/ssh");
jest.mock("../../src/core/tokenBuffer", () => ({
  storeToken: jest.fn(),
  readToken: jest.fn().mockReturnValue(undefined),
  clearAllTokens: jest.fn(),
  registerCleanupHandlers: jest.fn(),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedConfig = config as jest.Mocked<typeof config>;
const mockedProviderFactory = providerFactory as jest.Mocked<typeof providerFactory>;
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

const mockProvider: CloudProvider = {
  name: "hetzner",
  displayName: "Hetzner Cloud",
  validateToken: jest.fn(),
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
  findServerByIp: jest.fn().mockResolvedValue(null),
};

const originalEnv = process.env;

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...originalEnv };
  mockedSsh.assertValidIp.mockImplementation(() => {});
});

afterAll(() => {
  process.env = originalEnv;
});

describe("F-024: server_info status running counter", () => {
  /**
   * Regression test for F-024: summary.running shows 0 even when the cloud
   * server is running, because the counter only checks platformStatus
   * (Coolify/Dokploy HTTP probe) and ignores serverStatus (cloud provider view).
   *
   * Scenario: Server is running in Hetzner (serverStatus = "running") but
   * Coolify is unreachable (platformStatus = "not reachable"). The running
   * counter should count servers where EITHER status indicates running.
   */

  it("should count server as running when serverStatus=running even if platformStatus=not reachable", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(sampleServer);
    // Cloud provider says the server is running
    (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
    // But Coolify is not responding (server itself is up, platform is down)
    mockedAxios.get.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await handleServerInfo({ action: "status", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    // The server IS running in the cloud — counter must reflect that
    expect(data.summary.running).toBe(1);
    expect(data.results[0].serverStatus).toBe("running");
    expect(data.results[0].platformStatus).toBe("not reachable");
  });

  it("should count server as running when platformStatus=running (Coolify responding)", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(sampleServer);
    (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
    mockedAxios.get.mockResolvedValue({ status: 200 });

    const result = await handleServerInfo({ action: "status", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(data.summary.running).toBe(1);
    expect(data.results[0].platformStatus).toBe("running");
  });

  it("should count multiple servers correctly — one running in cloud, one not", async () => {
    const runningServer = { ...sampleServer };
    const stoppedServer = { ...sampleServer, id: "456", name: "stopped-server" };

    process.env.HETZNER_TOKEN = "test-token";
    mockedConfig.getServers.mockReturnValue([runningServer, stoppedServer]);
    (mockProvider.getServerStatus as jest.Mock)
      .mockResolvedValueOnce("running")
      .mockResolvedValueOnce("off");
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
    // Coolify responds for running server, not for stopped
    mockedAxios.get
      .mockResolvedValueOnce({ status: 200 })
      .mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await handleServerInfo({ action: "status" });
    const data = JSON.parse(result.content[0].text);

    expect(data.summary.total).toBe(2);
    // Server with serverStatus="running" should be counted as running
    expect(data.summary.running).toBe(1);
    // The running server's platformStatus can be anything — it's the cloud status that matters
  });

  it("should not count server as running when both serverStatus and platformStatus are not running", async () => {
    process.env.HETZNER_TOKEN = "test-token";
    mockedConfig.getServers.mockReturnValue([sampleServer]);
    mockedConfig.findServer.mockReturnValue(sampleServer);
    (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("initializing");
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
    mockedAxios.get.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await handleServerInfo({ action: "status", server: "coolify-test" });
    const data = JSON.parse(result.content[0].text);

    expect(data.summary.running).toBe(0);
    expect(data.results[0].serverStatus).toBe("initializing");
    expect(data.results[0].platformStatus).toBe("not reachable");
  });
});
