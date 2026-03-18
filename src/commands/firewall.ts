import inquirer from "inquirer";
import { resolveServer } from "../utils/serverSelect.js";
import { checkSshAvailable } from "../utils/ssh.js";
import { logger, createSpinner } from "../utils/logger.js";
import { isBareServer } from "../utils/modeGuard.js";
import { resolvePlatform, getAdapter } from "../adapters/factory.js";
import { adapterDisplayName } from "../adapters/shared.js";
import {
  isValidPort,
  isProtectedPort,
  firewallSetup,
  addFirewallRule,
  removeFirewallRule,
  getFirewallStatus,
} from "../core/firewall.js";
import type { FirewallProtocol } from "../types/index.js";

export async function firewallCommand(
  subcommand?: string,
  query?: string,
  options?: { port?: string; protocol?: string; dryRun?: boolean; force?: boolean },
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
      const platform = resolvePlatform(server);
      await firewallSetup(server.ip, server.name, dryRun, bare, platform);
      break;
    }
    case "add":
      await firewallAdd(server.ip, server.name, options, dryRun);
      break;
    case "remove": {
      const removePlatform = resolvePlatform(server);
      await firewallRemove(server.ip, server.name, options, dryRun, removePlatform, options?.force);
      break;
    }
    case "list":
      await firewallList(server.ip, server.name);
      break;
    case "status":
      await firewallStatusCheck(server.ip, server.name);
      break;
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

  if (dryRun) {
    logger.title("Dry Run - Add Firewall Rule");
    logger.info(`Server: ${name} (${ip})`);
    logger.step(`ufw allow ${port}/${protocol}`);
    logger.warning("No changes applied. Remove --dry-run to execute.");
    return;
  }

  const spinner = createSpinner(`Opening port ${port}/${protocol}...`);
  spinner.start();

  const result = await addFirewallRule(ip, port, protocol);

  if (!result.success) {
    spinner.fail(`Failed to open port ${port}/${protocol}`);
    logger.error(result.error ?? "Unknown error");
    if (result.hint) logger.info(result.hint);
    return;
  }

  spinner.succeed(`Port ${port}/${protocol} opened on ${name}`);
}

async function firewallRemove(
  ip: string,
  name: string,
  options?: { port?: string; protocol?: string },
  dryRun?: boolean,
  platform?: import("../types/index.js").Platform,
  force?: boolean,
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

  const platformAdapter = platform ? getAdapter(platform) : null;
  const isPlatformPort = platformAdapter ? platformAdapter.platformPorts.includes(port) : false;

  if (isPlatformPort && !force) {
    const platformName = platformAdapter ? adapterDisplayName(platformAdapter) : "platform";
    const { confirm } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirm",
        message: `Port ${port} is used by ${platformName}. Are you sure you want to remove it?`,
        default: false,
      },
    ]);
    if (!confirm) {
      logger.info("Remove cancelled.");
      return;
    }
  }

  if (dryRun) {
    logger.title("Dry Run - Remove Firewall Rule");
    logger.info(`Server: ${name} (${ip})`);
    logger.step(`ufw delete allow ${port}/${protocol}`);
    logger.warning("No changes applied. Remove --dry-run to execute.");
    return;
  }

  const spinner = createSpinner(`Closing port ${port}/${protocol}...`);
  spinner.start();

  const result = await removeFirewallRule(ip, port, protocol, platform);

  if (!result.success) {
    spinner.fail(`Failed to close port ${port}/${protocol}`);
    logger.error(result.error ?? "Unknown error");
    if (result.hint) logger.info(result.hint);
    return;
  }

  if (result.warning) {
    logger.warning(result.warning);
  }
  spinner.succeed(`Port ${port}/${protocol} closed on ${name}`);
}

async function firewallList(ip: string, name: string): Promise<void> {
  const spinner = createSpinner(`Fetching firewall rules from ${name}...`);
  spinner.start();

  const result = await getFirewallStatus(ip);

  if (result.error) {
    spinner.fail("Failed to fetch firewall rules");
    logger.error(result.error);
    if (result.hint) logger.info(result.hint);
    return;
  }

  spinner.succeed(`Firewall rules for ${name} (${ip})`);

  if (!result.status.active) {
    logger.warning("UFW is inactive. Run 'kastell firewall setup' to enable.");
    return;
  }

  if (result.status.rules.length === 0) {
    logger.info("No rules configured.");
    return;
  }

  console.log();
  for (const rule of result.status.rules) {
    logger.step(`${rule.port}/${rule.protocol} → ${rule.action} from ${rule.from}`);
  }
}

async function firewallStatusCheck(ip: string, name: string): Promise<void> {
  const spinner = createSpinner(`Checking firewall status on ${name}...`);
  spinner.start();

  const result = await getFirewallStatus(ip);

  if (result.error) {
    spinner.fail("Failed to check firewall status");
    logger.error(result.error);
    if (result.hint) logger.info(result.hint);
    return;
  }

  if (result.status.active) {
    spinner.succeed(`UFW is active on ${name}`);
    if (result.status.rules.length > 0) {
      console.log();
      logger.info(`Open ports (${result.status.rules.length} rules):`);
      for (const rule of result.status.rules) {
        logger.step(`${rule.port}/${rule.protocol} → ${rule.action} from ${rule.from}`);
      }
    } else {
      logger.info("No rules configured.");
    }
  } else {
    spinner.warn(`UFW is inactive on ${name}`);
    logger.info("Run 'kastell firewall setup' to enable.");
  }
}
