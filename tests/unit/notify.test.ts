import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import axios from "axios";
import {
  loadNotifyConfig,
  sendTelegram,
  sendDiscord,
  sendSlack,
  dispatchNotification,
  dispatchWithCooldown,
  loadCooldownState,
  saveCooldownState,
  NotifyConfigSchema,
} from "../../src/core/notify.js";
import type { NotifyConfig, ChannelResult } from "../../src/core/notify.js";
import { loadNotifyChannels } from "../../src/core/notifyStore.js";

jest.mock("fs", () => ({
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  existsSync: jest.fn(),
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

const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockedReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;
const mockedWriteFileSync = writeFileSync as jest.MockedFunction<typeof writeFileSync>;
const mockedMkdirSync = mkdirSync as jest.MockedFunction<typeof mkdirSync>;
const mockedAxiosPost = axios.post as jest.Mock;
const mockedLoadNotifyChannels = loadNotifyChannels as jest.Mock;

beforeEach(() => {
  jest.resetAllMocks();
  mockedLoadNotifyChannels.mockReturnValue({});
});

// ─── loadNotifyConfig ─────────────────────────────────────────────────────────

describe("loadNotifyConfig — delegates to notifyStore", () => {
  it("returns empty object when no channels configured (NOTF-01)", () => {
    mockedLoadNotifyChannels.mockReturnValue({});

    const result = loadNotifyConfig();

    expect(result).toEqual({});
  });

  it("returns telegram config from notifyStore (NOTF-01)", () => {
    const config = { telegram: { botToken: "bot123:ABC", chatId: "-100123456" } };
    mockedLoadNotifyChannels.mockReturnValue(config);

    const result = loadNotifyConfig();

    expect(result.telegram?.botToken).toBe("bot123:ABC");
    expect(result.telegram?.chatId).toBe("-100123456");
  });

  it("returns discord config from notifyStore (NOTF-02)", () => {
    const config = { discord: { webhookUrl: "https://discord.com/api/webhooks/123/abc" } };
    mockedLoadNotifyChannels.mockReturnValue(config);

    const result = loadNotifyConfig();

    expect(result.discord?.webhookUrl).toBe("https://discord.com/api/webhooks/123/abc");
  });

  it("returns slack config from notifyStore (NOTF-03)", () => {
    const config = { slack: { webhookUrl: "https://hooks.slack.com/services/T/B/secret" } };
    mockedLoadNotifyChannels.mockReturnValue(config);

    const result = loadNotifyConfig();

    expect(result.slack?.webhookUrl).toBe("https://hooks.slack.com/services/T/B/secret");
  });
});

// ─── sendTelegram ──────────────────────────────────────────────────────────────

describe("sendTelegram", () => {
  it("POSTs to api.telegram.org with chat_id (snake_case) and text (NOTF-05)", async () => {
    mockedAxiosPost.mockResolvedValue({ data: { ok: true }, status: 200 });

    await sendTelegram("bot123:ABC", "-100456", "Hello telegram");

    expect(mockedAxiosPost).toHaveBeenCalledWith(
      "https://api.telegram.org/botbot123:ABC/sendMessage",
      { chat_id: "-100456", text: "Hello telegram" },
      { timeout: 10_000 },
    );
  });

  it("returns { success: true } on successful POST (NOTF-05)", async () => {
    mockedAxiosPost.mockResolvedValue({ data: { ok: true }, status: 200 });

    const result = await sendTelegram("bot123", "chat456", "msg");

    expect(result).toEqual({ success: true });
  });

  it("returns { success: false, error } on network error (NOTF-05)", async () => {
    mockedAxiosPost.mockRejectedValue(new Error("Network timeout"));

    const result = await sendTelegram("bot123", "chat456", "msg");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Network timeout");
  });

  it("uses 10s timeout", async () => {
    mockedAxiosPost.mockResolvedValue({ data: {}, status: 200 });

    await sendTelegram("bot", "cid", "text");

    expect(mockedAxiosPost).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      { timeout: 10_000 },
    );
  });
});

// ─── sendDiscord / sendSlack ───────────────────────────────────────────────────

describe("sendDiscord / sendSlack", () => {
  it("sendDiscord POSTs { content } to webhookUrl (NOTF-05)", async () => {
    mockedAxiosPost.mockResolvedValue({ status: 204 });

    await sendDiscord("https://discord.com/api/webhooks/1/tok", "Hello discord");

    expect(mockedAxiosPost).toHaveBeenCalledWith(
      "https://discord.com/api/webhooks/1/tok",
      { content: "Hello discord" },
      { timeout: 10_000 },
    );
  });

  it("sendDiscord returns { success: true } on 2xx response (NOTF-05)", async () => {
    mockedAxiosPost.mockResolvedValue({ status: 204 });

    const result = await sendDiscord("https://discord.com/api/webhooks/1/tok", "msg");

    expect(result).toEqual({ success: true });
  });

  it("sendDiscord returns { success: false, error } on network error", async () => {
    mockedAxiosPost.mockRejectedValue(new Error("Connection refused"));

    const result = await sendDiscord("https://discord.com/api/webhooks/1/tok", "msg");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Connection refused");
  });

  it("sendSlack POSTs { text } to webhookUrl (NOTF-05)", async () => {
    mockedAxiosPost.mockResolvedValue({ data: "ok", status: 200 });

    await sendSlack("https://hooks.slack.com/services/T/B/secret", "Hello slack");

    expect(mockedAxiosPost).toHaveBeenCalledWith(
      "https://hooks.slack.com/services/T/B/secret",
      { text: "Hello slack" },
      { timeout: 10_000 },
    );
  });

  it("sendSlack returns { success: true } on 200 (NOTF-05)", async () => {
    mockedAxiosPost.mockResolvedValue({ data: "ok", status: 200 });

    const result = await sendSlack("https://hooks.slack.com/services/T/B/secret", "msg");

    expect(result).toEqual({ success: true });
  });

  it("sendSlack returns { success: false, error } on network error", async () => {
    mockedAxiosPost.mockRejectedValue(new Error("Slack down"));

    const result = await sendSlack("https://hooks.slack.com/services/T/B/secret", "msg");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Slack down");
  });
});

// ─── dispatchNotification ─────────────────────────────────────────────────────

describe("dispatchNotification", () => {
  it("fans out to all configured channels simultaneously (NOTF-05)", async () => {
    mockedAxiosPost.mockResolvedValue({ data: {}, status: 200 });

    const config: NotifyConfig = {
      telegram: { botToken: "bot", chatId: "cid" },
      discord: { webhookUrl: "https://discord.com/api/webhooks/1/tok" },
      slack: { webhookUrl: "https://hooks.slack.com/services/T/B/s" },
    };

    const results = await dispatchNotification("Test broadcast", config);

    expect(results).toHaveLength(3);
    expect(mockedAxiosPost).toHaveBeenCalledTimes(3);
  });

  it("one channel failure does not block others (NOTF-05)", async () => {
    mockedAxiosPost
      .mockRejectedValueOnce(new Error("Telegram down"))
      .mockResolvedValue({ status: 200 });

    const config: NotifyConfig = {
      telegram: { botToken: "bot", chatId: "cid" },
      discord: { webhookUrl: "https://discord.com/api/webhooks/1/tok" },
    };

    const results = await dispatchNotification("msg", config);

    expect(results).toHaveLength(2);
    const telegramResult = results.find((r) => r.channel === "telegram");
    const discordResult = results.find((r) => r.channel === "discord");
    expect(telegramResult?.success).toBe(false);
    expect(discordResult?.success).toBe(true);
  });

  it("returns ChannelResult[] with per-channel status (NOTF-05)", async () => {
    mockedAxiosPost.mockResolvedValue({ status: 200 });

    const config: NotifyConfig = {
      telegram: { botToken: "bot", chatId: "cid" },
    };

    const results = await dispatchNotification("msg", config);

    expect(results[0]).toMatchObject({
      channel: "telegram",
      success: true,
    });
  });

  it("returns empty array when no channels configured", async () => {
    const results = await dispatchNotification("msg", {});

    expect(results).toEqual([]);
    expect(mockedAxiosPost).not.toHaveBeenCalled();
  });

  it("loads config from notifyStore when config not provided", async () => {
    mockedLoadNotifyChannels.mockReturnValue({ telegram: { botToken: "bot", chatId: "cid" } });
    mockedAxiosPost.mockResolvedValue({ status: 200 });

    const results = await dispatchNotification("msg");

    expect(results).toHaveLength(1);
    expect(results[0].channel).toBe("telegram");
  });
});

// ─── dispatchWithCooldown ─────────────────────────────────────────────────────

describe("dispatchWithCooldown", () => {
  it("dispatches when key is not in cooldown state (NOTF-06)", async () => {
    // loadCooldownState: no file
    mockedExistsSync.mockReturnValue(false);
    mockedAxiosPost.mockResolvedValue({ status: 200 });

    const result = await dispatchWithCooldown("web", "disk", "Disk 85%");

    expect(result.skipped).toBe(false);
  });

  it("skips dispatch when same key sent within 30 minutes (NOTF-06)", async () => {
    const fixedNow = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockReturnValue(fixedNow);
    const recentTimestamp = new Date(fixedNow - 10 * 60 * 1000).toISOString(); // 10 minutes ago

    // dispatchWithCooldown: loadCooldownState calls existsSync then readFileSync
    mockedExistsSync.mockReturnValueOnce(true); // cooldown file exists
    mockedReadFileSync.mockReturnValueOnce(
      JSON.stringify({ "web:disk": recentTimestamp }),
    );

    const result = await dispatchWithCooldown("web", "disk", "Disk 85%");

    expect(result.skipped).toBe(true);
    expect(result.results).toEqual([]);
    expect(mockedAxiosPost).not.toHaveBeenCalled();
  });

  it("dispatches when cooldown has expired (NOTF-06)", async () => {
    const fixedNow = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockReturnValue(fixedNow);
    const expiredTimestamp = new Date(fixedNow - 31 * 60 * 1000).toISOString(); // 31 minutes ago

    // loadCooldownState: cooldown file exists, returns expired state
    // loadNotifyConfig -> loadNotifyChannels (mocked, returns {})
    mockedExistsSync.mockReturnValueOnce(true); // cooldown file exists
    mockedReadFileSync.mockReturnValueOnce(
      JSON.stringify({ "web:disk": expiredTimestamp }),
    );
    mockedAxiosPost.mockResolvedValue({ status: 200 });

    const result = await dispatchWithCooldown("web", "disk", "Disk 85%");

    expect(result.skipped).toBe(false);
  });

  it("updates cooldown timestamp when at least one channel succeeds (NOTF-06)", async () => {
    const fixedNow = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockReturnValue(fixedNow);

    // loadCooldownState: no cooldown file
    // loadNotifyConfig -> loadNotifyChannels (mocked with telegram config)
    mockedExistsSync.mockReturnValueOnce(false); // cooldown file missing
    mockedLoadNotifyChannels.mockReturnValue({ telegram: { botToken: "bot", chatId: "cid" } });
    mockedAxiosPost.mockResolvedValue({ status: 200 });

    await dispatchWithCooldown("api", "ram", "RAM 95%");

    expect(mockedWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining("notify-cooldown.json"),
      expect.stringContaining("api:ram"),
      { mode: 0o600 },
    );
  });

  it("does not update cooldown when all channels fail (NOTF-06)", async () => {
    const fixedNow = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockReturnValue(fixedNow);

    // loadCooldownState: no cooldown file
    // loadNotifyConfig -> loadNotifyChannels (mocked with telegram config)
    mockedExistsSync.mockReturnValueOnce(false); // cooldown file missing
    mockedLoadNotifyChannels.mockReturnValue({ telegram: { botToken: "bot", chatId: "cid" } });
    mockedAxiosPost.mockRejectedValue(new Error("All down"));

    await dispatchWithCooldown("api", "cpu", "CPU 200%");

    // writeFileSync should NOT have been called for cooldown
    const cooldownWrites = (mockedWriteFileSync.mock.calls as unknown[][]).filter(
      (call) => typeof call[0] === "string" && (call[0] as string).includes("notify-cooldown.json"),
    );
    expect(cooldownWrites).toHaveLength(0);
  });

  it("uses composite key serverName:findingType to prevent cross-server collision (NOTF-06)", async () => {
    const fixedNow = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockReturnValue(fixedNow);
    const recentTimestamp = new Date(fixedNow - 5 * 60 * 1000).toISOString(); // 5 minutes ago

    // loadCooldownState: has serverA:disk in cooldown — serverB:disk should not be skipped
    // loadNotifyConfig -> loadNotifyChannels (mocked, returns {})
    mockedExistsSync.mockReturnValueOnce(true); // cooldown file exists
    mockedReadFileSync.mockReturnValueOnce(
      JSON.stringify({ "serverA:disk": recentTimestamp }),
    );
    mockedAxiosPost.mockResolvedValue({ status: 200 });

    const result = await dispatchWithCooldown("serverB", "disk", "Disk breach");

    expect(result.skipped).toBe(false);
  });
});

// ─── loadCooldownState / saveCooldownState ────────────────────────────────────

describe("loadCooldownState / saveCooldownState", () => {
  it("loadCooldownState returns empty object when file missing", () => {
    mockedExistsSync.mockReturnValue(false);

    const state = loadCooldownState();

    expect(state).toEqual({});
  });

  it("loadCooldownState returns parsed state when file is valid", () => {
    const ts = new Date().toISOString();
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(JSON.stringify({ "web:disk": ts }));

    const state = loadCooldownState();

    expect(state["web:disk"]).toBe(ts);
  });

  it("loadCooldownState returns empty object on malformed JSON", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("{ bad json");

    const state = loadCooldownState();

    expect(state).toEqual({});
  });

  it("saveCooldownState writes to notify-cooldown.json with mode 0o600", () => {
    const state = { "web:disk": new Date().toISOString() };

    saveCooldownState(state);

    expect(mockedMkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    expect(mockedWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining("notify-cooldown.json"),
      JSON.stringify(state, null, 2),
      { mode: 0o600 },
    );
  });
});

// ─── NotifyConfigSchema ───────────────────────────────────────────────────────

describe("NotifyConfigSchema", () => {
  it("validates a full config with all three channels", () => {
    const result = NotifyConfigSchema.safeParse({
      telegram: { botToken: "bot", chatId: "cid" },
      discord: { webhookUrl: "https://discord.com/api/webhooks/1/tok" },
      slack: { webhookUrl: "https://hooks.slack.com/services/T/B/s" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects telegram config with empty botToken", () => {
    const result = NotifyConfigSchema.safeParse({
      telegram: { botToken: "", chatId: "cid" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects discord config with non-URL webhookUrl", () => {
    const result = NotifyConfigSchema.safeParse({
      discord: { webhookUrl: "not-a-url" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts empty config (all channels optional)", () => {
    const result = NotifyConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});
