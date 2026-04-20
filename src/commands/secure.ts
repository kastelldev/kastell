import { resolveServer } from "../utils/serverSelect.js";
import { checkSshAvailable, sshExec } from "../utils/ssh.js";
import { logger, createSpinner } from "../utils/logger.js";
import { mapSshError, classifyError } from "../utils/errorMapper.js";
import {
  parseSshdConfig,
  parseAuditResult,
  buildHardeningCommand,
  buildFail2banCommand,
  buildAuditCommand,
  buildKeyCheckCommand,
  secureSetup,
  calculateSecurityScore,
} from "../core/secure.js";
export {
  parseSshdConfig,
  parseAuditResult,
  buildHardeningCommand,
  buildFail2banCommand,
  buildAuditCommand,
  buildKeyCheckCommand,
  secureSetup,
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
    const classified = classifyError(error);
    logger.error(classified.message);
    if (classified.hint) logger.info(classified.hint);
    if (!classified.isTyped) {
      const hint = mapSshError(error, ip);
      if (hint) logger.info(hint);
    }
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
    const score = calculateSecurityScore(audit);
    const maxScore = 100;

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
    const classified = classifyError(error);
    logger.error(classified.message);
    if (classified.hint) logger.info(classified.hint);
    if (!classified.isTyped) {
      const hint = mapSshError(error, ip);
      if (hint) logger.info(hint);
    }
  }
}
