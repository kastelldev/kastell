import { resolveServer } from "../utils/serverSelect.js";
import { checkSshAvailable, sshExec } from "../utils/ssh.js";
import { logger, createSpinner } from "../utils/logger.js";
import { getErrorMessage, mapSshError } from "../utils/errorMapper.js";
import { COOLIFY_DB_CONTAINER } from "../constants.js";
import { requireManagedMode } from "../utils/modeGuard.js";
import { updateServer } from "../utils/config.js";
import { resolvePlatform } from "../adapters/factory.js";
import {
  isValidDomain,
  sanitizeDomain,
  escapePsqlString,
  buildSetFqdnCommand,
  buildGetFqdnCommand,
  buildCoolifyCheckCommand,
  buildDnsCheckCommand,
  parseDnsResult,
  parseFqdn,
} from "../core/domain.js";
export {
  isValidDomain,
  sanitizeDomain,
  escapePsqlString,
  buildSetFqdnCommand,
  buildGetFqdnCommand,
  buildCoolifyCheckCommand,
  buildDnsCheckCommand,
  parseDnsResult,
  parseFqdn,
};

export async function domainCommand(
  subcommand?: string,
  query?: string,
  options?: { domain?: string; ssl?: boolean; dryRun?: boolean },
): Promise<void> {
  if (!checkSshAvailable()) {
    logger.error("SSH client not found. Please install OpenSSH.");
    return;
  }

  const validSubcommands = ["add", "remove", "check", "list", "info"];
  const sub = subcommand || "list";

  if (!validSubcommands.includes(sub)) {
    logger.error(`Invalid subcommand: ${sub}. Choose from: ${validSubcommands.join(", ")}`);
    return;
  }

  const server = await resolveServer(query, "Select a server for domain management:");
  if (!server) return;

  const modeError = requireManagedMode(server, "domain");
  if (modeError) {
    logger.error(modeError);
    return;
  }

  const platform = resolvePlatform(server) ?? "coolify";
  if (platform === "dokploy") {
    logger.error("Domain management is not supported for Dokploy servers. Use the Dokploy dashboard instead.");
    return;
  }

  const dryRun = options?.dryRun || false;

  switch (sub) {
    case "add":
      await domainAdd(server.ip, server.name, options, dryRun);
      break;
    case "remove":
      await domainRemove(server.ip, server.name, dryRun);
      break;
    case "check":
      await domainCheck(server.ip, options);
      break;
    case "list":
      await domainList(server.ip, server.name);
      break;
    case "info":
      await domainInfo(server.ip, server.name);
      break;
  }
}

async function domainAdd(
  ip: string,
  name: string,
  options?: { domain?: string; ssl?: boolean },
  dryRun?: boolean,
): Promise<void> {
  if (!options?.domain) {
    logger.error("Missing --domain. Usage: kastell domain add <server> --domain example.com");
    return;
  }

  const domain = sanitizeDomain(options.domain);
  if (!isValidDomain(domain)) {
    logger.error(`Invalid domain: ${domain}`);
    return;
  }

  const ssl = options?.ssl !== false; // default true
  const command = buildSetFqdnCommand(domain, ssl);

  if (dryRun) {
    logger.title("Dry Run - Add Domain");
    logger.info(`Server: ${name} (${ip})`);
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

  try {
    // Check if coolify-db container is running
    const checkResult = await sshExec(ip, buildCoolifyCheckCommand());
    if (!checkResult.stdout.includes(COOLIFY_DB_CONTAINER)) {
      spinner.fail("Coolify database container not found");
      logger.error("Is Coolify installed and running on this server?");
      logger.info("Run: kastell status <server> to check");
      return;
    }

    const result = await sshExec(ip, command);
    if (result.code !== 0) {
      spinner.fail("Failed to set domain");
      if (result.stderr) logger.error(result.stderr);
      return;
    }

    spinner.succeed(`Domain set to ${domain} on ${name}`);
    updateServer(name, { domain });
    const protocol = ssl ? "https" : "http";
    logger.success(`Coolify is now accessible at ${protocol}://${domain}`);
    logger.info("Make sure your DNS A record points to " + ip);
  } catch (error: unknown) {
    spinner.fail("Failed to set domain");
    logger.error(getErrorMessage(error));
    const hint = mapSshError(error, ip);
    if (hint) logger.info(hint);
  }
}

async function domainRemove(ip: string, name: string, dryRun: boolean): Promise<void> {
  const command = buildSetFqdnCommand(`${ip}:8000`, false);

  if (dryRun) {
    logger.title("Dry Run - Remove Domain");
    logger.info(`Server: ${name} (${ip})`);
    logger.info(`Will reset to: http://${ip}:8000`);
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

  try {
    const result = await sshExec(ip, command);
    if (result.code !== 0) {
      spinner.fail("Failed to remove domain");
      if (result.stderr) logger.error(result.stderr);
      return;
    }

    spinner.succeed(`Domain removed from ${name}`);
    updateServer(name, { domain: undefined });
    logger.success(`Coolify is now accessible at http://${ip}:8000`);
  } catch (error: unknown) {
    spinner.fail("Failed to remove domain");
    logger.error(getErrorMessage(error));
    const hint = mapSshError(error, ip);
    if (hint) logger.info(hint);
  }
}

async function domainCheck(ip: string, options?: { domain?: string }): Promise<void> {
  if (!options?.domain) {
    logger.error("Missing --domain. Usage: kastell domain check <server> --domain example.com");
    return;
  }

  const domain = sanitizeDomain(options.domain);
  if (!isValidDomain(domain)) {
    logger.error(`Invalid domain: ${domain}`);
    return;
  }

  const spinner = createSpinner(`Checking DNS for ${domain}...`);
  spinner.start();

  try {
    const result = await sshExec(ip, buildDnsCheckCommand(domain));
    const resolvedIp = parseDnsResult(result.stdout);

    if (!resolvedIp) {
      spinner.fail(`No A record found for ${domain}`);
      logger.info("Add an A record pointing to " + ip);
      return;
    }

    if (resolvedIp === ip) {
      spinner.succeed(`DNS OK: ${domain} → ${resolvedIp}`);
    } else {
      spinner.warn(`DNS mismatch: ${domain} → ${resolvedIp} (expected ${ip})`);
      logger.info("Update your A record to point to " + ip);
    }
  } catch (error: unknown) {
    spinner.fail("Failed to check DNS");
    logger.error(getErrorMessage(error));
    const hint = mapSshError(error, ip);
    if (hint) logger.info(hint);
  }
}

async function domainList(ip: string, name: string): Promise<void> {
  const spinner = createSpinner(`Fetching domain from ${name}...`);
  spinner.start();

  try {
    const result = await sshExec(ip, buildGetFqdnCommand());
    if (result.code !== 0) {
      spinner.fail("Failed to fetch domain");
      if (result.stderr) logger.error(result.stderr);
      return;
    }

    const fqdn = parseFqdn(result.stdout);
    if (fqdn) {
      spinner.succeed(`Current domain for ${name}`);
      logger.info(`FQDN: ${fqdn}`);
    } else {
      spinner.succeed(`No custom domain set for ${name}`);
      logger.info(`Default: http://${ip}:8000`);
    }
  } catch (error: unknown) {
    spinner.fail("Failed to fetch domain");
    logger.error(getErrorMessage(error));
    const hint = mapSshError(error, ip);
    if (hint) logger.info(hint);
  }
}

async function domainInfo(ip: string, name: string): Promise<void> {
  const spinner = createSpinner(`Fetching domain info for ${name}...`);
  spinner.start();

  try {
    const result = await sshExec(ip, buildGetFqdnCommand());
    if (result.code !== 0) {
      spinner.fail("Failed to fetch domain info");
      if (result.stderr) logger.error(result.stderr);
      return;
    }

    const fqdn = parseFqdn(result.stdout);
    spinner.succeed(`Domain info for ${name}`);
    console.log();
    logger.info(`Server: ${name} (${ip})`);
    if (fqdn) {
      logger.info(`FQDN: ${fqdn}`);
      const isHttps = fqdn.startsWith("https://");
      logger.info(`SSL: ${isHttps ? "enabled" : "disabled"}`);
      logger.info(`URL: ${fqdn}`);
    } else {
      logger.info(`FQDN: not set (using IP)`);
      logger.info(`URL: http://${ip}:8000`);
    }
  } catch (error: unknown) {
    spinner.fail("Failed to fetch domain info");
    logger.error(getErrorMessage(error));
    const hint = mapSshError(error, ip);
    if (hint) logger.info(hint);
  }
}
