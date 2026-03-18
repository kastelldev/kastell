import inquirer from "inquirer";
import { resolveServer } from "../utils/serverSelect.js";
import { checkSshAvailable } from "../utils/ssh.js";
import { logger, createSpinner } from "../utils/logger.js";
import { applyLock } from "../core/lock.js";
import type { LockStepResult } from "../core/lock.js";

const groups: Array<{
  label: string;
  steps: Array<{ key: keyof LockStepResult; label: string }>;
}> = [
  {
    label: "SSH & Auth",
    steps: [
      { key: "sshHardening", label: "SSH hardening" },
      { key: "fail2ban", label: "Fail2ban" },
      { key: "banners", label: "Login banners" },
      { key: "accountLock", label: "Account locking" },
      { key: "sshCipher", label: "SSH cipher blacklist" },
    ],
  },
  {
    label: "Firewall & Network",
    steps: [
      { key: "ufw", label: "UFW firewall" },
      { key: "cloudMeta", label: "Cloud metadata block" },
      { key: "dns", label: "DNS security" },
    ],
  },
  {
    label: "System",
    steps: [
      { key: "sysctl", label: "Sysctl hardening" },
      { key: "unattendedUpgrades", label: "Unattended upgrades" },
      { key: "aptValidation", label: "APT validation" },
      { key: "resourceLimits", label: "Resource limits" },
      { key: "serviceDisable", label: "Service disabling" },
      { key: "backupPermissions", label: "Backup permissions" },
      { key: "pwquality", label: "Password quality policy" },
    ],
  },
  {
    label: "Monitoring",
    steps: [
      { key: "auditd", label: "Auditd" },
      { key: "logRetention", label: "Log retention" },
      { key: "aide", label: "AIDE integrity" },
    ],
  },
];

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

  // Dry-run: show grouped preview without applying
  if (options.dryRun) {
    logger.title("Dry Run — Lock Preview");
    for (const group of groups) {
      logger.info(`\n  ${group.label}`);
      for (const step of group.steps) {
        logger.info(`    ○ ${step.label}`);
      }
    }
    logger.info("\nNo changes applied. Use --production --force to apply.");
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

  // Display grouped per-step results
  logger.title("Hardening Results");
  for (const group of groups) {
    logger.info(`\n  ${group.label}`);
    for (const step of group.steps) {
      const ok = result.steps[step.key];
      if (ok) {
        logger.success(`    ${step.label}`);
      } else {
        const reason = result.stepErrors?.[step.key];
        const suffix = reason ? ` (${reason})` : "";
        logger.error(`    ✗ ${step.label}${suffix}`);
      }
    }
  }

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
