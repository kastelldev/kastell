import { sshExec, assertValidIp } from "../utils/ssh.js";
import { getErrorMessage, mapSshError } from "../utils/errorMapper.js";
import { raw, type SshCommand } from "../utils/sshCommand.js";
import {
  COOLIFY_SOURCE_DIR,
  COOLIFY_DB_CONTAINER,
  COOLIFY_DB_USER,
  COOLIFY_DB_NAME,
  DOKPLOY_DB_CONTAINER,
  DOKPLOY_DB_USER,
  DOKPLOY_DB_NAME,
  COOLIFY_PORT,
  DOKPLOY_PORT,
} from "../constants.js";
import type { Platform } from "../types/index.js";

// ─── Platform Helpers ────────────────────────────────────────────────────────

export function platformDefaults(platform?: Platform) {
  const isDokploy = platform === "dokploy";
  return {
    port: isDokploy ? DOKPLOY_PORT : COOLIFY_PORT,
    dbContainer: isDokploy ? DOKPLOY_DB_CONTAINER : COOLIFY_DB_CONTAINER,
    label: isDokploy ? "Dokploy" : "Coolify",
  };
}

// ─── Pure Functions ─────────────────────────────────────────────────────────

export function isValidDomain(domain: string): boolean {
  const pattern = /^(?!-)[a-zA-Z0-9-]{1,63}(?<!-)(\.[a-zA-Z0-9-]{1,63})*\.[a-zA-Z]{2,}$/;
  return pattern.test(domain);
}

export function sanitizeDomain(input: string): string {
  let domain = input.trim();
  domain = domain.replace(/^https?:\/\//, "");
  domain = domain.replace(/\/+$/, "");
  domain = domain.replace(/:\d+$/, "");
  return domain;
}

export function escapePsqlString(input: string): string {
  return input.replace(/'/g, "''");
}

export function buildSetFqdnCommand(domain: string, ssl: boolean, platform?: Platform): SshCommand {
  if (/[^a-zA-Z0-9.:_-]/.test(domain)) {
    throw new Error(`Invalid domain for FQDN command: ${domain}`);
  }
  const protocol = ssl ? "https" : "http";
  const url = escapePsqlString(`${protocol}://${domain}`);

  if (platform === "dokploy") {
    // Domain is validated above — safe to use in raw() SQL template
    return raw(`docker exec $(docker ps --filter name=${DOKPLOY_DB_CONTAINER} -q | head -1) psql -U ${DOKPLOY_DB_USER} -d ${DOKPLOY_DB_NAME} -c "UPDATE \\"webServerSettings\\" SET host='${escapePsqlString(domain)}', https=${ssl} WHERE id=(SELECT id FROM \\"webServerSettings\\" LIMIT 1);"`);
  }

  // Domain is validated above — safe to use in raw() SQL template
  return raw(
    [
      `docker exec ${COOLIFY_DB_CONTAINER} psql -U ${COOLIFY_DB_USER} -d ${COOLIFY_DB_NAME} -c "UPDATE instance_settings SET fqdn='${url}' WHERE id=0;"`,
      `cd ${COOLIFY_SOURCE_DIR} && docker compose -f docker-compose.yml -f docker-compose.prod.yml restart coolify`,
    ].join(" && "),
  );
}

export function buildGetFqdnCommand(platform?: Platform): SshCommand {
  if (platform === "dokploy") {
    return raw(`docker exec $(docker ps --filter name=${DOKPLOY_DB_CONTAINER} -q | head -1) psql -U ${DOKPLOY_DB_USER} -d ${DOKPLOY_DB_NAME} -t -c "SELECT CASE WHEN host IS NOT NULL AND host != '' THEN CASE WHEN https THEN 'https://' ELSE 'http://' END || host ELSE NULL END FROM \\"webServerSettings\\" LIMIT 1;"`);
  }
  return raw(`docker exec ${COOLIFY_DB_CONTAINER} psql -U ${COOLIFY_DB_USER} -d ${COOLIFY_DB_NAME} -t -c "SELECT fqdn FROM instance_settings WHERE id=0;"`);
}

export function buildPlatformCheckCommand(platform?: Platform): SshCommand {
  if (platform === "dokploy") {
    return raw(`docker ps --filter name=${DOKPLOY_DB_CONTAINER} --format '{{.Names}}' 2>/dev/null`);
  }
  return raw(`docker ps --filter name=${COOLIFY_DB_CONTAINER} --format '{{.Names}}' 2>/dev/null`);
}

/** @deprecated Use buildPlatformCheckCommand instead */
export function buildCoolifyCheckCommand(): SshCommand {
  return buildPlatformCheckCommand("coolify");
}

export function buildDnsCheckCommand(domain: string): SshCommand {
  // Strip any non-safe chars as defense-in-depth before using in raw()
  const safeDomain = domain.replace(/[^a-zA-Z0-9.-]/g, "");
  return raw(`dig +short A ${safeDomain} 2>/dev/null || getent ahosts ${safeDomain} 2>/dev/null | head -1 | awk '{print $1}'`);
}

export function parseDnsResult(stdout: string): string | null {
  const ipMatch = stdout.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
  return ipMatch ? ipMatch[1] : null;
}

export function parseFqdn(stdout: string): string | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  return trimmed;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DomainResult {
  success: boolean;
  error?: string;
  hint?: string;
}

export interface DomainInfoResult {
  fqdn: string | null;
  error?: string;
  hint?: string;
}

export interface DnsCheckResult {
  resolvedIp: string | null;
  match: boolean;
  error?: string;
  hint?: string;
}

// ─── Async Wrappers ─────────────────────────────────────────────────────────

export async function setDomain(
  ip: string,
  domain: string,
  ssl: boolean = true,
  platform?: Platform,
): Promise<DomainResult> {
  assertValidIp(ip);

  const cleanDomain = sanitizeDomain(domain);
  if (!isValidDomain(cleanDomain)) {
    return { success: false, error: `Invalid domain: ${cleanDomain}` };
  }

  const { dbContainer, label } = platformDefaults(platform);

  try {
    const checkResult = await sshExec(ip, buildPlatformCheckCommand(platform));
    if (!checkResult.stdout.includes(dbContainer)) {
      return {
        success: false,
        error: `${label} database container not found. Is ${label} installed and running?`,
      };
    }

    const command = buildSetFqdnCommand(cleanDomain, ssl, platform);
    const result = await sshExec(ip, command);
    if (result.code !== 0) {
      return {
        success: false,
        error: `Failed to set domain (exit code ${result.code})`,
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

export async function removeDomain(ip: string, platform?: Platform): Promise<DomainResult> {
  assertValidIp(ip);

  const { dbContainer, label, port } = platformDefaults(platform);

  try {
    const checkResult = await sshExec(ip, buildPlatformCheckCommand(platform));
    if (!checkResult.stdout.includes(dbContainer)) {
      return {
        success: false,
        error: `${label} database container not found. Is ${label} installed and running?`,
      };
    }

    const command = buildSetFqdnCommand(`${ip}:${port}`, false, platform);
    const result = await sshExec(ip, command);
    if (result.code !== 0) {
      return {
        success: false,
        error: `Failed to remove domain (exit code ${result.code})`,
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

export async function getDomain(ip: string, platform?: Platform): Promise<DomainInfoResult> {
  assertValidIp(ip);

  try {
    const result = await sshExec(ip, buildGetFqdnCommand(platform));
    if (result.code !== 0) {
      return {
        fqdn: null,
        error: `Failed to get domain (exit code ${result.code})`,
      };
    }

    return { fqdn: parseFqdn(result.stdout) };
  } catch (error: unknown) {
    const hint = mapSshError(error, ip);
    return {
      fqdn: null,
      error: getErrorMessage(error),
      ...(hint ? { hint } : {}),
    };
  }
}

export async function checkDns(ip: string, domain: string): Promise<DnsCheckResult> {
  assertValidIp(ip);

  const cleanDomain = sanitizeDomain(domain);
  if (!isValidDomain(cleanDomain)) {
    return { resolvedIp: null, match: false, error: `Invalid domain: ${cleanDomain}` };
  }

  try {
    const result = await sshExec(ip, buildDnsCheckCommand(cleanDomain));
    const resolvedIp = parseDnsResult(result.stdout);

    if (!resolvedIp) {
      return {
        resolvedIp: null,
        match: false,
        hint: `No A record found for ${cleanDomain}. Add an A record pointing to ${ip}`,
      };
    }

    return {
      resolvedIp,
      match: resolvedIp === ip,
      ...(resolvedIp !== ip
        ? { hint: `DNS mismatch: ${cleanDomain} → ${resolvedIp} (expected ${ip}). Update your A record.` }
        : {}),
    };
  } catch (error: unknown) {
    const hint = mapSshError(error, ip);
    return {
      resolvedIp: null,
      match: false,
      error: getErrorMessage(error),
      ...(hint ? { hint } : {}),
    };
  }
}
