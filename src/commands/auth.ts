import { Command } from "commander";
import chalk from "chalk";
import inquirer from "inquirer";
import { logger } from "../utils/logger.js";
import {
  setToken,
  removeToken,
  listStoredProviders,
  isKeychainAvailable,
} from "../core/auth.js";
import {
  SUPPORTED_PROVIDERS,
  PROVIDER_DISPLAY_NAMES,
  PROVIDER_ENV_KEYS,
  invalidProviderError,
} from "../constants.js";
import type { SupportedProvider } from "../constants.js";

function isValidProvider(provider: string): provider is SupportedProvider {
  return SUPPORTED_PROVIDERS.includes(provider as SupportedProvider);
}

export async function authSetAction(provider: string): Promise<void> {
  if (!isValidProvider(provider)) {
    console.error(chalk.red(invalidProviderError(provider)));
    return;
  }

  if (!isKeychainAvailable()) {
    const envKey = PROVIDER_ENV_KEYS[provider];
    console.error(
      chalk.red(
        `OS keychain not available. Use environment variables instead: export ${envKey}=...`,
      ),
    );
    return;
  }

  const { token } = await inquirer.prompt([
    {
      type: "password",
      name: "token",
      message: `Enter ${PROVIDER_DISPLAY_NAMES[provider]} API token:`,
      validate: (input: string) =>
        input.trim().length > 0 || "Token is required",
    },
  ]);

  const trimmed = token.trim();
  const success = setToken(provider, trimmed);

  if (success) {
    console.log(chalk.green(`${PROVIDER_DISPLAY_NAMES[provider]} token saved to OS keychain.`));
  } else {
    console.error(chalk.red(`Failed to save ${PROVIDER_DISPLAY_NAMES[provider]} token.`));
  }
}

export async function authRemoveAction(provider: string): Promise<void> {
  if (!isValidProvider(provider)) {
    console.error(chalk.red(invalidProviderError(provider)));
    return;
  }

  const success = removeToken(provider);

  if (success) {
    console.log(chalk.green(`${PROVIDER_DISPLAY_NAMES[provider]} token removed from OS keychain.`));
  } else {
    console.error(chalk.red(`No token found for ${PROVIDER_DISPLAY_NAMES[provider]} in OS keychain.`));
  }
}

export async function authListAction(): Promise<void> {
  const providers = listStoredProviders();

  if (providers.length === 0) {
    logger.info("No tokens stored in OS keychain.");
    return;
  }

  logger.info("Tokens stored in OS keychain:");
  for (const provider of providers) {
    const displayName =
      PROVIDER_DISPLAY_NAMES[provider as SupportedProvider] ?? provider;
    logger.success(displayName);
  }
  logger.info("Tokens from environment variables are not listed here.");
}

export function registerAuthCommands(program: Command): void {
  const auth = program
    .command("auth")
    .description("Manage provider API tokens (OS keychain)");

  auth
    .command("set <provider>")
    .description("Store a provider API token in OS keychain")
    .action(authSetAction);

  auth
    .command("remove <provider>")
    .description("Remove a provider API token from OS keychain")
    .action(authRemoveAction);

  auth
    .command("list")
    .description("List providers with stored tokens")
    .action(authListAction);
}
