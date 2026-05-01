#!/usr/bin/env node

import { Command } from "commander";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { checkForUpdate } from "./utils/updateCheck.js";
import { migrateConfigIfNeeded } from "./utils/migration.js";
import { loadPlugins } from "./plugin/loader.js";
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
import { registerAuthCommands } from "./commands/auth.js";
import { auditCommand } from "./commands/audit.js";
import { explainCommand } from "./commands/explain.js";
import { evidenceCommand } from "./commands/evidence.js";
import { lockCommand } from "./commands/lock.js";
import { guardCommand } from "./commands/guard.js";
import { notifyCommand } from "./commands/notify.js";
import { fleetCommand } from "./commands/fleet.js";
import { botCommand } from "./commands/bot.js";
import { fixSafeCommand } from "./commands/fix.js";
import { scheduleCommand } from "./commands/schedule.js";
import { changelogCommand } from "./commands/changelog.js";
import { regressionStatusCommand, regressionResetCommand } from "./commands/regression.js";
import { printHeader, printQuickHelp } from "./cli/header.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));

// Graceful handling of unhandled rejections (security audit MEDIUM-007)
process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  process.stderr.write(`Unhandled rejection: ${msg}\n`);
  process.exit(1);
});

migrateConfigIfNeeded();

const pluginResult = await loadPlugins();
if (pluginResult.errors.length > 0) {
  for (const err of pluginResult.errors) {
    console.warn(`[plugin] ${err}`);
  }
}

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
  .option("--force", "Skip confirmation prompts")
  .action((query?: string, options?: { dryRun?: boolean; force?: boolean }) =>
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
  .option("--force", "Skip confirmation prompts")
  .action((query?: string, options?: { all?: boolean; dryRun?: boolean; force?: boolean }) =>
    updateCommand(query, options),
  );

program
  .command("restart [query]")
  .description("Restart a registered server")
  .option("--dry-run", "Show what would happen without executing")
  .option("--force", "Skip confirmation prompts")
  .action((query?: string, options?: { dryRun?: boolean; force?: boolean }) =>
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
  .command("doctor [server]")
  .description("Check local environment, or run proactive health analysis on a server")
  .option("--check-tokens", "Validate provider API tokens (local mode only)")
  .option("--fresh", "Fetch live data from server via SSH before analysis")
  .option("--json", "Output findings as JSON")
  .option("--fix", "Interactively fix doctor findings via SSH")
  .option("--force", "Skip confirmation prompts (use with --fix)")
  .option("--dry-run", "Show fix commands without executing (use with --fix)")
  .option("--auto-fix", "Run diagnose->fix chain for all actionable findings")
  .action(
    (
      server?: string,
      options?: {
        checkTokens?: boolean;
        fresh?: boolean;
        json?: boolean;
        fix?: boolean;
        force?: boolean;
        dryRun?: boolean;
        autoFix?: boolean;
      },
    ) => doctorCommand(server, options, pkg.version),
  );

program
  .command("firewall [subcommand] [query]")
  .description("Manage server firewall (UFW)")
  .option("--port <port>", "Port number (for add/remove)")
  .option("--protocol <protocol>", "Protocol: tcp or udp (default: tcp)")
  .option("--dry-run", "Show commands without executing")
  .option("--force", "Skip confirmation prompts")
  .action(
    (
      subcommand?: string,
      query?: string,
      options?: { port?: string; protocol?: string; dryRun?: boolean; force?: boolean },
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
  .command("lock [query]")
  .description("Harden a server to production security standard")
  .option("--production", "Apply all hardening measures (SSH, fail2ban, UFW, sysctl, auto-updates)")
  .option("--dry-run", "Preview changes without applying")
  .option("--force", "Skip confirmation prompt")
  .action((query, options) => lockCommand(query, options));

const guard = program
  .command("guard")
  .description("Manage autonomous security monitoring daemon on a server");

guard
  .command("start [query]")
  .description("Install guard daemon (checks disk, RAM, CPU every 5 minutes)")
  .option("--force", "Skip confirmation prompt")
  .action((query, options) => guardCommand("start", query, options));

guard
  .command("status [query]")
  .description("Show guard daemon status and recent alerts")
  .action((query) => guardCommand("status", query, {}));

guard
  .command("stop [query]")
  .description("Remove guard daemon from server")
  .option("--force", "Skip confirmation prompt")
  .action((query, options) => guardCommand("stop", query, options));

program
  .command("secure [subcommand] [query]")
  .description("Manage server security (SSH hardening, fail2ban)")
  .option("--port <port>", "Change SSH port")
  .option("--dry-run", "Show commands without executing")
  .option("--force", "Skip confirmation prompts")
  .action((subcommand?: string, query?: string, options?: { port?: string; dryRun?: boolean; force?: boolean }) =>
    secureCommand(subcommand, query, options),
  );

program
  .command("backup [query]")
  .description("Backup server data, or manage backup schedule (use 'list' or 'cleanup' as query)")
  .option("--dry-run", "Show commands without executing")
  .option("--all", "Backup all servers")
  .option("--schedule <value>", 'Cron expression, "list", or "remove"')
  .option("--force", "Skip confirmation prompts")
  .action((query?: string, options?: { dryRun?: boolean; all?: boolean; schedule?: string; force?: boolean }) =>
    backupCommand(query, options),
  );

program
  .command("restore [query]")
  .description("Restore Coolify from a backup")
  .option("--backup <backup>", "Backup timestamp to restore (skip selection prompt)")
  .option("--dry-run", "Show commands without executing")
  .option("--force", "Skip confirmation prompts")
  .action((query?: string, options?: { backup?: string; dryRun?: boolean; force?: boolean }) =>
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
  .option("--force", "Skip confirmation prompts")
  .action((query?: string, options?: { dryRun?: boolean; force?: boolean }) =>
    removeCommand(query, options),
  );

program
  .command("maintain [query]")
  .description("Run full maintenance cycle (status, update, health, reboot)")
  .option("--skip-reboot", "Skip the reboot step")
  .option("--all", "Maintain all servers sequentially")
  .option("--dry-run", "Show steps without executing")
  .option("--force", "Skip confirmation prompts")
  .action((query?: string, options?: { skipReboot?: boolean; all?: boolean; dryRun?: boolean; force?: boolean }) =>
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

program
  .command("explain <check-id>")
  .description("Deep-dive into a single audit check — why it matters, how to fix it, compliance references")
  .option("--format <format>", "Output format: terminal (default), json, md", "terminal")
  .action(async (checkId: string, options: { format?: string }) => {
    await explainCommand(checkId, options as { format?: "terminal" | "json" | "md" });
  });

program
  .command("audit [server-name]")
  .description("Run a security audit on a server")
  .option("--json", "Output results as JSON")
  .option("--badge", "Output an SVG badge with score")
  .option("--report <format>", "Generate a report (html or md)")
  .option("--summary", "Show compact dashboard summary")
  .option("--score-only", "Output only the score (e.g. 72/100)")
  .option("--fix", "Interactive fix mode")
  .option("--dry-run", "Show fix commands without executing")
  .option("--watch [interval]", "Watch mode with optional interval in seconds")
  .option("--host <user@ip>", "Audit an unregistered server by IP")
  .option("--threshold <score>", "Exit with code 1 if score is below threshold")
  .option("--ci", "CI mode: JSON output, no spinner, requires --threshold")
  .option("--category <list>", "Comma-separated list of categories to audit")
  .option("--snapshot [name]", "Save audit result as snapshot (optionally named)")
  .option("--snapshots", "List saved snapshots for the server")
  .option("--diff <before:after>", "Compare two snapshots (e.g. pre-upgrade:latest)")
  .option("--compare <server1:server2>", "Compare two servers (uses snapshots, falls back to live audit)")
  .option("--fresh", "Force live audit for --compare (skip snapshots)")
  .option("--detail", "Show check-level diff instead of category summary in --compare")
  .option("--trend", "Show audit score trend over time")
  .option("--days <n>", "Limit trend to last N days")
  .option("--list-checks", "List all audit checks without running audit")
  .option("--severity <level>", "Filter by severity (critical, warning, info)")
  .option("--profile <name>", "Compliance profile filter (cis-level1, cis-level2, pci-dss, hipaa)")
  .option("--compliance <frameworks>", "Compliance report by framework (cis, pci-dss, hipaa — comma-separated)")
  .option("--explain", "Show why each failing check matters and how to fix it")
  .action((serverName?: string, options?: Record<string, unknown>) =>
    auditCommand(serverName, options),
  );

program
  .command("evidence [server]")
  .description("Collect forensic evidence package from a server")
  .option("--name <label>", "Label for evidence directory")
  .option("--output <dir>", "Override output directory")
  .option("--lines <n>", "Log lines to collect (default: 500)", "500")
  .option("--no-docker", "Skip Docker data collection")
  .option("--no-sysinfo", "Skip system info collection")
  .option("--quiet", "Suppress spinner output")
  .option("--force", "Overwrite existing evidence")
  .option("--json", "Print manifest JSON to stdout")
  .action((server?: string, options?: Record<string, unknown>) =>
    evidenceCommand(server, options ?? {}),
  );

program
  .command("fix [server]")
  .description("Apply safe auto-fixes from security audit (SAFE tier only)")
  .option("--safe", "Apply only SAFE tier fixes (no service restarts)")
  .option("--dry-run", "Preview fixes without applying")
  .option("--category <list>", "Comma-separated category filter")
  .option("--rollback <id>", "Rollback a previous fix (fix ID or 'last')")
  .option("--rollback-all", "Rollback all applied fixes for server")
  .option("--rollback-to <id>", "Rollback all fixes from newest down to given fix ID")
  .option("--history", "Show fix history for the server")
  .option("--top <n>", "Apply top N highest-impact SAFE fixes (requires --safe)")
  .option("--target <score>", "Apply SAFE fixes until score reaches target (requires --safe)")
  .option("--checks <ids>", "Comma-separated check IDs to fix (e.g. KERN-SYNCOOKIES,FW-DENY)")
  .option("--profile <name>", "Apply only checks matching server profile (web-server, database, mail-server)")
  .option("--diff", "Show per-fix diff preview after applying")
  .option("--report", "Generate markdown fix report after applying fixes")
  .option("--no-interactive", "Skip confirmation prompt (for scheduled/automated runs)")
  .option("--force", "Bypass regression gate and force operation")
  .action(
    (server?: string, options?: { safe?: boolean; dryRun?: boolean; category?: string; checks?: string; rollback?: string; rollbackAll?: boolean; rollbackTo?: string; history?: boolean; top?: string; target?: string; profile?: string; diff?: boolean; report?: boolean; interactive?: boolean; force?: boolean }) =>
      fixSafeCommand(server, options ?? {}),
  );

program.addCommand(scheduleCommand());
notifyCommand(program);
fleetCommand(program);
botCommand(program);

program
  .command("changelog [version]")
  .description("Show release notes from CHANGELOG.md")
  .option("--all", "Show full changelog")
  .action((version?: string, options?: { all?: boolean }) =>
    changelogCommand(version, options),
  );

const regressionCmd = program
  .command("regression")
  .description("Manage regression baselines");

regressionCmd
  .command("status")
  .description("Show baseline status for all or specific server")
  .argument("[server]", "Server IP to check")
  .action(async (server?: string) => {
    await regressionStatusCommand(server);
  });

regressionCmd
  .command("reset")
  .description("Delete baseline for a server")
  .requiredOption("--server <ip>", "Server IP to reset")
  .option("--force", "Skip confirmation prompt")
  .action(async (options: { server: string; force?: boolean }) => {
    await regressionResetCommand(options.server, options);
  });

registerAuthCommands(program);

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
    if (selected[0] === "version") {
      console.log(pkg.version);
      await checkForUpdate(pkg.version);
    } else {
      await program.parseAsync(["node", "kastell", ...selected]);
    }
  }
} else {
  await program.parseAsync();
}
checkForUpdate(pkg.version).catch(() => {});
