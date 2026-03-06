import inquirer from "inquirer";
import chalk from "chalk";

const BACK = "__back__";

interface MenuAction {
  name: string;
  value: string;
}

interface MenuCategory {
  label: string;
  actions: MenuAction[];
}

const MENU: MenuCategory[] = [
  {
    label: "Server Management",
    actions: [
      { name: "Deploy a new server", value: "init" },
      { name: "Add an existing server", value: "add" },
      { name: "List all servers", value: "list" },
      { name: "Check server status", value: "status" },
      { name: "SSH into a server", value: "ssh" },
      { name: "Restart a server", value: "restart" },
      { name: "Remove from config", value: "remove" },
      { name: "Destroy a server", value: "destroy" },
    ],
  },
  {
    label: "Security",
    actions: [
      { name: "Harden SSH & fail2ban", value: "secure" },
      { name: "Manage firewall (UFW)", value: "firewall" },
      { name: "Manage domain & SSL", value: "domain" },
    ],
  },
  {
    label: "Monitoring & Logs",
    actions: [
      { name: "View server logs", value: "logs" },
      { name: "Monitor resources (CPU/RAM/Disk)", value: "monitor" },
      { name: "Health check", value: "health" },
    ],
  },
  {
    label: "Backup & Snapshots",
    actions: [
      { name: "Create a backup", value: "backup" },
      { name: "Restore from backup", value: "restore" },
      { name: "Manage snapshots", value: "snapshot" },
    ],
  },
  {
    label: "Maintenance",
    actions: [
      { name: "Update platform (Coolify/Dokploy)", value: "update" },
      { name: "Full maintenance cycle", value: "maintain" },
      { name: "Check local environment", value: "doctor" },
    ],
  },
  {
    label: "Configuration",
    actions: [
      { name: "Manage defaults", value: "config" },
      { name: "Export server list", value: "export" },
      { name: "Import server list", value: "import" },
    ],
  },
];

type SeparatorInstance = InstanceType<typeof inquirer.Separator>;
type Choice = { name: string; value: string } | SeparatorInstance;

function buildMainChoices(): Choice[] {
  const choices: Choice[] = [];

  for (const category of MENU) {
    choices.push(new inquirer.Separator(chalk.yellow.bold(`  ${category.label}`)));
    for (const action of category.actions) {
      choices.push({ name: `    ${action.name}`, value: action.value });
    }
  }

  choices.push(new inquirer.Separator(" "));
  choices.push({ name: chalk.dim("  Exit"), value: "exit" });

  return choices;
}

function backChoice(): { name: string; value: string } {
  return { name: chalk.dim("← Back"), value: BACK };
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
  const { containers } = await inquirer.prompt([
    {
      type: "confirm",
      name: "containers",
      message: "Include Docker container list?",
      default: false,
    },
  ]);
  const args = ["monitor"];
  if (containers) args.push("--containers");
  return args;
}

async function promptMaintain(): Promise<string[] | null> {
  const { skipReboot } = await inquirer.prompt([
    {
      type: "confirm",
      name: "skipReboot",
      message: "Skip reboot step? (useful during business hours)",
      default: false,
    },
  ]);
  const args = ["maintain"];
  if (skipReboot) args.push("--skip-reboot");
  return args;
}

async function promptStatus(): Promise<string[] | null> {
  const { all } = await inquirer.prompt([
    { type: "confirm", name: "all", message: "Check all servers at once?", default: false },
  ]);
  const args = ["status"];
  if (all) args.push("--all");
  return args;
}

async function promptUpdate(): Promise<string[] | null> {
  const { all } = await inquirer.prompt([
    { type: "confirm", name: "all", message: "Update all servers at once?", default: false },
  ]);
  const args = ["update"];
  if (all) args.push("--all");
  return args;
}

async function promptDoctor(): Promise<string[] | null> {
  const { checkTokens } = await inquirer.prompt([
    { type: "confirm", name: "checkTokens", message: "Validate provider API tokens?", default: false },
  ]);
  const args = ["doctor"];
  if (checkTokens) args.push("--check-tokens");
  return args;
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
  const { all } = await inquirer.prompt([
    { type: "confirm", name: "all", message: "Backup all servers?", default: false },
  ]);
  const args = ["backup"];
  if (all) args.push("--all");
  return args;
}

async function promptImport(): Promise<string[] | null> {
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

// ─── Command → args mapping ─────────────────────────────────────────────────

const SUB_PROMPTS: Record<string, () => Promise<string[] | null>> = {
  init: promptInit,
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
};

const DIRECT_COMMANDS = new Set([
  "list", "add", "destroy", "restart", "remove", "restore", "export", "config",
]);

export async function interactiveMenu(): Promise<string[] | null> {
  // Loop: back from sub-menus returns here
  for (;;) {
    const { action } = await inquirer.prompt<{ action: string }>([
      {
        type: "list",
        name: "action",
        message: "What would you like to do?",
        choices: buildMainChoices(),
        pageSize: 22,
        loop: false,
      },
    ]);

    if (action === "exit") return null;

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
