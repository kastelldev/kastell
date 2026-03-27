import { Bot } from "grammy";
import * as configUtils from "../../src/utils/config";
import * as snapshotModule from "../../src/core/audit/snapshot";
import * as guardModule from "../../src/core/guard";
import * as doctorModule from "../../src/core/doctor";
import { registerHandlers } from "../../src/core/bot/handlers";
import type { SnapshotFile, SnapshotListEntry } from "../../src/core/audit/types";

jest.mock("../../src/utils/config");
jest.mock("../../src/core/audit/snapshot");
jest.mock("../../src/core/guard");
jest.mock("../../src/core/doctor");

const mockedConfig = configUtils as jest.Mocked<typeof configUtils>;
const mockedSnapshot = snapshotModule as jest.Mocked<typeof snapshotModule>;
const mockedGuard = guardModule as jest.Mocked<typeof guardModule>;
const mockedDoctor = doctorModule as jest.Mocked<typeof doctorModule>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a bot with transformer that captures sendMessage calls */
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

  // Intercept all API calls via transformer — no actual Telegram calls
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

/** Simulate a command message update */
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
          length: command.length + 1, // +1 for /
        },
      ],
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedGuard.getGuardStates.mockReturnValue({});
  mockedConfig.getServers.mockReturnValue([]);
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

  it("replies with formatted audit when server and snapshot exist", async () => {
    const server = {
      id: "s1", name: "my-srv", provider: "hetzner",
      ip: "1.2.3.4", region: "eu", size: "cx11",
      createdAt: "2026-01-01", mode: "bare" as const,
    };
    mockedConfig.findServer.mockReturnValue(server);

    const entry: SnapshotListEntry = {
      filename: "2026-03-27.json",
      savedAt: new Date().toISOString(),
      overallScore: 70,
    };
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
});

// ─── /doctor ──────────────────────────────────────────────────────────────────

describe("/doctor handler", () => {
  it("replies with usage message when no argument", async () => {
    const { bot, sentMessages } = createTestBot();
    await bot.handleUpdate(makeCommandUpdate("doctor", ""));
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain("Usage: /doctor");
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

// ─── /health ──────────────────────────────────────────────────────────────────

describe("/health handler", () => {
  it("replies with fleet overview when no argument", async () => {
    mockedConfig.getServers.mockReturnValue([]);
    const { bot, sentMessages } = createTestBot();
    await bot.handleUpdate(makeCommandUpdate("health", ""));
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toContain("No servers registered");
  });
});
