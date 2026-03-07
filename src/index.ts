#!/usr/bin/env node

import { Command } from "commander";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { checkForUpdate } from "./utils/updateCheck.js";
import { migrateConfigIfNeeded } from "./utils/migration.js";
import { interactiveMenu } from "./commands/interactive.js";
import { initCommand } from "./commands/init.js";
import { listCommand } from "./commands/list.js";
import { statusCommand } from "./commands/status.js";
import { destroyCommand } from "./commands/destroy.js";
import { configCommand } from "./commands/config.js";
import { sshCommand } from "./commands/ssh.js";
import { updateCommand } from "./commands/update.js";
import { restartCommand } from "./commands/restart.js";
import { logsCommand } from "./commands/logs.js";
import { monitorCommand } from "./commands/monitor.js";
import { healthCommand } from "./commands/health.js";
import { doctorCommand } from "./commands/doctor.js";
import { firewallCommand } from "./commands/firewall.js";
import { domainCommand } from "./commands/domain.js";
import { secureCommand } from "./commands/secure.js";
import { backupCommand } from "./commands/backup.js";
import { restoreCommand } from "./commands/restore.js";
import { exportCommand, importCommand } from "./commands/transfer.js";
import { addCommand } from "./commands/add.js";
import { removeCommand } from "./commands/remove.js";
import { maintainCommand } from "./commands/maintain.js";
import { snapshotCommand } from "./commands/snapshot.js";
import { completionsCommand } from "./commands/completions.js";
import { printHeader, printQuickHelp } from "./cli/header.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));

migrateConfigIfNeeded();

const program = new Command();

program
  .name("kastell")
  .description("Automate Coolify deployment on cloud providers")
  .version(pkg.version);

program
  .command("init")
  .description("Deploy a new Coolify instance on a cloud provider")
  .option("--provider <provider>", "Cloud provider (hetzner, digitalocean, vultr, linode)")
  .option(
    "--token <token>",
    "API token (or set HETZNER_TOKEN / DIGITALOCEAN_TOKEN / VULTR_TOKEN / LINODE_TOKEN env var)",
  )
  .option("--token-stdin", "Read API token from stdin (pipe-friendly, avoids shell history)")
  .option("--region <region>", "Server region")
  .option("--size <size>", "Server size")
  .option("--name <name>", "Server name")
  .option("--full-setup", "Auto-configure firewall and SSH hardening after deploy")
  .option("--config <path>", "Load deployment config from a YAML file (kastell.yml)")
  .option("--template <template>", "Use a predefined template (starter, production, dev)")
  .option("--no-open", "Do not open browser after deployment")
  .option("--mode <mode>", "Server mode: coolify (default), dokploy, or bare")
  .action(initCommand);

program.command("list").description("List all registered servers").action(listCommand);

program
  .command("status [query]")
  .description("Check server and Coolify status")
  .option("--all", "Check status of all servers")
  .option("--autostart", "Restart Coolify if server is running but Coolify is down")
  .action((query?: string, options?: { all?: boolean; autostart?: boolean }) =>
    statusCommand(query, options),
  );

program
  .command("destroy [query]")
  .description("Destroy a registered server")
  .option("--dry-run", "Show what would happen without executing")
  .action((query?: string, options?: { dryRun?: boolean }) =>
    destroyCommand(query, options),
  );

program
  .command("config [subcommand] [args...]")
  .description("Manage default configuration")
  .action((subcommand?: string, args?: string[]) => configCommand(subcommand, args));

program
  .command("ssh [query]")
  .description("SSH into a registered server")
  .option("-c, --command <command>", "Execute a single command via SSH")
  .action((query?: string, options?: { command?: string }) => sshCommand(query, options));

program
  .command("update [query]")
  .description("Update Coolify on a registered server")
  .option("--all", "Update Coolify on all servers")
  .option("--dry-run", "Show what would happen without executing")
  .action((query?: string, options?: { all?: boolean; dryRun?: boolean }) =>
    updateCommand(query, options),
  );

program
  .command("restart [query]")
  .description("Restart a registered server")
  .option("--dry-run", "Show what would happen without executing")
  .action((query?: string, options?: { dryRun?: boolean }) =>
    restartCommand(query, options),
  );

program
  .command("logs [query]")
  .description("View server logs (Coolify, Docker, or system)")
  .option("-n, --lines <lines>", "Number of log lines to show", "50")
  .option("-f, --follow", "Follow log output in real-time")
  .option("-s, --service <service>", "Log service: coolify, docker, system", "coolify")
  .action((query?: string, options?: { lines?: string; follow?: boolean; service?: string }) =>
    logsCommand(query, options),
  );

program
  .command("monitor [query]")
  .description("Show server resource usage (CPU, RAM, Disk)")
  .option("--containers", "Show Docker container list")
  .action((query?: string, options?: { containers?: boolean }) => monitorCommand(query, options));

program
  .command("health [query]")
  .description("Check health of all registered servers")
  .action((query?: string) => healthCommand(query));

program
  .command("doctor")
  .description("Check your local environment and configuration")
  .option("--check-tokens", "Validate provider API tokens")
  .action((options?: { checkTokens?: boolean }) => doctorCommand(options, pkg.version));

program
  .command("firewall [subcommand] [query]")
  .description("Manage server firewall (UFW)")
  .option("--port <port>", "Port number (for add/remove)")
  .option("--protocol <protocol>", "Protocol: tcp or udp (default: tcp)")
  .option("--dry-run", "Show commands without executing")
  .action(
    (
      subcommand?: string,
      query?: string,
      options?: { port?: string; protocol?: string; dryRun?: boolean },
    ) => firewallCommand(subcommand, query, options),
  );

program
  .command("domain [subcommand] [query]")
  .description("Manage server domain and SSL")
  .option("--domain <domain>", "Domain name (for add/check)")
  .option("--no-ssl", "Disable HTTPS (default: enabled)")
  .option("--dry-run", "Show commands without executing")
  .action(
    (
      subcommand?: string,
      query?: string,
      options?: { domain?: string; ssl?: boolean; dryRun?: boolean },
    ) => domainCommand(subcommand, query, options),
  );

program
  .command("secure [subcommand] [query]")
  .description("Manage server security (SSH hardening, fail2ban)")
  .option("--port <port>", "Change SSH port")
  .option("--dry-run", "Show commands without executing")
  .action((subcommand?: string, query?: string, options?: { port?: string; dryRun?: boolean }) =>
    secureCommand(subcommand, query, options),
  );

program
  .command("backup [query]")
  .description("Backup Coolify database and config files")
  .option("--dry-run", "Show commands without executing")
  .option("--all", "Backup all servers")
  .action((query?: string, options?: { dryRun?: boolean; all?: boolean }) =>
    backupCommand(query, options),
  );

program
  .command("restore [query]")
  .description("Restore Coolify from a backup")
  .option("--backup <backup>", "Backup timestamp to restore (skip selection prompt)")
  .option("--dry-run", "Show commands without executing")
  .action((query?: string, options?: { backup?: string; dryRun?: boolean }) =>
    restoreCommand(query, options),
  );

program
  .command("export [path]")
  .description("Export server list to a JSON file")
  .action((path?: string) => exportCommand(path));

program
  .command("import <path>")
  .description("Import servers from a JSON file")
  .action((path: string) => importCommand(path));

program
  .command("add")
  .description("Add an existing server to Kastell management")
  .option("--provider <provider>", "Cloud provider (hetzner, digitalocean, vultr, linode)")
  .option("--ip <ip>", "Server IP address")
  .option("--name <name>", "Server name")
  .option("--skip-verify", "Skip Coolify installation verification")
  .option("--mode <mode>", "Server mode: coolify (default), dokploy, or bare")
  .action((options?: { provider?: string; ip?: string; name?: string; skipVerify?: boolean; mode?: string }) =>
    addCommand(options),
  );

program
  .command("remove [query]")
  .description("Remove a server from local config (does not destroy the cloud server)")
  .option("--dry-run", "Show what would happen without executing")
  .action((query?: string, options?: { dryRun?: boolean }) =>
    removeCommand(query, options),
  );

program
  .command("maintain [query]")
  .description("Run full maintenance cycle (status, update, health, reboot)")
  .option("--skip-reboot", "Skip the reboot step")
  .option("--all", "Maintain all servers sequentially")
  .option("--dry-run", "Show steps without executing")
  .action((query?: string, options?: { skipReboot?: boolean; all?: boolean; dryRun?: boolean }) =>
    maintainCommand(query, options),
  );

program
  .command("snapshot [subcommand] [query]")
  .description("Manage server snapshots (create, list, delete)")
  .option("--all", "List snapshots across all servers")
  .option("--dry-run", "Show what would happen without executing")
  .option("--force", "Skip confirmation prompts")
  .action(
    (
      subcommand?: string,
      query?: string,
      options?: { all?: boolean; dryRun?: boolean; force?: boolean },
    ) => snapshotCommand(subcommand, query, options),
  );

program
  .command("completions [shell]")
  .description("Generate shell completion scripts (bash, zsh, fish)")
  .action(completionsCommand);

// If --version or -V, print version and await update check before exiting
const args = process.argv.slice(2);
if (args.includes("--version") || args.includes("-V")) {
  console.log(pkg.version);
  await checkForUpdate(pkg.version);
  process.exit(0);
}

// If no arguments provided, show header + interactive menu
if (args.length === 0) {
  printHeader(pkg.version);
  printQuickHelp();
  const selected = await interactiveMenu();
  if (selected) {
    await program.parseAsync(["node", "kastell", ...selected]);
  }
} else {
  await program.parseAsync();
}
checkForUpdate(pkg.version).catch(() => {});
