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
import { provisionServer } from "../../src/core/provision";
import type { CloudProvider } from "../../src/providers/base";

jest.mock("../../src/utils/config");
jest.mock("../../src/utils/ssh");
jest.mock("../../src/utils/providerFactory");
jest.mock("../../src/core/tokens");
jest.mock("../../src/utils/sshKey");
jest.mock("../../src/utils/cloudInit");
jest.mock("../../src/utils/templates");

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedSsh = ssh as jest.Mocked<typeof ssh>;
const mockedProviderFactory = providerFactory as jest.Mocked<typeof providerFactory>;
const mockedTokens = tokens as jest.Mocked<typeof tokens>;
const mockedSshKey = sshKey as jest.Mocked<typeof sshKey>;
const mockedCloudInit = cloudInit as jest.Mocked<typeof cloudInit>;
const mockedTemplates = templates as jest.Mocked<typeof templates>;

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
  getSnapshotCostEstimate: jest.fn().mockReturnValue("$0.01/GB/month"),
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
  mockedCloudInit.getCoolifyCloudInit.mockReturnValue("#!/bin/bash\necho coolify");
  mockedCloudInit.getBareCloudInit.mockReturnValue("#!/bin/bash\necho bare");
  mockedTemplates.getTemplateDefaults.mockReturnValue({ region: "nbg1", size: "cax11" });
  mockedConfig.saveServer.mockImplementation(() => {});
});

describe("provisionServer — bare mode cloud-init selection", () => {
  it("should call getBareCloudInit (not getCoolifyCloudInit) when mode='bare'", async () => {
    const result = await provisionServer({
      provider: "hetzner",
      region: "nbg1",
      size: "cax11",
      name: "bare-srv",
      mode: "bare",
    });

    expect(result.success).toBe(true);
    expect(mockedCloudInit.getBareCloudInit).toHaveBeenCalledWith("bare-srv");
    expect(mockedCloudInit.getCoolifyCloudInit).not.toHaveBeenCalled();
  });

  it("should call getCoolifyCloudInit (not getBareCloudInit) when mode='coolify'", async () => {
    const result = await provisionServer({
      provider: "hetzner",
      region: "nbg1",
      size: "cax11",
      name: "coolify-srv",
      mode: "coolify",
    });

    expect(result.success).toBe(true);
    expect(mockedCloudInit.getCoolifyCloudInit).toHaveBeenCalledWith("coolify-srv");
    expect(mockedCloudInit.getBareCloudInit).not.toHaveBeenCalled();
  });

  it("should call getCoolifyCloudInit when mode is not specified (backward compat)", async () => {
    const result = await provisionServer({
      provider: "hetzner",
      region: "nbg1",
      size: "cax11",
      name: "default-srv",
    });

    expect(result.success).toBe(true);
    expect(mockedCloudInit.getCoolifyCloudInit).toHaveBeenCalledWith("default-srv");
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
