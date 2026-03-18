import inquirer from "inquirer";
import chalk from "chalk";

const BACK = "__back__";

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
      { name: "Run security audit", value: "audit", description: "Score server security across 27 categories with compliance mapping" },
      { name: "Harden SSH & fail2ban", value: "secure", description: "Configure SSH security and brute-force protection" },
      { name: "Lock server (production hardening)", value: "lock", description: "Apply 19-step hardening: SSH, fail2ban, UFW, sysctl, auditd, AIDE, and more" },
      { name: "Manage firewall (UFW)", value: "firewall", description: "View, add, or remove UFW firewall port rules" },
      { name: "Manage domain & SSL", value: "domain", description: "Set custom domains and configure SSL certificates" },
      { name: "Collect forensic evidence", value: "evidence", description: "Gather logs, ports, firewall rules with SHA256 checksums" },
      { name: "Manage auth tokens", value: "auth", description: "Store, remove, or list provider API tokens in OS keychain" },
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
      { name: "Doctor (diagnostics)", value: "doctor", description: "Proactive health analysis with remediation commands" },
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
    label: "Notifications",
    emoji: "\uD83D\uDD14",
    actions: [
      { name: "Manage notifications", value: "notify", description: "Add Telegram or Discord/Slack webhook for alerts" },
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
        validate: (v: string) => {
          const n = Number(v);
          return n >= 1 && n <= 65535 ? true : "Enter a valid port (1-65535)";
        },
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
    { name: "Create a snapshot", value: "create" },
    { name: "Delete a snapshot", value: "delete" },
  ]);
  if (!sub) return null;
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
  ]);
  if (!mode) return null;
  const args = ["maintain"];
  if (mode === "skip-reboot") args.push("--skip-reboot");
  return args;
}

async function promptStatus(): Promise<string[] | null> {
  const mode = await promptList("Status check:", [
    { name: "Single server", value: "single" },
    { name: "All servers at once", value: "all" },
  ]);
  if (!mode) return null;
  const args = ["status"];
  if (mode === "all") args.push("--all");
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
  ]);
  if (!mode) return null;
  const args = ["doctor"];
  if (mode === "fresh") args.push("--fresh");
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
  ]);
  if (!sub) return null;

  const args = ["backup"];
  if (sub === "all") args.push("--all");
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
      validate: (v: string) => (v.trim().length > 0 ? true : "File path is required"),
    },
  ]);
  return ["import", path];
}

async function promptAudit(): Promise<string[] | null> {
  const mode = await promptList("Audit mode:", [
    { name: "Run full audit", value: "run" },
    { name: "List all checks (no scan)", value: "list-checks" },
    { name: "Run with compliance profile", value: "profile" },
    { name: "Compliance framework report", value: "compliance" },
  ]);
  if (!mode) return null;

  if (mode === "list-checks") return ["audit", "--list-checks"];

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
      { name: "Show all 27 categories...", value: "__all__" },
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
  ]);
  if (!mode) return null;

  const args = ["lock"];
  if (mode === "dry-run") args.push("--dry-run");
  else args.push("--production");
  return args;
}

async function promptEvidence(): Promise<string[] | null> {
  const action = await promptList("Evidence collection:", [
    { name: "Collect with default label", value: "default" },
    { name: "Collect with custom label", value: "custom" },
  ]);
  if (!action) return null;

  if (action === "custom") {
    const { name } = await inquirer.prompt([
      {
        type: "input",
        name: "name",
        message: "Evidence label (e.g. pre-incident, weekly-check):",
        default: "manual",
      },
    ]);
    return ["evidence", "--name", name];
  }
  return ["evidence", "--name", "manual"];
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
  evidence: promptEvidence,
  guard: promptGuard,
  notify: promptNotify,
  completions: promptCompletions,
};

const DIRECT_COMMANDS = new Set([
  "list", "add", "destroy", "restart", "remove", "restore", "export", "config",
  "health", "fleet", "backup-list", "version",
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
