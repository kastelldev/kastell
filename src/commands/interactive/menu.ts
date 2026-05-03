import inquirer from "inquirer";
import chalk from "chalk";

export interface MenuAction {
  name: string;
  value: string;
  description?: string;
}

export interface MenuCategory {
  label: string;
  emoji: string;
  actions: MenuAction[];
}

export const SCHEDULE_COMMANDS: Record<string, string> = {
  "schedule-fix": "fix",
  "schedule-audit": "audit",
  "schedule-list": "list",
  "schedule-remove": "remove",
};

export const MENU: MenuCategory[] = [
  {
    label: "Server Management",
    emoji: "🖥️",
    actions: [
      { name: "Deploy a new server", value: "init", description: "Provision a VPS on Hetzner, DigitalOcean, Vultr, or Linode" },
      { name: "Add an existing server", value: "add", description: "Register an existing server in your Kastell config" },
      { name: "List all servers", value: "list", description: "Show all managed servers with status overview" },
      { name: "Check server status", value: "status", description: "Check uptime, resources, and platform health" },
      { name: "Fleet overview", value: "fleet", description: "Health and security posture of all servers at once" },
      { name: "SSH into a server", value: "ssh", description: "Open an SSH session or run a remote command" },
      { name: "Restart a server", value: "restart", description: "Reboot a managed server via provider API" },
      { name: "Remove from config", value: "remove", description: "Remove a server from local config without destroying it" },
      { name: "Destroy a server", value: "destroy", description: "Permanently delete a server from the cloud provider" },
    ],
  },
  {
    label: "Security",
    emoji: "🔒",
    actions: [
      { name: "Run security audit", value: "audit", description: "Score server security across 31 categories with compliance mapping" },
      { name: "Harden SSH & fail2ban", value: "secure", description: "Configure SSH security and brute-force protection" },
      { name: "Lock server (production hardening)", value: "lock", description: "Apply 24-step hardening: SSH, fail2ban, UFW, sysctl, auditd, AIDE, and more" },
      { name: "Fix server (safe auto-fix)", value: "fix", description: "Apply safe fixes automatically with backup (SAFE tier only)" },
      { name: "Manage firewall (UFW)", value: "firewall", description: "View, add, or remove UFW firewall port rules" },
      { name: "Manage domain & SSL", value: "domain", description: "Set custom domains and configure SSL certificates" },
      { name: "Collect forensic evidence", value: "evidence", description: "Gather logs, ports, firewall rules with SHA256 checksums" },
      { name: "Manage auth tokens", value: "auth", description: "Store, remove, or list provider API tokens in OS keychain" },
      { name: "Regression baseline status", value: "regression-status", description: "Show baseline status for all or specific server" },
      { name: "Reset regression baseline", value: "regression-reset", description: "Delete baseline for a server" },
    ],
  },
  {
    label: "Monitoring & Logs",
    emoji: "📊",
    actions: [
      { name: "View server logs", value: "logs", description: "View Coolify, Dokploy, Docker, or system logs" },
      { name: "Monitor resources (CPU/RAM/Disk)", value: "monitor", description: "Live resource usage with optional Docker container list" },
      { name: "Health check", value: "health", description: "Verify platform and server connectivity" },
      { name: "Guard daemon", value: "guard", description: "Start, stop, or check autonomous security monitoring" },
      { name: "Doctor (diagnostics + auto-fix)", value: "doctor", description: "Proactive health analysis with optional auto-fix" },
    ],
  },
  {
    label: "Backup & Snapshots",
    emoji: "💾",
    actions: [
      { name: "Create a backup", value: "backup", description: "Download server configuration backup via SCP" },
      { name: "List local backups", value: "backup-list", description: "Show all locally stored backups" },
      { name: "Restore from backup", value: "restore", description: "Restore a previously downloaded backup to a server" },
      { name: "Manage snapshots", value: "snapshot", description: "List, create, or delete provider-level snapshots" },
    ],
  },
  {
    label: "Maintenance",
    emoji: "🔧",
    actions: [
      { name: "Update platform (Coolify/Dokploy)", value: "update", description: "Update Coolify or Dokploy to the latest version" },
      { name: "Full maintenance cycle", value: "maintain", description: "Update + security patches + disk cleanup + Docker prune" },
    ],
  },
  {
    label: "Notifications & Bot",
    emoji: "🔔",
    actions: [
      { name: "Manage notifications", value: "notify", description: "Add Telegram or Discord/Slack webhook for alerts" },
      { name: "Start Telegram bot", value: "bot", description: "Start Telegram bot for read-only server commands (foreground)" },
    ],
  },
  {
    label: "Scheduling",
    emoji: "⏰",
    actions: [
      { name: "Schedule automatic fix runs", value: "schedule-fix", description: "Install a local cron for periodic kastell fix --safe" },
      { name: "Schedule automatic audit runs", value: "schedule-audit", description: "Install a local cron for periodic kastell audit" },
      { name: "List installed schedules", value: "schedule-list", description: "Show all fix/audit schedules" },
      { name: "Remove a schedule", value: "schedule-remove", description: "Remove an installed fix or audit schedule" },
    ],
  },
  {
    label: "Configuration",
    emoji: "⚙️",
    actions: [
      { name: "Manage defaults", value: "config", description: "Set default provider, region, and server template" },
      { name: "Export server list", value: "export", description: "Export server configuration to a JSON file" },
      { name: "Import server list", value: "import", description: "Import servers from a previously exported JSON file" },
      { name: "Manage plugins", value: "plugin", description: "Install, remove, list, or validate kastell plugins" },
      { name: "Shell completions", value: "completions", description: "Generate bash, zsh, or fish completion scripts" },
      { name: "Check version", value: "version", description: "Show current Kastell version and check for updates" },
      { name: "View changelog", value: "changelog", description: "Show release notes for the latest or a specific version" },
    ],
  },
];

type SeparatorInstance = InstanceType<typeof inquirer.Separator>;
export type Choice = { name: string; value: string; description?: string } | SeparatorInstance;

let _cachedChoices: Choice[] | undefined;

export function clearChoicesCache(): void {
  _cachedChoices = undefined;
}

export function buildMainChoices(): Choice[] {
  if (_cachedChoices) return [..._cachedChoices];
  const choices: Choice[] = [];

  for (const category of MENU) {
    choices.push(new inquirer.Separator(chalk.yellow.bold(`  ${category.emoji}  ${category.label}`)));
    for (const action of category.actions) {
      choices.push({ name: `    ${action.name}`, value: action.value, description: action.description });
    }
  }

  choices.push(new inquirer.Separator(" "));
  choices.push({ name: chalk.dim("  Exit"), value: "exit" });

  _cachedChoices = choices;
  return [...choices];
}
