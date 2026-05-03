import inquirer from "inquirer";
import { promptList } from "./shared.js";

export async function promptLogs(): Promise<string[] | null> {
  const service = await promptList("Log source:", [
    { name: "Coolify container logs", value: "coolify" },
    { name: "Dokploy container logs", value: "dokploy" },
    { name: "Docker service logs", value: "docker" },
    { name: "Full system journal", value: "system" },
  ]);
  if (!service) return null;

  const lines = await promptList("Number of log lines:", [
    { name: "25 lines", value: "25" },
    { name: "50 lines (default)", value: "50" },
    { name: "100 lines", value: "100" },
    { name: "200 lines", value: "200" },
  ]);
  if (!lines) return null;

  const { follow } = await inquirer.prompt([
    { type: "confirm", name: "follow", message: "Follow log output in real-time?", default: false },
  ]);

  const args = ["logs", "--service", service, "--lines", lines];
  if (follow) args.push("--follow");
  return args;
}

export async function promptMonitor(): Promise<string[] | null> {
  const mode = await promptList("Monitor options:", [
    { name: "Basic (CPU/RAM/Disk)", value: "basic" },
    { name: "With Docker containers", value: "containers" },
  ]);
  if (!mode) return null;
  const args = ["monitor"];
  if (mode === "containers") args.push("--containers");
  return args;
}

export async function promptDoctor(): Promise<string[] | null> {
  const mode = await promptList("Doctor mode:", [
    { name: "Fresh data via SSH (accurate)", value: "fresh" },
    { name: "Use cached metrics (fast)", value: "cached" },
    { name: "Interactive fix mode", value: "fix" },
    { name: "Auto-fix (diagnose + fix all)", value: "auto-fix" },
    { name: "Auto-fix dry run (preview only)", value: "auto-fix-dry" },
    { name: "JSON output", value: "json" },
    { name: "Check local tokens (no server)", value: "check-tokens" },
  ]);
  if (!mode) return null;
  if (mode === "check-tokens") return ["doctor", "--check-tokens"];
  if (mode === "json") return ["doctor", "--fresh", "--json"];

  const args = ["doctor"];
  if (mode === "fresh") args.push("--fresh");
  if (mode === "fix") {
    args.push("--fix");
    const dryRun = await promptList("Fix mode:", [
      { name: "Execute fixes interactively", value: "live" },
      { name: "Dry run (show commands only)", value: "dry-run" },
    ]);
    if (!dryRun) return null;
    if (dryRun === "dry-run") args.push("--dry-run");
  }
  if (mode === "auto-fix") {
    args.push("--auto-fix");
    const forceOption = await promptList("Confirmation mode:", [
      { name: "Confirm each finding", value: "interactive" },
      { name: "Skip confirmations (--force)", value: "force" },
    ]);
    if (!forceOption) return null;
    if (forceOption === "force") args.push("--force");
  }
  if (mode === "auto-fix-dry") {
    args.push("--auto-fix", "--dry-run");
  }
  return args;
}

export async function promptGuard(): Promise<string[] | null> {
  const sub = await promptList("Guard action:", [
    { name: "Check guard status", value: "status" },
    { name: "Start guard daemon", value: "start" },
    { name: "Stop guard daemon", value: "stop" },
  ]);
  if (!sub) return null;
  return ["guard", sub];
}
