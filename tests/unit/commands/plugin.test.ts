import inquirer from "inquirer";
import * as pluginCore from "../../../src/core/plugin";
import * as loggerUtils from "../../../src/utils/logger";
import {
  pluginInstallCommand,
  pluginRemoveCommand,
  pluginListCommand,
  pluginValidateCommand,
} from "../../../src/commands/plugin";

jest.mock("inquirer");
jest.mock("../../../src/core/plugin");
jest.mock("../../../src/utils/logger");
jest.mock("../../../src/utils/version.js", () => ({
  getKastellVersion: () => "2.1.0",
  KASTELL_VERSION: "2.1.0",
  clearVersionCache: jest.fn(),
}));

const mockedPluginCore = pluginCore as jest.Mocked<typeof pluginCore>;
const mockedLogger = loggerUtils as jest.Mocked<typeof loggerUtils>;
const loggerInfo = loggerUtils.logger.info as jest.Mock;
const loggerSuccess = loggerUtils.logger.success as jest.Mock;
const loggerError = loggerUtils.logger.error as jest.Mock;

const mockSpinner = {
  start: jest.fn(),
  stop: jest.fn(),
};
mockedLogger.createSpinner.mockReturnValue(mockSpinner as any);

describe("pluginInstallCommand", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedLogger.createSpinner.mockReturnValue(mockSpinner as any);
  });

  it("should validate name before showing confirm prompt", async () => {
    const promptSpy = jest.spyOn(inquirer, "prompt");

    await pluginInstallCommand("invalid-name", { force: false });

    expect(promptSpy).not.toHaveBeenCalled();
    expect(mockedLogger.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Invalid plugin name"),
    );
  });

  it("should prompt for confirmation when force is false", async () => {
    (inquirer.prompt as unknown as jest.Mock).mockResolvedValueOnce({ confirm: false });

    await pluginInstallCommand("kastell-plugin-my-plugin", { force: false });

    expect(inquirer.prompt).toHaveBeenCalledWith([
      expect.objectContaining({
        type: "confirm",
        name: "confirm",
        message: expect.stringContaining("root privileges"),
      }),
    ]);
    expect(mockedPluginCore.installPlugin).not.toHaveBeenCalled();
  });

  it("should cancel install when user declines confirmation", async () => {
    (inquirer.prompt as unknown as jest.Mock).mockResolvedValueOnce({ confirm: false });

    await pluginInstallCommand("kastell-plugin-my-plugin", { force: false });

    expect(mockedLogger.logger.info).toHaveBeenCalledWith("Plugin install cancelled.");
    expect(mockedPluginCore.installPlugin).not.toHaveBeenCalled();
  });

  it("should skip confirmation when force is true", async () => {
    mockedPluginCore.installPlugin.mockResolvedValueOnce({ success: true, name: "my-plugin" });

    await pluginInstallCommand("kastell-plugin-my-plugin", { force: true });

    expect(inquirer.prompt).not.toHaveBeenCalled();
    expect(mockedPluginCore.installPlugin).toHaveBeenCalledWith("kastell-plugin-my-plugin", undefined);
  });

  it("should install with version option", async () => {
    mockedPluginCore.installPlugin.mockResolvedValueOnce({ success: true, name: "my-plugin" });

    await pluginInstallCommand("kastell-plugin-my-plugin", { version: "1.0.0", force: true });

    expect(mockedPluginCore.installPlugin).toHaveBeenCalledWith("kastell-plugin-my-plugin", "1.0.0");
  });

  it("should show success message on install success", async () => {
    mockedPluginCore.installPlugin.mockResolvedValueOnce({ success: true, name: "my-plugin" });

    await pluginInstallCommand("kastell-plugin-my-plugin", { force: true });

    expect(mockedLogger.logger.success).toHaveBeenCalledWith(
      "Plugin kastell-plugin-my-plugin installed successfully.",
    );
  });

  it("should show error message on install failure", async () => {
    mockedPluginCore.installPlugin.mockResolvedValueOnce({
      success: false,
      name: "my-plugin",
      error: "network timeout",
    });

    await pluginInstallCommand("kastell-plugin-my-plugin", { force: true });

    expect(mockedLogger.logger.error).toHaveBeenCalledWith("network timeout");
  });

  it("should show generic error when error is undefined", async () => {
    mockedPluginCore.installPlugin.mockResolvedValueOnce({ success: false, name: "my-plugin" });

    await pluginInstallCommand("kastell-plugin-my-plugin", { force: true });

    expect(mockedLogger.logger.error).toHaveBeenCalledWith("Plugin install failed.");
  });
});

describe("pluginRemoveCommand", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedLogger.createSpinner.mockReturnValue(mockSpinner as any);
  });

  it("should show success message on remove success", async () => {
    mockedPluginCore.removePlugin.mockResolvedValueOnce({ success: true, name: "my-plugin" });

    await pluginRemoveCommand("my-plugin");

    expect(mockedLogger.logger.success).toHaveBeenCalledWith(
      "Plugin my-plugin removed successfully.",
    );
  });

  it("should show error message on remove failure", async () => {
    mockedPluginCore.removePlugin.mockResolvedValueOnce({
      success: false,
      name: "my-plugin",
      error: "plugin not found",
    });

    await pluginRemoveCommand("my-plugin");

    expect(mockedLogger.logger.error).toHaveBeenCalledWith("plugin not found");
  });

  it("should show generic error when error is undefined", async () => {
    mockedPluginCore.removePlugin.mockResolvedValueOnce({ success: false, name: "my-plugin" });

    await pluginRemoveCommand("my-plugin");

    expect(mockedLogger.logger.error).toHaveBeenCalledWith("Plugin remove failed.");
  });
});

describe("pluginListCommand", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("should show no plugins message when list is empty", () => {
    mockedPluginCore.listPlugins.mockReturnValueOnce([]);

    pluginListCommand();

    expect(mockedLogger.logger.info).toHaveBeenCalledWith("No plugins installed.");
  });

  it("should render table header with correct columns", () => {
    mockedPluginCore.listPlugins.mockReturnValueOnce([
      { name: "a-plugin", version: "1.0.0", prefix: "ap", status: "loaded" as const, checks: 1 },
    ]);

    pluginListCommand();

    expect(loggerInfo).toHaveBeenCalledWith(
      expect.stringContaining("Name"),
    );
    expect(loggerInfo).toHaveBeenCalledWith(
      expect.stringContaining("Version"),
    );
    expect(loggerInfo).toHaveBeenCalledWith(
      expect.stringContaining("Prefix"),
    );
    expect(loggerInfo).toHaveBeenCalledWith(
      expect.stringContaining("Status"),
    );
  });

  it("should render loaded plugin with green status", () => {
    mockedPluginCore.listPlugins.mockReturnValueOnce([
      {
        name: "test-plugin",
        version: "1.0.0",
        prefix: "tp",
        status: "loaded",
        checks: 3,
      },
    ]);

    pluginListCommand();

    const infoCalls = loggerInfo.mock.calls;
    const tableLine = infoCalls.find((call) => call[0].includes("test-plugin"));
    expect(tableLine).toBeDefined();
    expect(tableLine![0]).toContain("loaded");
  });

  it("should render failed plugin with red status and reason", () => {
    mockedPluginCore.listPlugins.mockReturnValueOnce([
      {
        name: "broken-plugin",
        version: "2.0.0",
        prefix: "bp",
        status: "failed",
        reason: "missing entry point",
        checks: 0,
      },
    ]);

    pluginListCommand();

    const infoCalls = loggerInfo.mock.calls;
    const tableLine = infoCalls.find((call) => call[0].includes("broken-plugin"));
    expect(tableLine).toBeDefined();
    expect(tableLine![0]).toContain("failed");
    expect(tableLine![0]).toContain("missing entry point");
  });

  it("should show validate hint when failed plugins exist", () => {
    mockedPluginCore.listPlugins.mockReturnValueOnce([
      {
        name: "failing-plugin",
        version: "1.0.0",
        prefix: "fp",
        status: "failed",
        reason: "load error",
        checks: 0,
      },
    ]);

    pluginListCommand();

    const infoCalls = loggerInfo.mock.calls;
    const validateHint = infoCalls.find((call) =>
      call[0].includes("kastell plugin validate"),
    );
    expect(validateHint).toBeDefined();
  });

  it("should not show validate hint when all plugins are loaded", () => {
    mockedPluginCore.listPlugins.mockReturnValueOnce([
      {
        name: "good-plugin",
        version: "1.0.0",
        prefix: "gp",
        status: "loaded",
        checks: 5,
      },
    ]);

    pluginListCommand();

    const infoCalls = loggerInfo.mock.calls;
    const validateHint = infoCalls.find((call) =>
      call[0].includes("kastell plugin validate"),
    );
    expect(validateHint).toBeUndefined();
  });
});

describe("pluginValidateCommand", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("should show no plugins message when list is empty", () => {
    mockedPluginCore.validatePlugins.mockReturnValueOnce([]);

    pluginValidateCommand();

    expect(mockedLogger.logger.info).toHaveBeenCalledWith("No plugins to validate.");
  });

  it("should show success for valid plugin", () => {
    mockedPluginCore.validatePlugins.mockReturnValueOnce([
      { name: "my-plugin", valid: true },
    ]);

    pluginValidateCommand();

    expect(mockedLogger.logger.success).toHaveBeenCalledWith("my-plugin: valid");
  });

  it("should show error for invalid plugin", () => {
    mockedPluginCore.validatePlugins.mockReturnValueOnce([
      { name: "bad-plugin", valid: false, reason: "missing manifest" },
    ]);

    pluginValidateCommand();

    expect(mockedLogger.logger.error).toHaveBeenCalledWith(
      "bad-plugin: invalid — missing manifest",
    );
  });

  it("should show unknown error when reason is undefined", () => {
    mockedPluginCore.validatePlugins.mockReturnValueOnce([
      { name: "bad-plugin", valid: false },
    ]);

    pluginValidateCommand();

    expect(mockedLogger.logger.error).toHaveBeenCalledWith(
      "bad-plugin: invalid — unknown error",
    );
  });

  it("should validate specific plugin when name is provided", () => {
    mockedPluginCore.validatePlugins.mockReturnValueOnce([
      { name: "specific-plugin", valid: true },
    ]);

    pluginValidateCommand("specific-plugin");

    expect(mockedPluginCore.validatePlugins).toHaveBeenCalledWith("specific-plugin");
  });

  it("should validate all plugins when name is undefined", () => {
    mockedPluginCore.validatePlugins.mockReturnValueOnce([]);

    pluginValidateCommand();

    expect(mockedPluginCore.validatePlugins).toHaveBeenCalledWith(undefined);
  });

  it("should handle mixed valid and invalid results", () => {
    mockedPluginCore.validatePlugins.mockReturnValueOnce([
      { name: "good-plugin", valid: true },
      { name: "bad-plugin", valid: false, reason: "schema mismatch" },
      { name: "another-good", valid: true },
    ]);

    pluginValidateCommand();

    expect(mockedLogger.logger.success).toHaveBeenCalledWith("good-plugin: valid");
    expect(mockedLogger.logger.error).toHaveBeenCalledWith(
      "bad-plugin: invalid — schema mismatch",
    );
    expect(mockedLogger.logger.success).toHaveBeenCalledWith("another-good: valid");
  });
});