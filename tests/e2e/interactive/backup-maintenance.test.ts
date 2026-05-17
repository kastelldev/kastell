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
      const { reset } = runInteractiveFlow([
        { name: "Snapshot action:", value: "create" },
      ]);
      const result = await promptSnapshot();
      expect(result).toEqual(["snapshot", "create"]);
      reset();
    });

    it("should return argv for list action", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Snapshot action:", value: "list" },
      ]);
      const result = await promptSnapshot();
      expect(result).toEqual(["snapshot", "list"]);
      reset();
    });

    it("should return argv for list-all action", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Snapshot action:", value: "list-all" },
      ]);
      const result = await promptSnapshot();
      expect(result).toEqual(["snapshot", "list", "--all"]);
      reset();
    });

    it("should return argv for restore action", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Snapshot action:", value: "restore" },
      ]);
      const result = await promptSnapshot();
      expect(result).toEqual(["snapshot", "restore"]);
      reset();
    });

    it("should return argv for delete action", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Snapshot action:", value: "delete" },
      ]);
      const result = await promptSnapshot();
      expect(result).toEqual(["snapshot", "delete"]);
      reset();
    });
  });

  describe("promptMaintain", () => {
    it("should return argv for full mode", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Maintenance mode:", value: "full" },
      ]);
      const result = await promptMaintain();
      expect(result).toEqual(["maintain"]);
      reset();
    });

    it("should return argv for skip-reboot mode", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Maintenance mode:", value: "skip-reboot" },
      ]);
      const result = await promptMaintain();
      expect(result).toEqual(["maintain", "--skip-reboot"]);
      reset();
    });

    it("should return argv for all servers mode", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Maintenance mode:", value: "all" },
      ]);
      const result = await promptMaintain();
      expect(result).toEqual(["maintain", "--all"]);
      reset();
    });

    it("should return argv for dry-run mode", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Maintenance mode:", value: "dry-run" },
      ]);
      const result = await promptMaintain();
      expect(result).toEqual(["maintain", "--dry-run"]);
      reset();
    });
  });

  describe("promptUpdate", () => {
    it("should return argv for single server", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Update scope:", value: "single" },
      ]);
      const result = await promptUpdate();
      expect(result).toEqual(["update"]);
      reset();
    });

    it("should return argv for all servers", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Update scope:", value: "all" },
      ]);
      const result = await promptUpdate();
      expect(result).toEqual(["update", "--all"]);
      reset();
    });
  });

  describe("promptBackup", () => {
    it("should return argv for create action", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Backup action:", value: "create" },
      ]);
      const result = await promptBackup();
      expect(result).toEqual(["backup", "create"]);
      reset();
    });

    it("should return argv for backup all servers", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Backup action:", value: "all" },
      ]);
      const result = await promptBackup();
      expect(result).toEqual(["backup", "--all"]);
      reset();
    });

    it("should return argv for dry-run", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Backup action:", value: "dry-run" },
      ]);
      const result = await promptBackup();
      expect(result).toEqual(["backup", "--dry-run"]);
      reset();
    });

    it("should return argv for schedule list", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Backup action:", value: "schedule" },
        { name: "Backup schedule:", value: "list" },
      ]);
      const result = await promptBackup();
      expect(result).toEqual(["backup", "--schedule", "list"]);
      reset();
    });

    it("should return argv for schedule remove", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Backup action:", value: "schedule" },
        { name: "Backup schedule:", value: "remove" },
      ]);
      const result = await promptBackup();
      expect(result).toEqual(["backup", "--schedule", "remove"]);
      reset();
    });

    it("should return argv for schedule set with cron", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Backup action:", value: "schedule" },
        { name: "Backup schedule:", value: "set" },
        { cron: "0 2 * * *" },
      ]);
      const result = await promptBackup();
      expect(result).toEqual(["backup", "--schedule", "0 2 * * *"]);
      reset();
    });
  });

  describe("promptImport", () => {
    it("should return argv with file path", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Import server list:", value: "file" },
        { path: "/path/to/servers.json" },
      ]);
      const result = await promptImport();
      expect(result).toEqual(["import", "/path/to/servers.json"]);
      reset();
    });
  });

  describe("promptNotify", () => {
    it("should return argv for list action", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Notification action:", value: "list" },
      ]);
      const result = await promptNotify();
      expect(result).toEqual(["notify", "list"]);
      reset();
    });

    it("should return argv for add action", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Notification action:", value: "add" },
      ]);
      const result = await promptNotify();
      expect(result).toEqual(["notify", "add"]);
      reset();
    });

    it("should return argv for remove action", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Notification action:", value: "remove" },
      ]);
      const result = await promptNotify();
      expect(result).toEqual(["notify", "remove"]);
      reset();
    });

    it("should return argv for test action", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Notification action:", value: "test" },
      ]);
      const result = await promptNotify();
      expect(result).toEqual(["notify", "test"]);
      reset();
    });
  });

  describe("promptCompletions", () => {
    it("should return argv for bash shell", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Shell:", value: "bash" },
      ]);
      const result = await promptCompletions();
      expect(result).toEqual(["completions", "bash"]);
      reset();
    });

    it("should return argv for zsh shell", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Shell:", value: "zsh" },
      ]);
      const result = await promptCompletions();
      expect(result).toEqual(["completions", "zsh"]);
      reset();
    });

    it("should return argv for fish shell", async () => {
      const { reset } = runInteractiveFlow([
        { name: "Shell:", value: "fish" },
      ]);
      const result = await promptCompletions();
      expect(result).toEqual(["completions", "fish"]);
      reset();
    });
  });
});