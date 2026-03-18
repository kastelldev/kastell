import * as providerFactory from "../../src/utils/providerFactory";
import * as adapterFactory from "../../src/adapters/factory";
import * as errorMapper from "../../src/utils/errorMapper";
import { updateServer } from "../../src/core/update";
import type { CloudProvider } from "../../src/providers/base";

jest.mock("../../src/utils/providerFactory");
jest.mock("../../src/adapters/factory");
jest.mock("../../src/utils/errorMapper");

const mockedProviderFactory = providerFactory as jest.Mocked<typeof providerFactory>;
const mockedAdapterFactory = adapterFactory as jest.Mocked<typeof adapterFactory>;
const mockedErrorMapper = errorMapper as jest.Mocked<typeof errorMapper>;

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

const manualServer = {
  ...sampleServer,
  id: "manual-abc123",
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
  getSnapshotCostEstimate: jest.fn(),
};

const mockAdapter = {
  name: "coolify",
  getCloudInit: jest.fn(() => ""),
  healthCheck: jest.fn(async () => ({ status: "running" as const })),
  createBackup: jest.fn(async () => ({ success: true })),
  getStatus: jest.fn(async () => ({ platformVersion: "1.0", status: "running" as const })),
  update: jest.fn(async () => ({ success: true, output: "Coolify updated" })),
};

beforeEach(() => {
  jest.resetAllMocks();
  mockedAdapterFactory.getAdapter.mockReturnValue(mockAdapter as any);
  mockedErrorMapper.getErrorMessage.mockImplementation((e) =>
    e instanceof Error ? e.message : String(e),
  );
  mockedErrorMapper.mapProviderError.mockReturnValue(null);
});

describe("updateServer", () => {
  it("should return success when server is running and adapter update succeeds", async () => {
    (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
    mockAdapter.update.mockResolvedValue({ success: true, output: "Updated" });

    const result = await updateServer(sampleServer, "test-token", "coolify");

    expect(result.success).toBe(true);
    expect(result.output).toBe("Updated");
    expect(result.error).toBeUndefined();
    expect(mockedProviderFactory.createProviderWithToken).toHaveBeenCalledWith("hetzner", "test-token");
    expect(mockProvider.getServerStatus).toHaveBeenCalledWith("123");
    expect(mockAdapter.update).toHaveBeenCalledWith("1.2.3.4");
  });

  it("should return error when server is not running", async () => {
    (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("off");
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);

    const result = await updateServer(sampleServer, "test-token", "coolify");

    expect(result.success).toBe(false);
    expect(result.error).toContain("not running");
    expect(result.error).toContain("off");
    expect(mockAdapter.update).not.toHaveBeenCalled();
  });

  it("should skip provider status check for manual servers", async () => {
    mockAdapter.update.mockResolvedValue({ success: true, output: "Updated" });

    const result = await updateServer(manualServer, "", "coolify");

    expect(result.success).toBe(true);
    expect(mockedProviderFactory.createProviderWithToken).not.toHaveBeenCalled();
    expect(mockAdapter.update).toHaveBeenCalledWith("1.2.3.4");
  });

  it("should return error and hint when provider API throws", async () => {
    const apiError = new Error("Unauthorized");
    (mockProvider.getServerStatus as jest.Mock).mockRejectedValue(apiError);
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
    mockedErrorMapper.getErrorMessage.mockReturnValue("Unauthorized");
    mockedErrorMapper.mapProviderError.mockReturnValue("Check your API token");

    const result = await updateServer(sampleServer, "bad-token", "coolify");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Unauthorized");
    expect(result.hint).toBe("Check your API token");
    expect(mockAdapter.update).not.toHaveBeenCalled();
  });

  it("should return error when adapter update fails", async () => {
    (mockProvider.getServerStatus as jest.Mock).mockResolvedValue("running");
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
    mockAdapter.update.mockResolvedValue({ success: false, error: "SSH connection refused" });

    const result = await updateServer(sampleServer, "test-token", "coolify");

    expect(result.success).toBe(false);
    expect(result.error).toBe("SSH connection refused");
  });

  it("should not include hint field when mapProviderError returns null", async () => {
    const apiError = new Error("Some error");
    (mockProvider.getServerStatus as jest.Mock).mockRejectedValue(apiError);
    mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
    mockedErrorMapper.getErrorMessage.mockReturnValue("Some error");
    mockedErrorMapper.mapProviderError.mockReturnValue(null);

    const result = await updateServer(sampleServer, "test-token", "coolify");

    expect(result.success).toBe(false);
    expect(result.hint).toBeUndefined();
  });
});
