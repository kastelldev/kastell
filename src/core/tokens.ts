import type { ServerRecord } from "../types/index.js";
import { PROVIDER_ENV_KEYS } from "../constants.js";
import { getToken } from "./auth.js";

export function getProviderToken(provider: string): string | undefined {
  // 1. Try OS Keychain first
  const keychainToken = getToken(provider);
  if (keychainToken) return keychainToken;

  // 2. Fall back to env var
  const envKey = PROVIDER_ENV_KEYS[provider as keyof typeof PROVIDER_ENV_KEYS];
  const raw = envKey ? process.env[envKey] : undefined;
  const trimmed = raw?.trim();
  return trimmed || undefined;
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
