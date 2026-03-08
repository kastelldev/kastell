import type { ServerRecord } from "../types/index.js";
import { PROVIDER_ENV_KEYS } from "../constants.js";
import { getToken } from "./auth.js";
import { storeToken, readToken, registerCleanupHandlers } from "./tokenBuffer.js";

// Register cleanup handlers once at module load — zeroes all buffered tokens on exit
registerCleanupHandlers();

export function getProviderToken(provider: string): string | undefined {
  // 1. Check buffer cache (memory-safe storage)
  const buffered = readToken(provider);
  if (buffered) return buffered;

  // 2. Try OS Keychain
  const keychainToken = getToken(provider);
  if (keychainToken) {
    storeToken(provider, keychainToken);
    return keychainToken;
  }

  // 3. Fall back to env var
  const envKey = PROVIDER_ENV_KEYS[provider as keyof typeof PROVIDER_ENV_KEYS];
  const raw = envKey ? process.env[envKey] : undefined;
  const trimmed = raw?.trim();
  if (trimmed) {
    storeToken(provider, trimmed);
    return trimmed;
  }
  return undefined;
}

/**
 * Collect tokens for all unique providers in the server list.
 * Checks keychain first, then environment variables.
 */
export function collectProviderTokensFromEnv(
  servers: ServerRecord[],
): Map<string, string> {
  const tokenMap = new Map<string, string>();
  const providers = [
    ...new Set(
      servers.filter((s) => !s.id.startsWith("manual-")).map((s) => s.provider),
    ),
  ];
  for (const provider of providers) {
    const token = getProviderToken(provider);
    if (token) tokenMap.set(provider, token);
  }
  return tokenMap;
}
