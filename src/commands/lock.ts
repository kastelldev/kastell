import inquirer from "inquirer";
import { resolveServer } from "../utils/serverSelect.js";
import { checkSshAvailable } from "../utils/ssh.js";
import { logger, createSpinner } from "../utils/logger.js";
import { applyLock } from "../core/lock.js";

export async function lockCommand(
  query: string | undefined,
  options: { production?: boolean; dryRun?: boolean; force?: boolean },
): Promise<void> {
  // Production flag is required — it signals intentional destructive hardening
  if (!options.production) {
    logger.error("Use --production flag to apply all hardening measures.");
    logger.info("Example: kastell lock <server> --production");
    return;
  }

  // SSH client must be available
  if (!checkSshAvailable()) {
    logger.error("SSH client not found. Please install OpenSSH.");
    return;
  }

  // Resolve the target server
  const server = await resolveServer(query, "Select a server to lock:");
  if (!server) return;

  // Dry-run: delegate entirely to applyLock, no spinner
  if (options.dryRun) {
    await applyLock(server.ip, server.name, server.platform, { dryRun: true });
    return;
  }

  // Confirmation prompt (skipped with --force)
  if (!options.force) {
    const { confirm } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirm",
        message: `This will apply production hardening to ${server.name} (${server.ip}). Continue?`,
        default: false,
      },
    ]);
    if (!confirm) {
      logger.info("Lock cancelled.");
      return;
    }
  }

  // Apply hardening with spinner
  const spinner = createSpinner("Applying production hardening...");
  spinner.start();

  const result = await applyLock(server.ip, server.name, server.platform, options);

  spinner.stop();

  // Display per-step results
  const check = (ok: boolean, label: string) =>
    ok ? logger.success(`${label}: applied`) : logger.error(`${label}: failed`);

  logger.title("Hardening Results");
  check(result.steps.sshHardening, "SSH hardening");
  check(result.steps.fail2ban, "fail2ban");
  check(result.steps.ufw, "UFW firewall");
  check(result.steps.sysctl, "sysctl kernel settings");
  check(result.steps.unattendedUpgrades, "Unattended upgrades");

  // Audit score delta
  if (result.scoreBefore !== undefined && result.scoreAfter !== undefined) {
    const delta = result.scoreAfter - result.scoreBefore;
    const sign = delta >= 0 ? "+" : "";
    logger.info(
      `Audit score: ${result.scoreBefore} -> ${result.scoreAfter} (${sign}${delta})`,
    );
  }

  // Overall result
  if (result.success) {
    logger.success("Server hardened successfully.");
  } else {
    logger.error(result.error ?? "Hardening failed.");
    if (result.hint) {
      logger.info(result.hint);
    }
  }
}
