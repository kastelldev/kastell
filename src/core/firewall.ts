import { sshExec, assertValidIp } from "../utils/ssh.js";
import { getErrorMessage, mapSshError } from "../utils/errorMapper.js";
import { logger, createSpinner } from "../utils/logger.js";
import { cmd, raw, and, type SshCommand } from "../utils/sshCommand.js";
import type { FirewallStatus, FirewallRule, FirewallProtocol } from "../types/index.js";
import type { Platform } from "../types/index.js";
import { getAdapter } from "../adapters/factory.js";

// ─── Constants ──────────────────────────────────────────────────────────────

export const PROTECTED_PORTS = [22];
export const BARE_PORTS = [80, 443];

// ─── Pure Functions ─────────────────────────────────────────────────────────

export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

export function isProtectedPort(port: number): boolean {
  return PROTECTED_PORTS.includes(port);
}

export function getPortsForPlatform(platform?: Platform | "bare"): readonly number[] {
  if (!platform || platform === "bare") return BARE_PORTS;
  return getAdapter(platform).platformPorts;
}

export function buildFirewallSetupCommand(platform?: Platform): SshCommand {
  const ports = getPortsForPlatform(platform);
  const parts: SshCommand[] = [
    cmd("apt-get", "install", "-y", "ufw"),
    cmd("ufw", "default", "deny", "incoming"),
    cmd("ufw", "default", "allow", "outgoing"),
    ...ports.map((p) => cmd("ufw", "allow", `${p}/tcp`)),
    cmd("ufw", "allow", "22/tcp"),
    raw('echo "y" | ufw enable'),
  ];
  return and(...parts);
}

export function buildUfwRuleCommand(
  action: "allow" | "delete allow",
  port: number,
  protocol: FirewallProtocol = "tcp",
): SshCommand {
  // action is a literal union type (safe), port is a number (safe), protocol is a literal union type (safe)
  return raw(`ufw ${action} ${port}/${protocol}`);
}

export function buildUfwStatusCommand(): SshCommand {
  return raw("ufw status numbered");
}

export function parseUfwStatus(stdout: string): FirewallStatus {
  const lines = stdout.split("\n");
  const active = stdout.toLowerCase().includes("status: active");
  const rules: FirewallRule[] = [];

  for (const line of lines) {
    const match = line.match(/\[\s*\d+\]\s+(\d+)\/(tcp|udp)\s+(ALLOW|DENY)\s+IN\s+(.*)/i);
    if (match) {
      rules.push({
        port: parseInt(match[1], 10),
        protocol: match[2].toLowerCase() as FirewallProtocol,
        action: match[3].toUpperCase() as "ALLOW" | "DENY",
        from: match[4].trim() || "Anywhere",
      });
    }
  }

  return { active, rules };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getPlatformPortWarning(port: number, platform?: Platform): string | undefined {
  if (platform) {
    const ports = getPortsForPlatform(platform);
    if (ports.includes(port)) {
      const name = platform.charAt(0).toUpperCase() + platform.slice(1);
      return `Port ${port} is used by ${name}. Removing it may break ${name} access.`;
    }
    return undefined;
  }
  const coolifyPorts = getAdapter("coolify").platformPorts;
  const dokployPorts = getAdapter("dokploy").platformPorts;
  if (coolifyPorts.includes(port) || dokployPorts.includes(port)) {
    return `Port ${port} is commonly used by platform services. Removing it may break access.`;
  }
  return undefined;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FirewallResult {
  success: boolean;
  error?: string;
  hint?: string;
  warning?: string;
}

export interface FirewallStatusResult {
  status: FirewallStatus;
  error?: string;
  hint?: string;
}

// ─── Async Wrappers ─────────────────────────────────────────────────────────

export async function setupFirewall(ip: string, platform?: Platform): Promise<FirewallResult> {
  assertValidIp(ip);

  try {
    const result = await sshExec(ip, buildFirewallSetupCommand(platform));
    if (result.code !== 0) {
      return {
        success: false,
        error: `Firewall setup failed (exit code ${result.code})`,
      };
    }
    return { success: true };
  } catch (error: unknown) {
    const hint = mapSshError(error, ip);
    return {
      success: false,
      error: getErrorMessage(error),
      ...(hint ? { hint } : {}),
    };
  }
}

export async function addFirewallRule(
  ip: string,
  port: number,
  protocol: FirewallProtocol = "tcp",
): Promise<FirewallResult> {
  assertValidIp(ip);

  if (!isValidPort(port)) {
    return { success: false, error: `Invalid port: ${port}. Must be 1-65535.` };
  }

  try {
    const result = await sshExec(ip, buildUfwRuleCommand("allow", port, protocol));
    if (result.code !== 0) {
      return {
        success: false,
        error: `Failed to add rule for port ${port}/${protocol}`,
      };
    }
    return { success: true };
  } catch (error: unknown) {
    const hint = mapSshError(error, ip);
    return {
      success: false,
      error: getErrorMessage(error),
      ...(hint ? { hint } : {}),
    };
  }
}

export async function removeFirewallRule(
  ip: string,
  port: number,
  protocol: FirewallProtocol = "tcp",
  platform?: Platform,
): Promise<FirewallResult> {
  assertValidIp(ip);

  if (!isValidPort(port)) {
    return { success: false, error: `Invalid port: ${port}. Must be 1-65535.` };
  }

  if (isProtectedPort(port)) {
    return { success: false, error: `Port ${port} is protected (SSH access). Cannot remove.` };
  }

  const warning = getPlatformPortWarning(port, platform);

  try {
    const result = await sshExec(ip, buildUfwRuleCommand("delete allow", port, protocol));
    if (result.code !== 0) {
      return {
        success: false,
        error: `Failed to remove rule for port ${port}/${protocol}`,
        ...(warning ? { warning } : {}),
      };
    }
    return { success: true, ...(warning ? { warning } : {}) };
  } catch (error: unknown) {
    const hint = mapSshError(error, ip);
    return {
      success: false,
      error: getErrorMessage(error),
      ...(hint ? { hint } : {}),
      ...(warning ? { warning } : {}),
    };
  }
}

export async function getFirewallStatus(ip: string): Promise<FirewallStatusResult> {
  assertValidIp(ip);

  try {
    const result = await sshExec(ip, buildUfwStatusCommand());
    if (result.code !== 0) {
      return {
        status: { active: false, rules: [] },
        error: `Failed to get firewall status (exit code ${result.code})`,
      };
    }
    return { status: parseUfwStatus(result.stdout) };
  } catch (error: unknown) {
    const hint = mapSshError(error, ip);
    return {
      status: { active: false, rules: [] },
      error: getErrorMessage(error),
      ...(hint ? { hint } : {}),
    };
  }
}

// ─── Interactive Setup (moved from commands/firewall.ts) ────────────────────

export async function firewallSetup(
  ip: string,
  name: string,
  dryRun: boolean,
  isBare?: boolean,
  platform?: Platform,
): Promise<void> {
  const command = buildFirewallSetupCommand(isBare ? undefined : platform);

  if (dryRun) {
    logger.title("Dry Run - Firewall Setup");
    logger.info(`Server: ${name} (${ip})`);
    console.log();
    logger.info("Commands to execute:");
    for (const cmd of command.split(" && ")) {
      logger.step(cmd);
    }
    console.log();
    logger.warning("No changes applied. Remove --dry-run to execute.");
    return;
  }

  const spinner = createSpinner("Setting up firewall...");
  spinner.start();

  try {
    const result = await sshExec(ip, command);
    if (result.code !== 0) {
      spinner.fail("Failed to setup firewall");
      if (result.stderr) logger.error(result.stderr);
      return;
    }
    spinner.succeed("Firewall configured successfully");
    if (isBare) {
      logger.success(`UFW enabled with web ports (${BARE_PORTS.join(", ")}) + SSH (22)`);
    } else {
      const platformLabel = platform === "dokploy" ? "Dokploy" : "Coolify";
      const platformPorts = getPortsForPlatform(platform);
      logger.success(`UFW enabled with ${platformLabel} ports (${platformPorts.join(", ")}) + SSH (22)`);
    }
  } catch (error: unknown) {
    spinner.fail("Failed to setup firewall");
    logger.error(getErrorMessage(error));
    const hint = mapSshError(error, ip);
    if (hint) logger.info(hint);
  }
}
