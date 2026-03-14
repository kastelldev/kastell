import inquirer from "inquirer";
import { sshExec, assertValidIp } from "../utils/ssh.js";
import { getErrorMessage, mapSshError } from "../utils/errorMapper.js";
import { logger, createSpinner } from "../utils/logger.js";
import type { SshdSetting, SecureAuditResult } from "../types/index.js";

// ─── Pure Functions ─────────────────────────────────────────────────────────

export function parseSshdConfig(content: string): SshdSetting[] {
  const settings: SshdSetting[] = [];
  const checks: { key: string; secureValue: string }[] = [
    { key: "PasswordAuthentication", secureValue: "no" },
    { key: "PermitRootLogin", secureValue: "prohibit-password" },
    { key: "PubkeyAuthentication", secureValue: "yes" },
    { key: "MaxAuthTries", secureValue: "3" },
  ];

  for (const check of checks) {
    const regex = new RegExp(`^\\s*${check.key}\\s+(.+)`, "im");
    const match = content.match(regex);

    if (match) {
      const value = match[1].trim();
      settings.push({
        key: check.key,
        value,
        status: value.toLowerCase() === check.secureValue.toLowerCase() ? "secure" : "insecure",
      });
    } else {
      settings.push({
        key: check.key,
        value: "",
        status: "missing",
      });
    }
  }

  return settings;
}

export function parseAuditResult(stdout: string): SecureAuditResult {
  const sections = stdout.split("---SEPARATOR---");
  const sshdContent = sections[0] || "";
  const fail2banStatus = sections[1] || "";
  const sshdSettings = parseSshdConfig(sshdContent);

  const passwordAuth = sshdSettings.find((s) => s.key === "PasswordAuthentication") || {
    key: "PasswordAuthentication",
    value: "",
    status: "missing" as const,
  };
  const rootLogin = sshdSettings.find((s) => s.key === "PermitRootLogin") || {
    key: "PermitRootLogin",
    value: "",
    status: "missing" as const,
  };

  const fail2banInstalled =
    fail2banStatus.includes("active") || fail2banStatus.includes("inactive");
  const fail2banActive = fail2banStatus.includes("active (running)");

  const portMatch = sshdContent.match(/^\s*Port\s+(\d+)/im);
  const sshPort = portMatch ? parseInt(portMatch[1], 10) : 22;

  return {
    passwordAuth,
    rootLogin,
    fail2ban: { installed: fail2banInstalled, active: fail2banActive },
    sshPort,
  };
}

export function buildHardeningCommand(options?: { port?: number }): string {
  const commands = [
    "cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak",
    `sed -i 's/^#\\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config`,
    `sed -i 's/^#\\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config`,
    `sed -i 's/^#\\?PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config`,
    `sed -i 's/^#\\?MaxAuthTries.*/MaxAuthTries 3/' /etc/ssh/sshd_config`,
  ];

  // Validate port is a safe integer in range 1-65535 before interpolating into sed command
  const port = options?.port;
  if (port !== undefined && port !== 22) {
    const isValidPort = Number.isInteger(port) && port >= 1 && port <= 65535;
    if (isValidPort) {
      commands.push(`sed -i 's/^#\\?Port.*/Port ${port}/' /etc/ssh/sshd_config`);
    }
    // If port is invalid (NaN, negative, out of range), silently skip — no injection risk
  }

  commands.push("systemctl restart sshd 2>/dev/null || systemctl restart ssh");
  return commands.join(" && ");
}

export function buildFail2banCommand(): string {
  const jailContent = [
    "[sshd]",
    "enabled = true",
    "port = ssh",
    "filter = sshd",
    "backend = systemd",
    "maxretry = 5",
    "bantime = 3600",
    "findtime = 600",
  ].join("\\n");

  return [
    "apt-get install -y fail2ban python3-systemd",
    `printf '${jailContent}\\n' > /etc/fail2ban/jail.local`,
    "systemctl enable fail2ban",
    "systemctl restart fail2ban",
  ].join(" && ");
}

export function buildAuditCommand(): string {
  return `sshd -T 2>/dev/null || cat /etc/ssh/sshd_config && echo '---SEPARATOR---' && systemctl status fail2ban 2>&1 || true`;
}

export function buildKeyCheckCommand(): string {
  return "test -f /root/.ssh/authorized_keys && wc -l < /root/.ssh/authorized_keys || echo 0";
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SecureSetupResult {
  success: boolean;
  sshHardening: boolean;
  fail2ban: boolean;
  sshKeyCount: number;
  error?: string;
  hint?: string;
}

export interface SecureAuditFullResult {
  audit: SecureAuditResult;
  score: number;
  error?: string;
  hint?: string;
}

// ─── Async Wrappers ─────────────────────────────────────────────────────────

export async function applySecureSetup(
  ip: string,
  options?: { port?: number },
): Promise<SecureSetupResult> {
  assertValidIp(ip);

  // Step 1: Check SSH keys
  try {
    const keyResult = await sshExec(ip, buildKeyCheckCommand());
    const keyCount = parseInt(keyResult.stdout.trim(), 10);

    if (isNaN(keyCount) || keyCount === 0) {
      return {
        success: false,
        sshHardening: false,
        fail2ban: false,
        sshKeyCount: 0,
        error: "No SSH keys found in /root/.ssh/authorized_keys. Cannot disable password authentication without SSH keys — this would permanently lock you out.",
        hint: `Add an SSH key first: ssh-copy-id root@${ip}`,
      };
    }

    // Step 2: Apply SSH hardening
    const hardenResult = await sshExec(ip, buildHardeningCommand(options));
    if (hardenResult.code !== 0) {
      return {
        success: false,
        sshHardening: false,
        fail2ban: false,
        sshKeyCount: keyCount,
        error: `SSH hardening failed (exit code ${hardenResult.code})`,
      };
    }

    // Step 3: Install fail2ban (non-fatal)
    let fail2banOk = true;
    const f2bResult = await sshExec(ip, buildFail2banCommand());
    if (f2bResult.code !== 0) {
      fail2banOk = false;
    }

    return {
      success: true,
      sshHardening: true,
      fail2ban: fail2banOk,
      sshKeyCount: keyCount,
      ...(!fail2banOk ? { hint: "Fail2ban installation failed. Retry with secure-setup." } : {}),
    };
  } catch (error: unknown) {
    const hint = mapSshError(error, ip);
    return {
      success: false,
      sshHardening: false,
      fail2ban: false,
      sshKeyCount: -1,
      error: getErrorMessage(error),
      ...(hint ? { hint } : {}),
    };
  }
}

export function calculateSecurityScore(audit: SecureAuditResult): number {
  let score = 0;
  if (audit.passwordAuth.status === "secure") score += 25;
  if (audit.rootLogin.status === "secure") score += 25;
  if (audit.fail2ban.active) score += 25;
  if (audit.sshPort !== 22) score += 25;
  return score;
}

const EMPTY_AUDIT: SecureAuditResult = {
  passwordAuth: { key: "PasswordAuthentication", value: "", status: "missing" },
  rootLogin: { key: "PermitRootLogin", value: "", status: "missing" },
  fail2ban: { installed: false, active: false },
  sshPort: 22,
};

export async function runSecureAudit(ip: string): Promise<SecureAuditFullResult> {
  assertValidIp(ip);

  try {
    const result = await sshExec(ip, buildAuditCommand());
    if (result.code !== 0 && !result.stdout) {
      return {
        audit: { ...EMPTY_AUDIT },
        score: 0,
        error: `Audit command failed (exit code ${result.code})`,
      };
    }

    const audit = parseAuditResult(result.stdout);
    const score = calculateSecurityScore(audit);
    return { audit, score };
  } catch (error: unknown) {
    const hint = mapSshError(error, ip);
    return {
      audit: { ...EMPTY_AUDIT },
      score: 0,
      error: getErrorMessage(error),
      ...(hint ? { hint } : {}),
    };
  }
}

// ─── Interactive Setup (moved from commands/secure.ts) ──────────────────────

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
