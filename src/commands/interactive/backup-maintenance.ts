import inquirer from "inquirer";
import { promptList, validateRequired } from "./shared.js";

export async function promptSnapshot(): Promise<string[] | null> {
  const sub = await promptList("Snapshot action:", [
    { name: "List snapshots", value: "list" },
    { name: "List all servers' snapshots", value: "list-all" },
    { name: "Create a snapshot", value: "create" },
    { name: "Restore from snapshot", value: "restore" },
    { name: "Delete a snapshot", value: "delete" },
  ]);
  if (!sub) return null;
  if (sub === "list-all") return ["snapshot", "list", "--all"];
  return ["snapshot", sub];
}

export async function promptMaintain(): Promise<string[] | null> {
  const mode = await promptList("Maintenance mode:", [
    { name: "Full cycle (update + reboot)", value: "full" },
    { name: "Skip reboot (business hours)", value: "skip-reboot" },
    { name: "All servers at once", value: "all" },
    { name: "Dry run (preview steps)", value: "dry-run" },
  ]);
  if (!mode) return null;
  const args = ["maintain"];
  if (mode === "skip-reboot") args.push("--skip-reboot");
  else if (mode === "all") args.push("--all");
  else if (mode === "dry-run") args.push("--dry-run");
  return args;
}

export async function promptUpdate(): Promise<string[] | null> {
  const mode = await promptList("Update scope:", [
    { name: "Single server", value: "single" },
    { name: "All servers at once", value: "all" },
  ]);
  if (!mode) return null;
  const args = ["update"];
  if (mode === "all") args.push("--all");
  return args;
}

export async function promptBackup(): Promise<string[] | null> {
  const sub = await promptList("Backup action:", [
    { name: "Create a new backup", value: "create" },
    { name: "Backup all servers", value: "all" },
    { name: "Dry run (preview)", value: "dry-run" },
    { name: "Manage backup schedule", value: "schedule" },
  ]);
  if (!sub) return null;

  if (sub === "schedule") {
    const schedAction = await promptList("Backup schedule:", [
      { name: "Set cron schedule", value: "set" },
      { name: "List current schedule", value: "list" },
      { name: "Remove schedule", value: "remove" },
    ]);
    if (!schedAction) return null;
    if (schedAction === "list") return ["backup", "--schedule", "list"];
    if (schedAction === "remove") return ["backup", "--schedule", "remove"];
    const { cron } = await inquirer.prompt([{
      type: "input",
      name: "cron",
      message: "Cron expression (e.g. 0 2 * * *):",
      validate: validateRequired("Cron expression required"),
    }]);
    return ["backup", "--schedule", cron];
  }

  const args = ["backup"];
  if (sub === "all") args.push("--all");
  if (sub === "dry-run") args.push("--dry-run");
  return args;
}

export async function promptImport(): Promise<string[] | null> {
  const action = await promptList("Import server list:", [
    { name: "Import from JSON file", value: "file" },
  ]);
  if (!action) return null;

  const { path } = await inquirer.prompt([
    {
      type: "input",
      name: "path",
      message: "Path to JSON file to import:",
      validate: validateRequired("File path is required"),
    },
  ]);
  return ["import", path];
}

export async function promptNotify(): Promise<string[] | null> {
  const sub = await promptList("Notification action:", [
    { name: "List notification channels", value: "list" },
    { name: "Add a notification channel", value: "add" },
    { name: "Remove a notification channel", value: "remove" },
    { name: "Send a test notification", value: "test" },
  ]);
  if (!sub) return null;
  return ["notify", sub];
}

export async function promptCompletions(): Promise<string[] | null> {
  const shell = await promptList("Shell:", [
    { name: "Bash", value: "bash" },
    { name: "Zsh", value: "zsh" },
    { name: "Fish", value: "fish" },
  ]);
  if (!shell) return null;
  return ["completions", shell];
}
