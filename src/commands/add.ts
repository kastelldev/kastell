import inquirer from "inquirer";
import ora from "ora";
import { promptApiToken } from "../utils/serverSelect.js";
import { addServerRecord, validateIpAddress } from "../core/manage.js";
import { logger } from "../utils/logger.js";
import { isServerMode } from "../types/index.js";
import { SUPPORTED_PROVIDERS, PROVIDER_DISPLAY_NAMES, invalidProviderError } from "../constants.js";

interface AddOptions {
  provider?: string;
  ip?: string;
  name?: string;
  skipVerify?: boolean;
  mode?: string;
}

export async function addCommand(options: AddOptions = {}): Promise<void> {
  // Step 1: Select provider
  let providerName = options.provider;
  if (!providerName) {
    const { provider } = await inquirer.prompt([
      {
        type: "list",
        name: "provider",
        message: "Select cloud provider:",
        choices: SUPPORTED_PROVIDERS.map((p) => ({
          name: PROVIDER_DISPLAY_NAMES[p],
          value: p,
        })),
      },
    ]);
    providerName = provider;
  }

  if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(providerName!)) {
    logger.error(invalidProviderError(providerName!));
    process.exit(1);
    return;
  }

  // Step 2: Get API token
  const apiToken = await promptApiToken(providerName!);

  // Step 3: Get server IP
  let serverIp = options.ip;
  if (!serverIp) {
    const { ip } = await inquirer.prompt([
      {
        type: "input",
        name: "ip",
        message: "Enter server IP address:",
        validate: (input: string) => {
          const result = validateIpAddress(input.trim());
          return result === null ? true : result;
        },
      },
    ]);
    serverIp = ip.trim();
  }

  // Step 4: Get server name
  let serverName = options.name;
  if (!serverName) {
    const defaultName = options.mode === "bare" ? "bare-server" : options.mode === "dokploy" ? "dokploy-server" : "coolify-server";
    const { name } = await inquirer.prompt([
      {
        type: "input",
        name: "name",
        message: "Server name:",
        default: defaultName,
        validate: (input: string) => {
          const trimmed = input.trim();
          if (!trimmed) return "Server name is required";
          if (trimmed.length < 3 || trimmed.length > 63) {
            return "Server name must be 3-63 characters";
          }
          if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(trimmed)) {
            return "Must start with a letter, end with letter/number, only lowercase letters, numbers, hyphens";
          }
          return true;
        },
      },
    ]);
    serverName = name.trim();
  }

  const spinner = ora("Adding server...").start();

  // Delegate all business logic to core
  const result = await addServerRecord({
    provider: providerName!,
    ip: serverIp!,
    name: serverName!,
    skipVerify: options.skipVerify,
    apiToken,
    ...(isServerMode(options.mode) ? { mode: options.mode } : {}),
  });

  if (!result.success) {
    spinner.fail(result.error ?? "Failed to add server");
    process.exit(1);
    return;
  }

  // Handle SSH unavailable (non-fatal)
  if (result.platformStatus === "ssh_unavailable") {
    spinner.warn("SSH not available. Use --skip-verify to skip Coolify verification.");
    process.exit(1);
    return;
  }

  const server = result.server!;

  if (result.platformStatus === "running") {
    spinner.succeed("Coolify is running");
  } else if (result.platformStatus === "containers_detected") {
    spinner.succeed("Coolify containers detected");
  } else if (result.platformStatus === "skipped") {
    spinner.succeed("Token validated");
  } else {
    spinner.warn("Could not verify Coolify. Server added anyway.");
  }

  logger.success("Server added successfully!");
  logger.info(`  Name: ${server.name}`);
  logger.info(`  IP: ${server.ip}`);
  logger.info(`  Provider: ${server.provider}`);
  if (!server.id.startsWith("manual-")) {
    logger.info(`  Cloud ID: ${server.id}`);
  }
  logger.success("All commands now work for this server (status, update, backup, etc.)");
}
