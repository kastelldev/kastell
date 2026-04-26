/**
 * Tests for fleet core module (38-01 Task 1)
 * Tests runFleet aggregation, sortRows, getLatestAuditScore.
 */

// Mock external dependencies with inline jest.fn() (NOT jest.requireActual — Node v24 crash risk)
jest.mock("../../src/utils/config.js", () => ({
  getServers: jest.fn(),
}));

jest.mock("../../src/core/health.js", () => ({
  checkServerHealth: jest.fn(),
}));

jest.mock("../../src/core/audit/history.js", () => ({
  loadAuditHistory: jest.fn(),
}));

jest.mock("../../src/core/audit/snapshot.js", () => ({
  listSnapshots: jest.fn(),
  loadSnapshot: jest.fn(),
  saveSnapshot: jest.fn(),
}));

jest.mock("../../src/utils/logger.js", () => ({
  createSpinner: jest.fn(),
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
  },
}));

import { runFleet, sortRows, getLatestAuditScore, getWeakestCategory } from "../../src/core/fleet.js";
import { getServers } from "../../src/utils/config.js";
import { checkServerHealth } from "../../src/core/health.js";
import { loadAuditHistory } from "../../src/core/audit/history.js";
import { listSnapshots, loadSnapshot } from "../../src/core/audit/snapshot.js";
import { createSpinner } from "../../src/utils/logger.js";

const mockedGetServers = getServers as jest.MockedFunction<typeof getServers>;
const mockedCheckServerHealth = checkServerHealth as jest.MockedFunction<typeof checkServerHealth>;
const mockedLoadAuditHistory = loadAuditHistory as jest.MockedFunction<typeof loadAuditHistory>;
const mockedCreateSpinner = createSpinner as jest.MockedFunction<typeof createSpinner>;
const mockedListSnapshots = listSnapshots as jest.MockedFunction<typeof listSnapshots>;
const mockedLoadSnapshot = loadSnapshot as jest.MockedFunction<typeof loadSnapshot>;

const makeSpinner = () => ({
  start: jest.fn(),
  stop: jest.fn(),
  succeed: jest.fn(),
  fail: jest.fn(),
});

const makeServer = (overrides: Partial<{ id: string; name: string; provider: string; ip: string }> = {}) => ({
  id: overrides.id ?? "server-1",
  name: overrides.name ?? "web-01",
  provider: overrides.provider ?? "hetzner",
  ip: overrides.ip ?? "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00.000Z",
  mode: "bare" as const,
});

beforeEach(() => {
  jest.resetAllMocks();
  // Re-setup spinner mock after reset (resetAllMocks clears implementations)
  mockedCreateSpinner.mockReturnValue(makeSpinner() as unknown as ReturnType<typeof createSpinner>);
});

// ─── runFleet ─────────────────────────────────────────────────────────────────

describe("runFleet", () => {
  it("returns empty array and logs when no servers found", async () => {
    mockedGetServers.mockReturnValue([]);

    const rows = await runFleet({});

    expect(rows).toEqual([]);
  });

  it("returns FleetRow[] with name, ip, provider, status, auditScore, responseTime", async () => {
    const server = makeServer();
    mockedGetServers.mockReturnValue([server]);
    mockedCheckServerHealth.mockResolvedValue({
      server,
      status: "healthy",
      responseTime: 42,
    });
    mockedLoadAuditHistory.mockReturnValue([
      {
        serverIp: "1.2.3.4",
        serverName: "web-01",
        timestamp: "2026-01-10T00:00:00.000Z",
        overallScore: 85,
        categoryScores: {},
      },
    ]);

    const rows = await runFleet({});

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "web-01",
      ip: "1.2.3.4",
      provider: "hetzner",
      status: "ONLINE",
      auditScore: 85,
      responseTime: 42,
      errorReason: null,
    });
  });

  it("healthy server produces status ONLINE with numeric auditScore and responseTime", async () => {
    const server = makeServer();
    mockedGetServers.mockReturnValue([server]);
    mockedCheckServerHealth.mockResolvedValue({ server, status: "healthy", responseTime: 120 });
    mockedLoadAuditHistory.mockReturnValue([
      { serverIp: "1.2.3.4", serverName: "web-01", timestamp: "2026-01-01T00:00:00.000Z", overallScore: 72, categoryScores: {} },
    ]);

    const [row] = await runFleet({});

    expect(row.status).toBe("ONLINE");
    expect(typeof row.auditScore).toBe("number");
    expect(typeof row.responseTime).toBe("number");
  });

  it("unhealthy server produces status DEGRADED", async () => {
    const server = makeServer();
    mockedGetServers.mockReturnValue([server]);
    mockedCheckServerHealth.mockResolvedValue({ server, status: "unhealthy", responseTime: 200 });
    mockedLoadAuditHistory.mockReturnValue([]);

    const [row] = await runFleet({});

    expect(row.status).toBe("DEGRADED");
  });

  it("unreachable server produces status OFFLINE with errorReason, no crash", async () => {
    const server = makeServer();
    mockedGetServers.mockReturnValue([server]);
    mockedCheckServerHealth.mockResolvedValue({ server, status: "unreachable", responseTime: 0 });
    mockedLoadAuditHistory.mockReturnValue([]);

    let rows: Awaited<ReturnType<typeof runFleet>>;
    expect(async () => {
      rows = await runFleet({});
    }).not.toThrow();

    rows = await runFleet({});
    expect(rows[0].status).toBe("OFFLINE");
  });

  it("host-key-mismatch server produces status OFFLINE", async () => {
    const server = makeServer();
    mockedGetServers.mockReturnValue([server]);
    mockedCheckServerHealth.mockResolvedValue({ server, status: "host-key-mismatch", responseTime: 0 });
    mockedLoadAuditHistory.mockReturnValue([]);

    const [row] = await runFleet({});

    expect(row.status).toBe("OFFLINE");
  });

  it("server with no audit history shows auditScore as null", async () => {
    const server = makeServer();
    mockedGetServers.mockReturnValue([server]);
    mockedCheckServerHealth.mockResolvedValue({ server, status: "healthy", responseTime: 50 });
    mockedLoadAuditHistory.mockReturnValue([]);

    const [row] = await runFleet({});

    expect(row.auditScore).toBeNull();
  });

  it("Promise.allSettled rejection becomes OFFLINE row (not thrown)", async () => {
    const server = makeServer();
    mockedGetServers.mockReturnValue([server]);
    mockedCheckServerHealth.mockRejectedValue(new Error("unexpected crash"));
    mockedLoadAuditHistory.mockReturnValue([]);

    const rows = await runFleet({});

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("OFFLINE");
    expect(rows[0].errorReason).toBe("Error: unexpected crash");
  });

  it("renders Weakest Category column in terminal when categories option is set", async () => {
    const server = makeServer();
    mockedGetServers.mockReturnValue([server]);
    mockedCheckServerHealth.mockResolvedValue({ server, status: "healthy", responseTime: 10 });
    mockedLoadAuditHistory.mockReturnValue([
      { serverIp: "1.2.3.4", serverName: "web-01", timestamp: "2026-01-10T00:00:00.000Z", overallScore: 72, categoryScores: {} },
    ]);
    mockedListSnapshots.mockResolvedValue([
      { filename: "snap.json", savedAt: "2026-04-26T10:00:00Z", overallScore: 72 },
    ]);
    mockedLoadSnapshot.mockResolvedValue({
      version: 2,
      audit: {
        overallScore: 72,
        categories: [
          { name: "SSH", score: 90, maxScore: 100, checks: [] },
          { name: "Firewall", score: 45, maxScore: 100, checks: [] },
        ],
      },
    } as never);

    const consoleSpy = jest.spyOn(console, "log").mockImplementation();

    await runFleet({ categories: true });

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("Weakest Category");
    expect(output).toContain("Firewall (45)");

    consoleSpy.mockRestore();
  });

  it("outputs JSON to stdout when json option is set", async () => {
    const server = makeServer();
    mockedGetServers.mockReturnValue([server]);
    mockedCheckServerHealth.mockResolvedValue({ server, status: "healthy", responseTime: 10 });
    mockedLoadAuditHistory.mockReturnValue([]);

    const consoleSpy = jest.spyOn(console, "log").mockImplementation();

    const rows = await runFleet({ json: true });

    const jsonOutput = consoleSpy.mock.calls.find((call) => {
      try {
        JSON.parse(call[0]);
        return true;
      } catch {
        return false;
      }
    });

    expect(jsonOutput).toBeTruthy();
    expect(rows).toHaveLength(1);

    consoleSpy.mockRestore();
  });
});

// ─── sortRows ─────────────────────────────────────────────────────────────────

describe("sortRows", () => {
  const rows = [
    { name: "charlie", ip: "3.3.3.3", provider: "vultr", status: "ONLINE" as const, auditScore: 50, responseTime: 100, errorReason: null },
    { name: "alpha", ip: "1.1.1.1", provider: "hetzner", status: "ONLINE" as const, auditScore: 90, responseTime: 50, errorReason: null },
    { name: "bravo", ip: "2.2.2.2", provider: "digitalocean", status: "OFFLINE" as const, auditScore: null, responseTime: null, errorReason: "timeout" },
  ];

  it("sortRows('score') sorts descending, null scores last", () => {
    const sorted = sortRows(rows, "score");

    expect(sorted[0].auditScore).toBe(90);
    expect(sorted[1].auditScore).toBe(50);
    expect(sorted[2].auditScore).toBeNull();
  });

  it("sortRows('name') sorts alphabetically A-Z", () => {
    const sorted = sortRows(rows, "name");

    expect(sorted[0].name).toBe("alpha");
    expect(sorted[1].name).toBe("bravo");
    expect(sorted[2].name).toBe("charlie");
  });

  it("sortRows('provider') sorts alphabetically A-Z", () => {
    const sorted = sortRows(rows, "provider");

    expect(sorted[0].provider).toBe("digitalocean");
    expect(sorted[1].provider).toBe("hetzner");
    expect(sorted[2].provider).toBe("vultr");
  });

  it("sortRows with unknown field defaults to name sort", () => {
    const sorted = sortRows(rows, "unknown");

    expect(sorted[0].name).toBe("alpha");
  });
});

// ─── getLatestAuditScore ──────────────────────────────────────────────────────

describe("getLatestAuditScore", () => {
  it("returns null when no history entries", () => {
    mockedLoadAuditHistory.mockReturnValue([]);

    const score = getLatestAuditScore("1.2.3.4");

    expect(score).toBeNull();
  });

  it("returns latest overallScore from history (sorted by timestamp desc)", () => {
    mockedLoadAuditHistory.mockReturnValue([
      { serverIp: "1.2.3.4", serverName: "web-01", timestamp: "2026-01-05T00:00:00.000Z", overallScore: 60, categoryScores: {} },
      { serverIp: "1.2.3.4", serverName: "web-01", timestamp: "2026-01-10T00:00:00.000Z", overallScore: 80, categoryScores: {} },
      { serverIp: "1.2.3.4", serverName: "web-01", timestamp: "2026-01-01T00:00:00.000Z", overallScore: 40, categoryScores: {} },
    ]);

    const score = getLatestAuditScore("1.2.3.4");

    expect(score).toBe(80);
  });
});

// ─── getWeakestCategory ──────────────────────────────────────────────────────

describe("getWeakestCategory", () => {
  it("should return the lowest scoring category from latest snapshot", async () => {
    mockedListSnapshots.mockResolvedValue([
      { filename: "2026-04-26-auto.json", savedAt: "2026-04-26T10:00:00Z", overallScore: 72 },
    ]);
    mockedLoadSnapshot.mockResolvedValue({
      version: 2,
      audit: {
        overallScore: 72,
        categories: [
          { name: "SSH", score: 90, maxScore: 100, checks: [] },
          { name: "Firewall", score: 45, maxScore: 100, checks: [] },
          { name: "Kernel", score: 80, maxScore: 100, checks: [] },
        ],
      },
    } as never);

    const result = await getWeakestCategory("1.2.3.4");

    expect(result).toEqual({ name: "Firewall", score: 45 });
  });

  it("should return null when no snapshots exist", async () => {
    mockedListSnapshots.mockResolvedValue([]);

    const result = await getWeakestCategory("1.2.3.4");

    expect(result).toBeNull();
  });

  it("should return null when snapshot has no categories", async () => {
    mockedListSnapshots.mockResolvedValue([
      { filename: "snap.json", savedAt: "2026-04-26T10:00:00Z", overallScore: 0 },
    ]);
    mockedLoadSnapshot.mockResolvedValue({
      version: 2,
      audit: { overallScore: 0, categories: [] },
    } as never);

    const result = await getWeakestCategory("1.2.3.4");

    expect(result).toBeNull();
  });

  it("should return null when loadSnapshot returns null", async () => {
    mockedListSnapshots.mockResolvedValue([
      { filename: "corrupt.json", savedAt: "2026-04-26T10:00:00Z", overallScore: 0 },
    ]);
    mockedLoadSnapshot.mockResolvedValue(null);

    const result = await getWeakestCategory("1.2.3.4");

    expect(result).toBeNull();
  });

  it("should return null when listSnapshots throws", async () => {
    mockedListSnapshots.mockRejectedValue(new Error("disk error"));

    const result = await getWeakestCategory("1.2.3.4");

    expect(result).toBeNull();
  });
});
