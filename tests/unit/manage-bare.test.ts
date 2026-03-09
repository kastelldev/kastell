/**
 * Tests for bare mode in src/core/manage.ts
 * Covers: addServerRecord with mode='bare' skips Coolify, saves mode:'bare'
 */

import * as config from "../../src/utils/config";
import * as ssh from "../../src/utils/ssh";
import * as providerFactory from "../../src/utils/providerFactory";
import * as tokens from "../../src/core/tokens";
import { addServerRecord } from "../../src/core/manage";
import type { CloudProvider } from "../../src/providers/base";

jest.mock("../../src/utils/config");
jest.mock("../../src/utils/ssh");
jest.mock("../../src/utils/providerFactory");
jest.mock("../../src/core/tokens");

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedSsh = ssh as jest.Mocked<typeof ssh>;
const mockedProviderFactory = providerFactory as jest.Mocked<typeof providerFactory>;
const mockedTokens = tokens as jest.Mocked<typeof tokens>;

const createMockProvider = (): jest.Mocked<CloudProvider> => ({
  name: "hetzner",
  displayName: "Hetzner Cloud",
  validateToken: jest.fn().mockResolvedValue(true),
  getRegions: jest.fn().mockResolvedValue([]),
  getServerSizes: jest.fn().mockResolvedValue([]),
  getAvailableLocations: jest.fn().mockResolvedValue([]),
  getAvailableServerTypes: jest.fn().mockResolvedValue([]),
  createServer: jest.fn().mockResolvedValue({ id: "srv-1", ip: "1.2.3.4", status: "running" }),
  getServerStatus: jest.fn().mockResolvedValue("running"),
  getServerDetails: jest.fn().mockResolvedValue({ id: "srv-1", ip: "1.2.3.4", status: "running" }),
  destroyServer: jest.fn().mockResolvedValue(undefined),
  rebootServer: jest.fn().mockResolvedValue(undefined),
  uploadSshKey: jest.fn().mockResolvedValue("key-1"),
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
  mockedSsh.checkSshAvailable.mockReturnValue(false);
  mockedConfig.getServers.mockReturnValue([]);
  mockedConfig.saveServer.mockImplementation(() => Promise.resolve());
});

describe("addServerRecord — bare mode skips Coolify verification", () => {
  it("should skip Coolify verification when mode='bare' (platformStatus='skipped')", async () => {
    const result = await addServerRecord({
      provider: "hetzner",
      ip: "5.6.7.8",
      name: "bare-server",
      mode: "bare",
    });

    expect(result.success).toBe(true);
    expect(result.platformStatus).toBe("skipped");
    // SSH should NOT be called for bare mode verification
    expect(mockedSsh.sshExec).not.toHaveBeenCalled();
  });

  it("should save ServerRecord with mode:'bare' when mode='bare'", async () => {
    const result = await addServerRecord({
      provider: "hetzner",
      ip: "5.6.7.8",
      name: "bare-server",
      mode: "bare",
    });

    expect(result.success).toBe(true);
    expect(result.server?.mode).toBe("bare");
    expect(mockedConfig.saveServer).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "bare" }),
    );
  });
});

describe("addServerRecord — default mode (backward compat)", () => {
  it("should attempt Coolify verification when mode is not specified", async () => {
    // SSH available so verification is attempted
    mockedSsh.checkSshAvailable.mockReturnValue(true);
    mockedSsh.sshExec = jest.fn().mockResolvedValue({ code: 0, stdout: "200", stderr: "" });

    const result = await addServerRecord({
      provider: "hetzner",
      ip: "5.6.7.8",
      name: "coolify-server",
    });

    expect(result.success).toBe(true);
    // sshExec should be called for Coolify verification
    expect(mockedSsh.sshExec).toHaveBeenCalled();
  });

  it("should save ServerRecord with mode:'coolify' when mode is not specified", async () => {
    const result = await addServerRecord({
      provider: "hetzner",
      ip: "5.6.7.8",
      name: "coolify-server",
      skipVerify: true,
    });

    expect(result.success).toBe(true);
    expect(result.server?.mode).toBe("coolify");
    expect(mockedConfig.saveServer).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "coolify" }),
    );
  });
});
