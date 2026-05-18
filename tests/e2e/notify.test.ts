import inquirer from "inquirer";
import axios from "axios";
import { addChannel, removeChannel, testChannel, loadNotifyConfig } from "../../src/core/notify";
import * as notifyStore from "../../src/core/notifyStore";
import * as secureWrite from "../../src/utils/secureWrite";

jest.mock("../../src/utils/secureWrite");
jest.mock("../../src/core/notifyStore");

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;
const mockedNotifyStore = notifyStore as jest.Mocked<typeof notifyStore>;
const mockedSecureWrite = secureWrite as jest.Mocked<typeof secureWrite>;

describe("notify command", () => {
  let consoleSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.spyOn(console, "error").mockImplementation();
    processExitSpy = jest.spyOn(process, "exit").mockImplementation((() => {}) as unknown as typeof process.exit);
    mockedAxios.post.mockReset();
    mockedInquirer.prompt.mockReset();
    mockedNotifyStore.saveNotifyChannel.mockReset();
    mockedNotifyStore.removeNotifyChannel.mockReset();
    mockedNotifyStore.loadNotifyChannels.mockReset();
    mockedSecureWrite.secureMkdirSync.mockReturnValue();
    mockedSecureWrite.secureWriteFileSync.mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe("notify add", () => {
    it("should dispatch to correct channel type (telegram)", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ botToken: "123456:abc-def", chatId: "999888777" });

      await addChannel("telegram", {});

      expect(mockedNotifyStore.saveNotifyChannel).toHaveBeenCalledWith("telegram", {
        botToken: "123456:abc-def",
        chatId: "999888777",
      });
      const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
      expect(output).toContain("configured successfully");
    });

    it("should dispatch to correct channel type (discord)", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ webhookUrl: "https://discord.com/api/webhooks/123456/abcdef" });

      await addChannel("discord", {});

      expect(mockedNotifyStore.saveNotifyChannel).toHaveBeenCalledWith("discord", {
        webhookUrl: "https://discord.com/api/webhooks/123456/abcdef",
      });
    });

    it("should dispatch to correct channel type (slack)", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ webhookUrl: "https://hooks.slack.example/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX" });

      await addChannel("slack", {});

      expect(mockedNotifyStore.saveNotifyChannel).toHaveBeenCalledWith("slack", {
        webhookUrl: "https://hooks.slack.example/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX",
      });
    });

    it("should use force flags for telegram", async () => {
      await addChannel("telegram", {
        force: true,
        botToken: "123456:abcdef",
        chatId: "111222333",
      });

      expect(mockedNotifyStore.saveNotifyChannel).toHaveBeenCalledWith("telegram", {
        botToken: "123456:abcdef",
        chatId: "111222333",
      });
      expect(mockedInquirer.prompt).not.toHaveBeenCalled();
    });

    it("should use force flags for discord", async () => {
      await addChannel("discord", {
        force: true,
        webhookUrl: "https://discord.com/api/webhooks/123/abc",
      });

      expect(mockedNotifyStore.saveNotifyChannel).toHaveBeenCalledWith("discord", {
        webhookUrl: "https://discord.com/api/webhooks/123/abc",
      });
      expect(mockedInquirer.prompt).not.toHaveBeenCalled();
    });

    it("should reject invalid channel name", async () => {
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
      await addChannel("invalid-channel" as "telegram", {});

      expect(mockedNotifyStore.saveNotifyChannel).not.toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it("should require both bot-token and chat-id for forced telegram", async () => {
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();

      await addChannel("telegram", { force: true });

      expect(mockedNotifyStore.saveNotifyChannel).not.toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it("should require webhook-url for forced discord", async () => {
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();

      await addChannel("discord", { force: true });

      expect(mockedNotifyStore.saveNotifyChannel).not.toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe("notify test", () => {
    it("should send test message via telegram", async () => {
      mockedNotifyStore.loadNotifyChannels.mockReturnValue({
        telegram: { botToken: "123456:abcdef", chatId: "111222" },
      });
      mockedAxios.post.mockResolvedValueOnce({ data: { ok: true } });

      await testChannel("telegram");

      expect(mockedAxios.post).toHaveBeenCalledWith(
        "https://api.telegram.org/bot123456:abcdef/sendMessage",
        { chat_id: "111222", text: "[Kastell] Test notification - your telegram integration is working!" },
        { timeout: 10000 },
      );
    });

    it("should send test message via discord", async () => {
      mockedNotifyStore.loadNotifyChannels.mockReturnValue({
        discord: { webhookUrl: "https://discord.com/api/webhooks/123/abc" },
      });
      mockedAxios.post.mockResolvedValueOnce({ data: { ok: true } });

      await testChannel("discord");

      expect(mockedAxios.post).toHaveBeenCalledWith(
        "https://discord.com/api/webhooks/123/abc",
        { content: "[Kastell] Test notification - your discord integration is working!" },
        { timeout: 10000 },
      );
    });

    it("should send test message via slack", async () => {
      mockedNotifyStore.loadNotifyChannels.mockReturnValue({
        slack: { webhookUrl: "https://hooks.slack.com/services/T00/B00/XX" },
      });
      mockedAxios.post.mockResolvedValueOnce({ data: { ok: true } });

      await testChannel("slack");

      expect(mockedAxios.post).toHaveBeenCalledWith(
        "https://hooks.slack.com/services/T00/B00/XX",
        { text: "[Kastell] Test notification - your slack integration is working!" },
        { timeout: 10000 },
      );
    });

    it("should report failure when telegram send fails", async () => {
      mockedNotifyStore.loadNotifyChannels.mockReturnValue({
        telegram: { botToken: "123456:abcdef", chatId: "111222" },
      });
      mockedAxios.post.mockRejectedValueOnce(new Error("Network error"));
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();

      await testChannel("telegram");

      const errorOutput = consoleErrorSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
      expect(errorOutput).toContain("Failed to send test notification");
      consoleErrorSpy.mockRestore();
    });

    it("should report failure when discord webhook fails", async () => {
      mockedNotifyStore.loadNotifyChannels.mockReturnValue({
        discord: { webhookUrl: "https://discord.com/api/webhooks/123/abc" },
      });
      mockedAxios.post.mockRejectedValueOnce(new Error("Webhook rejected"));
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();

      await testChannel("discord");

      const errorOutput = consoleErrorSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
      expect(errorOutput).toContain("Failed to send test notification");
      consoleErrorSpy.mockRestore();
    });

    it("should report failure when slack webhook fails", async () => {
      mockedNotifyStore.loadNotifyChannels.mockReturnValue({
        slack: { webhookUrl: "https://hooks.slack.com/services/T00/B00/XX" },
      });
      mockedAxios.post.mockRejectedValueOnce(new Error("Slack error"));
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();

      await testChannel("slack");

      const errorOutput = consoleErrorSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
      expect(errorOutput).toContain("Failed to send test notification");
      consoleErrorSpy.mockRestore();
    });

    it("should report error when channel not configured", async () => {
      mockedNotifyStore.loadNotifyChannels.mockReturnValue({});
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();

      await testChannel("telegram");

      const errorOutput = consoleErrorSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
      expect(errorOutput).toContain("not configured");
      consoleErrorSpy.mockRestore();
    });

    it("should report error for invalid channel name", async () => {
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();

      await testChannel("invalid-channel" as "telegram");

      expect(mockedAxios.post).not.toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe("notify remove", () => {
    it("should remove telegram channel", () => {
      removeChannel("telegram");

      expect(mockedNotifyStore.removeNotifyChannel).toHaveBeenCalledWith("telegram");
      const output = consoleSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
      expect(output).toContain("removed");
    });

    it("should remove discord channel", () => {
      removeChannel("discord");

      expect(mockedNotifyStore.removeNotifyChannel).toHaveBeenCalledWith("discord");
    });

    it("should remove slack channel", () => {
      removeChannel("slack");

      expect(mockedNotifyStore.removeNotifyChannel).toHaveBeenCalledWith("slack");
    });

    it("should report error for invalid channel name", () => {
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();

      removeChannel("invalid-channel" as "telegram");

      expect(mockedNotifyStore.removeNotifyChannel).not.toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe("loadNotifyConfig", () => {
    it("should load existing channel configuration", () => {
      mockedNotifyStore.loadNotifyChannels.mockReturnValue({
        telegram: { botToken: "123:abc", chatId: "555" },
        discord: { webhookUrl: "https://discord.com/api/webhooks/123/abc" },
      });

      const config = loadNotifyConfig();

      expect(config).toEqual({
        telegram: { botToken: "123:abc", chatId: "555" },
        discord: { webhookUrl: "https://discord.com/api/webhooks/123/abc" },
      });
    });

    it("should return empty config when no channels configured", () => {
      mockedNotifyStore.loadNotifyChannels.mockReturnValue({});

      const config = loadNotifyConfig();

      expect(config).toEqual({});
    });
  });

  describe("SSRF protection", () => {
    it("should reject webhook URL pointing to private IP (discord)", async () => {
      mockedNotifyStore.loadNotifyChannels.mockReturnValue({
        discord: { webhookUrl: "https://192.168.1.1/webhook" },
      });

      await expect(testChannel("discord")).rejects.toThrow("Webhook URL points to a private/reserved address");
    });

    it("should reject webhook URL with non-HTTPS protocol", async () => {
      mockedNotifyStore.loadNotifyChannels.mockReturnValue({
        slack: { webhookUrl: "http://example.com/webhook" },
      });

      await expect(testChannel("slack")).rejects.toThrow("Webhook URL must use HTTPS");
    });

    it("should reject webhook URL with localhost", async () => {
      mockedNotifyStore.loadNotifyChannels.mockReturnValue({
        discord: { webhookUrl: "https://localhost/webhook" },
      });

      await expect(testChannel("discord")).rejects.toThrow("Webhook URL points to a private/reserved address");
    });

    it("should reject webhook URL with 10.x private range", async () => {
      mockedNotifyStore.loadNotifyChannels.mockReturnValue({
        slack: { webhookUrl: "https://10.0.0.1/webhook" },
      });

      await expect(testChannel("slack")).rejects.toThrow("Webhook URL points to a private/reserved address");
    });

    it("should reject webhook URL with 172.16.x range", async () => {
      mockedNotifyStore.loadNotifyChannels.mockReturnValue({
        discord: { webhookUrl: "https://172.16.0.1/webhook" },
      });

      await expect(testChannel("discord")).rejects.toThrow("Webhook URL points to a private/reserved address");
    });
  });
});
