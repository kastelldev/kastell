import inquirer from "inquirer";

jest.mock("inquirer");

jest.mock("../../../src/utils/config", () => ({
  getServers: jest.fn(),
}));

import { getServers } from "../../../src/utils/config.js";
import {
  promptSnapshot,
  promptMaintain,
  promptUpdate,
  promptBackup,
  promptImport,
  promptNotify,
  promptCompletions,
} from "../../../src/commands/interactive/backup-maintenance.js";

const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;
const mockedGetServers = getServers as jest.MockedFunction<typeof getServers>;

describe("interactive backup-maintenance prompts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetServers.mockReturnValue([]);
  });

  describe("promptSnapshot", () => {
    it("should return argv for create action", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "create" });
      const result = await promptSnapshot();
      expect(result).toEqual(["snapshot", "create"]);
    });

    it("should return argv for list action", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "list" });
      const result = await promptSnapshot();
      expect(result).toEqual(["snapshot", "list"]);
    });

    it("should return argv for list-all action", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "list-all" });
      const result = await promptSnapshot();
      expect(result).toEqual(["snapshot", "list", "--all"]);
    });

    it("should return argv for restore action", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "restore" });
      const result = await promptSnapshot();
      expect(result).toEqual(["snapshot", "restore"]);
    });

    it("should return argv for delete action", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "delete" });
      const result = await promptSnapshot();
      expect(result).toEqual(["snapshot", "delete"]);
    });
  });

  describe("promptMaintain", () => {
    it("should return argv for full mode", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "full" });
      const result = await promptMaintain();
      expect(result).toEqual(["maintain"]);
    });

    it("should return argv for skip-reboot mode", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "skip-reboot" });
      const result = await promptMaintain();
      expect(result).toEqual(["maintain", "--skip-reboot"]);
    });

    it("should return argv for all servers mode", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "all" });
      const result = await promptMaintain();
      expect(result).toEqual(["maintain", "--all"]);
    });

    it("should return argv for dry-run mode", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "dry-run" });
      const result = await promptMaintain();
      expect(result).toEqual(["maintain", "--dry-run"]);
    });
  });

  describe("promptUpdate", () => {
    it("should return argv for single server", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "single" });
      const result = await promptUpdate();
      expect(result).toEqual(["update"]);
    });

    it("should return argv for all servers", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "all" });
      const result = await promptUpdate();
      expect(result).toEqual(["update", "--all"]);
    });
  });

  describe("promptBackup", () => {
    it("should return argv for create action", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "create" });
      const result = await promptBackup();
      expect(result).toEqual(["backup"]);
    });

    it("should return argv for backup all servers", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "all" });
      const result = await promptBackup();
      expect(result).toEqual(["backup", "--all"]);
    });

    it("should return argv for dry-run", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "dry-run" });
      const result = await promptBackup();
      expect(result).toEqual(["backup", "--dry-run"]);
    });

    it("should return argv for schedule list", async () => {
      mockedInquirer.prompt
        .mockResolvedValueOnce({ answer: "schedule" })
        .mockResolvedValueOnce({ answer: "list" });
      const result = await promptBackup();
      expect(result).toEqual(["backup", "--schedule", "list"]);
    });

    it("should return argv for schedule remove", async () => {
      mockedInquirer.prompt
        .mockResolvedValueOnce({ answer: "schedule" })
        .mockResolvedValueOnce({ answer: "remove" });
      const result = await promptBackup();
      expect(result).toEqual(["backup", "--schedule", "remove"]);
    });

    it("should return argv for schedule set with cron", async () => {
      mockedInquirer.prompt
        .mockResolvedValueOnce({ answer: "schedule" })
        .mockResolvedValueOnce({ answer: "set" })
        .mockResolvedValueOnce({ cron: "0 2 * * *" });
      const result = await promptBackup();
      expect(result).toEqual(["backup", "--schedule", "0 2 * * *"]);
    });
  });

  describe("promptImport", () => {
    it("should return argv with file path", async () => {
      mockedInquirer.prompt
        .mockResolvedValueOnce({ answer: "file" })
        .mockResolvedValueOnce({ path: "/path/to/servers.json" });
      const result = await promptImport();
      expect(result).toEqual(["import", "/path/to/servers.json"]);
    });
  });

  describe("promptNotify", () => {
    it("should return argv for list action", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "list" });
      const result = await promptNotify();
      expect(result).toEqual(["notify", "list"]);
    });

    it("should return argv for add action", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "add" });
      const result = await promptNotify();
      expect(result).toEqual(["notify", "add"]);
    });

    it("should return argv for remove action", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "remove" });
      const result = await promptNotify();
      expect(result).toEqual(["notify", "remove"]);
    });

    it("should return argv for test action", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "test" });
      const result = await promptNotify();
      expect(result).toEqual(["notify", "test"]);
    });
  });

  describe("promptCompletions", () => {
    it("should return argv for bash shell", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "bash" });
      const result = await promptCompletions();
      expect(result).toEqual(["completions", "bash"]);
    });

    it("should return argv for zsh shell", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "zsh" });
      const result = await promptCompletions();
      expect(result).toEqual(["completions", "zsh"]);
    });

    it("should return argv for fish shell", async () => {
      mockedInquirer.prompt.mockResolvedValueOnce({ answer: "fish" });
      const result = await promptCompletions();
      expect(result).toEqual(["completions", "fish"]);
    });
  });
});
