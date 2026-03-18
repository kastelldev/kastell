import { sshExec, assertValidIp } from "../utils/ssh.js";
import { buildHardeningCommand, buildFail2banCommand, buildKeyCheckCommand } from "./secure.js";
import { buildFirewallSetupCommand } from "./firewall.js";
import { runAudit } from "./audit/index.js";
import { raw, type SshCommand } from "../utils/sshCommand.js";
import type { Platform } from "../types/index.js";
import { LOCK_FIREWALL_TIMEOUT_MS, LOCK_UPGRADES_TIMEOUT_MS, LOCK_PACKAGES_TIMEOUT_MS } from "../constants.js";
import { getErrorMessage } from "../utils/errorMapper.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LockOptions {
  production?: boolean;
  dryRun?: boolean;
  force?: boolean;
}

export interface LockStepResult {
  // Group 1: SSH & Auth
  sshHardening: boolean;
  fail2ban: boolean;
  banners: boolean;
  accountLock: boolean;
  // Group 2: Firewall & Network
  ufw: boolean;
  cloudMeta: boolean;
  dns: boolean;
  // Group 3: System
  sysctl: boolean;
  unattendedUpgrades: boolean;
  aptValidation: boolean;
  resourceLimits: boolean;
  serviceDisable: boolean;
  backupPermissions: boolean;
  // Group 4: Monitoring
  auditd: boolean;
  logRetention: boolean;
  aide: boolean;
}

export interface LockResult {
  success: boolean;
  steps: LockStepResult;
  stepErrors?: Partial<Record<keyof LockStepResult, string>>;
  scoreBefore?: number;
  scoreAfter?: number;
  error?: string;
  hint?: string;
}

// ─── Command Builders ────────────────────────────────────────────────────────

export function buildSysctlHardeningCommand(): SshCommand {
  const settings = [
    // Existing baseline settings
    "net.ipv4.conf.all.accept_redirects=0",
    "net.ipv4.conf.default.accept_redirects=0",
    "net.ipv4.conf.all.accept_source_route=0",
    "net.ipv4.conf.default.accept_source_route=0",
    "net.ipv4.conf.all.log_martians=1",
    "net.ipv4.tcp_syncookies=1",
    "kernel.randomize_va_space=2",
    "net.ipv4.icmp_echo_ignore_broadcasts=1",
    // Deep kernel hardening (CIS L2)
    "kernel.dmesg_restrict=1",
    "kernel.kptr_restrict=1",
    "fs.suid_dumpable=0",
    "net.core.bpf_jit_harden=1",
    "kernel.unprivileged_bpf_disabled=1",
    // Reverse path filter — loose mode (2) to not break Docker bridge networking
    "net.ipv4.conf.all.rp_filter=2",
    "net.ipv4.conf.default.rp_filter=2",
    // Disable ICMP redirect sending
    "net.ipv4.conf.all.send_redirects=0",
    "net.ipv4.conf.default.send_redirects=0",
    // Disable secure redirects
    "net.ipv4.conf.all.secure_redirects=0",
    "net.ipv4.conf.default.secure_redirects=0",
    // IPv6 redirect hardening
    "net.ipv6.conf.all.accept_redirects=0",
    "net.ipv6.conf.default.accept_redirects=0",
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
      "DEBIAN_FRONTEND=noninteractive apt-get install -y unattended-upgrades",
      `printf '${periodicConfig}\\n' > /etc/apt/apt.conf.d/20auto-upgrades`,
    ].join(" && "),
  );
}

export function buildLoginBannersCommand(): SshCommand {
  const bannerText = "Authorized access only. All activity is monitored and logged.";
  return raw(
    [
      `printf '${bannerText}\\n' > /etc/issue`,
      `printf '${bannerText}\\n' > /etc/issue.net`,
      `grep -qE '^Banner' /etc/ssh/sshd_config || echo 'Banner /etc/issue.net' >> /etc/ssh/sshd_config`,
      "systemctl restart ssh 2>/dev/null || systemctl restart sshd",
    ].join(" && "),
  );
}

export function buildAuditdCommand(): SshCommand {
  // Deep rules go in 50-kastell-deep.rules (sorts BEFORE 99-kastell.rules -e 2 immutability)
  const deepRules = [
    "# Identity — file integrity",
    "-w /etc/passwd -p wa -k identity",
    "-w /etc/shadow -p wa -k identity",
    "-w /etc/group -p wa -k identity",
    "-w /etc/gshadow -p wa -k identity",
    "# Privilege escalation",
    "-w /etc/sudoers -p wa -k privilege",
    "-w /etc/sudoers.d/ -p wa -k privilege",
    "-a always,exit -F arch=b64 -S setuid -S setgid -S setreuid -S setregid -k privilege",
    "# Time change",
    "-a always,exit -F arch=b64 -S adjtimex -S settimeofday -S clock_settime -k time-change",
    "-w /etc/localtime -p wa -k time-change",
    "# Login and session",
    "-w /var/log/lastlog -p wa -k logins",
    "-w /var/run/faillock/ -p wa -k logins",
    "-w /var/run/utmp -p wa -k session",
    "-w /var/log/wtmp -p wa -k session",
    "-w /var/log/btmp -p wa -k session",
    "# Network changes",
    "-a always,exit -F arch=b64 -S sethostname -S setdomainname -k network-change",
    "-w /etc/hostname -p wa -k network-change",
    "-w /etc/hosts -p wa -k network-change",
    "-w /etc/sysconfig/network -p wa -k network-change",
    "# Kernel modules",
    "-a always,exit -F arch=b64 -S init_module -S delete_module -S finit_module -k kernel-module",
    "-w /sbin/insmod -p x -k kernel-module",
    "-w /sbin/modprobe -p x -k kernel-module",
    "-w /sbin/rmmod -p x -k kernel-module",
  ].join("\\n");

  // Immutability directive in 99 — sorts AFTER 50
  const immutableRule = "-e 2";

  return raw(
    [
      "DEBIAN_FRONTEND=noninteractive apt-get install -y auditd audispd-plugins",
      "systemctl enable auditd && systemctl start auditd",
      `printf '${deepRules}\\n' > /etc/audit/rules.d/50-kastell-deep.rules`,
      `printf '${immutableRule}\\n' > /etc/audit/rules.d/99-kastell.rules`,
      "augenrules --load 2>/dev/null || true",
    ].join(" && "),
  );
}

export function buildResourceLimitsCommand(): SshCommand {
  const limitsContent = [
    "* soft nproc 1024",
    "* hard nproc 2048",
    "* soft nofile 65536",
    "* hard nofile 65536",
    "root soft nproc unlimited",
    "root hard nproc unlimited",
  ].join("\\n");

  return raw(`printf '${limitsContent}\\n' > /etc/security/limits.d/99-kastell.conf`);
}

export function buildServiceDisableCommand(): SshCommand {
  const services = ["bluetooth", "avahi-daemon", "cups", "rpcbind"];
  const disableScript = services
    .map(
      (s) =>
        `systemctl list-unit-files '${s}.service' 2>/dev/null | grep -q '${s}' && systemctl stop ${s} && systemctl disable ${s} 2>/dev/null || true`,
    )
    .join("; ");
  return raw(disableScript);
}

export function buildAptValidationCommand(): SshCommand {
  const aptConf = [
    'APT::Get::AllowUnauthenticated "false";',
    'Acquire::AllowInsecureRepositories "false";',
    'Acquire::AllowDowngradeToInsecureRepositories "false";',
  ].join("\\n");

  return raw(`printf '${aptConf}\\n' > /etc/apt/apt.conf.d/99-kastell-apt.conf`);
}

export function buildLogRetentionCommand(): SshCommand {
  const logrotateConf = [
    "/var/log/syslog",
    "{",
    "    daily",
    "    missingok",
    "    rotate 90",
    "    compress",
    "    delaycompress",
    "    notifempty",
    "    postrotate",
    "        /usr/lib/rsyslog/rsyslog-rotate",
    "    endscript",
    "}",
  ].join("\\n");

  return raw(
    [
      "systemctl enable rsyslog 2>/dev/null || true",
      "systemctl start rsyslog 2>/dev/null || true",
      `printf '${logrotateConf}\\n' > /etc/logrotate.d/99-kastell-syslog`,
    ].join(" && "),
  );
}

export function buildCloudMetaBlockCommand(): SshCommand {
  return raw(
    [
      "ufw deny out to 169.254.169.254",
      "ufw deny in from 169.254.169.254",
    ].join(" && "),
  );
}

export function buildAccountLockCommand(): SshCommand {
  return raw(
    [
      "for user in $(awk -F: '($3 >= 1000 && $3 < 65534 && ($7 == \"/bin/bash\" || $7 == \"/bin/sh\")) {print $1}' /etc/passwd); do",
      "  if ! who | grep -q \"^$user \"; then",
      "    passwd -l $user 2>/dev/null || true",
      "  fi",
      "done",
    ].join(" "),
  );
}

export function buildAideInitCommand(): SshCommand {
  const cronLine = "0 5 * * * root aide --check 2>/dev/null | mail -s 'AIDE check' root";
  return raw(
    [
      "DEBIAN_FRONTEND=noninteractive apt-get install -y aide",
      "nohup aide --init > /var/log/aide-init.log 2>&1 &",
      `echo '${cronLine}' > /etc/cron.d/kastell-aide`,
    ].join(" && "),
  );
}

export function buildBackupPermissionsCommand(): SshCommand {
  return raw(
    [
      "DEBIAN_FRONTEND=noninteractive apt-get install -y rsync",
      "mkdir -p /var/backups",
      "chmod 700 /var/backups",
      "chown root:root /var/backups",
    ].join(" && "),
  );
}

export function buildDnsSecurityCommand(): SshCommand {
  const dropinContent = ["[Resolve]", "DNSSEC=yes", "DNSOverTLS=opportunistic"].join("\\n");

  return raw(
    [
      "cp /etc/systemd/resolved.conf /etc/systemd/resolved.conf.kastell.bak 2>/dev/null || true",
      "mkdir -p /etc/systemd/resolved.conf.d",
      `printf '${dropinContent}\\n' > /etc/systemd/resolved.conf.d/99-kastell-dns.conf`,
      "systemctl restart systemd-resolved",
      "dig google.com +timeout=5 +tries=1 @127.0.0.53 >/dev/null 2>&1",
    ].join(" && "),
  );
}

export function buildDnsRollbackCommand(): SshCommand {
  return raw(
    [
      "rm -f /etc/systemd/resolved.conf.d/99-kastell-dns.conf",
      "systemctl restart systemd-resolved",
    ].join(" && "),
  );
}

// ─── Helper ──────────────────────────────────────────────────────────────────

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
    banners: false,
    accountLock: false,
    ufw: false,
    cloudMeta: false,
    dns: false,
    sysctl: false,
    unattendedUpgrades: false,
    aptValidation: false,
    resourceLimits: false,
    serviceDisable: false,
    backupPermissions: false,
    auditd: false,
    logRetention: false,
    aide: false,
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

  // ── Group 2: Firewall & Network ──────────────────────────────────────────

  // Step 5: UFW firewall, 60s timeout for apt
  const ufwResult = await runLockStep(ip, buildFirewallSetupCommand(platform), { timeoutMs: LOCK_FIREWALL_TIMEOUT_MS });
  steps.ufw = ufwResult.ok;
  if (!ufwResult.ok) stepErrors.ufw = ufwResult.error!;

  // Step 6: Cloud metadata — conditional on UFW
  if (steps.ufw) {
    const cloudMetaResult = await runLockStep(ip, buildCloudMetaBlockCommand());
    steps.cloudMeta = cloudMetaResult.ok;
    if (!cloudMetaResult.ok) stepErrors.cloudMeta = cloudMetaResult.error!;
  } else {
    stepErrors.cloudMeta = "UFW required";
  }

  // Step 7: DNS security — with rollback on failure
  const dnsResult = await runLockStep(ip, buildDnsSecurityCommand(), { timeoutMs: 15_000 });
  steps.dns = dnsResult.ok;
  if (!dnsResult.ok) {
    stepErrors.dns = dnsResult.error!;
    await runLockStep(ip, buildDnsRollbackCommand());
  }

  // ── Group 3: System ──────────────────────────────────────────────────────

  // Step 8: sysctl hardening
  const sysctlResult = await runLockStep(ip, buildSysctlHardeningCommand());
  steps.sysctl = sysctlResult.ok;
  if (!sysctlResult.ok) stepErrors.sysctl = sysctlResult.error!;

  // Step 9: unattended-upgrades, 120s timeout for apt
  const upgradesResult = await runLockStep(ip, buildUnattendedUpgradesCommand(), { timeoutMs: LOCK_UPGRADES_TIMEOUT_MS });
  steps.unattendedUpgrades = upgradesResult.ok;
  if (!upgradesResult.ok) stepErrors.unattendedUpgrades = upgradesResult.error!;

  // Step 10: APT validation
  const aptResult = await runLockStep(ip, buildAptValidationCommand());
  steps.aptValidation = aptResult.ok;
  if (!aptResult.ok) stepErrors.aptValidation = aptResult.error!;

  // Step 11: Resource limits
  const limitsResult = await runLockStep(ip, buildResourceLimitsCommand());
  steps.resourceLimits = limitsResult.ok;
  if (!limitsResult.ok) stepErrors.resourceLimits = limitsResult.error!;

  // Step 12: Service disabling
  const serviceResult = await runLockStep(ip, buildServiceDisableCommand());
  steps.serviceDisable = serviceResult.ok;
  if (!serviceResult.ok) stepErrors.serviceDisable = serviceResult.error!;

  // Step 13: Backup permissions
  const backupResult = await runLockStep(ip, buildBackupPermissionsCommand(), { timeoutMs: LOCK_PACKAGES_TIMEOUT_MS });
  steps.backupPermissions = backupResult.ok;
  if (!backupResult.ok) stepErrors.backupPermissions = backupResult.error!;

  // ── Group 4: Monitoring ──────────────────────────────────────────────────

  // Step 14: auditd
  const auditdResult = await runLockStep(ip, buildAuditdCommand(), { timeoutMs: LOCK_PACKAGES_TIMEOUT_MS });
  steps.auditd = auditdResult.ok;
  if (!auditdResult.ok) stepErrors.auditd = auditdResult.error!;

  // Step 15: Log retention
  const logResult = await runLockStep(ip, buildLogRetentionCommand());
  steps.logRetention = logResult.ok;
  if (!logResult.ok) stepErrors.logRetention = logResult.error!;

  // Step 16: AIDE (fire-and-forget)
  const aideResult = await runLockStep(ip, buildAideInitCommand(), { timeoutMs: LOCK_PACKAGES_TIMEOUT_MS });
  steps.aide = aideResult.ok;
  if (!aideResult.ok) stepErrors.aide = aideResult.error!;

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
