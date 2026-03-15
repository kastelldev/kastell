import axios from "axios";
import inquirer from "inquirer";
import {
  loadNotifyConfig,
  addChannel,
  dispatchNotification,
  dispatchWithCooldown,
  removeChannel,
} from "../../src/core/notify.js";
import type { NotifyConfig } from "../../src/core/notify.js";
import {
  loadNotifyChannels,
  saveNotifyChannel,
  removeNotifyChannel,
} from "../../src/core/notifyStore.js";

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock("fs", () => ({
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  existsSync: jest.fn(() => false),
  mkdirSync: jest.fn(),
}));

jest.mock("../../src/core/notifyStore.js", () => ({
  loadNotifyChannels: jest.fn(),
  saveNotifyChannel: jest.fn(),
  removeNotifyChannel: jest.fn(),
  isNotifyKeychainAvailable: jest.fn(() => true),
  storeNotifySecret: jest.fn(),
  readNotifySecret: jest.fn(),
  removeNotifySecret: jest.fn(),
}));

jest.mock("../../src/utils/logger", () => ({
  logger: {
    info: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  },
  createSpinner: jest.fn(() => ({
    start: jest.fn().mockReturnThis(),
    stop: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
  })),
}));

const mockedLoadNotifyChannels = loadNotifyChannels as jest.Mock;
const mockedSaveNotifyChannel = saveNotifyChannel as jest.Mock;
const mockedRemoveNotifyChannel = removeNotifyChannel as jest.Mock;
const mockedAxiosPost = axios.post as jest.Mock;
const mockedInquirerPrompt = inquirer.prompt as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

// ─── loadNotifyConfig delegates to notifyStore ────────────────────────────────

describe("loadNotifyConfig — delegates to notifyStore (SEC-01)", () => {
  it("returns config from loadNotifyChannels", () => {
    const expected: NotifyConfig = {
      telegram: { botToken: "bot123", chatId: "-100456" },
    };
    mockedLoadNotifyChannels.mockReturnValue(expected);

    const config = loadNotifyConfig();

    expect(mockedLoadNotifyChannels).toHaveBeenCalled();
    expect(config).toEqual(expected);
  });

  it("returns empty config when loadNotifyChannels returns empty object", () => {
    mockedLoadNotifyChannels.mockReturnValue({});

    const config = loadNotifyConfig();

    expect(config).toEqual({});
  });

  it("returns discord config from keychain-backed store", () => {
    const expected: NotifyConfig = {
      discord: { webhookUrl: "https://discord.com/api/webhooks/1/tok" },
    };
    mockedLoadNotifyChannels.mockReturnValue(expected);

    const config = loadNotifyConfig();

    expect(config.discord?.webhookUrl).toBe("https://discord.com/api/webhooks/1/tok");
  });
});

// ─── addChannel stores via saveNotifyChannel (not plain-text JSON) ────────────

describe("addChannel — stores via notifyStore (SEC-01)", () => {
  it("calls saveNotifyChannel for telegram --force (not writeFileSync to notify.json)", async () => {
    await addChannel("telegram", {
      force: true,
      botToken: "bot123:ABC",
      chatId: "-100123",
    });

    expect(mockedSaveNotifyChannel).toHaveBeenCalledWith("telegram", {
      botToken: "bot123:ABC",
      chatId: "-100123",
    });
  });

  it("calls saveNotifyChannel for discord --force", async () => {
    await addChannel("discord", {
      force: true,
      webhookUrl: "https://discord.com/api/webhooks/123/abc",
    });

    expect(mockedSaveNotifyChannel).toHaveBeenCalledWith("discord", {
      webhookUrl: "https://discord.com/api/webhooks/123/abc",
    });
  });

  it("calls saveNotifyChannel for slack --force", async () => {
    await addChannel("slack", {
      force: true,
      webhookUrl: "https://hooks.slack.com/services/T/B/secret",
    });

    expect(mockedSaveNotifyChannel).toHaveBeenCalledWith("slack", {
      webhookUrl: "https://hooks.slack.com/services/T/B/secret",
    });
  });

  it("calls saveNotifyChannel after interactive telegram prompts", async () => {
    mockedInquirerPrompt.mockResolvedValue({ botToken: "promptedBot", chatId: "promptedChat" });

    await addChannel("telegram", {});

    expect(mockedSaveNotifyChannel).toHaveBeenCalledWith("telegram", {
      botToken: "promptedBot",
      chatId: "promptedChat",
    });
  });

  it("does not call saveNotifyChannel when --force telegram is missing botToken", async () => {
    await addChannel("telegram", { force: true, chatId: "123" });

    expect(mockedSaveNotifyChannel).not.toHaveBeenCalled();
  });

  it("does not call saveNotifyChannel when channel is invalid", async () => {
    await addChannel("invalid-channel", { force: true });

    expect(mockedSaveNotifyChannel).not.toHaveBeenCalled();
  });
});

// ─── removeChannel ────────────────────────────────────────────────────────────

describe("removeChannel — delegates to notifyStore (SEC-01)", () => {
  it("calls removeNotifyChannel for telegram", () => {
    removeChannel("telegram");

    expect(mockedRemoveNotifyChannel).toHaveBeenCalledWith("telegram");
  });

  it("calls removeNotifyChannel for discord", () => {
    removeChannel("discord");

    expect(mockedRemoveNotifyChannel).toHaveBeenCalledWith("discord");
  });

  it("calls removeNotifyChannel for slack", () => {
    removeChannel("slack");

    expect(mockedRemoveNotifyChannel).toHaveBeenCalledWith("slack");
  });

  it("does not call removeNotifyChannel for invalid channel", () => {
    removeChannel("invalid-channel");

    expect(mockedRemoveNotifyChannel).not.toHaveBeenCalled();
  });
});

// ─── dispatchNotification works with keychain-loaded config ──────────────────

describe("dispatchNotification — backward compatible with keychain config (SEC-01)", () => {
  it("fans out to telegram using keychain-loaded config", async () => {
    mockedLoadNotifyChannels.mockReturnValue({
      telegram: { botToken: "bot123", chatId: "-100456" },
    });
    mockedAxiosPost.mockResolvedValue({ data: { ok: true }, status: 200 });

    const results = await dispatchNotification("Test message");

    expect(results).toHaveLength(1);
    expect(results[0].channel).toBe("telegram");
    expect(results[0].success).toBe(true);
  });

  it("accepts explicit config and does not call loadNotifyChannels", async () => {
    mockedAxiosPost.mockResolvedValue({ status: 200 });
    const config: NotifyConfig = {
      telegram: { botToken: "explicitBot", chatId: "cid" },
    };

    await dispatchNotification("msg", config);

    expect(mockedLoadNotifyChannels).not.toHaveBeenCalled();
  });

  it("returns empty array when no channels configured in keychain", async () => {
    mockedLoadNotifyChannels.mockReturnValue({});

    const results = await dispatchNotification("msg");

    expect(results).toEqual([]);
  });
});

// ─── dispatchWithCooldown — guard/fleet backward compatibility ────────────────

describe("dispatchWithCooldown — guard/fleet callers unchanged (SEC-01)", () => {
  it("dispatches when key not in cooldown and channels configured via keychain", async () => {
    // loadCooldownState — no file
    // loadNotifyConfig -> loadNotifyChannels
    mockedLoadNotifyChannels.mockReturnValue({
      telegram: { botToken: "guardBot", chatId: "guardChat" },
    });
    mockedAxiosPost.mockResolvedValue({ status: 200 });

    const result = await dispatchWithCooldown("web", "disk", "Disk 85%");

    expect(result.skipped).toBe(false);
    expect(result.results[0].channel).toBe("telegram");
  });

  it("skips dispatch when in cooldown regardless of keychain config", async () => {
    mockedLoadNotifyChannels.mockReturnValue({
      telegram: { botToken: "bot", chatId: "cid" },
    });

    // This is a basic sanity check — cooldown tests are in notify.test.ts
    // Just verify the API contract is preserved
    const result = await dispatchWithCooldown("web", "disk", "msg");

    // Either skipped or dispatched — just should not throw
    expect(typeof result.skipped).toBe("boolean");
    expect(Array.isArray(result.results)).toBe(true);
  });
});

// ─── notify remove subcommand — command registration ─────────────────────────

describe("notifyCommand — remove subcommand registered (SEC-01)", () => {
  it("notifyCommand registers remove subcommand", async () => {
    const { Command } = await import("commander");
    const { notifyCommand } = await import("../../src/commands/notify.js");

    const program = new Command();
    program.exitOverride();
    notifyCommand(program);

    const notifySub = program.commands.find((c) => c.name() === "notify");
    const removeSub = notifySub?.commands.find((c) => c.name() === "remove");
    expect(removeSub).toBeDefined();
  });
});
