import inquirer from "inquirer";
import { resolveServer } from "../utils/serverSelect.js";
import { checkSshAvailable, sshExec } from "../utils/ssh.js";
import { logger, createSpinner } from "../utils/logger.js";
import { getErrorMessage, mapSshError } from "../utils/errorMapper.js";
import {
  parseSshdConfig,
  parseAuditResult,
  buildHardeningCommand,
  buildFail2banCommand,
  buildAuditCommand,
  buildKeyCheckCommand,
} from "../core/secure.js";
export {
  parseSshdConfig,
  parseAuditResult,
  buildHardeningCommand,
  buildFail2banCommand,
  buildAuditCommand,
  buildKeyCheckCommand,
};
export async function secureCommand(
  subcommand?: string,
  query?: string,
  options?: { port?: string; dryRun?: boolean; force?: boolean },
): Promise<void> {
  if (!checkSshAvailable()) {
    logger.error("SSH client not found. Please install OpenSSH.");
    return;
  }

  const validSubcommands = ["setup", "status", "audit"];
  const sub = subcommand || "status";

  if (!validSubcommands.includes(sub)) {
    logger.error(`Invalid subcommand: ${sub}. Choose from: ${validSubcommands.join(", ")}`);
    return;
  }

  const server = await resolveServer(query, "Select a server for security management:");
  if (!server) return;

  const dryRun = options?.dryRun || false;

  switch (sub) {
    case "setup":
      await secureSetup(server.ip, server.name, options, dryRun, options?.force || false);
      break;
    case "status":
      await secureStatus(server.ip, server.name);
      break;
    case "audit":
      await secureAudit(server.ip, server.name);
      break;
  }
}

export async function secureSetup(
  ip: string,
  name: string,
  options?: { port?: string },
  dryRun?: boolean,
  force?: boolean,
): Promise<void> {
  // Step 1: Check SSH keys exist
  const keyCheckResult = await sshExec(ip, buildKeyCheckCommand());
  const keyCount = parseInt(keyCheckResult.stdout.trim(), 10);

  if (isNaN(keyCount) || keyCount === 0) {
    logger.error("No SSH keys found in /root/.ssh/authorized_keys");
    logger.error("You MUST add an SSH key before disabling password authentication.");
    logger.info("Run: ssh-copy-id root@" + ip);
    return;
  }

  const port = options?.port ? parseInt(options.port, 10) : undefined;
  if (options?.port && (!port || port < 1 || port > 65535)) {
    logger.error("Invalid --port. Must be 1-65535.");
    return;
  }

  const hardenCmd = buildHardeningCommand(port ? { port } : undefined);
  const fail2banCmd = buildFail2banCommand();

  if (dryRun) {
    logger.title("Dry Run - Security Setup");
    logger.info(`Server: ${name} (${ip})`);
    logger.info(`SSH keys found: ${keyCount}`);
    console.log();
    logger.info("SSH Hardening commands:");
    for (const cmd of hardenCmd.split(" && ")) {
      logger.step(cmd);
    }
    console.log();
    logger.info("Fail2ban commands:");
    for (const cmd of fail2banCmd.split(" && ")) {
      logger.step(cmd.length > 80 ? cmd.substring(0, 80) + "..." : cmd);
    }
    console.log();
    logger.warning("No changes applied. Remove --dry-run to execute.");
    return;
  }

  // Double confirmation (skip if force=true, e.g. from --full-setup)
  if (!force) {
    const { confirm } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirm",
        message: `This will harden SSH on "${name}" (${ip}). Password login will be DISABLED. Continue?`,
        default: false,
      },
    ]);

    if (!confirm) {
      logger.info("Security setup cancelled.");
      return;
    }

    const { confirmName } = await inquirer.prompt([
      {
        type: "input",
        name: "confirmName",
        message: `Type the server name "${name}" to confirm:`,
      },
    ]);

    if (confirmName.trim() !== name) {
      logger.error("Server name does not match. Setup cancelled.");
      return;
    }
  }

  // Step 2: Apply SSH hardening
  const spinner = createSpinner("Applying SSH hardening...");
  spinner.start();

  try {
    const hardenResult = await sshExec(ip, hardenCmd);
    if (hardenResult.code !== 0) {
      spinner.fail("Failed to apply SSH hardening");
      if (hardenResult.stderr) logger.error(hardenResult.stderr);
      return;
    }
    spinner.succeed("SSH hardened successfully");
  } catch (error: unknown) {
    spinner.fail("Failed to apply SSH hardening");
    logger.error(getErrorMessage(error));
    const hint = mapSshError(error, ip);
    if (hint) logger.info(hint);
    return;
  }

  // Step 3: Install fail2ban
  let fail2banOk = true;
  const f2bSpinner = createSpinner("Installing fail2ban...");
  f2bSpinner.start();

  try {
    const f2bResult = await sshExec(ip, fail2banCmd);
    if (f2bResult.code !== 0) {
      f2bSpinner.warn("Fail2ban installation had issues (non-fatal)");
      if (f2bResult.stderr) logger.warning(f2bResult.stderr);
      fail2banOk = false;
    } else {
      f2bSpinner.succeed("Fail2ban installed and configured");
    }
  } catch (error: unknown) {
    f2bSpinner.warn("Fail2ban installation failed (non-fatal)");
    logger.warning(getErrorMessage(error));
    const hint = mapSshError(error, ip);
    if (hint) logger.info(hint);
    fail2banOk = false;
  }

  if (fail2banOk) {
    logger.success(`Security setup complete for ${name}`);
  } else {
    logger.warning(
      `Security setup partially complete for ${name} — fail2ban is not active. Retry with: kastell secure setup ${name}`,
    );
  }
  if (port && port !== 22) {
    logger.warning(`SSH port changed to ${port}. Use: ssh -p ${port} root@${ip}`);
  }
}

async function secureStatus(ip: string, name: string): Promise<void> {
  const spinner = createSpinner(`Checking security status of ${name}...`);
  spinner.start();

  try {
    const result = await sshExec(ip, buildAuditCommand());
    if (result.code !== 0 && !result.stdout) {
      spinner.fail("Failed to check security status");
      if (result.stderr) logger.error(result.stderr);
      return;
    }

    const audit = parseAuditResult(result.stdout);
    spinner.succeed(`Security status for ${name} (${ip})`);

    console.log();
    const passIcon = (status: string) =>
      status === "secure" ? "\u2714" : status === "insecure" ? "\u2716" : "?";

    logger.info(
      `Password Auth:  ${passIcon(audit.passwordAuth.status)} ${audit.passwordAuth.value || "not set"}`,
    );
    logger.info(
      `Root Login:     ${passIcon(audit.rootLogin.status)} ${audit.rootLogin.value || "not set"}`,
    );
    logger.info(
      `Fail2ban:       ${audit.fail2ban.installed ? (audit.fail2ban.active ? "\u2714 active" : "\u2716 inactive") : "\u2716 not installed"}`,
    );
    logger.info(`SSH Port:       ${audit.sshPort}`);
  } catch (error: unknown) {
    spinner.fail("Failed to check security status");
    logger.error(getErrorMessage(error));
    const hint = mapSshError(error, ip);
    if (hint) logger.info(hint);
  }
}

async function secureAudit(ip: string, name: string): Promise<void> {
  const spinner = createSpinner(`Running security audit on ${name}...`);
  spinner.start();

  try {
    const result = await sshExec(ip, buildAuditCommand());
    if (result.code !== 0 && !result.stdout) {
      spinner.fail("Failed to run security audit");
      if (result.stderr) logger.error(result.stderr);
      return;
    }

    const audit = parseAuditResult(result.stdout);
    spinner.succeed(`Security audit for ${name} (${ip})`);

    // Score calculation
    let score = 0;
    const maxScore = 4;
    if (audit.passwordAuth.status === "secure") score++;
    if (audit.rootLogin.status === "secure") score++;
    if (audit.fail2ban.active) score++;
    if (audit.sshPort !== 22) score++;

    console.log();
    logger.title(`Security Score: ${score}/${maxScore}`);

    // Detailed report
    const check = (ok: boolean, msg: string) => (ok ? logger.success(msg) : logger.warning(msg));

    check(
      audit.passwordAuth.status === "secure",
      `Password Authentication: ${audit.passwordAuth.value || "not set"} ${audit.passwordAuth.status === "secure" ? "(OK)" : "(should be 'no')"}`,
    );
    check(
      audit.rootLogin.status === "secure",
      `Root Login: ${audit.rootLogin.value || "not set"} ${audit.rootLogin.status === "secure" ? "(OK)" : "(should be 'prohibit-password')"}`,
    );
    check(
      audit.fail2ban.active,
      `Fail2ban: ${audit.fail2ban.installed ? (audit.fail2ban.active ? "active (OK)" : "installed but inactive") : "not installed"}`,
    );
    check(
      audit.sshPort !== 22,
      `SSH Port: ${audit.sshPort} ${audit.sshPort !== 22 ? "(non-default, OK)" : "(default port 22)"}`,
    );

    if (score < maxScore) {
      console.log();
      logger.info("Run 'kastell secure setup' to improve your security score.");
    }
  } catch (error: unknown) {
    spinner.fail("Failed to run security audit");
    logger.error(getErrorMessage(error));
    const hint = mapSshError(error, ip);
    if (hint) logger.info(hint);
  }
}
