import axios from "axios";
import { createProviderWithToken } from "../utils/providerFactory.js";
import { getErrorMessage } from "../utils/errorMapper.js";
import { assertValidIp } from "../utils/ssh.js";
import { getAdapter, resolvePlatform } from "../adapters/factory.js";
import type { ServerRecord } from "../types/index.js";

export interface StatusResult {
  server: ServerRecord;
  serverStatus: string;
  platformStatus: string;
  error?: string;
}

/** @deprecated Use getAdapter(platform).healthCheck(ip) instead. Kept for health.ts and status.ts legacy callers. */
export async function checkCoolifyHealth(ip: string): Promise<"running" | "not reachable"> {
  assertValidIp(ip);
  try {
    await axios.get(`http://${ip}:8000`, {
      timeout: 5000,
      validateStatus: () => true,
    });
    return "running";
  } catch {
    return "not reachable";
  }
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
  try {
    const serverStatus = await getCloudServerStatus(server, apiToken);
    const platform = resolvePlatform(server);
    const platformStatus = platform
      ? (await getAdapter(platform).healthCheck(server.ip, server.domain)).status
      : "n/a";
    return { server, serverStatus, platformStatus };
  } catch (error: unknown) {
    return {
      server,
      serverStatus: "error",
      platformStatus: "unknown",
      error: getErrorMessage(error),
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
