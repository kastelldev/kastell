import { Command } from "commander";
import { registerPluginCommands } from "../../src/plugin/registerCommands.js";
import type { PluginCommandEntry } from "../../src/plugin/registry.js";

jest.mock("../../src/utils/logger.js", () => ({ debugLog: undefined }));

describe("registerPluginCommands", () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.name("kastell");
    // Simulate existing built-in commands
    program.command("audit").description("built-in audit");
    program.command("fix").description("built-in fix");
    program.command("plugin").description("built-in plugin");
  });

  it("registers plugin commands as subcommands", () => {
    const entries: PluginCommandEntry[] = [{
      pluginShortName: "wordpress",
      command: { name: "scan", description: "Run WP scan", handler: "./scan.js" },
      pluginDir: "/fake/path",
    }];
    const registered = registerPluginCommands(program, entries);
    expect(registered).toBe(1);

    const wpCmd = program.commands.find(c => c.name() === "wordpress");
    expect(wpCmd).toBeDefined();
    const scanCmd = wpCmd!.commands.find(c => c.name() === "scan");
    expect(scanCmd).toBeDefined();
  });

  it("groups multiple commands under same plugin", () => {
    const entries: PluginCommandEntry[] = [
      { pluginShortName: "wordpress", command: { name: "scan", description: "Scan", handler: "./scan.js" }, pluginDir: "/fake" },
      { pluginShortName: "wordpress", command: { name: "report", description: "Report", handler: "./report.js" }, pluginDir: "/fake" },
    ];
    const registered = registerPluginCommands(program, entries);
    expect(registered).toBe(2);

    const wpCmd = program.commands.find(c => c.name() === "wordpress");
    expect(wpCmd!.commands).toHaveLength(2);
  });

  it("rejects plugin name that collides with existing built-in command", () => {
    const entries: PluginCommandEntry[] = [{
      pluginShortName: "audit",
      command: { name: "scan", description: "Scan", handler: "./scan.js" },
      pluginDir: "/fake",
    }];
    const registered = registerPluginCommands(program, entries);
    expect(registered).toBe(0);
  });

  it("rejects collision with plugin command too", () => {
    const entries: PluginCommandEntry[] = [{
      pluginShortName: "plugin",
      command: { name: "test", description: "test", handler: "./test.js" },
      pluginDir: "/fake",
    }];
    const registered = registerPluginCommands(program, entries);
    expect(registered).toBe(0);
  });

  it("returns 0 when no entries provided", () => {
    const registered = registerPluginCommands(program, []);
    expect(registered).toBe(0);
  });
});