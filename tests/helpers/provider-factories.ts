import type { CloudProvider } from "../../src/providers/base.js";
import type { SnapshotInfo } from "../../src/types/index.js";

/**
 * Default snapshot for mock provider responses.
 */
const DEFAULT_SNAPSHOT: SnapshotInfo = {
  id: "snap-001",
  serverId: "server-001",
  name: "test-snapshot",
  status: "available",
  sizeGb: 20,
  createdAt: "2026-01-01T00:00:00.000Z",
  costPerMonth: "$0.01/GB/month",
};

/**
 * createMockProvider — creates a jest.Mocked<CloudProvider> with sensible defaults.
 *
 * Centralizes provider mock construction so test files don't repeat the full
 * interface. Pass method overrides via the second parameter.
 *
 * Usage:
 *   const provider = createMockProvider();
 *   provider.createServer.mockResolvedValue({ id: "srv-99", ip: "9.9.9.9", status: "running" });
 */
export function createMockProvider(
  overrides: Partial<jest.Mocked<CloudProvider>> = {},
): jest.Mocked<CloudProvider> {
  const base: jest.Mocked<CloudProvider> = {
    name: "hetzner",
    displayName: "Hetzner Cloud",
    validateToken: jest.fn().mockResolvedValue(true),
    getRegions: jest.fn().mockReturnValue([]),
    getServerSizes: jest.fn().mockReturnValue([]),
    getAvailableLocations: jest.fn().mockResolvedValue([]),
    getAvailableServerTypes: jest.fn().mockResolvedValue([]),
    uploadSshKey: jest.fn().mockResolvedValue("key-001"),
    createServer: jest.fn().mockResolvedValue({ id: "server-001", ip: "1.2.3.4", status: "running" }),
    getServerStatus: jest.fn().mockResolvedValue("running"),
    getServerDetails: jest.fn().mockResolvedValue({ id: "server-001", ip: "1.2.3.4", status: "running" }),
    destroyServer: jest.fn().mockResolvedValue(undefined),
    rebootServer: jest.fn().mockResolvedValue(undefined),
    createSnapshot: jest.fn().mockResolvedValue(DEFAULT_SNAPSHOT),
    listSnapshots: jest.fn().mockResolvedValue([]),
    deleteSnapshot: jest.fn().mockResolvedValue(undefined),
    restoreSnapshot: jest.fn().mockResolvedValue(undefined),
    getSnapshotCostEstimate: jest.fn().mockResolvedValue("$0.01/GB/month"),
  };

  return { ...base, ...overrides };
}
