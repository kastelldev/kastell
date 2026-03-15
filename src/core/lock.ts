import { sshExec, assertValidIp } from "../utils/ssh.js";
import { buildHardeningCommand, buildFail2banCommand, buildKeyCheckCommand } from "./secure.js";
import { buildFirewallSetupCommand } from "./firewall.js";
import { runAudit } from "./audit/index.js";
import { raw, type SshCommand } from "../utils/sshCommand.js";
import type { Platform } from "../types/index.js";
import { LOCK_FIREWALL_TIMEOUT_MS, LOCK_UPGRADES_TIMEOUT_MS } from "../constants.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LockOptions {
  production?: boolean;
  dryRun?: boolean;
  force?: boolean;
}

export interface LockStepResult {
  sshHardening: boolean;
  fail2ban: boolean;
  ufw: boolean;
  sysctl: boolean;
  unattendedUpgrades: boolean;
}

export interface LockResult {
  success: boolean;
  steps: LockStepResult;
  scoreBefore?: number;
  scoreAfter?: number;
  error?: string;
  hint?: string;
}

// ─── Command Builders ────────────────────────────────────────────────────────

export function buildSysctlHardeningCommand(): SshCommand {
  const settings = [
    "net.ipv4.conf.all.accept_redirects=0",
    "net.ipv4.conf.default.accept_redirects=0",
    "net.ipv4.conf.all.accept_source_route=0",
    "net.ipv4.conf.default.accept_source_route=0",
    "net.ipv4.conf.all.log_martians=1",
    "net.ipv4.tcp_syncookies=1",
    "kernel.randomize_va_space=2",
    "net.ipv4.icmp_echo_ignore_broadcasts=1",
  ].join("\\n");

  return raw(
    [
      `printf '${settings}\\n' > /etc/sysctl.d/99-kastell.conf`,
      "sysctl -p /etc/sysctl.d/99-kastell.conf 2>/dev/null || true",
    ].join(" && "),
  );
}

export function buildUnattendedUpgradesCommand(): SshCommand {
  const periodicConfig = [
    'APT::Periodic::Update-Package-Lists "1";',
    'APT::Periodic::Unattended-Upgrade "1";',
    'APT::Periodic::AutocleanInterval "7";',
  ].join("\\n");

  return raw(
    [
      "apt-get install -y unattended-upgrades",
      `printf '${periodicConfig}\\n' > /etc/apt/apt.conf.d/20auto-upgrades`,
    ].join(" && "),
  );
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

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
    ufw: false,
    sysctl: false,
    unattendedUpgrades: false,
  };

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
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      steps,
      error: `SSH key check failed: ${message}`,
    };
  }

  // Step 1: SSH hardening (critical)
  try {
    await sshExec(ip, buildHardeningCommand());
    steps.sshHardening = true;
  } catch {
    // Critical step failed — mark false and continue other steps
  }

  // Step 2: fail2ban (non-fatal)
  try {
    await sshExec(ip, buildFail2banCommand());
    steps.fail2ban = true;
  } catch {
    // Non-fatal
  }

  // Step 3: UFW firewall (non-fatal), 60s timeout for apt
  try {
    await sshExec(ip, buildFirewallSetupCommand(platform), { timeoutMs: LOCK_FIREWALL_TIMEOUT_MS });
    steps.ufw = true;
  } catch {
    // Non-fatal
  }

  // Step 4: sysctl hardening (non-fatal)
  try {
    await sshExec(ip, buildSysctlHardeningCommand());
    steps.sysctl = true;
  } catch {
    // Non-fatal
  }

  // Step 5: unattended-upgrades (non-fatal), 120s timeout for apt
  try {
    await sshExec(ip, buildUnattendedUpgradesCommand(), { timeoutMs: LOCK_UPGRADES_TIMEOUT_MS });
    steps.unattendedUpgrades = true;
  } catch {
    // Non-fatal
  }

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
    scoreBefore,
    scoreAfter,
  };
}
