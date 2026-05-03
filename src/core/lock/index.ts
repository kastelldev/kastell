export type { LockOptions, LockStepResult, LockResult } from "./types.js";

export { buildLoginBannersCommand, buildSshCipherCommand, buildSshFineTuningCommand } from "./ssh.js";
export { buildSysctlHardeningCommand, buildCloudMetaBlockCommand, buildDnsSecurityCommand, buildDnsRollbackCommand } from "./network.js";
export { buildUnattendedUpgradesCommand, buildResourceLimitsCommand, buildServiceDisableCommand, buildAptValidationCommand, buildLogRetentionCommand, buildCronAccessCommand, buildBackupPermissionsCommand } from "./system.js";
export { buildAccountLockCommand, buildPwqualityCommand, buildLoginDefsCommand, buildFaillockCommand, buildSudoHardeningCommand } from "./auth.js";
export { buildAuditdCommand, buildAideInitCommand } from "./monitoring.js";
export { buildDockerHardeningCommand } from "./docker.js";

import { sshExec, assertValidIp } from "../../utils/ssh.js";
import { buildHardeningCommand, buildFail2banCommand, buildKeyCheckCommand } from "../secure.js";
import { buildFirewallSetupCommand } from "../firewall.js";
import { runAudit } from "../audit/index.js";
import type { SshCommand } from "../../utils/sshCommand.js";
import type { Platform } from "../../types/index.js";
import { LOCK_FIREWALL_TIMEOUT_MS, LOCK_UPGRADES_TIMEOUT_MS, LOCK_PACKAGES_TIMEOUT_MS } from "../../constants.js";
import { getErrorMessage } from "../../utils/errorMapper.js";

import { buildLoginBannersCommand, buildSshCipherCommand, buildSshFineTuningCommand } from "./ssh.js";
import { buildSysctlHardeningCommand, buildCloudMetaBlockCommand, buildDnsSecurityCommand, buildDnsRollbackCommand } from "./network.js";
import { buildUnattendedUpgradesCommand, buildResourceLimitsCommand, buildServiceDisableCommand, buildAptValidationCommand, buildLogRetentionCommand, buildCronAccessCommand, buildBackupPermissionsCommand } from "./system.js";
import { buildAccountLockCommand, buildPwqualityCommand, buildLoginDefsCommand, buildFaillockCommand, buildSudoHardeningCommand } from "./auth.js";
import { buildAuditdCommand, buildAideInitCommand } from "./monitoring.js";
import { buildDockerHardeningCommand } from "./docker.js";
import type { LockOptions, LockStepResult, LockResult } from "./types.js";

async function runLockStep(
  ip: string,
  command: SshCommand,
  opts?: { timeoutMs?: number },
): Promise<{ ok: boolean; error?: string }> {
  try {
    await sshExec(ip, command, opts);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: getErrorMessage(err) };
  }
}

export async function applyLock(
  ip: string,
  name: string,
  platform: Platform | undefined,
  options: LockOptions,
): Promise<LockResult> {
  assertValidIp(ip);

  const steps: LockStepResult = {
    sshHardening: false,
    fail2ban: false,
    banners: false,
    accountLock: false,
    sshCipher: false,
    ufw: false,
    cloudMeta: false,
    dns: false,
    sysctl: false,
    unattendedUpgrades: false,
    aptValidation: false,
    resourceLimits: false,
    serviceDisable: false,
    backupPermissions: false,
    pwquality: false,
    dockerHardening: false,
    auditd: false,
    logRetention: false,
    aide: false,
    cronAccess: false,
    sshFineTuning: false,
    loginDefs: false,
    faillock: false,
    sudoHardening: false,
  };

  const stepErrors: Partial<Record<keyof LockStepResult, string>> = {};

  // Dry run: preview only, no SSH
  if (options.dryRun) {
    return {
      success: true,
      steps,
    };
  }

  const auditPlatform = platform ?? "bare";

  // Pre-audit (non-fatal)
  let scoreBefore: number | undefined;
  try {
    const preAudit = await runAudit(ip, name, auditPlatform);
    if (preAudit.success && preAudit.data) {
      scoreBefore = preAudit.data.overallScore;
    }
  } catch {
    // Non-fatal — continue without score
  }

  // Step 0: SSH key check — abort if no keys
  try {
    const keyResult = await sshExec(ip, buildKeyCheckCommand());
    const keyCount = parseInt(keyResult.stdout.trim(), 10);
    if (isNaN(keyCount) || keyCount === 0) {
      return {
        success: false,
        steps,
        error: "No SSH keys found in /root/.ssh/authorized_keys. Cannot disable password authentication without SSH keys — this would permanently lock you out.",
        hint: `Add an SSH key first: ssh-copy-id root@${ip}`,
      };
    }
  } catch (err) {
    return {
      success: false,
      steps,
      error: `SSH key check failed: ${getErrorMessage(err)}`,
    };
  }

  // ── Group 1: SSH & Auth ──────────────────────────────────────────────────

  // Step 1: SSH hardening (critical — determines overall success)
  const sshResult = await runLockStep(ip, buildHardeningCommand());
  steps.sshHardening = sshResult.ok;
  if (!sshResult.ok) stepErrors.sshHardening = sshResult.error!;

  // Step 2: fail2ban
  const fail2banResult = await runLockStep(ip, buildFail2banCommand());
  steps.fail2ban = fail2banResult.ok;
  if (!fail2banResult.ok) stepErrors.fail2ban = fail2banResult.error!;

  // Step 3: Login banners
  const bannersResult = await runLockStep(ip, buildLoginBannersCommand());
  steps.banners = bannersResult.ok;
  if (!bannersResult.ok) stepErrors.banners = bannersResult.error!;

  // Step 4: Account locking
  const accountLockResult = await runLockStep(ip, buildAccountLockCommand());
  steps.accountLock = accountLockResult.ok;
  if (!accountLockResult.ok) stepErrors.accountLock = accountLockResult.error!;

  // Step 5: SSH cipher hardening — with sshd -t rollback
  const sshCipherResult = await runLockStep(ip, buildSshCipherCommand());
  steps.sshCipher = sshCipherResult.ok;
  if (!sshCipherResult.ok) stepErrors.sshCipher = sshCipherResult.error!;

  // ── Group 2: Firewall & Network ──────────────────────────────────────────

  // Step 6: UFW firewall, 60s timeout for apt
  const ufwResult = await runLockStep(ip, buildFirewallSetupCommand(platform), { timeoutMs: LOCK_FIREWALL_TIMEOUT_MS });
  steps.ufw = ufwResult.ok;
  if (!ufwResult.ok) stepErrors.ufw = ufwResult.error!;

  // Step 7: Cloud metadata — conditional on UFW
  if (steps.ufw) {
    const cloudMetaResult = await runLockStep(ip, buildCloudMetaBlockCommand());
    steps.cloudMeta = cloudMetaResult.ok;
    if (!cloudMetaResult.ok) stepErrors.cloudMeta = cloudMetaResult.error!;
  } else {
    stepErrors.cloudMeta = "UFW required";
  }

  // Step 8: DNS security — with rollback on failure
  const dnsResult = await runLockStep(ip, buildDnsSecurityCommand(), { timeoutMs: 15_000 });
  steps.dns = dnsResult.ok;
  if (!dnsResult.ok) {
    stepErrors.dns = dnsResult.error!;
    await runLockStep(ip, buildDnsRollbackCommand());
  }

  // ── Group 3: System ──────────────────────────────────────────────────────

  // Step 9: sysctl hardening
  const sysctlResult = await runLockStep(ip, buildSysctlHardeningCommand());
  steps.sysctl = sysctlResult.ok;
  if (!sysctlResult.ok) stepErrors.sysctl = sysctlResult.error!;

  // Step 10: unattended-upgrades, 120s timeout for apt
  const upgradesResult = await runLockStep(ip, buildUnattendedUpgradesCommand(), { timeoutMs: LOCK_UPGRADES_TIMEOUT_MS });
  steps.unattendedUpgrades = upgradesResult.ok;
  if (!upgradesResult.ok) stepErrors.unattendedUpgrades = upgradesResult.error!;

  // Step 11: APT validation
  const aptResult = await runLockStep(ip, buildAptValidationCommand());
  steps.aptValidation = aptResult.ok;
  if (!aptResult.ok) stepErrors.aptValidation = aptResult.error!;

  // Step 12: Resource limits
  const limitsResult = await runLockStep(ip, buildResourceLimitsCommand());
  steps.resourceLimits = limitsResult.ok;
  if (!limitsResult.ok) stepErrors.resourceLimits = limitsResult.error!;

  // Step 13: Service disabling
  const serviceResult = await runLockStep(ip, buildServiceDisableCommand());
  steps.serviceDisable = serviceResult.ok;
  if (!serviceResult.ok) stepErrors.serviceDisable = serviceResult.error!;

  // Step 14: Backup permissions
  const backupResult = await runLockStep(ip, buildBackupPermissionsCommand(), { timeoutMs: LOCK_PACKAGES_TIMEOUT_MS });
  steps.backupPermissions = backupResult.ok;
  if (!backupResult.ok) stepErrors.backupPermissions = backupResult.error!;

  // Step 15: Password quality policy
  const pwqualityResult = await runLockStep(ip, buildPwqualityCommand(), { timeoutMs: LOCK_PACKAGES_TIMEOUT_MS });
  steps.pwquality = pwqualityResult.ok;
  if (!pwqualityResult.ok) stepErrors.pwquality = pwqualityResult.error!;

  // Step 16: Docker runtime hardening
  const dockerResult = await runLockStep(ip, buildDockerHardeningCommand(platform), { timeoutMs: LOCK_PACKAGES_TIMEOUT_MS });
  steps.dockerHardening = dockerResult.ok;
  if (!dockerResult.ok) stepErrors.dockerHardening = dockerResult.error!;

  // ── Group 4: Monitoring ──────────────────────────────────────────────────

  // Step 17: auditd
  const auditdResult = await runLockStep(ip, buildAuditdCommand(), { timeoutMs: LOCK_PACKAGES_TIMEOUT_MS });
  steps.auditd = auditdResult.ok;
  if (!auditdResult.ok) stepErrors.auditd = auditdResult.error!;

  // Step 18: Log retention
  const logResult = await runLockStep(ip, buildLogRetentionCommand());
  steps.logRetention = logResult.ok;
  if (!logResult.ok) stepErrors.logRetention = logResult.error!;

  // Step 19: AIDE (fire-and-forget)
  const aideResult = await runLockStep(ip, buildAideInitCommand(), { timeoutMs: LOCK_PACKAGES_TIMEOUT_MS });
  steps.aide = aideResult.ok;
  if (!aideResult.ok) stepErrors.aide = aideResult.error!;

  // Step 20: Cron access control
  const cronAccessResult = await runLockStep(ip, buildCronAccessCommand());
  steps.cronAccess = cronAccessResult.ok;
  if (!cronAccessResult.ok) stepErrors.cronAccess = cronAccessResult.error!;

  // ── Group 5: Score Boost (P87) ─────────────────────────────────────────────

  // Step 21: SSH fine-tuning — with sshd -t rollback
  const sshFineTuneResult = await runLockStep(ip, buildSshFineTuningCommand());
  steps.sshFineTuning = sshFineTuneResult.ok;
  if (!sshFineTuneResult.ok) stepErrors.sshFineTuning = sshFineTuneResult.error!;

  // Step 22: Login definitions
  const loginDefsResult = await runLockStep(ip, buildLoginDefsCommand());
  steps.loginDefs = loginDefsResult.ok;
  if (!loginDefsResult.ok) stepErrors.loginDefs = loginDefsResult.error!;

  // Step 23: Faillock
  const faillockResult = await runLockStep(ip, buildFaillockCommand());
  steps.faillock = faillockResult.ok;
  if (!faillockResult.ok) stepErrors.faillock = faillockResult.error!;

  // Step 24: Sudo hardening
  const sudoHardeningResult = await runLockStep(ip, buildSudoHardeningCommand());
  steps.sudoHardening = sudoHardeningResult.ok;
  if (!sudoHardeningResult.ok) stepErrors.sudoHardening = sudoHardeningResult.error!;

  // Post-audit (non-fatal)
  let scoreAfter: number | undefined;
  try {
    const postAudit = await runAudit(ip, name, auditPlatform);
    if (postAudit.success && postAudit.data) {
      scoreAfter = postAudit.data.overallScore;
    }
  } catch {
    // Non-fatal
  }

  return {
    success: steps.sshHardening,
    steps,
    ...(Object.keys(stepErrors).length > 0 && { stepErrors }),
    scoreBefore,
    scoreAfter,
  };
}
