import inquirer from "inquirer";
import { promptList } from "./shared.js";

export async function promptInit(): Promise<string[] | null> {
  const mode = await promptList("Server mode:", [
    { name: "Coolify (auto-install panel)", value: "coolify" },
    { name: "Dokploy (auto-install panel)", value: "dokploy" },
    { name: "Bare (generic VPS, no panel)", value: "bare" },
  ]);
  if (!mode) return null;

  const template = await promptList("Server template:", [
    { name: "Starter (cheapest option)", value: "starter" },
    { name: "Production (more resources)", value: "production" },
    { name: "Dev (development)", value: "dev" },
  ]);
  if (!template) return null;

  const { fullSetup } = await inquirer.prompt([
    {
      type: "confirm",
      name: "fullSetup",
      message: "Run full setup after deploy? (firewall + SSH hardening)",
      default: true,
    },
  ]);

  const args = ["init", "--mode", mode, "--template", template];
  if (fullSetup) args.push("--full-setup");
  return args;
}

export async function promptStatus(): Promise<string[] | null> {
  const mode = await promptList("Status check:", [
    { name: "Single server", value: "single" },
    { name: "All servers at once", value: "all" },
    { name: "With auto-restart if platform is down", value: "autostart" },
  ]);
  if (!mode) return null;
  const args = ["status"];
  if (mode === "all") args.push("--all");
  if (mode === "autostart") args.push("--autostart");
  return args;
}

export async function promptSsh(): Promise<string[] | null> {
  const mode = await promptList("SSH mode:", [
    { name: "Open interactive SSH session", value: "interactive" },
    { name: "Run a single command", value: "command" },
  ]);
  if (!mode) return null;

  if (mode === "command") {
    const { command } = await inquirer.prompt([
      { type: "input", name: "command", message: "Command to execute:" },
    ]);
    return ["ssh", "--command", command];
  }
  return ["ssh"];
}

export async function promptFleet(): Promise<string[] | null> {
  const mode = await promptList("Fleet output:", [
    { name: "Dashboard (default)", value: "default" },
    { name: "JSON output", value: "json" },
    { name: "Sort by score", value: "sort-score" },
    { name: "Sort by provider", value: "sort-provider" },
  ]);
  if (!mode) return null;
  const args = ["fleet"];
  if (mode === "json") args.push("--json");
  if (mode === "sort-score") args.push("--sort", "score");
  if (mode === "sort-provider") args.push("--sort", "provider");
  return args;
}
