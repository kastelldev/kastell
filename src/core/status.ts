import { createProviderWithToken } from "../utils/providerFactory.js";
import { getErrorMessage, mapSshError } from "../utils/errorMapper.js";
import { getAdapter, resolvePlatform } from "../adapters/factory.js";
import { sshExec } from "../utils/ssh.js";
import { raw } from "../utils/sshCommand.js";
import { COOLIFY_RESTART_CMD, POLL_DELAY_MS } from "../constants.js";
import type { ServerRecord, Platform } from "../types/index.js";

export interface StatusResult {
  server: ServerRecord;
  serverStatus: string;
  platformStatus: string;
  error?: string;
  errorSource?: "provider" | "platform";
}

export async function getCloudServerStatus(
  server: ServerRecord,
  apiToken: string,
): Promise<string> {
  if (server.id.startsWith("manual-")) {
    return "unknown (manual)";
  }
  if (!apiToken) {
    return "unknown (no token)";
  }
  const provider = createProviderWithToken(server.provider, apiToken);
  return provider.getServerStatus(server.id);
}

export async function checkServerStatus(
  server: ServerRecord,
  apiToken: string,
): Promise<StatusResult> {
  let serverStatus: string;
  try {
    serverStatus = await getCloudServerStatus(server, apiToken);
  } catch (error: unknown) {
    return {
      server,
      serverStatus: "error",
      platformStatus: "unknown",
      error: getErrorMessage(error),
      errorSource: "provider",
    };
  }

  const platform = resolvePlatform(server);
  if (!platform) {
    return { server, serverStatus, platformStatus: "n/a" };
  }

  try {
    const health = await getAdapter(platform).healthCheck(server.ip, server.domain);
    return { server, serverStatus, platformStatus: health.status };
  } catch (error: unknown) {
    return {
      server,
      serverStatus,
      platformStatus: "error",
      error: getErrorMessage(error),
      errorSource: "platform",
    };
  }
}

export async function checkAllServersStatus(
  servers: ServerRecord[],
  tokenMap: Map<string, string>,
): Promise<StatusResult[]> {
  return Promise.all(
    servers.map((s) => checkServerStatus(s, tokenMap.get(s.provider) ?? "")),
  );
}

export interface RestartPlatformResult {
  success: boolean;
  nowRunning: boolean;
  error?: string;
  hint?: string;
}

export async function restartPlatform(server: ServerRecord): Promise<RestartPlatformResult> {
  const platform: Platform = resolvePlatform(server) ?? "coolify";
  const adapter = getAdapter(platform);

  // Currently only Coolify has a known restart command
  const restartCmd = platform === "coolify" ? COOLIFY_RESTART_CMD : null;
  if (!restartCmd) {
    return { success: false, nowRunning: false, error: `Restart not supported for ${adapter.name}` };
  }

  try {
    const result = await sshExec(server.ip, raw(restartCmd));
    if (result.code !== 0) {
      return {
        success: false,
        nowRunning: false,
        error: result.stderr || "Restart command failed",
      };
    }

    // Poll for platform health (check every 1s, up to POLL_DELAY_MS total)
    const pollInterval = 1_000;
    const maxAttempts = Math.ceil(POLL_DELAY_MS / pollInterval);
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      const healthResult = await adapter.healthCheck(server.ip, server.domain);
      if (healthResult.status === "running") {
        return { success: true, nowRunning: true };
      }
    }
    return { success: true, nowRunning: false };
  } catch (error: unknown) {
    const hint = mapSshError(error, server.ip);
    return {
      success: false,
      nowRunning: false,
      error: getErrorMessage(error),
      ...(hint ? { hint } : {}),
    };
  }
}

/** @deprecated Use restartPlatform instead */
export const restartCoolify = restartPlatform;
