import { Bot } from "grammy";
import * as configUtils from "../../src/utils/config";
import * as snapshotModule from "../../src/core/audit/snapshot";
import * as guardModule from "../../src/core/guard";
import * as doctorModule from "../../src/core/doctor";
import { registerHandlers } from "../../src/core/bot/handlers";
import type { SnapshotFile, SnapshotListEntry } from "../../src/core/audit/types";
import type { MetricSnapshot } from "../../src/types/index";

jest.mock("../../src/utils/config");
jest.mock("../../src/core/audit/snapshot");
jest.mock("../../src/core/guard");
jest.mock("../../src/core/doctor");
jest.mock("../../src/utils/version", () => ({
  KASTELL_VERSION: "2.2.0",
  clearVersionCache: jest.fn(),
}));

const mockedConfig = configUtils as jest.Mocked<typeof configUtils>;
const mockedSnapshot = snapshotModule as jest.Mocked<typeof snapshotModule>;
const mockedGuard = guardModule as jest.Mocked<typeof guardModule>;
const mockedDoctor = doctorModule as jest.Mocked<typeof doctorModule>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createTestBot(): { bot: Bot; sentMessages: Array<{ text: string }> } {
  const bot = new Bot("test-token", {
    botInfo: {
      id: 1,
      is_bot: true,
      first_name: "TestBot",
      username: "test_bot",
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
    },
  });
  const sentMessages: Array<{ text: string }> = [];

  bot.api.config.use((prev, method, payload) => {
    if (method === "sendMessage") {
      const p = payload as { text?: string };
      sentMessages.push({ text: p.text ?? "" });
    }
    return { ok: true, result: true } as ReturnType<typeof prev>;
  });

  registerHandlers(bot);
  return { bot, sentMessages };
}

function makeCommandUpdate(command: string, args: string, chatId = 12345) {
  const text = args ? `/${command} ${args}` : `/${command}`;
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: "private" as const, first_name: "Test" },
      from: { id: chatId, is_bot: false, first_name: "Test" },
      text,
      entities: [
        {
          type: "bot_command" as const,
          offset: 0,
          length: command.length + 1,
        },
      ],
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedGuard.getGuardStates.mockReturnValue({});
  mockedConfig.getServers.mockReturnValue([]);
  mockedDoctor.loadMetricsHistory.mockReset();
});

// ─── /audit ───────────────────────────────────────────────────────────────────

describe("/audit handler", () => {
  it("replies with usage message when no argument", async () => {
    const { bot, sentMessages } = createTestBot();
    await bot.handleUpdate(makeCommandUpdate("audit", ""));
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain("Usage: /audit");
  });

  it("replies with not-found when server unknown", async () => {
    mockedConfig.findServer.mockReturnValue(undefined);
    const { bot, sentMessages } = createTestBot();
    await bot.handleUpdate(makeCommandUpdate("audit", "unknown-srv"));
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain("Server not found: unknown-srv");
  });

  it("replies with no-snapshot message when server has no snapshots", async () => {
    const server = { id: "s1", name: "srv", provider: "hetzner", ip: "1.2.3.4", region: "eu", size: "cx11", createdAt: "2026-01-01", mode: "bare" as const };
    mockedConfig.findServer.mockReturnValue(server);
    mockedSnapshot.listSnapshots.mockResolvedValue([]);

    const { bot, sentMessages } = createTestBot();
    await bot.handleUpdate(makeCommandUpdate("audit", "srv"));
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain("No audit snapshot yet");
  });

  it("replies with failed-to-read message when snapshot load returns null", async () => {
    const server = { id: "s1", name: "srv", provider: "hetzner", ip: "1.2.3.4", region: "eu", size: "cx11", createdAt: "2026-01-01", mode: "bare" as const };
    mockedConfig.findServer.mockReturnValue(server);
    mockedSnapshot.listSnapshots.mockResolvedValue([{ filename: "2026-03-27.json", savedAt: new Date().toISOString(), overallScore: 70 }]);
    mockedSnapshot.loadSnapshot.mockResolvedValue(null);

    const { bot, sentMessages } = createTestBot();
    await bot.handleUpdate(makeCommandUpdate("audit", "srv"));
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain("Failed to read snapshot");
  });

  it("replies with formatted audit when server and snapshot exist", async () => {
    const server = { id: "s1", name: "my-srv", provider: "hetzner", ip: "1.2.3.4", region: "eu", size: "cx11", createdAt: "2026-01-01", mode: "bare" as const };
    mockedConfig.findServer.mockReturnValue(server);

    const entry: SnapshotListEntry = { filename: "2026-03-27.json", savedAt: new Date().toISOString(), overallScore: 70 };
    mockedSnapshot.listSnapshots.mockResolvedValue([entry]);

    const snapshot: SnapshotFile = {
      schemaVersion: 2,
      savedAt: new Date().toISOString(),
      audit: {
        serverName: "my-srv",
        serverIp: "1.2.3.4",
        platform: "bare",
        timestamp: new Date().toISOString(),
        auditVersion: "1.14.0",
        overallScore: 70,
        categories: [
          { name: "SSH", score: 60, maxScore: 100, checks: [] },
          { name: "FW", score: 80, maxScore: 100, checks: [] },
        ],
        quickWins: [],
      },
    };
    mockedSnapshot.loadSnapshot.mockResolvedValue(snapshot);

    const { bot, sentMessages } = createTestBot();
    await bot.handleUpdate(makeCommandUpdate("audit", "my-srv"));
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain("70/100");
    expect(sentMessages[0].text).toContain("my-srv");
  });
});

// ─── /status ──────────────────────────────────────────────────────────────────

describe("/status handler", () => {
  it("replies with usage message when no argument", async () => {
    const { bot, sentMessages } = createTestBot();
    await bot.handleUpdate(makeCommandUpdate("status", ""));
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain("Usage: /status");
  });

  it("replies with not-found when server unknown", async () => {
    mockedConfig.findServer.mockReturnValue(undefined);
    const { bot, sentMessages } = createTestBot();
    await bot.handleUpdate(makeCommandUpdate("status", "unknown"));
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain("Server not found: unknown");
  });

  it("replies with status message when server exists", async () => {
    const server = { id: "s1", name: "my-srv", provider: "hetzner", ip: "1.2.3.4", region: "eu", size: "cx11", createdAt: "2026-01-01", mode: "coolify" as const };
    mockedConfig.findServer.mockReturnValue(server);
    mockedGuard.getGuardStates.mockReturnValue({ "my-srv": { installedAt: "2026-01-01T00:00:00Z", cronExpr: "*/5 * * * *" } } as unknown as ReturnType<typeof mockedGuard.getGuardStates>);
    mockedSnapshot.listSnapshots.mockResolvedValue([{ filename: "2026-03-27.json", savedAt: new Date(Date.now() - 86400000).toISOString(), overallScore: 85 }]);

    const { bot, sentMessages } = createTestBot();
    await bot.handleUpdate(makeCommandUpdate("status", "my-srv"));
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain("my-srv");
    expect(sentMessages[0].text).toContain("Guard:");
  });

  it("replies with status message when server has no guard state", async () => {
    const server = { id: "s1", name: "bare-srv", provider: "hetzner", ip: "5.6.7.8", region: "eu", size: "cx11", createdAt: "2026-01-01", mode: "bare" as const };
    mockedConfig.findServer.mockReturnValue(server);
    mockedGuard.getGuardStates.mockReturnValue({});
    mockedSnapshot.listSnapshots.mockResolvedValue([]);

    const { bot, sentMessages } = createTestBot();
    await bot.handleUpdate(makeCommandUpdate("status", "bare-srv"));
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain("bare-srv");
    expect(sentMessages[0].text).toContain("Guard: not installed");
    expect(sentMessages[0].text).toContain("no snapshot");
  });
});

// ─── /health ──────────────────────────────────────────────────────────────────

describe("/health handler", () => {
  it("replies with fleet overview when no argument and no servers", async () => {
    mockedConfig.getServers.mockReturnValue([]);
    const { bot, sentMessages } = createTestBot();
    await bot.handleUpdate(makeCommandUpdate("health", ""));
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain("No servers registered");
  });

  it("treats argument as single-server status alias when arg provided", async () => {
    const server = { id: "s1", name: "single-srv", provider: "hetzner", ip: "1.2.3.4", region: "eu", size: "cx11", createdAt: "2026-01-01", mode: "coolify" as const };
    mockedConfig.findServer.mockReturnValue(server);
    mockedGuard.getGuardStates.mockReturnValue({});
    mockedSnapshot.listSnapshots.mockResolvedValue([]);

    const { bot, sentMessages } = createTestBot();
    await bot.handleUpdate(makeCommandUpdate("health", "single-srv"));
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain("single-srv");
  });

  it("replies with not-found when single-server arg is unknown", async () => {
    mockedConfig.findServer.mockReturnValue(undefined);
    const { bot, sentMessages } = createTestBot();
    await bot.handleUpdate(makeCommandUpdate("health", "unknown"));
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain("Server not found: unknown");
  });

  it("replies with fleet overview when no argument and servers exist", async () => {
    const servers = [
      { id: "s1", name: "srv-a", provider: "hetzner", ip: "1.2.3.4", region: "eu", size: "cx11", createdAt: "2026-01-01", mode: "coolify" as const },
      { id: "s2", name: "srv-b", provider: "digitalocean", ip: "2.3.4.5", region: "nyc", size: "s-1vcpu-1gb", createdAt: "2026-01-01", mode: "bare" as const },
    ];
    mockedConfig.getServers.mockReturnValue(servers);
    mockedGuard.getGuardStates.mockReturnValue({ "srv-a": { installedAt: "2026-01-01T00:00:00Z", cronExpr: "*/5 * * * *" } } as unknown as ReturnType<typeof mockedGuard.getGuardStates>);
    mockedSnapshot.listSnapshots
      .mockResolvedValueOnce([{ filename: "a.json", savedAt: new Date().toISOString(), overallScore: 90 }])
      .mockResolvedValueOnce([]);

    const { bot, sentMessages } = createTestBot();
    await bot.handleUpdate(makeCommandUpdate("health", ""));
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain("srv-a");
    expect(sentMessages[0].text).toContain("srv-b");
    expect(sentMessages[0].text).toContain("2 servers");
  });
});

// ─── /doctor ──────────────────────────────────────────────────────────────────

describe("/doctor handler", () => {
  it("replies with usage message when no argument", async () => {
    const { bot, sentMessages } = createTestBot();
    await bot.handleUpdate(makeCommandUpdate("doctor", ""));
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain("Usage: /doctor");
  });

  it("replies with not-found when server unknown", async () => {
    mockedConfig.findServer.mockReturnValue(undefined);
    const { bot, sentMessages } = createTestBot();
    await bot.handleUpdate(makeCommandUpdate("doctor", "unknown"));
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain("Server not found: unknown");
  });

  it("replies with no-doctor-data when metrics history is empty", async () => {
    const server = { id: "s1", name: "srv", provider: "hetzner", ip: "1.2.3.4", region: "eu", size: "cx11", createdAt: "2026-01-01", mode: "bare" as const };
    mockedConfig.findServer.mockReturnValue(server);
    mockedDoctor.loadMetricsHistory.mockReturnValue([]);

    const { bot, sentMessages } = createTestBot();
    await bot.handleUpdate(makeCommandUpdate("doctor", "srv"));
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain("No doctor data");
  });

  it("replies with disk critical finding when disk >= 90%", async () => {
    const server = { id: "s1", name: "srv", provider: "hetzner", ip: "1.2.3.4", region: "eu", size: "cx11", createdAt: "2026-01-01", mode: "bare" as const };
    mockedConfig.findServer.mockReturnValue(server);
    mockedDoctor.loadMetricsHistory.mockImplementation(() => [{
      timestamp: new Date().toISOString(),
      diskPct: 92,
      ramPct: 40,
      cpuLoad1: 0.5,
      ncpu: 4,
    } as MetricSnapshot]);

    const { bot, sentMessages } = createTestBot();
    await bot.handleUpdate(makeCommandUpdate("doctor", "srv"));
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain("critical");
    expect(sentMessages[0].text).toContain("Disk usage high: 92%");
  });

  it("replies with disk warning finding when disk >= 80% and < 90%", async () => {
    const server = { id: "s1", name: "srv", provider: "hetzner", ip: "1.2.3.4", region: "eu", size: "cx11", createdAt: "2026-01-01", mode: "bare" as const };
    mockedConfig.findServer.mockReturnValue(server);
    mockedDoctor.loadMetricsHistory.mockImplementation(() => [{
      timestamp: new Date().toISOString(),
      diskPct: 84,
      ramPct: 40,
      cpuLoad1: 0.5,
      ncpu: 4,
    } as MetricSnapshot]);

    const { bot, sentMessages } = createTestBot();
    await bot.handleUpdate(makeCommandUpdate("doctor", "srv"));
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain("warning");
    expect(sentMessages[0].text).toContain("Disk usage: 84%");
  });

  it("replies with RAM critical finding when ram >= 90%", async () => {
    const server = { id: "s1", name: "srv", provider: "hetzner", ip: "1.2.3.4", region: "eu", size: "cx11", createdAt: "2026-01-01", mode: "bare" as const };
    mockedConfig.findServer.mockReturnValue(server);
    mockedDoctor.loadMetricsHistory.mockImplementation(() => [{
      timestamp: new Date().toISOString(),
      diskPct: 50,
      ramPct: 95,
      cpuLoad1: 0.5,
      ncpu: 4,
    } as MetricSnapshot]);

    const { bot, sentMessages } = createTestBot();
    await bot.handleUpdate(makeCommandUpdate("doctor", "srv"));
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain("critical");
    expect(sentMessages[0].text).toContain("RAM usage high: 95%");
  });

  it("replies with RAM warning finding when ram >= 80% and < 90%", async () => {
    const server = { id: "s1", name: "srv", provider: "hetzner", ip: "1.2.3.4", region: "eu", size: "cx11", createdAt: "2026-01-01", mode: "bare" as const };
    mockedConfig.findServer.mockReturnValue(server);
    mockedDoctor.loadMetricsHistory.mockImplementation(() => [{
      timestamp: new Date().toISOString(),
      diskPct: 50,
      ramPct: 85,
      cpuLoad1: 0.5,
      ncpu: 4,
    } as MetricSnapshot]);

    const { bot, sentMessages } = createTestBot();
    await bot.handleUpdate(makeCommandUpdate("doctor", "srv"));
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain("warning");
    expect(sentMessages[0].text).toContain("RAM usage: 85%");
  });

  it("replies with CPU critical finding when load per CPU >= 2", async () => {
    const server = { id: "s1", name: "srv", provider: "hetzner", ip: "1.2.3.4", region: "eu", size: "cx11", createdAt: "2026-01-01", mode: "bare" as const };
    mockedConfig.findServer.mockReturnValue(server);
    mockedDoctor.loadMetricsHistory.mockImplementation(() => [{
      timestamp: new Date().toISOString(),
      diskPct: 50,
      ramPct: 40,
      cpuLoad1: 10,
      ncpu: 4,
    } as MetricSnapshot]);

    const { bot, sentMessages } = createTestBot();
    await bot.handleUpdate(makeCommandUpdate("doctor", "srv"));
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain("critical");
    expect(sentMessages[0].text).toContain("CPU load high: 10");
  });

  it("replies with CPU warning finding when load per CPU >= 1 and < 2", async () => {
    const server = { id: "s1", name: "srv", provider: "hetzner", ip: "1.2.3.4", region: "eu", size: "cx11", createdAt: "2026-01-01", mode: "bare" as const };
    mockedConfig.findServer.mockReturnValue(server);
    mockedDoctor.loadMetricsHistory.mockImplementation(() => [{
      timestamp: new Date().toISOString(),
      diskPct: 50,
      ramPct: 40,
      cpuLoad1: 5,
      ncpu: 4,
    } as MetricSnapshot]);

    const { bot, sentMessages } = createTestBot();
    await bot.handleUpdate(makeCommandUpdate("doctor", "srv"));
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain("warning");
    expect(sentMessages[0].text).toContain("CPU load: 5");
  });

  it("replies with no findings when all metrics are healthy", async () => {
    const server = { id: "s1", name: "srv", provider: "hetzner", ip: "1.2.3.4", region: "eu", size: "cx11", createdAt: "2026-01-01", mode: "bare" as const };
    mockedConfig.findServer.mockReturnValue(server);
    mockedDoctor.loadMetricsHistory.mockImplementation(() => [{
      timestamp: new Date().toISOString(),
      diskPct: 50,
      ramPct: 40,
      cpuLoad1: 0.5,
      ncpu: 4,
    } as MetricSnapshot]);

    const { bot, sentMessages } = createTestBot();
    await bot.handleUpdate(makeCommandUpdate("doctor", "srv"));
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain("No doctor data");
  });
});

// ─── /help ────────────────────────────────────────────────────────────────────

describe("/help handler", () => {
  it("replies with command list and version footer", async () => {
    const { bot, sentMessages } = createTestBot();
    await bot.handleUpdate(makeCommandUpdate("help", ""));
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain("/audit");
    expect(sentMessages[0].text).toContain("/status");
    expect(sentMessages[0].text).toContain("/health");
    expect(sentMessages[0].text).toContain("/doctor");
    expect(sentMessages[0].text).toMatch(/Kastell v\d+\.\d+\.\d+/);
    expect(sentMessages[0].text).toContain("4 commands");
  });
});

// ─── /start ───────────────────────────────────────────────────────────────────

describe("/start handler", () => {
  it("replies with bot already running message", async () => {
    const { bot, sentMessages } = createTestBot();
    await bot.handleUpdate(makeCommandUpdate("start", ""));
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain("already running");
  });
});