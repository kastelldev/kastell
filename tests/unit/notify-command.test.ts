import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import axios from "axios";
import inquirer from "inquirer";
import {
  addChannel,
  testChannel,
  loadNotifyConfig,
  sendTelegram,
  sendDiscord,
  sendSlack,
} from "../../src/core/notify.js";
import type { NotifyConfig } from "../../src/core/notify.js";
import { saveNotifyChannel, loadNotifyChannels } from "../../src/core/notifyStore.js";

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock("fs", () => ({
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
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

jest.mock("../../src/core/notifyStore.js", () => ({
  loadNotifyChannels: jest.fn(() => ({})),
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
const mockedAxiosPost = axios.post as jest.Mock;
const mockedInquirerPrompt = inquirer.prompt as unknown as jest.Mock;
const mockedSaveNotifyChannel = saveNotifyChannel as jest.Mock;
const mockedLoadNotifyChannels = loadNotifyChannels as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

// ─── addChannel ───────────────────────────────────────────────────────────────

describe("addChannel", () => {
  describe("force mode (non-interactive)", () => {
    it("saves telegram config via notifyStore when --force with botToken and chatId (NOTF-01)", async () => {
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

    it("saves discord config via notifyStore when --force with webhookUrl (NOTF-02)", async () => {
      await addChannel("discord", {
        force: true,
        webhookUrl: "https://discord.com/api/webhooks/123/abc",
      });

      expect(mockedSaveNotifyChannel).toHaveBeenCalledWith("discord", {
        webhookUrl: "https://discord.com/api/webhooks/123/abc",
      });
    });

    it("saves slack config via notifyStore when --force with webhookUrl (NOTF-03)", async () => {
      await addChannel("slack", {
        force: true,
        webhookUrl: "https://hooks.slack.com/services/T/B/secret",
      });

      expect(mockedSaveNotifyChannel).toHaveBeenCalledWith("slack", {
        webhookUrl: "https://hooks.slack.com/services/T/B/secret",
      });
    });

    it("saves telegram secrets without affecting discord (notifyStore handles merge) (NOTF-01)", async () => {
      await addChannel("telegram", {
        force: true,
        botToken: "tok",
        chatId: "123",
      });

      expect(mockedSaveNotifyChannel).toHaveBeenCalledWith("telegram", {
        botToken: "tok",
        chatId: "123",
      });
    });

    it("errors when --force telegram is missing botToken", async () => {
      await addChannel("telegram", { force: true, chatId: "123" });

      expect(mockedSaveNotifyChannel).not.toHaveBeenCalled();
    });

    it("errors when --force discord is missing webhookUrl", async () => {
      await addChannel("discord", { force: true });

      expect(mockedSaveNotifyChannel).not.toHaveBeenCalled();
    });

    it("errors when channel name is invalid", async () => {
      await addChannel("invalid-channel", { force: true });

      expect(mockedSaveNotifyChannel).not.toHaveBeenCalled();
    });
  });

  describe("interactive mode (Inquirer)", () => {
    it("prompts for botToken and chatId when telegram without --force (NOTF-01)", async () => {
      mockedInquirerPrompt.mockResolvedValue({ botToken: "tok", chatId: "123" });

      await addChannel("telegram", {});

      expect(mockedInquirerPrompt).toHaveBeenCalled();
      expect(mockedSaveNotifyChannel).toHaveBeenCalledWith("telegram", {
        botToken: "tok",
        chatId: "123",
      });
    });

    it("prompts for webhookUrl when discord without --force (NOTF-02)", async () => {
      mockedInquirerPrompt.mockResolvedValue({
        webhookUrl: "https://discord.com/api/webhooks/1/tok",
      });

      await addChannel("discord", {});

      expect(mockedInquirerPrompt).toHaveBeenCalled();
      expect(mockedSaveNotifyChannel).toHaveBeenCalled();
    });
  });
});

// ─── testChannel ──────────────────────────────────────────────────────────────

describe("testChannel", () => {
  it("sends test message to telegram when configured (NOTF-04)", async () => {
    mockedLoadNotifyChannels.mockReturnValue({
      telegram: { botToken: "bot123", chatId: "-100456" },
    });
    mockedAxiosPost.mockResolvedValue({ data: { ok: true }, status: 200 });

    await testChannel("telegram");

    expect(mockedAxiosPost).toHaveBeenCalledWith(
      expect.stringContaining("api.telegram.org"),
      expect.objectContaining({ text: expect.stringContaining("[Kastell]") }),
      expect.any(Object),
    );
  });

  it("sends test message to discord when configured (NOTF-04)", async () => {
    mockedLoadNotifyChannels.mockReturnValue({
      discord: { webhookUrl: "https://discord.com/api/webhooks/1/tok" },
    });
    mockedAxiosPost.mockResolvedValue({ status: 204 });

    await testChannel("discord");

    expect(mockedAxiosPost).toHaveBeenCalledWith(
      "https://discord.com/api/webhooks/1/tok",
      expect.objectContaining({ content: expect.stringContaining("[Kastell]") }),
      expect.any(Object),
    );
  });

  it("sends test message to slack when configured (NOTF-04)", async () => {
    mockedLoadNotifyChannels.mockReturnValue({
      slack: { webhookUrl: "https://hooks.slack.com/services/T/B/secret" },
    });
    mockedAxiosPost.mockResolvedValue({ data: "ok", status: 200 });

    await testChannel("slack");

    expect(mockedAxiosPost).toHaveBeenCalledWith(
      "https://hooks.slack.com/services/T/B/secret",
      expect.objectContaining({ text: expect.stringContaining("[Kastell]") }),
      expect.any(Object),
    );
  });

  it("errors when channel not configured", async () => {
    mockedLoadNotifyChannels.mockReturnValue({});

    // Should not throw, just print error
    await expect(testChannel("telegram")).resolves.toBeUndefined();
    expect(mockedAxiosPost).not.toHaveBeenCalled();
  });

  it("errors when invalid channel name given", async () => {
    await expect(testChannel("email")).resolves.toBeUndefined();

    expect(mockedAxiosPost).not.toHaveBeenCalled();
  });
});

// ─── notify command wiring ────────────────────────────────────────────────────

describe("notifyCommand (command registration)", () => {
  it("notifyCommand export exists in src/commands/notify.ts", async () => {
    const mod = await import("../../src/commands/notify.js");
    expect(typeof mod.notifyCommand).toBe("function");
  });

  it("notifyCommand registers add and test subcommands on program", async () => {
    const { Command } = await import("commander");
    const { notifyCommand } = await import("../../src/commands/notify.js");

    const program = new Command();
    program.exitOverride();

    notifyCommand(program);

    const notifySub = program.commands.find((c) => c.name() === "notify");
    expect(notifySub).toBeDefined();

    const addSub = notifySub?.commands.find((c) => c.name() === "add");
    const testSub = notifySub?.commands.find((c) => c.name() === "test");
    expect(addSub).toBeDefined();
    expect(testSub).toBeDefined();
  });
});
