import inquirer from "inquirer";
import { getServers, findServers } from "./config.js";
import { logger } from "./logger.js";
import type { ServerRecord } from "../types/index.js";
import { PROVIDER_ENV_KEYS } from "../constants.js";

export async function collectProviderTokens(servers: ServerRecord[]): Promise<Map<string, string>> {
  const tokenMap = new Map<string, string>();
  const nonManualServers = servers.filter((s) => !s.id.startsWith("manual-"));
  const providers = [...new Set(nonManualServers.map((s) => s.provider))];
  for (const providerName of providers) {
    const token = await promptApiToken(providerName);
    tokenMap.set(providerName, token);
  }
  return tokenMap;
}

export async function selectServer(promptMessage?: string): Promise<ServerRecord | undefined> {
  const servers = getServers();

  if (servers.length === 0) {
    logger.info("No servers found. Deploy one with: kastell init");
    return undefined;
  }

  const { serverId } = await inquirer.prompt([
    {
      type: "list",
      name: "serverId",
      message: promptMessage || "Select a server:",
      choices: servers.map((s) => ({
        name: `${s.name} (${s.ip}) - ${s.provider}`,
        value: s.id,
      })),
    },
  ]);

  return servers.find((s) => s.id === serverId);
}

export async function resolveServer(
  query?: string,
  promptMessage?: string,
): Promise<ServerRecord | undefined> {
  if (query) {
    const matches = findServers(query);
    if (matches.length === 0) {
      logger.error(`Server not found: ${query}`);
      return undefined;
    }
    if (matches.length === 1) {
      return matches[0];
    }
    // Multiple matches — let user pick
    const { serverId } = await inquirer.prompt([
      {
        type: "list",
        name: "serverId",
        message: `Multiple servers found for "${query}". Select one:`,
        choices: matches.map((s) => ({
          name: `${s.name} (${s.ip}) - ${s.provider} [${s.id}]`,
          value: s.id,
        })),
      },
    ]);
    return matches.find((s) => s.id === serverId);
  }
  return selectServer(promptMessage);
}

export async function promptApiToken(providerName: string): Promise<string> {
  const envKey = PROVIDER_ENV_KEYS[providerName as keyof typeof PROVIDER_ENV_KEYS];
  if (envKey && process.env[envKey]) {
    return process.env[envKey]!;
  }

  const { apiToken } = await inquirer.prompt([
    {
      type: "password",
      name: "apiToken",
      message: `Enter your ${providerName} API token:`,
      validate: (input: string) => (input.trim().length > 0 ? true : "API token is required"),
    },
  ]);
  return apiToken.trim();
}
