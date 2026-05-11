import inquirer from "inquirer";
import { promptPlugin } from "../../src/commands/interactive/plugins.js";
import { promptList } from "../../src/commands/interactive/shared.js";

jest.mock("../../src/commands/interactive/shared.js", () => ({
  promptList: jest.fn(),
}));

jest.mock("../../src/plugin/registry.js", () => ({
  getPluginCommands: jest.fn().mockReturnValue([
    {
      pluginShortName: "wordpress",
      command: { name: "scan", description: "WP scan", handler: "./scan.js" },
      pluginDir: "/fake",
    },
  ]),
}));

jest.mock("inquirer");

const mockedPrompt = inquirer.prompt as jest.MockedFunction<typeof inquirer.prompt>;

describe("promptPlugin with plugin commands", () => {
  it("returns plugin command args when 'run' selected", async () => {
    (promptList as jest.Mock).mockResolvedValueOnce("run");
    mockedPrompt
      .mockResolvedValueOnce({ plugin: "wordpress" })
      .mockResolvedValueOnce({ command: "scan" });
    const result = await promptPlugin();
    expect(result).toEqual(["wordpress", "scan"]);
  });
});