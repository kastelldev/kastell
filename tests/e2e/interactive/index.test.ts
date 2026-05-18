import inquirer from "inquirer";

jest.mock("inquirer");

const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;

jest.mock("../../../src/commands/interactive/menu", () => ({
  buildMainChoices: jest.fn(),
  clearChoicesCache: jest.fn(),
  SCHEDULE_COMMANDS: {
    "schedule-fix": "fix",
    "schedule-audit": "audit",
    "schedule-list": "list",
    "schedule-remove": "remove",
  },
}));

jest.mock("../../../src/commands/interactive/security", () => ({
  promptSecure: jest.fn(),
  promptFirewall: jest.fn(),
  promptDomain: jest.fn(),
  promptAudit: jest.fn(),
  promptLock: jest.fn(),
  promptFix: jest.fn(),
  promptEvidence: jest.fn(),
  promptAuth: jest.fn(),
}));

jest.mock("../../../src/commands/interactive/monitoring", () => ({
  promptLogs: jest.fn(),
  promptMonitor: jest.fn(),
  promptDoctor: jest.fn(),
  promptGuard: jest.fn(),
}));

jest.mock("../../../src/commands/interactive/backup-maintenance", () => ({
  promptBackup: jest.fn(),
  promptSnapshot: jest.fn(),
  promptMaintain: jest.fn(),
  promptUpdate: jest.fn(),
  promptNotify: jest.fn(),
  promptCompletions: jest.fn(),
  promptImport: jest.fn(),
}));

jest.mock("../../../src/commands/interactive/plugins", () => ({
  promptPlugin: jest.fn(),
}));

jest.mock("../../../src/commands/interactive/server-management", () => ({
  promptInit: jest.fn(),
  promptStatus: jest.fn(),
  promptSsh: jest.fn(),
  promptFleet: jest.fn(),
}));

import { interactiveMenu } from "../../../src/commands/interactive";
import { promptSecure, promptFirewall, promptAudit, promptFix } from "../../../src/commands/interactive/security";
import { promptMonitor, promptLogs } from "../../../src/commands/interactive/monitoring";
import { promptBackup, promptSnapshot, promptMaintain, promptUpdate, promptNotify, promptCompletions, promptImport } from "../../../src/commands/interactive/backup-maintenance";
import { promptPlugin } from "../../../src/commands/interactive/plugins";
import { promptInit, promptStatus, promptSsh, promptFleet } from "../../../src/commands/interactive/server-management";
import { clearChoicesCache } from "../../../src/commands/interactive/menu";

const mockedPromptSecure = promptSecure as jest.MockedFunction<typeof promptSecure>;
const mockedPromptFirewall = promptFirewall as jest.MockedFunction<typeof promptFirewall>;
const mockedPromptAudit = promptAudit as jest.MockedFunction<typeof promptAudit>;
const mockedPromptFix = promptFix as jest.MockedFunction<typeof promptFix>;
const mockedPromptMonitor = promptMonitor as jest.MockedFunction<typeof promptMonitor>;
const mockedPromptLogs = promptLogs as jest.MockedFunction<typeof promptLogs>;
const mockedPromptBackup = promptBackup as jest.MockedFunction<typeof promptBackup>;
const mockedPromptSnapshot = promptSnapshot as jest.MockedFunction<typeof promptSnapshot>;
const mockedPromptMaintain = promptMaintain as jest.MockedFunction<typeof promptMaintain>;
const mockedPromptUpdate = promptUpdate as jest.MockedFunction<typeof promptUpdate>;
const mockedPromptNotify = promptNotify as jest.MockedFunction<typeof promptNotify>;
const mockedPromptCompletions = promptCompletions as jest.MockedFunction<typeof promptCompletions>;
const mockedPromptImport = promptImport as jest.MockedFunction<typeof promptImport>;
const mockedPromptPlugin = promptPlugin as jest.MockedFunction<typeof promptPlugin>;
const mockedPromptInit = promptInit as jest.MockedFunction<typeof promptInit>;
const mockedPromptStatus = promptStatus as jest.MockedFunction<typeof promptStatus>;
const mockedPromptSsh = promptSsh as jest.MockedFunction<typeof promptSsh>;
const mockedPromptFleet = promptFleet as jest.MockedFunction<typeof promptFleet>;
const mockedClearChoicesCache = clearChoicesCache as jest.MockedFunction<typeof clearChoicesCache>;

describe("interactiveMenu dispatcher", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedInquirer.prompt.mockReset();
  });

  it("should dispatch secure action to promptSecure and return its argv", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({ action: "secure" });
    mockedPromptSecure.mockResolvedValueOnce(["--dry-run"]);

    const result = await interactiveMenu();

    expect(mockedPromptSecure).toHaveBeenCalledTimes(1);
    expect(result).toEqual(["--dry-run"]);
  });

  it("should return null when user picks exit", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({ action: "exit" });

    const result = await interactiveMenu();

    expect(result).toBeNull();
  });

  it("should return null when promptSub returns null (continue loop)", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ action: "secure" })
      .mockResolvedValueOnce({ action: "exit" });
    mockedPromptSecure.mockResolvedValueOnce(null);

    const result = await interactiveMenu();

    expect(result).toBeNull();
    expect(mockedPromptSecure).toHaveBeenCalledTimes(1);
  });

  it("should dispatch schedule-fix to schedule fix command", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({ action: "schedule-fix" });

    const result = await interactiveMenu();

    expect(result).toEqual(["schedule", "fix"]);
  });

  it("should dispatch direct command list to list argv", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({ action: "list" });

    const result = await interactiveMenu();

    expect(result).toEqual(["list"]);
  });

  it("should dispatch plugin action to promptPlugin", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({ action: "plugin" });
    mockedPromptPlugin.mockResolvedValueOnce(["plugin", "add", "nginx"]);

    const result = await interactiveMenu();

    expect(mockedPromptPlugin).toHaveBeenCalledTimes(1);
    expect(result).toEqual(["plugin", "add", "nginx"]);
  });

  it("should return action as argv for unknown action with no matching sub-prompt", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({ action: "unknown-cmd" });

    const result = await interactiveMenu();

    expect(result).toEqual(["unknown-cmd"]);
  });
});
