import inquirer from "inquirer";
import { resolveServer } from "../utils/serverSelect.js";
import { checkSshAvailable, sshExec } from "../utils/ssh.js";
import { logger, createSpinner } from "../utils/logger.js";
import { getErrorMessage, mapSshError } from "../utils/errorMapper.js";
import { isBareServer } from "../utils/modeGuard.js";
import {
  PROTECTED_PORTS,
  COOLIFY_PORTS,
  BARE_PORTS,
  isValidPort,
  isProtectedPort,
  buildUfwRuleCommand,
  buildFirewallSetupCommand,
  buildBareFirewallSetupCommand,
  buildUfwStatusCommand,
  parseUfwStatus,
} from "../core/firewall.js";
export {
  PROTECTED_PORTS,
  COOLIFY_PORTS,
  BARE_PORTS,
  isValidPort,
  isProtectedPort,
  buildUfwRuleCommand,
  buildFirewallSetupCommand,
  buildBareFirewallSetupCommand,
  buildUfwStatusCommand,
  parseUfwStatus,
};
import type { FirewallProtocol } from "../types/index.js";

export async function firewallCommand(
  subcommand?: string,
  query?: string,
  options?: { port?: string; protocol?: string; dryRun?: boolean },
): Promise<void> {
  if (!checkSshAvailable()) {
    logger.error("SSH client not found. Please install OpenSSH.");
    return;
  }

  const validSubcommands = ["setup", "add", "remove", "list", "status"];
  const sub = subcommand || "status";

  if (!validSubcommands.includes(sub)) {
    logger.error(`Invalid subcommand: ${sub}. Choose from: ${validSubcommands.join(", ")}`);
    return;
  }

  const server = await resolveServer(query, "Select a server for firewall management:");
  if (!server) return;

  const dryRun = options?.dryRun || false;

  switch (sub) {
    case "setup": {
      const bare = isBareServer(server);
      await firewallSetup(server.ip, server.name, dryRun, bare);
      break;
    }
    case "add":
      await firewallAdd(server.ip, server.name, options, dryRun);
      break;
    case "remove":
      await firewallRemove(server.ip, server.name, options, dryRun);
      break;
    case "list":
      await firewallList(server.ip, server.name);
      break;
    case "status":
      await firewallStatusCheck(server.ip, server.name);
      break;
  }
}

export async function firewallSetup(
  ip: string,
  name: string,
  dryRun: boolean,
  isBare?: boolean,
): Promise<void> {
  const command = isBare ? buildBareFirewallSetupCommand() : buildFirewallSetupCommand();

  if (dryRun) {
    logger.title("Dry Run - Firewall Setup");
    logger.info(`Server: ${name} (${ip})`);
    console.log();
    logger.info("Commands to execute:");
    for (const cmd of command.split(" && ")) {
      logger.step(cmd);
    }
    console.log();
    logger.warning("No changes applied. Remove --dry-run to execute.");
    return;
  }

  const spinner = createSpinner("Setting up firewall...");
  spinner.start();

  try {
    const result = await sshExec(ip, command);
    if (result.code !== 0) {
      spinner.fail("Failed to setup firewall");
      if (result.stderr) logger.error(result.stderr);
      return;
    }
    spinner.succeed("Firewall configured successfully");
    if (isBare) {
      logger.success(`UFW enabled with web ports (${BARE_PORTS.join(", ")}) + SSH (22)`);
    } else {
      logger.success(`UFW enabled with Coolify ports (${COOLIFY_PORTS.join(", ")}) + SSH (22)`);
    }
  } catch (error: unknown) {
    spinner.fail("Failed to setup firewall");
    logger.error(getErrorMessage(error));
    const hint = mapSshError(error, ip);
    if (hint) logger.info(hint);
  }
}

async function firewallAdd(
  ip: string,
  name: string,
  options?: { port?: string; protocol?: string },
  dryRun?: boolean,
): Promise<void> {
  const port = parseInt(options?.port || "", 10);
  if (!options?.port || !isValidPort(port)) {
    logger.error("Invalid or missing --port. Must be 1-65535.");
    return;
  }

  const protocol = (options?.protocol as FirewallProtocol) || "tcp";
  if (protocol !== "tcp" && protocol !== "udp") {
    logger.error("Invalid --protocol. Must be tcp or udp.");
    return;
  }

  const command = buildUfwRuleCommand("allow", port, protocol);

  if (dryRun) {
    logger.title("Dry Run - Add Firewall Rule");
    logger.info(`Server: ${name} (${ip})`);
    logger.step(command);
    logger.warning("No changes applied. Remove --dry-run to execute.");
    return;
  }

  const spinner = createSpinner(`Opening port ${port}/${protocol}...`);
  spinner.start();

  try {
    const result = await sshExec(ip, command);
    if (result.code !== 0) {
      spinner.fail(`Failed to open port ${port}/${protocol}`);
      if (result.stderr) logger.error(result.stderr);
      return;
    }
    spinner.succeed(`Port ${port}/${protocol} opened on ${name}`);
  } catch (error: unknown) {
    spinner.fail(`Failed to open port ${port}/${protocol}`);
    logger.error(getErrorMessage(error));
    const hint = mapSshError(error, ip);
    if (hint) logger.info(hint);
  }
}

async function firewallRemove(
  ip: string,
  name: string,
  options?: { port?: string; protocol?: string },
  dryRun?: boolean,
): Promise<void> {
  const port = parseInt(options?.port || "", 10);
  if (!options?.port || !isValidPort(port)) {
    logger.error("Invalid or missing --port. Must be 1-65535.");
    return;
  }

  if (isProtectedPort(port)) {
    logger.error(`Port ${port} is protected and cannot be removed (SSH access).`);
    return;
  }

  const protocol = (options?.protocol as FirewallProtocol) || "tcp";
  if (protocol !== "tcp" && protocol !== "udp") {
    logger.error("Invalid --protocol. Must be tcp or udp.");
    return;
  }

  if (COOLIFY_PORTS.includes(port)) {
    const { confirm } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirm",
        message: `Port ${port} is used by Coolify. Are you sure you want to remove it?`,
        default: false,
      },
    ]);
    if (!confirm) {
      logger.info("Remove cancelled.");
      return;
    }
  }

  const command = buildUfwRuleCommand("delete allow", port, protocol);

  if (dryRun) {
    logger.title("Dry Run - Remove Firewall Rule");
    logger.info(`Server: ${name} (${ip})`);
    logger.step(command);
    logger.warning("No changes applied. Remove --dry-run to execute.");
    return;
  }

  const spinner = createSpinner(`Closing port ${port}/${protocol}...`);
  spinner.start();

  try {
    const result = await sshExec(ip, command);
    if (result.code !== 0) {
      spinner.fail(`Failed to close port ${port}/${protocol}`);
      if (result.stderr) logger.error(result.stderr);
      return;
    }
    spinner.succeed(`Port ${port}/${protocol} closed on ${name}`);
  } catch (error: unknown) {
    spinner.fail(`Failed to close port ${port}/${protocol}`);
    logger.error(getErrorMessage(error));
    const hint = mapSshError(error, ip);
    if (hint) logger.info(hint);
  }
}

async function firewallList(ip: string, name: string): Promise<void> {
  const spinner = createSpinner(`Fetching firewall rules from ${name}...`);
  spinner.start();

  try {
    const result = await sshExec(ip, buildUfwStatusCommand());
    if (result.code !== 0) {
      spinner.fail("Failed to fetch firewall rules");
      if (result.stderr) logger.error(result.stderr);
      return;
    }

    const status = parseUfwStatus(result.stdout);
    spinner.succeed(`Firewall rules for ${name} (${ip})`);

    if (!status.active) {
      logger.warning("UFW is inactive. Run 'kastell firewall setup' to enable.");
      return;
    }

    if (status.rules.length === 0) {
      logger.info("No rules configured.");
      return;
    }

    console.log();
    for (const rule of status.rules) {
      logger.step(`${rule.port}/${rule.protocol} → ${rule.action} from ${rule.from}`);
    }
  } catch (error: unknown) {
    spinner.fail("Failed to fetch firewall rules");
    logger.error(getErrorMessage(error));
    const hint = mapSshError(error, ip);
    if (hint) logger.info(hint);
  }
}

async function firewallStatusCheck(ip: string, name: string): Promise<void> {
  const spinner = createSpinner(`Checking firewall status on ${name}...`);
  spinner.start();

  try {
    const result = await sshExec(ip, buildUfwStatusCommand());
    if (result.code !== 0) {
      spinner.fail("Failed to check firewall status");
      if (result.stderr) logger.error(result.stderr);
      return;
    }

    const status = parseUfwStatus(result.stdout);
    if (status.active) {
      spinner.succeed(`UFW is active on ${name}`);
      if (status.rules.length > 0) {
        console.log();
        logger.info(`Open ports (${status.rules.length} rules):`);
        for (const rule of status.rules) {
          logger.step(`${rule.port}/${rule.protocol} → ${rule.action} from ${rule.from}`);
        }
      } else {
        logger.info("No rules configured.");
      }
    } else {
      spinner.warn(`UFW is inactive on ${name}`);
      logger.info("Run 'kastell firewall setup' to enable.");
    }
  } catch (error: unknown) {
    spinner.fail("Failed to check firewall status");
    logger.error(getErrorMessage(error));
    const hint = mapSshError(error, ip);
    if (hint) logger.info(hint);
  }
}
