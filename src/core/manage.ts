import { getServers, saveServer, removeServer, findServer } from "../utils/config.js";
import { createProviderWithToken } from "../utils/providerFactory.js";
import { sshExec, checkSshAvailable, assertValidIp } from "../utils/ssh.js";
import { raw } from "../utils/sshCommand.js";
import { getErrorMessage, mapProviderError } from "../utils/errorMapper.js";
import { getProviderToken } from "./tokens.js";
import { detectPlatform } from "../adapters/factory.js";
import type { ServerRecord, ServerMode, Platform } from "../types/index.js";
import { SUPPORTED_PROVIDERS, invalidProviderError, COOLIFY_PORT, DOKPLOY_PORT } from "../constants.js";
import { extractReason } from "../utils/errors.js";

// Re-export from dedicated module for backward compatibility
export { isSafeMode } from "../utils/safeMode.js";

// ─── Validation ───────────────────────────────────────────────────────────────

export function isValidProvider(provider: string): boolean {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(provider);
}

export function validateIpAddress(ip: string): string | null {
  if (!ip) return "IP address is required";
  try {
    assertValidIp(ip);
    return null;
  } catch (err) {
    return extractReason(err);
  }
}

export function validateServerName(name: string): string | null {
  if (!name) return "Server name is required";
  if (name.length < 3 || name.length > 63) {
    return "Server name must be 3-63 characters";
  }
  if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(name)) {
    return "Must start with a letter, end with letter/number, only lowercase letters, numbers, hyphens";
  }
  return null;
}

// ─── Add Server ───────────────────────────────────────────────────────────────

export type PlatformStatus =
  | "skipped"
  | "ssh_unavailable"
  | "running"
  | "containers_detected"
  | "not_detected"
  | "verification_failed";

export interface AddServerParams {
  provider: string;
  ip: string;
  name: string;
  skipVerify?: boolean;
  apiToken?: string;
  mode?: string;
}

export type AddServerResult =
  | { success: true; server: ServerRecord; platformStatus: PlatformStatus }
  | { success: false; error: string };

export async function addServerRecord(params: AddServerParams): Promise<AddServerResult> {
  // Validate provider
  if (!isValidProvider(params.provider)) {
    return {
      success: false,
      error: invalidProviderError(params.provider),
    };
  }

  // Get token from explicit param or env
  const token = params.apiToken ?? getProviderToken(params.provider);
  if (!token) {
    return {
      success: false,
      error: `No API token found for provider: ${params.provider}. Set ${params.provider.toUpperCase()}_TOKEN environment variable`,
    };
  }

  // Validate IP
  const ipError = validateIpAddress(params.ip);
  if (ipError) {
    return { success: false, error: ipError };
  }

  // Check duplicate
  const existing = getServers();
  const duplicate = existing.find((s) => s.ip === params.ip);
  if (duplicate) {
    return {
      success: false,
      error: `Server with IP ${params.ip} already exists: ${duplicate.name}`,
    };
  }

  // Validate name
  const nameError = validateServerName(params.name);
  if (nameError) {
    return { success: false, error: nameError };
  }

  // Validate API token
  const provider = createProviderWithToken(params.provider, token);
  try {
    const valid = await provider.validateToken(token);
    if (!valid) {
      return { success: false, error: `Invalid API token for ${params.provider}` };
    }
  } catch (error: unknown) {
    return {
      success: false,
      error: `Token validation failed: ${getErrorMessage(error)}`,
    };
  }

  let cloudId: string | null = null;
  try {
    cloudId = await provider.findServerByIp(params.ip);
  } catch {
    // Non-fatal: API lookup failure keeps manual-{timestamp} id
  }

  // Resolve mode and platform — auto-detect if no explicit mode provided
  let modeStr = params.mode;
  if (!modeStr && !params.skipVerify && checkSshAvailable()) {
    try {
      const detected = await detectPlatform(params.ip);
      modeStr = detected; // "coolify" | "dokploy" | "bare"
    } catch {
      modeStr = "bare"; // safe fallback — bare is least privileged
    }
  }
  modeStr = modeStr || "bare";
  const isBare = modeStr === "bare";
  const platform: Platform | undefined = isBare ? undefined
    : modeStr === "dokploy" ? "dokploy"
    : "coolify";
  const mode: ServerMode = isBare ? "bare" : "coolify";

  // Optional platform verification via SSH (skip entirely for bare mode)
  let platformStatus: PlatformStatus = "skipped";
  if (!params.skipVerify && mode !== "bare") {
    const healthPort = platform === "dokploy" ? DOKPLOY_PORT : COOLIFY_PORT;
    const healthPath = platform === "dokploy" ? "/" : "/api/health";
    const containerGrep = platform === "dokploy" ? "dokploy" : "coolify";

    if (!checkSshAvailable()) {
      platformStatus = "ssh_unavailable";
    } else {
      try {
        const result = await sshExec(
          params.ip,
          raw(`curl -s -o /dev/null -w '%{http_code}' http://localhost:${healthPort}${healthPath}`),
        );
        if (result.code === 0 && result.stdout.trim().includes("200")) {
          platformStatus = "running";
        } else {
          const dockerResult = await sshExec(
            params.ip,
            raw(`docker ps --format '{{.Names}}' 2>/dev/null | grep -q ${containerGrep} && echo OK`),
          );
          if (dockerResult.code === 0 && dockerResult.stdout.trim().includes("OK")) {
            platformStatus = "containers_detected";
          } else {
            platformStatus = "not_detected";
          }
        }
      } catch (error: unknown) {
        process.stderr.write(`[warn] Platform verification failed: ${getErrorMessage(error)}\n`);
        platformStatus = "verification_failed";
      }
    }
  }

  // Save to config
  const record: ServerRecord = {
    id: cloudId ?? `manual-${Date.now()}`,
    name: params.name,
    provider: params.provider,
    ip: params.ip,
    region: "unknown",
    size: "unknown",
    createdAt: new Date().toISOString(),
    mode,
    ...(platform ? { platform } : {}),
  };

  await saveServer(record);

  return { success: true, server: record, platformStatus };
}

// ─── Remove Server ────────────────────────────────────────────────────────────

export interface RemoveServerResult {
  success: boolean;
  server?: ServerRecord;
  error?: string;
}

export async function removeServerRecord(query: string): Promise<RemoveServerResult> {
  const server = findServer(query);
  if (!server) {
    return { success: false, error: `Server not found: ${query}` };
  }

  const removed = await removeServer(server.id);
  if (!removed) {
    return { success: false, error: `Failed to remove server: ${server.name}` };
  }

  return { success: true, server };
}

// ─── Destroy Server ───────────────────────────────────────────────────────────

export interface DestroyServerResult {
  success: boolean;
  server?: ServerRecord;
  cloudDeleted: boolean;
  localRemoved: boolean;
  error?: string;
  hint?: string;
}

export async function destroyCloudServer(query: string): Promise<DestroyServerResult> {
  const server = findServer(query);
  if (!server) {
    return {
      success: false,
      cloudDeleted: false,
      localRemoved: false,
      error: `Server not found: ${query}`,
    };
  }

  // Manual servers can only be removed, not destroyed
  if (server.id.startsWith("manual-")) {
    return {
      success: false,
      server,
      cloudDeleted: false,
      localRemoved: false,
      error: `Server "${server.name}" was manually added (no cloud provider ID). Use 'remove' action instead.`,
    };
  }

  // Get token from env
  const token = getProviderToken(server.provider);
  if (!token) {
    return {
      success: false,
      server,
      cloudDeleted: false,
      localRemoved: false,
      error: `No API token for ${server.provider}. Set ${server.provider.toUpperCase()}_TOKEN environment variable`,
    };
  }

  try {
    const provider = createProviderWithToken(server.provider, token);
    await provider.destroyServer(server.id);
    await removeServer(server.id);
    return { success: true, server, cloudDeleted: true, localRemoved: true };
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    const isNotFound =
      message.toLowerCase().includes("not found") || message.toLowerCase().includes("not_found");

    if (isNotFound) {
      await removeServer(server.id);
      return {
        success: true,
        server,
        cloudDeleted: false,
        localRemoved: true,
        hint: `Server not found on ${server.provider} (may have been deleted manually). Removed from local config.`,
      };
    }

    const hint = mapProviderError(error, server.provider);
    return {
      success: false,
      server,
      cloudDeleted: false,
      localRemoved: false,
      error: message,
      ...(hint ? { hint } : {}),
    };
  }
}

// ─── Reboot Server ────────────────────────────────────────────────────────────

export interface RebootServerResult {
  success: boolean;
  server?: ServerRecord;
  error?: string;
  hint?: string;
}

export async function rebootServer(query: string): Promise<RebootServerResult> {
  const server = findServer(query);
  if (!server) {
    return { success: false, error: `Server not found: ${query}` };
  }

  if (server.id.startsWith("manual-")) {
    return {
      success: false,
      server,
      error: `Server "${server.name}" was manually added. Reboot is only available for cloud-provisioned servers.`,
    };
  }

  const token = getProviderToken(server.provider);
  if (!token) {
    return {
      success: false,
      server,
      error: `No API token for ${server.provider}. Set ${server.provider.toUpperCase()}_TOKEN environment variable`,
    };
  }

  try {
    const provider = createProviderWithToken(server.provider, token);
    await provider.rebootServer(server.id);
    return { success: true, server };
  } catch (error: unknown) {
    const hint = mapProviderError(error, server.provider);
    return {
      success: false,
      server,
      error: getErrorMessage(error),
      ...(hint ? { hint } : {}),
    };
  }
}
