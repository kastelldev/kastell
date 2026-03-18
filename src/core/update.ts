import { createProviderWithToken } from "../utils/providerFactory.js";
import { getErrorMessage, mapProviderError } from "../utils/errorMapper.js";
import { getAdapter } from "../adapters/factory.js";
import type { ServerRecord, Platform } from "../types/index.js";

export interface UpdateServerResult {
  success: boolean;
  output?: string;
  error?: string;
  hint?: string;
}

export async function updateServer(
  server: ServerRecord,
  apiToken: string,
  platform: Platform,
): Promise<UpdateServerResult> {
  // Check server status via provider API (skip for manual servers)
  if (!server.id.startsWith("manual-")) {
    try {
      const providerInstance = createProviderWithToken(server.provider, apiToken);
      const status = await providerInstance.getServerStatus(server.id);
      if (status !== "running") {
        return { success: false, error: `Server is not running (status: ${status})` };
      }
    } catch (error: unknown) {
      const hint = mapProviderError(error, server.provider);
      return {
        success: false,
        error: getErrorMessage(error),
        ...(hint ? { hint } : {}),
      };
    }
  }

  // Call adapter update
  const adapter = getAdapter(platform);
  const result = await adapter.update(server.ip);
  return {
    success: result.success,
    output: result.output,
    error: result.error,
  };
}
