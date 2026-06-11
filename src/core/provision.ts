import { isValidProvider, validateServerName } from "./manage.js";
import { getProviderToken } from "./tokens.js";
import { createProviderWithToken } from "../utils/providerFactory.js";
import { getBareCloudInit } from "../utils/cloudInit.js";
import { getAdapter } from "../adapters/factory.js";
import { findLocalSshKey, generateSshKey, getSshKeyName } from "../utils/sshKey.js";
import { saveServer, updateServer } from "../utils/config.js";
import { getTemplateDefaults } from "../utils/templates.js";
import { getErrorMessage, mapProviderError } from "../utils/errorMapper.js";
import { KastellError } from "../utils/errors.js";
import { assertValidIp, clearKnownHostKey, sshExec } from "../utils/ssh.js";
import { raw } from "../utils/sshCommand.js";
import { debugLog } from "../utils/logger.js";
import type { CloudProvider } from "../providers/base.js";
import type { ServerRecord, Platform } from "../types/index.js";
import { IP_WAIT, BOOT_WAIT, BOOT_WAIT_DEFAULT, invalidProviderError } from "../constants.js";

const BARE_SSH_WAIT_ATTEMPTS = 60;
const BARE_SSH_WAIT_INTERVAL_MS = 5000;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProvisionConfig {
  provider: string;
  region?: string;
  size?: string;
  name: string;
  template?: string;
  /** @deprecated Use platform field. Accepts "coolify", "dokploy", or "bare" for backward compat. */
  mode?: string;
}

export type ReadinessPolicy = "wait" | "defer";

export interface ProvisionOptions {
  readinessPolicy?: ReadinessPolicy;
}

export interface ProvisionReadiness {
  status: "pending" | "ready" | "unknown";
  message?: string;
}

export interface ProvisionResult {
  success: boolean;
  server?: ServerRecord;
  readiness?: ProvisionReadiness;
  error?: string;
  hint?: string;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class ProvisionPersistenceError extends KastellError {
  readonly provider: string;
  readonly serverId: string;
  readonly serverName: string;
  readonly ip: string;
  readonly warning: string;
  readonly recovery: string[];

  constructor(
    details: {
      provider: string;
      serverId: string;
      serverName: string;
      ip: string;
    },
    cause: unknown,
  ) {
    super(
      `Cloud server "${details.serverName}" was created but could not be saved locally.`,
      { cause, code: "PROVISION_PERSISTENCE" },
    );
    this.provider = details.provider;
    this.serverId = details.serverId;
    this.serverName = details.serverName;
    this.ip = details.ip;
    this.warning = "The cloud resource may still be running and billable.";
    this.recovery = [
      `Check the ${details.provider} dashboard for server ID ${details.serverId}.`,
      "Delete the resource through the provider dashboard or provider CLI if it is unwanted.",
      "Optionally use server_manage add for local visibility; manual registration does not preserve the original provider server ID.",
    ];
    Object.setPrototypeOf(this, ProvisionPersistenceError.prototype);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPendingIp(ip: string): boolean {
  return !ip || ip === "pending" || ip === "0.0.0.0";
}

function normalizeProvisionIp(ip: string): string {
  return isPendingIp(ip) ? "pending" : ip;
}

async function waitForBareServerReady(ip: string): Promise<ProvisionReadiness> {
  for (let attempt = 1; attempt <= BARE_SSH_WAIT_ATTEMPTS; attempt++) {
    try {
      const result = await sshExec(ip, raw("echo ok"));
      if (result.code === 0 || result.stdout.trim() === "ok") {
        const cloudInit = await sshExec(ip, raw("cloud-init status --wait"));
        if (cloudInit.code === 0) {
          return { status: "ready" };
        }
        return {
          status: "unknown",
          message: "SSH is reachable, but cloud-init readiness is unknown. Retry status shortly.",
        };
      }
    } catch (error) {
      debugLog?.("bare SSH readiness check failed", { cause: error, attempt });
    }

    if (attempt < BARE_SSH_WAIT_ATTEMPTS) {
      await sleep(BARE_SSH_WAIT_INTERVAL_MS);
    }
  }

  return {
    status: "unknown",
    message: "SSH was not reachable within 5 minutes. The server is saved; retry server_info health shortly.",
  };
}

export async function uploadSshKeyBestEffort(provider: CloudProvider): Promise<string[]> {
  let publicKey = findLocalSshKey();
  if (!publicKey) {
    process.stderr.write("[provision] No local SSH key found. Generating one...\n");
    publicKey = generateSshKey();
    if (!publicKey) {
      process.stderr.write("[provision] SSH key generation failed. Continuing without SSH key.\n");
      return [];
    }
    process.stderr.write("[provision] SSH key generated (~/.ssh/id_ed25519)\n");
  }

  try {
    const keyId = await provider.uploadSshKey(getSshKeyName(), publicKey);
    return [keyId];
  } catch (error: unknown) {
    process.stderr.write(
      `[provision] SSH key upload failed: ${getErrorMessage(error)}. Continuing without SSH key.\n`,
    );
    return [];
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function provisionServer(
  config: ProvisionConfig,
  options: ProvisionOptions = {},
): Promise<ProvisionResult> {
  const readinessPolicy = options.readinessPolicy ?? "wait";

  // 1. Validate provider
  if (!isValidProvider(config.provider)) {
    return {
      success: false,
      error: invalidProviderError(config.provider),
    };
  }

  // 2. Validate name
  const nameError = validateServerName(config.name);
  if (nameError) {
    return { success: false, error: nameError };
  }

  // 3. Resolve region/size — explicit params override template defaults
  const template = config.template || "starter";
  const defaults = getTemplateDefaults(template, config.provider);
  const region = config.region || defaults?.region;
  const size = config.size || defaults?.size;

  if (!region || !size) {
    return {
      success: false,
      error: `Could not resolve region/size for provider "${config.provider}" with template "${template}"`,
      hint: "Provide explicit region and size parameters, or use a valid template",
    };
  }

  // 4. Resolve token
  const token = getProviderToken(config.provider);
  if (!token) {
    return {
      success: false,
      error: `No API token found for ${config.provider}`,
      hint: `Set ${config.provider.toUpperCase()}_TOKEN environment variable`,
    };
  }

  // 5. Create provider instance
  const provider = createProviderWithToken(config.provider, token);

  // 6. Validate token
  try {
    const valid = await provider.validateToken(token);
    if (!valid) {
      return { success: false, error: `Invalid API token for ${config.provider}` };
    }
  } catch (error: unknown) {
    return {
      success: false,
      error: `Token validation failed: ${getErrorMessage(error)}`,
    };
  }

  // 7. Upload SSH key (best-effort)
  const sshKeyIds = await uploadSshKeyBestEffort(provider);

  // 8. Generate cloud-init
  const modeStr = config.mode || "coolify";
  const isBare = modeStr === "bare";
  const platform: Platform | undefined = isBare ? undefined : (modeStr === "dokploy" ? "dokploy" : "coolify");
  const sshPublicKey = findLocalSshKey() ?? undefined;
  const cloudInit = platform
    ? getAdapter(platform).getCloudInit(config.name, sshPublicKey)
    : getBareCloudInit(config.name);

  // 9. Create server
  let serverId: string;
  let serverIp: string;
  try {
    const result = await provider.createServer({
      name: config.name,
      region,
      size,
      cloudInit,
      sshKeyIds,
    });
    serverId = result.id;
    serverIp = result.ip;
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    const hint = mapProviderError(error, config.provider);
    return {
      success: false,
      error: `Server creation failed: ${message}`,
      ...(hint ? { hint } : {}),
    };
  }

  // Helper: build ServerRecord with current state (avoids duplication between timeout and success paths)
  const buildRecord = (ip: string): ServerRecord => ({
    id: serverId,
    name: config.name,
    provider: config.provider,
    ip,
    region,
    size,
    createdAt: new Date().toISOString(),
    mode: isBare ? ("bare" as const) : platform!,
    platform,
  });

  // 10. Save once IMMEDIATELY after createServer (recoverable core flow)
  // Local persistence happens BEFORE any network polling so a transient
  // disk/config failure never leaves a billable cloud server unmanaged.
  const initialIp = normalizeProvisionIp(serverIp);
  let record = buildRecord(initialIp);

  try {
    await saveServer(record);
  } catch (error) {
    throw new ProvisionPersistenceError(
      {
        provider: config.provider,
        serverId,
        serverName: config.name,
        ip: initialIp,
      },
      error,
    );
  }

  // Defer policy: skip ALL provider/IP/SSH polling. Caller will get the
  // saved record and a "pending" readiness marker. Do NOT call destroyServer.
  if (readinessPolicy === "defer") {
    return {
      success: true,
      server: record,
      readiness: {
        status: "pending",
        message: "Cloud creation and local registration completed; readiness checks were deferred.",
      },
    };
  }

  // 11. Wait for running status (provider-specific timing)
  const bootConfig = BOOT_WAIT[config.provider] || BOOT_WAIT_DEFAULT;
  for (let i = 0; i < bootConfig.attempts; i++) {
    try {
      const status = await provider.getServerStatus(serverId);
      if (status === "running") break;
    } catch (error) {
      // Ignore polling errors, retry
      debugLog?.("provision polling error, retrying", { cause: error });
    }
    if (i === bootConfig.attempts - 1) {
      const totalSec = Math.round((bootConfig.attempts * bootConfig.interval) / 1000);
      return {
        success: false,
        error: `Server did not reach running state within ${totalSec}s`,
        hint: `Server saved to config as '${config.name}'. Check with: kastell status ${config.name}`,
      };
    }
    await sleep(bootConfig.interval);
  }

  // 12. Wait for IP assignment (provider-specific timing)
  if (isPendingIp(serverIp)) {
    const ipConfig = IP_WAIT[config.provider] || { attempts: 20, interval: 3000 };
    for (let i = 0; i < ipConfig.attempts; i++) {
      await sleep(ipConfig.interval);
      try {
        const details = await provider.getServerDetails(serverId);
        if (!isPendingIp(details.ip)) {
          try {
            assertValidIp(details.ip);
            serverIp = details.ip;
            break;
          } catch (error) {
            // Invalid IP format, keep polling
            debugLog?.("invalid IP format during polling", { cause: error });
          }
        }
      } catch (error) {
        // Ignore polling errors, retry
        debugLog?.("provision polling error, retrying", { cause: error });
      }
    }
  } else {
    // Validate the IP we already have
    try {
      assertValidIp(serverIp);
    } catch (error) {
      process.stderr.write(`[provision] IP validation failed for ${serverIp}, marking as pending\n`);
      debugLog?.("IP validation failed, marking as pending", { cause: error });
      serverIp = "pending";
    }
  }

  // Enrich the saved record with the resolved IP via updateServer (no second saveServer)
  if (serverIp !== record.ip) {
    let updated: boolean;
    try {
      updated = await updateServer(record.name, { ip: serverIp });
    } catch (error) {
      throw new ProvisionPersistenceError(
        {
          provider: config.provider,
          serverId,
          serverName: config.name,
          ip: serverIp,
        },
        error,
      );
    }
    if (!updated) {
      throw new ProvisionPersistenceError(
        {
          provider: config.provider,
          serverId,
          serverName: config.name,
          ip: serverIp,
        },
        new Error(`Saved server "${record.name}" disappeared before enrichment`),
      );
    }
    record = { ...record, ip: serverIp };
  }

  // 13. Clear stale known_hosts entry (IP reuse across provision/destroy cycles)
  if (!isPendingIp(serverIp)) {
    clearKnownHostKey(serverIp);
  }

  const bareReadiness: ProvisionReadiness | undefined =
    isBare && !isPendingIp(serverIp) ? await waitForBareServerReady(serverIp) : undefined;

  // 14. Return result
  if (isPendingIp(serverIp)) {
    return {
      success: true,
      server: record,
      readiness: { status: "pending" },
      hint: `IP address not yet assigned. Check status with: server_info { action: 'status', server: '${config.name}' }`,
    };
  }

  // Bare path returns explicit readiness; managed-platform path stays "pending"
  // because this core layer does not verify platform installation.
  return {
    success: true,
    server: record,
    readiness: bareReadiness ?? { status: "pending" },
    ...(bareReadiness?.message ? { hint: bareReadiness.message } : {}),
  };
}
