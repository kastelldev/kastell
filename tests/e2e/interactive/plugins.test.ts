import inquirer from "inquirer";
import { promptPlugin } from "../../../src/commands/interactive/plugins.js";
import { runInteractiveFlow } from "../../helpers/interactiveFlow.js";

jest.mock("../../../src/core/plugin/loader", () => ({
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
    const flow = runInteractiveFlow([{ sub: "list" }]);

    const result = await promptPlugin();

    expect(result).toEqual(["plugin", "list"]);
    expect(flow.unconsumed()).toBe(0);
  });

  it("should return ['plugin', 'validate'] when user selects Validate plugins", async () => {
    const flow = runInteractiveFlow([{ sub: "validate" }]);

    const result = await promptPlugin();

    expect(result).toEqual(["plugin", "validate"]);
    expect(flow.unconsumed()).toBe(0);
  });

  it("should prompt for plugin name and return correct argv for Install a plugin", async () => {
    const flow = runInteractiveFlow([
      { sub: "install" },
      { name: "my-plugin" },
    ]);

    const result = await promptPlugin();

    expect(result).toEqual(["plugin", "install", "my-plugin"]);
    expect(flow.unconsumed()).toBe(0);
  });

  it("should prompt for plugin name and return correct argv for Remove a plugin", async () => {
    const flow = runInteractiveFlow([
      { sub: "remove" },
      { name: "my-plugin" },
    ]);

    const result = await promptPlugin();

    expect(result).toEqual(["plugin", "remove", "my-plugin"]);
    expect(flow.unconsumed()).toBe(0);
  });

  it("should return null when user cancels the main action prompt", async () => {
    const flow = runInteractiveFlow([
      (_promptName: string) => {
        // inquirer returns {} when user cancels (Escape or empty selection)
        return {};
      },
    ]);

    const result = await promptPlugin();

    expect(result).toBeNull();
    expect(flow.unconsumed()).toBe(0);
  });

  it("should return null when user cancels the install name prompt", async () => {
    const flow = runInteractiveFlow([
      { sub: "install" },
      (_promptName: string) => ({}),
    ]);

    const result = await promptPlugin();

    expect(result).toBeNull();
    expect(flow.unconsumed()).toBe(0);
  });

  it("should return null when user cancels the remove name prompt", async () => {
    const flow = runInteractiveFlow([
      { sub: "remove" },
      (_promptName: string) => ({}),
    ]);

    const result = await promptPlugin();

    expect(result).toBeNull();
    expect(flow.unconsumed()).toBe(0);
  });
});