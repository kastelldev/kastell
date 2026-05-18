import inquirer from "inquirer";
import { promptPlugin } from "../../../src/commands/interactive/plugins.js";
import { runInteractiveFlow } from "../../helpers/interactiveFlow.js";

jest.mock("../../../src/plugin/loader", () => ({
  loadPlugins: jest.fn().mockResolvedValue(undefined),
}));

const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;

describe("promptPlugin", () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("should return ['plugin', 'list'] when user selects List installed plugins", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({ answer: "list" });

    const result = await promptPlugin();

    expect(result).toEqual(["plugin", "list"]);
  });

  it("should return ['plugin', 'validate'] when user selects Validate plugins", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({ answer: "validate" });

    const result = await promptPlugin();

    expect(result).toEqual(["plugin", "validate"]);
  });

  it("should prompt for plugin name and return correct argv for Install a plugin", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ answer: "install" })
      .mockResolvedValueOnce({ name: "my-plugin" });

    const result = await promptPlugin();

    expect(result).toEqual(["plugin", "install", "my-plugin"]);
  });

  it("should prompt for plugin name and return correct argv for Remove a plugin", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ answer: "remove" })
      .mockResolvedValueOnce({ name: "my-plugin" });

    const result = await promptPlugin();

    expect(result).toEqual(["plugin", "remove", "my-plugin"]);
  });

  it("should return null when user cancels the main action prompt", async () => {
    mockedInquirer.prompt.mockResolvedValueOnce({ answer: undefined });

    const result = await promptPlugin();

    expect(result).toBeNull();
  });

  it("should return null when user cancels the install name prompt", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ answer: "install" })
      .mockResolvedValueOnce({ name: undefined });

    const result = await promptPlugin();

    expect(result).toBeNull();
  });

  it("should return null when user cancels the remove name prompt", async () => {
    mockedInquirer.prompt
      .mockResolvedValueOnce({ answer: "remove" })
      .mockResolvedValueOnce({ name: undefined });

    const result = await promptPlugin();

    expect(result).toBeNull();
  });
});