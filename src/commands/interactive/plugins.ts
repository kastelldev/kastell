import inquirer from "inquirer";
import { promptList } from "./shared.js";
import { getPluginCommands } from "../../plugin/registry.js";

export async function promptPlugin(): Promise<string[] | null> {
  const pluginCmds = getPluginCommands();
  const choices = [
    { name: "List installed plugins", value: "list" },
    { name: "Install a plugin", value: "install" },
    { name: "Remove a plugin", value: "remove" },
    { name: "Validate plugins", value: "validate" },
  ];

  if (pluginCmds.length > 0) {
    choices.push({ name: `Run plugin command (${pluginCmds.length} available)`, value: "run" });
  }

  const sub = await promptList("Plugin action:", choices);
  if (!sub) return null;

  if (sub === "run") {
    const grouped = new Map<string, typeof pluginCmds>();
    for (const entry of pluginCmds) {
      const group = grouped.get(entry.pluginShortName) ?? [];
      group.push(entry);
      grouped.set(entry.pluginShortName, group);
    }

    const pluginChoices = [...grouped.keys()].map(name => ({ name, value: name }));
    const { plugin } = await inquirer.prompt([
      { type: "list", name: "plugin", message: "Select plugin:", choices: pluginChoices },
    ]);

    const cmds = grouped.get(plugin)!;
    const cmdChoices = cmds.map(c => ({ name: `${c.command.name} — ${c.command.description}`, value: c.command.name }));
    const { command } = await inquirer.prompt([
      { type: "list", name: "command", message: "Select command:", choices: cmdChoices },
    ]);

    return [plugin, command];
  }

  if (sub === "install") {
    const { name } = await inquirer.prompt([
      { type: "input", name: "name", message: "Plugin name (kastell-plugin-<name>):" },
    ]);
    if (!name) return null;
    return ["plugin", "install", name];
  }
  if (sub === "remove") {
    const { name } = await inquirer.prompt([
      { type: "input", name: "name", message: "Plugin name to remove:" },
    ]);
    if (!name) return null;
    return ["plugin", "remove", name];
  }
  return ["plugin", sub];
}
