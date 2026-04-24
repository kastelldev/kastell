import inquirer from "inquirer";
import chalk from "chalk";
import { listAllProfileNames } from "../core/audit/profiles.js";
import { isValidPort } from "../core/firewall.js";
import { regressionStatusCommand, regressionResetCommand } from "./regression.js";

const BACK = "__back__";

// ─── Shared validators ──────────────────────────────────────────────────────

const validateRequired = (msg: string) => (v: string) =>
  v.trim().length > 0 ? true : msg;

const validateScore = (v: string) => {
  const num = Number(v);
  return num >= 0 && num <= 100 ? true : "Enter 0-100";
};

const validateColonPair = (msg: string) => (v: string) => {
  const parts = v.split(":");
  return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0
    ? true
    : msg;
};

const SCHEDULE_COMMANDS: Record<string, string> = {
  "schedule-fix": "fix",
  "schedule-audit": "audit",
  "schedule-list": "list",
  "schedule-remove": "remove",
};

interface MenuAction {
  name: string;
  value: string;
  description?: string;
}

interface MenuCategory {
  label: string;
  emoji: string;
  actions: MenuAction[];
}

const MENU: MenuCategory[] = [
  {
    label: "Server Management",
    emoji: "\uD83D\uDDA5\uFE0F",
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
    emoji: "\uD83D\uDD12",
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
    emoji: "\uD83D\uDCCA",
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
    emoji: "\uD83D\uDCBE",
    actions: [
      { name: "Create a backup", value: "backup", description: "Download server configuration backup via SCP" },
      { name: "List local backups", value: "backup-list", description: "Show all locally stored backups" },
      { name: "Restore from backup", value: "restore", description: "Restore a previously downloaded backup to a server" },
      { name: "Manage snapshots", value: "snapshot", description: "List, create, or delete provider-level snapshots" },
    ],
  },
  {
    label: "Maintenance",
    emoji: "\uD83D\uDD27",
    actions: [
      { name: "Update platform (Coolify/Dokploy)", value: "update", description: "Update Coolify or Dokploy to the latest version" },
      { name: "Full maintenance cycle", value: "maintain", description: "Update + security patches + disk cleanup + Docker prune" },
    ],
  },
  {
    label: "Notifications & Bot",
    emoji: "\uD83D\uDD14",
    actions: [
      { name: "Manage notifications", value: "notify", description: "Add Telegram or Discord/Slack webhook for alerts" },
      { name: "Start Telegram bot", value: "bot", description: "Start Telegram bot for read-only server commands (foreground)" },
    ],
  },
  {
    label: "Scheduling",
    emoji: "\u23F0",
    actions: [
      { name: "Schedule automatic fix runs", value: "schedule-fix", description: "Install a local cron for periodic kastell fix --safe" },
      { name: "Schedule automatic audit runs", value: "schedule-audit", description: "Install a local cron for periodic kastell audit" },
      { name: "List installed schedules", value: "schedule-list", description: "Show all fix/audit schedules" },
      { name: "Remove a schedule", value: "schedule-remove", description: "Remove an installed fix or audit schedule" },
    ],
  },
  {
    label: "Configuration",
    emoji: "\u2699\uFE0F",
    actions: [
      { name: "Manage defaults", value: "config", description: "Set default provider, region, and server template" },
      { name: "Export server list", value: "export", description: "Export server configuration to a JSON file" },
      { name: "Import server list", value: "import", description: "Import servers from a previously exported JSON file" },
      { name: "Shell completions", value: "completions", description: "Generate bash, zsh, or fish completion scripts" },
      { name: "Check version", value: "version", description: "Show current Kastell version and check for updates" },
      { name: "View changelog", value: "changelog", description: "Show release notes for the latest or a specific version" },
    ],
  },
];

type SeparatorInstance = InstanceType<typeof inquirer.Separator>;
type Choice = { name: string; value: string; description?: string } | SeparatorInstance;

function buildMainChoices(): Choice[] {
  const choices: Choice[] = [];

  for (const category of MENU) {
    choices.push(new inquirer.Separator(chalk.yellow.bold(`  ${category.emoji}  ${category.label}`)));
    for (const action of category.actions) {
      choices.push({ name: `    ${action.name}`, value: action.value, description: action.description });
    }
  }

  choices.push(new inquirer.Separator(" "));
  choices.push({ name: chalk.dim("  Exit"), value: "exit" });

  return choices;
}

export function buildSearchSource(term: string | undefined): Choice[] {
  const all = buildMainChoices();
  if (!term) return all;

  const lower = term.toLowerCase();
  const filtered = all.filter((c) => {
    // Skip separators in filtered results
    if ("type" in c && c.type === "separator") return false;
    const choice = c as { name: string; value: string; description?: string };
    return (
      choice.name.toLowerCase().includes(lower) ||
      choice.value.toLowerCase().includes(lower) ||
      (choice.description?.toLowerCase().includes(lower) ?? false)
    );
  });

  // Always include Exit
  if (!filtered.some((c) => "value" in c && c.value === "exit")) {
    filtered.push({ name: chalk.dim("  Exit"), value: "exit" });
  }

  return filtered;
}

function backChoice(): { name: string; value: string } {
  return { name: chalk.dim("\u2190 Back"), value: BACK };
}

// ─── Sub-option prompts ─────────────────────────────────────────────────────

async function promptList(
  message: string,
  choices: Array<{ name: string; value: string }>,
): Promise<string | null> {
  const { answer } = await inquirer.prompt([
    {
      type: "list",
      name: "answer",
      message,
      choices: [...choices, new inquirer.Separator(" "), backChoice()],
      loop: false,
    },
  ]);
  return answer === BACK ? null : answer;
}

async function promptInit(): Promise<string[] | null> {
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

async function promptLogs(): Promise<string[] | null> {
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

async function promptFirewall(): Promise<string[] | null> {
  const sub = await promptList("Firewall action:", [
    { name: "Show current rules", value: "status" },
    { name: "Initial firewall setup", value: "setup" },
    { name: "Add a port rule", value: "add" },
    { name: "Remove a port rule", value: "remove" },
  ]);
  if (!sub) return null;

  if (sub === "add" || sub === "remove") {
    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "port",
        message: "Port number:",
        validate: (v: string) =>
          isValidPort(Number(v)) || "Enter a valid port (1-65535)",
      },
    ]);

    const protocol = await promptList("Protocol:", [
      { name: "TCP", value: "tcp" },
      { name: "UDP", value: "udp" },
    ]);
    if (!protocol) return null;

    return ["firewall", sub, "--port", answers.port, "--protocol", protocol];
  }

  return ["firewall", sub];
}

async function promptSecure(): Promise<string[] | null> {
  const sub = await promptList("Security action:", [
    { name: "Harden SSH + install fail2ban", value: "setup" },
    { name: "Run security audit", value: "audit" },
    { name: "Show security status", value: "status" },
  ]);
  if (!sub) return null;
  return ["secure", sub];
}

async function promptDomain(): Promise<string[] | null> {
  const sub = await promptList("Domain action:", [
    { name: "Show current domain info", value: "info" },
    { name: "List domains", value: "list" },
    { name: "Set a custom domain", value: "add" },
    { name: "Check DNS for a domain", value: "check" },
    { name: "Remove domain", value: "remove" },
  ]);
  if (!sub) return null;

  if (sub === "add" || sub === "check") {
    const { domain } = await inquirer.prompt([
      {
        type: "input",
        name: "domain",
        message: "Domain name (e.g. panel.example.com):",
        validate: (v: string) => (v.includes(".") ? true : "Enter a valid domain"),
      },
    ]);
    const args = ["domain", sub, "--domain", domain];
    if (sub === "add") {
      const { ssl } = await inquirer.prompt([
        { type: "confirm", name: "ssl", message: "Enable SSL (HTTPS)?", default: true },
      ]);
      if (!ssl) args.push("--no-ssl");
    }
    return args;
  }

  return ["domain", sub];
}

async function promptSnapshot(): Promise<string[] | null> {
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

async function promptMonitor(): Promise<string[] | null> {
  const mode = await promptList("Monitor options:", [
    { name: "Basic (CPU/RAM/Disk)", value: "basic" },
    { name: "With Docker containers", value: "containers" },
  ]);
  if (!mode) return null;
  const args = ["monitor"];
  if (mode === "containers") args.push("--containers");
  return args;
}

async function promptMaintain(): Promise<string[] | null> {
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

async function promptStatus(): Promise<string[] | null> {
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

async function promptUpdate(): Promise<string[] | null> {
  const mode = await promptList("Update scope:", [
    { name: "Single server", value: "single" },
    { name: "All servers at once", value: "all" },
  ]);
  if (!mode) return null;
  const args = ["update"];
  if (mode === "all") args.push("--all");
  return args;
}

async function promptDoctor(): Promise<string[] | null> {
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

async function promptAuth(): Promise<string[] | null> {
  const sub = await promptList("Auth action:", [
    { name: "List stored tokens", value: "list" },
    { name: "Store a provider token", value: "set" },
    { name: "Remove a provider token", value: "remove" },
  ]);
  if (!sub) return null;

  if (sub === "set" || sub === "remove") {
    const provider = await promptList("Provider:", [
      { name: "Hetzner Cloud", value: "hetzner" },
      { name: "DigitalOcean", value: "digitalocean" },
      { name: "Vultr", value: "vultr" },
      { name: "Linode", value: "linode" },
    ]);
    if (!provider) return null;
    return ["auth", sub, provider];
  }

  return ["auth", sub];
}

async function promptSsh(): Promise<string[] | null> {
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

async function promptBackup(): Promise<string[] | null> {
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

async function promptImport(): Promise<string[] | null> {
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

async function promptAudit(): Promise<string[] | null> {
  const mode = await promptList("Audit mode:", [
    { name: "Run full audit", value: "run" },
    { name: "Run with --explain (show fixes)", value: "explain" },
    { name: "Compare two snapshots (diff)", value: "diff" },
    { name: "Interactive fix mode", value: "fix" },
    { name: "List all checks (no scan)", value: "list-checks" },
    { name: "Explain a specific check (deep-dive)", value: "explain-check" },
    { name: "Run with compliance profile", value: "profile" },
    { name: "Compliance framework report", value: "compliance" },
    { name: "Save snapshot", value: "snapshot" },
    { name: "List saved snapshots", value: "snapshots" },
    { name: "Compare two servers", value: "compare" },
    { name: "Score trend over time", value: "trend" },
    { name: "Watch mode (auto-refresh)", value: "watch" },
    { name: "Audit unregistered server by IP", value: "host" },
    { name: "CI gate (exit 1 if below threshold)", value: "threshold" },
    { name: "Generate report (HTML/Markdown)", value: "report" },
  ]);
  if (!mode) return null;

  if (mode === "explain") return ["audit", "--explain"];

  if (mode === "diff") {
    const { diffRef } = await inquirer.prompt([
      {
        type: "input",
        name: "diffRef",
        message: "Diff reference (e.g. pre-upgrade:latest or pre-upgrade:post-upgrade):",
        validate: validateColonPair("Format: before:after (e.g. pre-upgrade:latest)"),
      },
    ]);
    return ["audit", "--diff", diffRef];
  }

  if (mode === "fix") {
    const dryRun = await promptList("Fix mode:", [
      { name: "Execute fixes interactively", value: "live" },
      { name: "Dry run (show commands only)", value: "dry-run" },
    ]);
    if (!dryRun) return null;
    const args = ["audit", "--fix"];
    if (dryRun === "dry-run") args.push("--dry-run");
    return args;
  }

  if (mode === "list-checks") return ["audit", "--list-checks"];

  if (mode === "explain-check") {
    const { checkId } = await inquirer.prompt([
      {
        type: "input",
        name: "checkId",
        message: "Enter check ID (e.g. SSH-PASSWORD-AUTH):",
      },
    ]);
    if (!checkId?.trim()) return null;
    return ["explain", checkId.trim()];
  }

  if (mode === "snapshot") {
    const { snapName } = await inquirer.prompt([
      { type: "input", name: "snapName", message: "Snapshot name (leave empty for auto):", default: "" },
    ]);
    return snapName ? ["audit", "--snapshot", snapName] : ["audit", "--snapshot"];
  }

  if (mode === "snapshots") return ["audit", "--snapshots"];

  if (mode === "compare") {
    const { compareRef } = await inquirer.prompt([
      {
        type: "input",
        name: "compareRef",
        message: "Compare (server1:server2):",
        validate: validateColonPair("Format: server1:server2"),
      },
    ]);
    return ["audit", "--compare", compareRef];
  }

  if (mode === "trend") {
    const days = await promptList("Time range:", [
      { name: "Last 7 days", value: "7" },
      { name: "Last 30 days", value: "30" },
      { name: "All time", value: "0" },
    ]);
    if (!days) return null;
    return days === "0" ? ["audit", "--trend"] : ["audit", "--trend", "--days", days];
  }

  if (mode === "watch") {
    const interval = await promptList("Refresh interval:", [
      { name: "30 seconds", value: "30" },
      { name: "60 seconds", value: "60" },
      { name: "300 seconds (5 min)", value: "300" },
    ]);
    if (!interval) return null;
    return ["audit", "--watch", interval];
  }

  if (mode === "host") {
    const { hostAddr } = await inquirer.prompt([
      {
        type: "input",
        name: "hostAddr",
        message: "Server address (user@ip):",
        validate: (v: string) => (v.includes("@") ? true : "Format: user@ip"),
      },
    ]);
    return ["audit", "--host", hostAddr];
  }

  if (mode === "threshold") {
    const { thresholdScore } = await inquirer.prompt([
      {
        type: "input",
        name: "thresholdScore",
        message: "Minimum score (exit 1 if below):",
        validate: validateScore,
      },
    ]);
    return ["audit", "--threshold", thresholdScore];
  }

  if (mode === "report") {
    const reportFormat = await promptList("Report format:", [
      { name: "Markdown (.md)", value: "md" },
      { name: "HTML (.html)", value: "html" },
    ]);
    if (!reportFormat) return null;
    return ["audit", "--report", reportFormat];
  }

  if (mode === "profile") {
    const profile = await promptList("Compliance profile:", [
      { name: "CIS Level 1 (essential)", value: "cis-level1" },
      { name: "CIS Level 2 (advanced)", value: "cis-level2" },
      { name: "PCI-DSS (payment)", value: "pci-dss" },
      { name: "HIPAA (healthcare)", value: "hipaa" },
    ]);
    if (!profile) return null;

    const format = await promptList("Output format:", [
      { name: "Dashboard summary", value: "summary" },
      { name: "JSON output", value: "json" },
      { name: "Score only", value: "score-only" },
    ]);
    if (!format) return null;

    const args = ["audit", "--profile", profile];
    if (format === "json") args.push("--json");
    else if (format === "score-only") args.push("--score-only");
    else args.push("--summary");
    return args;
  }

  if (mode === "compliance") {
    const { frameworks } = await inquirer.prompt([
      {
        type: "checkbox",
        name: "frameworks",
        message: "Select compliance frameworks:",
        choices: [
          { name: "CIS Benchmark", value: "cis" },
          { name: "PCI-DSS", value: "pci-dss" },
          { name: "HIPAA", value: "hipaa" },
        ],
        validate: (v: string[]) => (v.length > 0 ? true : "Select at least one framework"),
      },
    ]);
    return ["audit", "--compliance", frameworks.join(",")];
  }

  // mode === "run" — standard audit
  const format = await promptList("Output format:", [
    { name: "Dashboard summary", value: "summary" },
    { name: "JSON output", value: "json" },
    { name: "Score only", value: "score-only" },
    { name: "SVG badge", value: "badge" },
    { name: "Show score trend", value: "trend" },
  ]);
  if (!format) return null;

  const args = ["audit"];
  if (format === "summary") args.push("--summary");
  else if (format === "json") args.push("--json");
  else if (format === "score-only") args.push("--score-only");
  else if (format === "badge") args.push("--badge");
  else if (format === "trend") args.push("--trend");

  // Optional category/severity filters (AUX-01, AUX-02)
  const filter = await promptList("Filter results?", [
    { name: "No filter (show all)", value: "none" },
    { name: "Filter by category", value: "category" },
    { name: "Filter by severity", value: "severity" },
    { name: "Filter by both", value: "both" },
  ]);
  if (!filter) return null;

  if (filter === "category" || filter === "both") {
    const TOP_CATEGORIES = [
      { name: "SSH", value: "ssh" },
      { name: "Firewall", value: "firewall" },
      { name: "Updates", value: "updates" },
      { name: "Auth", value: "auth" },
      { name: "Docker", value: "docker" },
      { name: "Network", value: "network" },
      { name: "Kernel", value: "kernel" },
      { name: "Logging", value: "logging" },
    ];
    const ALL_CATEGORIES = [
      ...TOP_CATEGORIES,
      { name: "Filesystem", value: "filesystem" },
      { name: "Accounts", value: "accounts" },
      { name: "Services", value: "services" },
      { name: "Boot", value: "boot" },
      { name: "Scheduling", value: "scheduling" },
      { name: "Time", value: "time" },
      { name: "Banners", value: "banners" },
      { name: "Crypto", value: "crypto" },
      { name: "File Integrity", value: "file integrity" },
      { name: "Malware", value: "malware" },
      { name: "MAC", value: "mac" },
      { name: "Memory", value: "memory" },
      { name: "Secrets", value: "secrets" },
      { name: "Cloud Metadata", value: "cloud metadata" },
      { name: "Supply Chain", value: "supply chain" },
      { name: "Backup Hygiene", value: "backup hygiene" },
      { name: "Resource Limits", value: "resource limits" },
      { name: "Incident Readiness", value: "incident readiness" },
      { name: "DNS Security", value: "dns security" },
    ];

    const category = await promptList("Category:", [
      ...TOP_CATEGORIES,
      { name: "Show all 31 categories...", value: "__all__" },
    ]);
    if (!category) return null;

    if (category === "__all__") {
      const fullCategory = await promptList("Category:", ALL_CATEGORIES);
      if (!fullCategory) return null;
      args.push("--category", fullCategory);
    } else {
      args.push("--category", category);
    }
  }

  if (filter === "severity" || filter === "both") {
    const severity = await promptList("Severity:", [
      { name: "Critical only", value: "critical" },
      { name: "Warning", value: "warning" },
      { name: "Info", value: "info" },
    ]);
    if (!severity) return null;
    args.push("--severity", severity);
  }

  return args;
}

async function promptLock(): Promise<string[] | null> {
  const mode = await promptList("Lock mode:", [
    { name: "Dry run (preview changes)", value: "dry-run" },
    { name: "Apply production hardening", value: "production" },
    { name: "Apply production (skip confirmation)", value: "production-force" },
  ]);
  if (!mode) return null;

  const args = ["lock"];
  if (mode === "dry-run") args.push("--dry-run");
  else if (mode === "production-force") args.push("--production", "--force");
  else args.push("--production");
  return args;
}

async function promptFix(): Promise<string[] | null> {
  const group = await promptList("Fix options:", [
    { name: "Apply fixes", value: "apply" },
    { name: "Fix history", value: "history" },
  ]);
  if (!group) return null;

  if (group === "apply") {
    const mode = await promptList("Apply mode:", [
      { name: "Dry run (preview safe fixes)", value: "dry-run" },
      { name: "Apply safe fixes (backup + fix + verify)", value: "apply" },
      { name: "Apply with profile filter", value: "profile" },
      { name: "Apply with category filter", value: "category" },
      { name: "Apply top N fixes by impact", value: "top" },
      { name: "Apply until target score", value: "target" },
      { name: "Apply with diff preview", value: "diff" },
      { name: "Apply and generate report", value: "report" },
    ]);
    if (!mode) return null;

    if (mode === "dry-run") return ["fix", "--safe", "--dry-run"];
    if (mode === "apply") return ["fix", "--safe"];
    if (mode === "diff") return ["fix", "--safe", "--diff"];
    if (mode === "report") return ["fix", "--safe", "--report"];

    if (mode === "profile") {
      const profileNames = listAllProfileNames();
      const choices = profileNames.map((p) => ({ name: p, value: p }));
      const profile = await promptList("Fix profile:", choices);
      if (!profile) return null;
      return ["fix", "--safe", "--profile", profile];
    }

    if (mode === "category") {
      const { cats } = await inquirer.prompt([{
        type: "input",
        name: "cats",
        message: "Category filter (comma-separated, e.g. Auth,Kernel):",
        validate: validateRequired("Enter at least one category"),
      }]);
      return ["fix", "--safe", "--category", cats];
    }

    if (mode === "top") {
      const { n } = await inquirer.prompt([{
        type: "input",
        name: "n",
        message: "Number of fixes to apply:",
        validate: (v: string) => {
          const num = Number(v);
          return num >= 1 && Number.isInteger(num) ? true : "Enter a positive integer";
        },
      }]);
      return ["fix", "--safe", "--top", n];
    }

    if (mode === "target") {
      const { score } = await inquirer.prompt([{
        type: "input",
        name: "score",
        message: "Target score (0-100):",
        validate: validateScore,
      }]);
      return ["fix", "--safe", "--target", score];
    }
  }

  if (group === "history") {
    const action = await promptList("History action:", [
      { name: "View fix history", value: "view" },
      { name: "Rollback a specific fix", value: "rollback" },
      { name: "Rollback all fixes", value: "rollback-all" },
      { name: "Rollback down to a specific fix", value: "rollback-to" },
    ]);
    if (!action) return null;

    if (action === "view") return ["fix", "--history"];
    if (action === "rollback-all") return ["fix", "--rollback-all"];

    if (action === "rollback-to") {
      const { fixId } = await inquirer.prompt([{
        type: "input",
        name: "fixId",
        message: "Rollback down to fix ID:",
        validate: validateRequired("Fix ID required"),
      }]);
      return ["fix", "--rollback-to", fixId];
    }

    if (action === "rollback") {
      const { fixId } = await inquirer.prompt([{
        type: "input",
        name: "fixId",
        message: "Fix ID (or 'last'):",
        validate: validateRequired("Fix ID required"),
      }]);
      return ["fix", "--rollback", fixId];
    }
  }

  return null;
}

async function promptEvidence(): Promise<string[] | null> {
  const action = await promptList("Evidence collection:", [
    { name: "Collect with default label", value: "default" },
    { name: "Collect with custom label", value: "custom" },
    { name: "Collect (overwrite existing)", value: "force" },
    { name: "Collect (JSON manifest output)", value: "json" },
  ]);
  if (!action) return null;

  const args = ["evidence"];

  if (action === "force") args.push("--force");
  if (action === "json") args.push("--json");

  if (action === "custom") {
    const { name } = await inquirer.prompt([
      {
        type: "input",
        name: "name",
        message: "Evidence label (e.g. pre-incident, weekly-check):",
        default: "manual",
      },
    ]);
    args.push("--name", name);
  } else {
    args.push("--name", "manual");
  }

  const options = await promptList("Collection options:", [
    { name: "Full collection (default)", value: "full" },
    { name: "Skip Docker data", value: "no-docker" },
    { name: "Skip system info", value: "no-sysinfo" },
    { name: "Skip Docker + system info", value: "no-both" },
  ]);
  if (!options) return null;

  if (options === "no-docker" || options === "no-both") args.push("--no-docker");
  if (options === "no-sysinfo" || options === "no-both") args.push("--no-sysinfo");

  const lines = await promptList("Log lines to collect:", [
    { name: "100 lines", value: "100" },
    { name: "500 lines (default)", value: "500" },
    { name: "1000 lines", value: "1000" },
  ]);
  if (!lines) return null;
  if (lines !== "500") args.push("--lines", lines);

  return args;
}

async function promptGuard(): Promise<string[] | null> {
  const sub = await promptList("Guard action:", [
    { name: "Check guard status", value: "status" },
    { name: "Start guard daemon", value: "start" },
    { name: "Stop guard daemon", value: "stop" },
  ]);
  if (!sub) return null;
  return ["guard", sub];
}

async function promptNotify(): Promise<string[] | null> {
  const sub = await promptList("Notification action:", [
    { name: "List notification channels", value: "list" },
    { name: "Add a notification channel", value: "add" },
    { name: "Remove a notification channel", value: "remove" },
    { name: "Send a test notification", value: "test" },
  ]);
  if (!sub) return null;
  return ["notify", sub];
}

async function promptFleet(): Promise<string[] | null> {
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

async function promptCompletions(): Promise<string[] | null> {
  const shell = await promptList("Shell:", [
    { name: "Bash", value: "bash" },
    { name: "Zsh", value: "zsh" },
    { name: "Fish", value: "fish" },
  ]);
  if (!shell) return null;
  return ["completions", shell];
}

// ─── Command → args mapping ─────────────────────────────────────────────────

const SUB_PROMPTS: Record<string, () => Promise<string[] | null>> = {
  init: promptInit,
  auth: promptAuth,
  logs: promptLogs,
  firewall: promptFirewall,
  secure: promptSecure,
  domain: promptDomain,
  snapshot: promptSnapshot,
  monitor: promptMonitor,
  maintain: promptMaintain,
  status: promptStatus,
  update: promptUpdate,
  doctor: promptDoctor,
  ssh: promptSsh,
  backup: promptBackup,
  import: promptImport,
  audit: promptAudit,
  lock: promptLock,
  fix: promptFix,
  evidence: promptEvidence,
  guard: promptGuard,
  fleet: promptFleet,
  notify: promptNotify,
  completions: promptCompletions,
};

const DIRECT_COMMANDS = new Set([
  "list", "add", "destroy", "restart", "remove", "restore", "export", "config",
  "health", "backup-list", "version", "changelog",
  "regression-status", "regression-reset",
]);

export async function interactiveMenu(): Promise<string[] | null> {
  // Header is printed by index.ts before calling interactiveMenu()

  // Loop: back from sub-menus returns here
  for (;;) {
    const { action } = await inquirer.prompt<{ action: string }>([
      {
        type: "search",
        name: "action",
        message: "What would you like to do?",
        source: buildSearchSource,
        pageSize: 25,
      },
    ]);

    if (action === "exit") return null;

    // Special compound commands
    if (action === "backup-list") return ["backup", "list"];
    if (action === "bot") return ["bot", "start"];
    if (action in SCHEDULE_COMMANDS) return ["schedule", SCHEDULE_COMMANDS[action]];

    if (DIRECT_COMMANDS.has(action)) {
      return [action];
    }

    const promptFn = SUB_PROMPTS[action];
    if (promptFn) {
      const result = await promptFn();
      if (result === null) continue; // back → show main menu again
      return result;
    }

    return [action];
  }
}
