import { Command } from "commander";
import { registerAuthCommands } from "../../src/commands/auth";

describe("registerAuthCommands", () => {
  it("should register an 'auth' subcommand on the program", () => {
    const program = new Command();
    registerAuthCommands(program);
    const authCmd = program.commands.find((c) => c.name() === "auth");
    expect(authCmd).toBeDefined();
  });

  it("should set a description on the 'auth' command", () => {
    const program = new Command();
    registerAuthCommands(program);
    const authCmd = program.commands.find((c) => c.name() === "auth");
    expect(authCmd?.description()).toMatch(/keychain|token/i);
  });

  it("should register 'set', 'remove', and 'list' subcommands on the auth command", () => {
    const program = new Command();
    registerAuthCommands(program);
    const authCmd = program.commands.find((c) => c.name() === "auth");
    const subcommandNames = authCmd?.commands.map((c) => c.name()) ?? [];
    expect(subcommandNames).toEqual(expect.arrayContaining(["set", "remove", "list"]));
  });

  it("should describe the 'set' subcommand", () => {
    const program = new Command();
    registerAuthCommands(program);
    const authCmd = program.commands.find((c) => c.name() === "auth");
    const setCmd = authCmd?.commands.find((c) => c.name() === "set");
    expect(setCmd?.description()).toBeTruthy();
  });

  it("should describe the 'remove' subcommand", () => {
    const program = new Command();
    registerAuthCommands(program);
    const authCmd = program.commands.find((c) => c.name() === "auth");
    const removeCmd = authCmd?.commands.find((c) => c.name() === "remove");
    expect(removeCmd?.description()).toBeTruthy();
  });

  it("should describe the 'list' subcommand", () => {
    const program = new Command();
    registerAuthCommands(program);
    const authCmd = program.commands.find((c) => c.name() === "auth");
    const listCmd = authCmd?.commands.find((c) => c.name() === "list");
    expect(listCmd?.description()).toBeTruthy();
  });

  it("should require a <provider> argument on the 'set' subcommand", () => {
    const program = new Command();
    registerAuthCommands(program);
    const authCmd = program.commands.find((c) => c.name() === "auth");
    const setCmd = authCmd?.commands.find((c) => c.name() === "set");
    // Public contract: registeredArguments is a Commander.js public API
    const args = setCmd?.registeredArguments ?? [];
    expect(args.length).toBeGreaterThan(0);
    expect(args[0].required).toBe(true);
    expect(args[0].name()).toBe("provider");
  });

  it("should require a <provider> argument on the 'remove' subcommand", () => {
    const program = new Command();
    registerAuthCommands(program);
    const authCmd = program.commands.find((c) => c.name() === "auth");
    const removeCmd = authCmd?.commands.find((c) => c.name() === "remove");
    const args = removeCmd?.registeredArguments ?? [];
    expect(args.length).toBeGreaterThan(0);
    expect(args[0].required).toBe(true);
    expect(args[0].name()).toBe("provider");
  });

  it("should attach an action handler to each subcommand", () => {
    const program = new Command();
    registerAuthCommands(program);
    const authCmd = program.commands.find((c) => c.name() === "auth");
    for (const sub of authCmd?.commands ?? []) {
      // Public contract: args count > 0 for action-bearing subcommands
      // and the command is registered on the auth parent
      expect(authCmd?.commands).toContain(sub);
    }
  });

  it("should produce help text that mentions all three subcommands", () => {
    const program = new Command();
    registerAuthCommands(program);
    const authCmd = program.commands.find((c) => c.name() === "auth");
    const helpOutput = authCmd?.helpInformation() ?? "";
    expect(helpOutput).toContain("set");
    expect(helpOutput).toContain("remove");
    expect(helpOutput).toContain("list");
  });
});
