import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import axios from "axios";
import inquirer from "inquirer";
import {
  addChannel,
  testChannel,
  loadNotifyConfig,
  saveNotifyConfig,
  sendTelegram,
  sendDiscord,
  sendSlack,
} from "../../src/core/notify.js";
import type { NotifyConfig } from "../../src/core/notify.js";

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



const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockedReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;
const mockedWriteFileSync = writeFileSync as jest.MockedFunction<typeof writeFileSync>;
const mockedAxiosPost = axios.post as jest.Mock;
const mockedInquirerPrompt = inquirer.prompt as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

// ─── addChannel ───────────────────────────────────────────────────────────────

describe("addChannel", () => {
  describe("force mode (non-interactive)", () => {
    it("saves telegram config when --force with botToken and chatId (NOTF-01)", async () => {
      mockedExistsSync.mockReturnValue(false);

      await addChannel("telegram", {
        force: true,
        botToken: "bot123:ABC",
        chatId: "-100123",
      });

      expect(mockedWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining("notify.json"),
        expect.stringContaining('"botToken": "bot123:ABC"'),
        { mode: 0o600 },
      );
    });

    it("saves discord config when --force with webhookUrl (NOTF-02)", async () => {
      mockedExistsSync.mockReturnValue(false);

      await addChannel("discord", {
        force: true,
        webhookUrl: "https://discord.com/api/webhooks/123/abc",
      });

      expect(mockedWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining("notify.json"),
        expect.stringContaining('"webhookUrl": "https://discord.com/api/webhooks/123/abc"'),
        { mode: 0o600 },
      );
    });

    it("saves slack config when --force with webhookUrl (NOTF-03)", async () => {
      mockedExistsSync.mockReturnValue(false);

      await addChannel("slack", {
        force: true,
        webhookUrl: "https://hooks.slack.com/services/T/B/secret",
      });

      expect(mockedWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining("notify.json"),
        expect.stringContaining('"webhookUrl": "https://hooks.slack.com/services/T/B/secret"'),
        { mode: 0o600 },
      );
    });

    it("merges telegram into existing config without removing discord (NOTF-01)", async () => {
      const existing: NotifyConfig = {
        discord: { webhookUrl: "https://discord.com/api/webhooks/1/tok" },
      };
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(JSON.stringify(existing));

      await addChannel("telegram", {
        force: true,
        botToken: "tok",
        chatId: "123",
      });

      const written = (mockedWriteFileSync.mock.calls[0] as unknown[])[1] as string;
      const parsed = JSON.parse(written) as NotifyConfig;
      expect(parsed.telegram?.botToken).toBe("tok");
      expect(parsed.discord?.webhookUrl).toBe("https://discord.com/api/webhooks/1/tok");
    });

    it("errors when --force telegram is missing botToken", async () => {
      const consoleSpy = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
      mockedExistsSync.mockReturnValue(false);

      await addChannel("telegram", { force: true, chatId: "123" });

      // Should not have written config
      expect(mockedWriteFileSync).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("errors when --force discord is missing webhookUrl", async () => {
      mockedExistsSync.mockReturnValue(false);

      await addChannel("discord", { force: true });

      expect(mockedWriteFileSync).not.toHaveBeenCalled();
    });

    it("errors when channel name is invalid", async () => {
      await addChannel("invalid-channel", { force: true });

      expect(mockedWriteFileSync).not.toHaveBeenCalled();
    });
  });

  describe("interactive mode (Inquirer)", () => {
    it("prompts for botToken and chatId when telegram without --force (NOTF-01)", async () => {
      mockedExistsSync.mockReturnValue(false);
      mockedInquirerPrompt.mockResolvedValue({ botToken: "tok", chatId: "123" });

      await addChannel("telegram", {});

      expect(mockedInquirerPrompt).toHaveBeenCalled();
      expect(mockedWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining("notify.json"),
        expect.stringContaining('"botToken": "tok"'),
        { mode: 0o600 },
      );
    });

    it("prompts for webhookUrl when discord without --force (NOTF-02)", async () => {
      mockedExistsSync.mockReturnValue(false);
      mockedInquirerPrompt.mockResolvedValue({
        webhookUrl: "https://discord.com/api/webhooks/1/tok",
      });

      await addChannel("discord", {});

      expect(mockedInquirerPrompt).toHaveBeenCalled();
      expect(mockedWriteFileSync).toHaveBeenCalled();
    });
  });
});

// ─── testChannel ──────────────────────────────────────────────────────────────

describe("testChannel", () => {
  it("sends test message to telegram when configured (NOTF-04)", async () => {
    const config: NotifyConfig = {
      telegram: { botToken: "bot123", chatId: "-100456" },
    };
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(JSON.stringify(config));
    mockedAxiosPost.mockResolvedValue({ data: { ok: true }, status: 200 });

    await testChannel("telegram");

    expect(mockedAxiosPost).toHaveBeenCalledWith(
      expect.stringContaining("api.telegram.org"),
      expect.objectContaining({ text: expect.stringContaining("[Kastell]") }),
      expect.any(Object),
    );
  });

  it("sends test message to discord when configured (NOTF-04)", async () => {
    const config: NotifyConfig = {
      discord: { webhookUrl: "https://discord.com/api/webhooks/1/tok" },
    };
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(JSON.stringify(config));
    mockedAxiosPost.mockResolvedValue({ status: 204 });

    await testChannel("discord");

    expect(mockedAxiosPost).toHaveBeenCalledWith(
      "https://discord.com/api/webhooks/1/tok",
      expect.objectContaining({ content: expect.stringContaining("[Kastell]") }),
      expect.any(Object),
    );
  });

  it("sends test message to slack when configured (NOTF-04)", async () => {
    const config: NotifyConfig = {
      slack: { webhookUrl: "https://hooks.slack.com/services/T/B/secret" },
    };
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(JSON.stringify(config));
    mockedAxiosPost.mockResolvedValue({ data: "ok", status: 200 });

    await testChannel("slack");

    expect(mockedAxiosPost).toHaveBeenCalledWith(
      "https://hooks.slack.com/services/T/B/secret",
      expect.objectContaining({ text: expect.stringContaining("[Kastell]") }),
      expect.any(Object),
    );
  });

  it("errors when channel not configured", async () => {
    mockedExistsSync.mockReturnValue(false);

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
