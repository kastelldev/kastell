import inquirer from "inquirer";
import { promptList } from "./shared.js";

export async function promptPlugin(): Promise<string[] | null> {
  const sub = await promptList("Plugin action:", [
    { name: "List installed plugins", value: "list" },
    { name: "Install a plugin", value: "install" },
    { name: "Remove a plugin", value: "remove" },
    { name: "Validate plugins", value: "validate" },
  ]);
  if (!sub) return null;
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
