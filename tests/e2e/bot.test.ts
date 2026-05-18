import axios from "axios";
import inquirer from "inquirer";
import { addChannel } from "../../src/core/notify.js";

jest.mock("../../src/core/notifyStore.js", () => ({
  saveNotifyChannel: jest.fn(),
  removeNotifyChannel: jest.fn(),
  loadNotifyChannels: jest.fn().mockReturnValue({}),
  readNotifySecret: jest.fn(),
  storeNotifySecret: jest.fn(),
  loadAllowedChatIds: jest.fn().mockReturnValue([]),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;

describe("bot command (notify add telegram) E2E", () => {
  let consoleSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
    processExitSpy = jest.spyOn(process, "exit").mockImplementation((() => {}) as unknown as typeof process.exit);
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe("addChannel with telegram channel", () => {
    it("should save config and print success when credentials are provided", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({
        botToken: "123456:ABCdefGHI_JKLmnopQRStUVwxyz",
        chatId: "987654321",
      });

      await addChannel("telegram", {});

      const { saveNotifyChannel } = require("../../src/core/notifyStore.js");
      expect(saveNotifyChannel).toHaveBeenCalledWith("telegram", {
        botToken: "123456:ABCdefGHI_JKLmnopQRStUVwxyz",
        chatId: "987654321",
      });

      const allOutput = consoleSpy.mock.calls.map((c: unknown[]) => (c as string[]).join(" ")).join("\n");
      expect(allOutput).toContain("telegram");
      expect(allOutput).toContain("successfully");
      expect(processExitSpy).not.toHaveBeenCalled();
    });

    it("should accept malformed token format and save it (no in-band validation)", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({
        botToken: "not-a-valid-format",
        chatId: "987654321",
      });

      await addChannel("telegram", {});

      // addChannel does not validate token format — it saves whatever is provided
      const { saveNotifyChannel } = require("../../src/core/notifyStore.js");
      expect(saveNotifyChannel).toHaveBeenCalledWith("telegram", {
        botToken: "not-a-valid-format",
        chatId: "987654321",
      });

      const allOutput = consoleSpy.mock.calls.map((c: unknown[]) => (c as string[]).join(" ")).join("\n");
      expect(allOutput).toContain("successfully");
    });

    it("should accept empty botToken and save it (no in-band validation)", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({
        botToken: "",
        chatId: "987654321",
      });

      await addChannel("telegram", {});

      const { saveNotifyChannel } = require("../../src/core/notifyStore.js");
      expect(saveNotifyChannel).toHaveBeenCalledWith("telegram", {
        botToken: "",
        chatId: "987654321",
      });
    });

    it("should still save channel when prompt returns empty inputs (no Zod validation in addChannel)", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({
        botToken: "",
        chatId: "",
      });

      await addChannel("telegram", {});

      // addChannel does not run Zod validation — empty chatId still triggers save.
      const { saveNotifyChannel } = require("../../src/core/notifyStore.js");
      expect(saveNotifyChannel).toHaveBeenCalled();
    });

    it("should save valid config in force mode with botToken and chatId options", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({
        botToken: "123456:ABCdefGHI_JKLmnopQRStUVwxyz",
        chatId: "111222333",
      });

      await addChannel("telegram", {
        botToken: "123456:ABCdefGHI_JKLmnopQRStUVwxyz",
        chatId: "111222333",
      });

      const { saveNotifyChannel } = require("../../src/core/notifyStore.js");
      expect(saveNotifyChannel).toHaveBeenCalledWith("telegram", {
        botToken: "123456:ABCdefGHI_JKLmnopQRStUVwxyz",
        chatId: "111222333",
      });
    });

    it("should require both --bot-token and --chat-id in force mode", async () => {
      await addChannel("telegram", { force: true, botToken: "123456:ABCdef", chatId: "" });

      const { saveNotifyChannel } = require("../../src/core/notifyStore.js");
      expect(saveNotifyChannel).not.toHaveBeenCalled();

      const allOutput = consoleErrorSpy.mock.calls.map((c: unknown[]) => (c as string[]).join(" ")).join("\n");
      expect(allOutput).toContain("Telegram requires --bot-token and --chat-id");
    });
  });
});