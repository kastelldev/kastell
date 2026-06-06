import inquirer from "inquirer";
import { runInteractiveFlow } from "../interactiveFlow";

jest.mock("inquirer");

const mockedInquirer = inquirer as jest.Mocked<typeof inquirer>;

describe("interactiveFlow", () => {
  afterEach(() => jest.resetAllMocks());

  it("consumes object steps in order", async () => {
    const flow = runInteractiveFlow([
      { action: "security" },
      { action: "exit" },
    ]);

    const a1 = await mockedInquirer.prompt([{ type: "list", name: "action", message: "?", choices: [] }]);
    const a2 = await mockedInquirer.prompt([{ type: "list", name: "action", message: "?", choices: [] }]);

    expect(a1).toEqual({ action: "security" });
    expect(a2).toEqual({ action: "exit" });
    expect(flow.unconsumed()).toBe(0);
  });

  it("supports function step with prompt name argument", async () => {
    const flow = runInteractiveFlow([
      (name) => ({ [name]: "computed-value" }),
    ]);
    const a = await mockedInquirer.prompt([{ type: "input", name: "username", message: "?" }]);
    expect(a).toEqual({ username: "computed-value" });
    expect(flow.unconsumed()).toBe(0);
  });

  it("throws when queue exhausted but prompt still called", async () => {
    runInteractiveFlow([{ action: "exit" }]);
    await mockedInquirer.prompt([{ type: "list", name: "action", message: "?", choices: [] }]);
    await expect(
      mockedInquirer.prompt([{ type: "list", name: "action", message: "?", choices: [] }])
    ).rejects.toThrow(/queue exhausted/);
  });
});
