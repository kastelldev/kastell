import * as scheduleManager from "../../../src/core/scheduleManager";
import * as serverSelect from "../../../src/utils/serverSelect";
import * as backupSchedule from "../../../src/core/backupSchedule";
import * as loggerUtils from "../../../src/utils/logger";
import { scheduleCommand } from "../../../src/commands/schedule";
import { Command } from "commander";

jest.mock("../../../src/core/scheduleManager");
jest.mock("../../../src/utils/serverSelect");
jest.mock("../../../src/core/backupSchedule");
jest.mock("../../../src/utils/logger");

const mockedScheduleManager = scheduleManager as jest.Mocked<typeof scheduleManager>;
const mockedServerSelect = serverSelect as jest.Mocked<typeof serverSelect>;
const mockedBackupSchedule = backupSchedule as jest.Mocked<typeof backupSchedule>;
const mockedLogger = loggerUtils as jest.Mocked<typeof loggerUtils>;

const sampleServer = {
  id: "server-1",
  name: "my-server",
  provider: "hetzner" as const,
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00.000Z",
  mode: "bare" as const,
};

async function runSubcommand(args: string[]): Promise<void> {
  const cmd = scheduleCommand();
  // Prevent Commander from calling process.exit on errors
  cmd.exitOverride();
  for (const sub of cmd.commands) {
    sub.exitOverride();
  }
  await cmd.parseAsync(["node", "kastell", ...args]);
}

describe("scheduleCommand", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    consoleSpy = jest.spyOn(console, "log").mockImplementation();

    mockedBackupSchedule.validateCronExpr.mockReturnValue({ valid: true });
    mockedServerSelect.resolveServer.mockResolvedValue(sampleServer);
    mockedScheduleManager.installLocalCron.mockReturnValue({ success: true });
    mockedScheduleManager.removeLocalCron.mockReturnValue({ success: true });
    mockedScheduleManager.listLocalCron.mockReturnValue([]);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("command structure", () => {
    it("returns a Command instance with name 'schedule'", () => {
      const cmd = scheduleCommand();
      expect(cmd).toBeInstanceOf(Command);
      expect(cmd.name()).toBe("schedule");
    });

    it("has fix subcommand", () => {
      const cmd = scheduleCommand();
      const names = cmd.commands.map((c) => c.name());
      expect(names).toContain("fix");
    });

    it("has audit subcommand", () => {
      const cmd = scheduleCommand();
      const names = cmd.commands.map((c) => c.name());
      expect(names).toContain("audit");
    });

    it("has list subcommand", () => {
      const cmd = scheduleCommand();
      const names = cmd.commands.map((c) => c.name());
      expect(names).toContain("list");
    });

    it("has remove subcommand", () => {
      const cmd = scheduleCommand();
      const names = cmd.commands.map((c) => c.name());
      expect(names).toContain("remove");
    });
  });

  describe("fix subcommand", () => {
    it("calls installLocalCron with correct args on success", async () => {
      await runSubcommand(["fix", "--server", "my-server", "--cron", "0 3 * * *"]);

      expect(mockedScheduleManager.installLocalCron).toHaveBeenCalledWith(
        "0 3 * * *",
        sampleServer.name,
        "fix",
      );
    });

    it("shows error when --cron is missing", async () => {
      await runSubcommand(["fix", "--server", "my-server"]);

      expect(mockedLogger.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Cron expression required"),
      );
      expect(mockedScheduleManager.installLocalCron).not.toHaveBeenCalled();
    });

    it("shows error when cron expression is invalid", async () => {
      mockedBackupSchedule.validateCronExpr.mockReturnValue({
        valid: false,
        error: "Must have 5 fields",
      });

      await runSubcommand(["fix", "--server", "my-server", "--cron", "bad"]);

      expect(mockedLogger.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid cron expression"),
      );
      expect(mockedScheduleManager.installLocalCron).not.toHaveBeenCalled();
    });

    it("shows success message when cron installed", async () => {
      await runSubcommand(["fix", "--server", "my-server", "--cron", "0 3 * * *"]);

      expect(mockedLogger.logger.success).toHaveBeenCalledWith(
        expect.stringContaining("Fix schedule installed"),
      );
    });

    it("shows machine-must-be-running caveat", async () => {
      await runSubcommand(["fix", "--server", "my-server", "--cron", "0 3 * * *"]);

      expect(mockedLogger.logger.info).toHaveBeenCalledWith(
        expect.stringContaining("machine must be running"),
      );
    });

    it("shows Windows Task Scheduler instructions on windowsFallback", async () => {
      mockedScheduleManager.installLocalCron.mockReturnValue({
        success: true,
        windowsFallback: true,
        command: "kastell fix --safe --server my-server --no-interactive",
      });

      await runSubcommand(["fix", "--server", "my-server", "--cron", "0 3 * * *"]);

      expect(loggerUtils.logger.warning).toHaveBeenCalledWith(
        expect.stringContaining("Windows detected"),
      );
    });

    it("shows error when installLocalCron fails", async () => {
      mockedScheduleManager.installLocalCron.mockReturnValue({
        success: false,
        error: "cron write failed",
      });

      await runSubcommand(["fix", "--server", "my-server", "--cron", "0 3 * * *"]);

      expect(mockedLogger.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("cron write failed"),
      );
    });
  });

  describe("audit subcommand", () => {
    it("calls installLocalCron with type 'audit'", async () => {
      await runSubcommand(["audit", "--server", "my-server", "--cron", "0 6 * * 1"]);

      expect(mockedScheduleManager.installLocalCron).toHaveBeenCalledWith(
        "0 6 * * 1",
        sampleServer.name,
        "audit",
      );
    });

    it("shows error when --cron is missing", async () => {
      await runSubcommand(["audit", "--server", "my-server"]);

      expect(mockedLogger.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Cron expression required"),
      );
    });

    it("shows success message on success", async () => {
      await runSubcommand(["audit", "--server", "my-server", "--cron", "0 6 * * 1"]);

      expect(mockedLogger.logger.success).toHaveBeenCalledWith(
        expect.stringContaining("Audit schedule installed"),
      );
    });

    it("shows machine-must-be-running caveat", async () => {
      await runSubcommand(["audit", "--server", "my-server", "--cron", "0 6 * * 1"]);

      expect(mockedLogger.logger.info).toHaveBeenCalledWith(
        expect.stringContaining("machine must be running"),
      );
    });
  });

  describe("list subcommand", () => {
    it("calls listLocalCron without filter when no --server", async () => {
      await runSubcommand(["list"]);

      expect(mockedScheduleManager.listLocalCron).toHaveBeenCalledWith(undefined);
    });

    it("calls listLocalCron with server filter when --server provided", async () => {
      await runSubcommand(["list", "--server", "my-server"]);

      expect(mockedScheduleManager.listLocalCron).toHaveBeenCalledWith("my-server");
    });

    it("shows 'No schedules found' when list is empty", async () => {
      mockedScheduleManager.listLocalCron.mockReturnValue([]);

      await runSubcommand(["list"]);

      expect(mockedLogger.logger.info).toHaveBeenCalledWith(
        expect.stringContaining("No schedules found"),
      );
    });

    it("formats table output when schedules exist", async () => {
      mockedScheduleManager.listLocalCron.mockReturnValue([
        { server: "my-server", type: "fix", cronExpr: "0 3 * * *" },
        { server: "other-server", type: "audit", cronExpr: "0 6 * * 1" },
      ]);

      await runSubcommand(["list"]);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Server"),
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("my-server"),
      );
    });
  });

  describe("remove subcommand", () => {
    it("calls removeLocalCron with correct server and type", async () => {
      await runSubcommand(["remove", "--server", "my-server", "--type", "fix"]);

      expect(mockedScheduleManager.removeLocalCron).toHaveBeenCalledWith(
        sampleServer.name,
        "fix",
      );
    });

    it("shows error when --type is missing", async () => {
      await runSubcommand(["remove", "--server", "my-server"]);

      expect(mockedLogger.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Type required"),
      );
      expect(mockedScheduleManager.removeLocalCron).not.toHaveBeenCalled();
    });

    it("shows error when --type is invalid", async () => {
      await runSubcommand(["remove", "--server", "my-server", "--type", "invalid"]);

      expect(mockedLogger.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid type"),
      );
      expect(mockedScheduleManager.removeLocalCron).not.toHaveBeenCalled();
    });

    it("shows success message on removal", async () => {
      await runSubcommand(["remove", "--server", "my-server", "--type", "fix"]);

      expect(mockedLogger.logger.success).toHaveBeenCalledWith(
        expect.stringContaining("Removed fix schedule"),
      );
    });

    it("shows error when removeLocalCron fails", async () => {
      mockedScheduleManager.removeLocalCron.mockReturnValue({
        success: false,
        error: "cron removal failed",
      });

      await runSubcommand(["remove", "--server", "my-server", "--type", "audit"]);

      expect(mockedLogger.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("cron removal failed"),
      );
    });

    it("supports audit type", async () => {
      await runSubcommand(["remove", "--server", "my-server", "--type", "audit"]);

      expect(mockedScheduleManager.removeLocalCron).toHaveBeenCalledWith(
        sampleServer.name,
        "audit",
      );
    });
  });
});
