/**
 * Tests for bare mode provisioning in src/core/provision.ts
 * Covers: mode selection for cloud-init, mode saved to ServerRecord
 */

import * as config from "../../src/utils/config";
import * as ssh from "../../src/utils/ssh";
import * as providerFactory from "../../src/utils/providerFactory";
import * as tokens from "../../src/core/tokens";
import * as sshKey from "../../src/utils/sshKey";
import * as cloudInit from "../../src/utils/cloudInit";
import * as templates from "../../src/utils/templates";
import * as adapterFactory from "../../src/adapters/factory";
import { provisionServer, uploadSshKeyBestEffort } from "../../src/core/provision";
import type { CloudProvider } from "../../src/providers/base";

jest.mock("../../src/utils/config");
jest.mock("../../src/utils/ssh");
jest.mock("../../src/utils/providerFactory");
jest.mock("../../src/core/tokens");
jest.mock("../../src/utils/sshKey");
jest.mock("../../src/utils/cloudInit");
jest.mock("../../src/utils/templates");
jest.mock("../../src/adapters/factory");

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedSsh = ssh as jest.Mocked<typeof ssh>;
const mockedProviderFactory = providerFactory as jest.Mocked<typeof providerFactory>;
const mockedTokens = tokens as jest.Mocked<typeof tokens>;
const mockedSshKey = sshKey as jest.Mocked<typeof sshKey>;
const mockedCloudInit = cloudInit as jest.Mocked<typeof cloudInit>;
const mockedTemplates = templates as jest.Mocked<typeof templates>;
const mockedAdapterFactory = adapterFactory as jest.Mocked<typeof adapterFactory>;

const createMockProvider = (): jest.Mocked<CloudProvider> => ({
  name: "hetzner",
  displayName: "Hetzner Cloud",
  validateToken: jest.fn().mockResolvedValue(true),
  getRegions: jest.fn().mockResolvedValue([]),
  getServerSizes: jest.fn().mockResolvedValue([]),
  getAvailableLocations: jest.fn().mockResolvedValue([]),
  getAvailableServerTypes: jest.fn().mockResolvedValue([]),
  createServer: jest.fn().mockResolvedValue({ id: "srv-456", ip: "1.2.3.4", status: "running" }),
  getServerStatus: jest.fn().mockResolvedValue("running"),
  getServerDetails: jest.fn().mockResolvedValue({ id: "srv-456", ip: "1.2.3.4", status: "running" }),
  destroyServer: jest.fn().mockResolvedValue(undefined),
  rebootServer: jest.fn().mockResolvedValue(undefined),
  uploadSshKey: jest.fn().mockResolvedValue("key-111"),
  createSnapshot: jest.fn().mockResolvedValue({ id: "snap-1", name: "test", status: "available", sizeGb: 20, createdAt: "", serverId: "", costPerMonth: "$0" }),
  listSnapshots: jest.fn().mockResolvedValue([]),
  deleteSnapshot: jest.fn().mockResolvedValue(undefined),
  restoreSnapshot: jest.fn().mockResolvedValue(undefined),
  getSnapshotCostEstimate: jest.fn().mockReturnValue("$0.01/GB/month"),
  findServerByIp: jest.fn().mockResolvedValue(null),
});

let mockProvider: jest.Mocked<CloudProvider>;

beforeEach(() => {
  jest.clearAllMocks();
  mockProvider = createMockProvider();
  mockedProviderFactory.createProviderWithToken.mockReturnValue(mockProvider);
  mockedTokens.getProviderToken.mockReturnValue("test-token");
  mockedSsh.assertValidIp.mockImplementation(() => {});
  mockedSshKey.findLocalSshKey.mockReturnValue("ssh-ed25519 AAAA test@host");
  mockedSshKey.getSshKeyName.mockReturnValue("kastell-test");
  mockedCloudInit.getBareCloudInit.mockReturnValue("#!/bin/bash\necho bare");
  mockedTemplates.getTemplateDefaults.mockReturnValue({ region: "nbg1", size: "cax11" });
  mockedConfig.saveServer.mockImplementation(() => Promise.resolve());
  const mockAdapter = { name: "coolify", getCloudInit: jest.fn().mockReturnValue("#!/bin/bash\necho coolify") };
  mockedAdapterFactory.getAdapter.mockReturnValue(mockAdapter as never);
});

describe("provisionServer — bare mode cloud-init selection", () => {
  it("should call getBareCloudInit when mode='bare'", async () => {
    const result = await provisionServer({
      provider: "hetzner",
      region: "nbg1",
      size: "cax11",
      name: "bare-srv",
      mode: "bare",
    });

    expect(result.success).toBe(true);
    expect(mockedCloudInit.getBareCloudInit).toHaveBeenCalledWith("bare-srv");
    // getCoolifyCloudInit removed (dead code)
  });

  it("should route through adapter getCloudInit (not getBareCloudInit) when mode='coolify'", async () => {
    const result = await provisionServer({
      provider: "hetzner",
      region: "nbg1",
      size: "cax11",
      name: "coolify-srv",
      mode: "coolify",
    });

    expect(result.success).toBe(true);
    expect(mockedAdapterFactory.getAdapter).toHaveBeenCalledWith("coolify");
    expect(mockedAdapterFactory.getAdapter("coolify").getCloudInit).toHaveBeenCalledWith("coolify-srv", expect.any(String));
    expect(mockedCloudInit.getBareCloudInit).not.toHaveBeenCalled();
  });

  it("should route through adapter getCloudInit when mode is not specified (backward compat)", async () => {
    const result = await provisionServer({
      provider: "hetzner",
      region: "nbg1",
      size: "cax11",
      name: "default-srv",
    });

    expect(result.success).toBe(true);
    expect(mockedAdapterFactory.getAdapter).toHaveBeenCalledWith("coolify");
    expect(mockedAdapterFactory.getAdapter("coolify").getCloudInit).toHaveBeenCalledWith("default-srv", expect.any(String));
    expect(mockedCloudInit.getBareCloudInit).not.toHaveBeenCalled();
  });
});

describe("provisionServer — bare mode saves mode:'bare' to ServerRecord", () => {
  it("should save ServerRecord with mode:'bare' when mode='bare'", async () => {
    const result = await provisionServer({
      provider: "hetzner",
      region: "nbg1",
      size: "cax11",
      name: "bare-srv",
      mode: "bare",
    });

    expect(result.success).toBe(true);
    expect(result.server?.mode).toBe("bare");
    expect(mockedConfig.saveServer).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "bare" }),
    );
  });

  it("should save ServerRecord with mode:'coolify' when mode is not specified (backward compat)", async () => {
    const result = await provisionServer({
      provider: "hetzner",
      region: "nbg1",
      size: "cax11",
      name: "default-srv",
    });

    expect(result.success).toBe(true);
    expect(result.server?.mode).toBe("coolify");
    expect(mockedConfig.saveServer).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "coolify" }),
    );
  });

  it("should save ServerRecord with mode:'coolify' when mode='coolify'", async () => {
    const result = await provisionServer({
      provider: "hetzner",
      region: "nbg1",
      size: "cax11",
      name: "coolify-srv",
      mode: "coolify",
    });

    expect(result.success).toBe(true);
    expect(result.server?.mode).toBe("coolify");
  });
});

// ─── Phase 74: Error paths ──────────────────────────────────────────────────

describe("provisionServer - error paths", () => {
  it("should fail for invalid provider", async () => {
    // Arrange — isValidProvider is real (not mocked), rejects unknown providers
    // Act
    const result = await provisionServer({
      provider: "unknown-cloud",
      name: "test-srv",
      mode: "bare",
    });
    // Assert
    expect(result.success).toBe(false);
    expect(result.error).toContain("unknown-cloud");
  });

  it("should fail for invalid server name", async () => {
    // Arrange — validateServerName is real, rejects single char
    // Act
    const result = await provisionServer({
      provider: "hetzner",
      name: "A",
      mode: "bare",
    });
    // Assert
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Server name/i);
  });

  it("should fail when region/size cannot be resolved", async () => {
    // Arrange
    mockedTemplates.getTemplateDefaults.mockReturnValue(null as never);
    // Act
    const result = await provisionServer({
      provider: "hetzner",
      name: "test-srv",
      mode: "bare",
    });
    // Assert
    expect(result.success).toBe(false);
    expect(result.error).toContain("Could not resolve region/size");
  });

  it("should fail when no API token found", async () => {
    // Arrange
    mockedTokens.getProviderToken.mockReturnValue(null as never);
    // Act
    const result = await provisionServer({
      provider: "hetzner",
      name: "test-srv",
      mode: "bare",
    });
    // Assert
    expect(result.success).toBe(false);
    expect(result.error).toContain("No API token found");
  });

  it("should fail when token validation returns false", async () => {
    // Arrange
    mockProvider.validateToken.mockResolvedValueOnce(false);
    // Act
    const result = await provisionServer({
      provider: "hetzner",
      name: "test-srv",
      mode: "bare",
    });
    // Assert
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid API token");
  });

  it("should fail when token validation throws", async () => {
    // Arrange
    mockProvider.validateToken.mockRejectedValueOnce(new Error("Network timeout"));
    // Act
    const result = await provisionServer({
      provider: "hetzner",
      name: "test-srv",
      mode: "bare",
    });
    // Assert
    expect(result.success).toBe(false);
    expect(result.error).toContain("Token validation failed");
  });

  it("should fail when server creation throws", async () => {
    // Arrange
    mockProvider.createServer.mockRejectedValueOnce(new Error("Insufficient quota"));
    // Act
    const result = await provisionServer({
      provider: "hetzner",
      name: "test-srv",
      mode: "bare",
    });
    // Assert
    expect(result.success).toBe(false);
    expect(result.error).toContain("Server creation failed");
  });
});

describe("provisionServer - boot and IP edge cases", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should fail when boot times out", async () => {
    // Arrange — server never reaches running state
    mockProvider.getServerStatus.mockResolvedValue("initializing");
    // Act
    const promise = provisionServer({
      provider: "hetzner",
      name: "test-srv",
      mode: "bare",
    });
    // Advance enough time for all boot polling attempts
    for (let i = 0; i < 40; i++) {
      await jest.advanceTimersByTimeAsync(5000);
    }
    const result = await promise;
    // Assert
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/did not reach running state/);
    expect(mockedConfig.saveServer).toHaveBeenCalled();
  });

  it("should mark IP as pending when assertValidIp throws on immediate IP", async () => {
    // Arrange
    mockProvider.createServer.mockResolvedValueOnce({
      id: "srv-1",
      ip: "999.999.999.999",
      status: "running",
    });
    mockedSsh.assertValidIp.mockImplementationOnce(() => {
      throw new Error("Invalid IP");
    });
    // Act
    const promise = provisionServer({
      provider: "hetzner",
      name: "test-srv",
      mode: "bare",
    });
    for (let i = 0; i < 40; i++) {
      await jest.advanceTimersByTimeAsync(5000);
    }
    const result = await promise;
    // Assert
    expect(result.success).toBe(true);
    expect(result.hint).toContain("IP address not yet assigned");
  });

  it("should return hint when IP is still pending after polling", async () => {
    // Arrange
    mockProvider.createServer.mockResolvedValueOnce({
      id: "srv-1",
      ip: "pending",
      status: "running",
    });
    mockProvider.getServerDetails.mockResolvedValue({
      id: "srv-1",
      ip: "pending",
      status: "running",
    });
    // Act
    const promise = provisionServer({
      provider: "hetzner",
      name: "test-srv",
      mode: "bare",
    });
    for (let i = 0; i < 80; i++) {
      await jest.advanceTimersByTimeAsync(5000);
    }
    const result = await promise;
    // Assert
    expect(result.success).toBe(true);
    expect(result.hint).toContain("IP address not yet assigned");
  });
});

describe("uploadSshKeyBestEffort - edge cases", () => {
  it("should return empty array when SSH key generation fails", async () => {
    // Arrange
    mockedSshKey.findLocalSshKey.mockReturnValue(null as never);
    mockedSshKey.generateSshKey.mockReturnValue(null as never);
    // Act
    const result = await uploadSshKeyBestEffort(mockProvider);
    // Assert
    expect(result).toEqual([]);
  });

  it("should return empty array when SSH key upload fails", async () => {
    // Arrange
    mockedSshKey.findLocalSshKey.mockReturnValue("ssh-ed25519 AAAA test@host");
    mockProvider.uploadSshKey.mockRejectedValueOnce(new Error("Upload failed"));
    // Act
    const result = await uploadSshKeyBestEffort(mockProvider);
    // Assert
    expect(result).toEqual([]);
  });
});
