import { resolveServer } from "../utils/serverSelect.js";
import { checkSshAvailable } from "../utils/ssh.js";
import { logger, createSpinner } from "../utils/logger.js";
import { requireManagedMode } from "../utils/modeGuard.js";
import { markCommandFailed } from "../utils/exitCode.js";
import { updateServer } from "../utils/config.js";
import { resolvePlatform } from "../adapters/factory.js";
import {
  isValidDomain,
  sanitizeDomain,
  buildSetFqdnCommand,
  platformDefaults,
  setDomain,
  removeDomain,
  getDomain,
  checkDns,
} from "../core/domain.js";
import type { Platform } from "../types/index.js";

export async function domainCommand(
  subcommand?: string,
  query?: string,
  options?: { domain?: string; ssl?: boolean; dryRun?: boolean },
): Promise<void> {
  if (!checkSshAvailable()) {
    logger.error("SSH client not found. Please install OpenSSH.");
    markCommandFailed();
    return;
  }

  const validSubcommands = ["add", "remove", "check", "list", "info"];
  const sub = subcommand || "list";

  if (!validSubcommands.includes(sub)) {
    logger.error(`Invalid subcommand: ${sub}. Choose from: ${validSubcommands.join(", ")}`);
    markCommandFailed();
    return;
  }

  const server = await resolveServer(query, "Select a server for domain management:");
  if (!server) {
    markCommandFailed();
    return;
  }

  const modeError = requireManagedMode(server, "domain");
  if (modeError) {
    logger.error(modeError);
    markCommandFailed();
    return;
  }

  const platform = resolvePlatform(server) ?? "coolify";
  const dryRun = options?.dryRun || false;

  switch (sub) {
    case "add":
      await domainAdd(server.ip, server.name, platform, options, dryRun);
      break;
    case "remove":
      await domainRemove(server.ip, server.name, platform, dryRun);
      break;
    case "check":
      await domainCheck(server.ip, options);
      break;
    case "list":
      await domainList(server.ip, server.name, platform);
      break;
    case "info":
      await domainInfo(server.ip, server.name, platform);
      break;
  }
}

async function domainAdd(
  ip: string,
  name: string,
  platform: Platform,
  options?: { domain?: string; ssl?: boolean },
  dryRun?: boolean,
): Promise<void> {
  if (!options?.domain) {
    logger.error("Missing --domain. Usage: kastell domain add <server> --domain example.com");
    markCommandFailed();
    return;
  }

  const domain = sanitizeDomain(options.domain);
  if (!isValidDomain(domain)) {
    logger.error(`Invalid domain: ${domain}`);
    markCommandFailed();
    return;
  }

  const ssl = options?.ssl !== false; // default true
  const { label: platformLabel } = platformDefaults(platform);

  if (dryRun) {
    const command = buildSetFqdnCommand(domain, ssl, platform);
    logger.title("Dry Run - Add Domain");
    logger.info(`Server: ${name} (${ip})`);
    logger.info(`Platform: ${platformLabel}`);
    logger.info(`Domain: ${domain}`);
    logger.info(`SSL: ${ssl ? "enabled" : "disabled"}`);
    console.log();
    logger.info("Commands to execute:");
    for (const cmd of command.split(" && ")) {
      logger.step(cmd.trim());
    }
    console.log();
    logger.warning("No changes applied. Remove --dry-run to execute.");
    return;
  }

  const spinner = createSpinner(`Setting domain to ${domain}...`);
  spinner.start();

  const result = await setDomain(ip, domain, ssl, platform);

  if (!result.success) {
    spinner.fail("Failed to set domain");
    logger.error(result.error ?? "Unknown error");
    if (result.hint) logger.info(result.hint);
    markCommandFailed();
    return;
  }

  spinner.succeed(`Domain set to ${domain} on ${name}`);
  await updateServer(name, { domain });
  const protocol = ssl ? "https" : "http";
  logger.success(`${platformLabel} is now accessible at ${protocol}://${domain}`);
  logger.info("Make sure your DNS A record points to " + ip);
}

async function domainRemove(ip: string, name: string, platform: Platform, dryRun: boolean): Promise<void> {
  const { port: defaultPort, label: platformLabel } = platformDefaults(platform);

  if (dryRun) {
    const command = buildSetFqdnCommand(`${ip}:${defaultPort}`, false, platform);
    logger.title("Dry Run - Remove Domain");
    logger.info(`Server: ${name} (${ip})`);
    logger.info(`Will reset to: http://${ip}:${defaultPort}`);
    console.log();
    logger.info("Commands to execute:");
    for (const cmd of command.split(" && ")) {
      logger.step(cmd.trim());
    }
    console.log();
    logger.warning("No changes applied. Remove --dry-run to execute.");
    return;
  }

  const spinner = createSpinner("Removing domain...");
  spinner.start();

  const result = await removeDomain(ip, platform);

  if (!result.success) {
    spinner.fail("Failed to remove domain");
    logger.error(result.error ?? "Unknown error");
    if (result.hint) logger.info(result.hint);
    markCommandFailed();
    return;
  }

  spinner.succeed(`Domain removed from ${name}`);
  await updateServer(name, { domain: undefined });
  logger.success(`${platformLabel} is now accessible at http://${ip}:${defaultPort}`);
}

async function domainCheck(ip: string, options?: { domain?: string }): Promise<void> {
  if (!options?.domain) {
    logger.error("Missing --domain. Usage: kastell domain check <server> --domain example.com");
    markCommandFailed();
    return;
  }

  const domain = sanitizeDomain(options.domain);
  if (!isValidDomain(domain)) {
    logger.error(`Invalid domain: ${domain}`);
    markCommandFailed();
    return;
  }

  const spinner = createSpinner(`Checking DNS for ${domain}...`);
  spinner.start();

  const result = await checkDns(ip, domain);

  if (result.error) {
    spinner.fail("Failed to check DNS");
    logger.error(result.error);
    if (result.hint) logger.info(result.hint);
    markCommandFailed();
    return;
  }

  if (!result.resolvedIp) {
    spinner.fail(`No A record found for ${domain}`);
    logger.info("Add an A record pointing to " + ip);
    markCommandFailed();
    return;
  }

  if (result.match) {
    spinner.succeed(`DNS OK: ${domain} → ${result.resolvedIp}`);
  } else {
    spinner.warn(`DNS mismatch: ${domain} → ${result.resolvedIp} (expected ${ip})`);
    logger.info("Update your A record to point to " + ip);
    markCommandFailed();
  }
}

async function domainList(ip: string, name: string, platform: Platform): Promise<void> {
  const spinner = createSpinner(`Fetching domain from ${name}...`);
  spinner.start();
  const { port: defaultPort } = platformDefaults(platform);

  const result = await getDomain(ip, platform);

  if (result.error) {
    spinner.fail("Failed to fetch domain");
    logger.error(result.error);
    if (result.hint) logger.info(result.hint);
    markCommandFailed();
    return;
  }

  if (result.fqdn) {
    spinner.succeed(`Current domain for ${name}`);
    logger.info(`FQDN: ${result.fqdn}`);
  } else {
    spinner.succeed(`No custom domain set for ${name}`);
    logger.info(`Default: http://${ip}:${defaultPort}`);
  }
}

async function domainInfo(ip: string, name: string, platform: Platform): Promise<void> {
  const spinner = createSpinner(`Fetching domain info for ${name}...`);
  spinner.start();
  const { port: defaultPort, label: platformLabel } = platformDefaults(platform);

  const result = await getDomain(ip, platform);

  if (result.error) {
    spinner.fail("Failed to fetch domain info");
    logger.error(result.error);
    if (result.hint) logger.info(result.hint);
    markCommandFailed();
    return;
  }

  spinner.succeed(`Domain info for ${name}`);
  console.log();
  logger.info(`Server: ${name} (${ip})`);
  logger.info(`Platform: ${platformLabel}`);
  if (result.fqdn) {
    logger.info(`FQDN: ${result.fqdn}`);
    const isHttps = result.fqdn.startsWith("https://");
    logger.info(`SSL: ${isHttps ? "enabled" : "disabled"}`);
    logger.info(`URL: ${result.fqdn}`);
  } else {
    logger.info(`FQDN: not set (using IP)`);
    logger.info(`URL: http://${ip}:${defaultPort}`);
  }
}
