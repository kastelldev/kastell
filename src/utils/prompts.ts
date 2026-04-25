import inquirer from "inquirer";
import type { CloudProvider } from "../providers/base.js";
import type { DeploymentConfig, ServerMode } from "../types/index.js";
import { SUPPORTED_PROVIDERS, PROVIDER_DISPLAY_NAMES } from "../constants.js";
import { logger } from "./logger.js";

export const BACK_SIGNAL = "__BACK__";

export async function getProviderConfig(): Promise<{ provider: string }> {
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

  return { provider };
}

export async function getDeploymentConfig(provider: CloudProvider): Promise<DeploymentConfig> {
  const { apiToken } = await inquirer.prompt([
    {
      type: "password",
      name: "apiToken",
      message: `Enter your ${provider.displayName} API token:`,
      validate: (input: string) => {
        if (!input || input.trim().length === 0) {
          return "API token is required";
        }
        return true;
      },
    },
  ]);

  return {
    provider: provider.name,
    apiToken: apiToken.trim(),
    region: "",
    serverSize: "",
    serverName: "",
  };
}

export async function getLocationConfig(
  provider: CloudProvider,
  exclude: string[] = [],
): Promise<string> {
  const allLocations = await provider.getAvailableLocations();
  const locations =
    exclude.length > 0 ? allLocations.filter((r) => !exclude.includes(r.id)) : allLocations;

  const { region } = await inquirer.prompt([
    {
      type: "list",
      name: "region",
      message: "Select region:",
      choices: [
        new inquirer.Separator("──────────"),
        ...locations.map((r) => ({
          name: `${r.name} (${r.location})`,
          value: r.id,
        })),
        new inquirer.Separator("──────────"),
        { name: "← Back", value: BACK_SIGNAL },
      ],
    },
  ]);

  return region;
}

export async function getServerTypeConfig(
  provider: CloudProvider,
  location: string,
  exclude: string[] = [],
  mode?: ServerMode,
): Promise<string> {
  const allTypes = await provider.getAvailableServerTypes(location, mode);
  const serverTypes =
    exclude.length > 0 ? allTypes.filter((s) => !exclude.includes(s.id)) : allTypes;

  const { size } = await inquirer.prompt([
    {
      type: "list",
      name: "size",
      message: "Select server size:",
      choices: [
        new inquirer.Separator("──────────"),
        ...serverTypes.map((s) => ({
          name: `${s.name} - ${s.vcpu} vCPU, ${s.ram}GB RAM, ${s.disk}GB - ${s.price}`,
          value: s.id,
        })),
        new inquirer.Separator("──────────"),
        { name: "← Back", value: BACK_SIGNAL },
      ],
    },
  ]);

  return size;
}

export async function getServerNameConfig(mode?: string): Promise<string> {
  const defaultName = mode === "bare" ? "bare-server" : mode === "dokploy" ? "dokploy-server" : "coolify-server";
  const { serverName } = await inquirer.prompt([
    {
      type: "input",
      name: "serverName",
      message: "Server name (leave empty to go back):",
      default: defaultName,
      validate: (input: string) => {
        if (!input || input.trim().length === 0) {
          return true; // empty = back signal
        }
        if (input.length < 3 || input.length > 63) {
          return "Server name must be 3-63 characters";
        }
        if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(input)) {
          return "Must start with a letter, end with letter/number, only lowercase letters, numbers, hyphens";
        }
        return true;
      },
    },
  ]);

  const trimmed = serverName.trim();
  if (trimmed.length === 0) {
    return BACK_SIGNAL;
  }
  return trimmed;
}

export async function confirmDeployment(
  config: DeploymentConfig,
  provider: CloudProvider,
): Promise<boolean | string> {
  // Try dynamic data first, fallback to static
  const locations = await provider.getAvailableLocations();
  const region =
    locations.find((r) => r.id === config.region) ||
    provider.getRegions().find((r) => r.id === config.region);

  const serverTypes = await provider.getAvailableServerTypes(config.region, config.mode);
  const size =
    serverTypes.find((s) => s.id === config.serverSize) ||
    provider.getServerSizes().find((s) => s.id === config.serverSize);

  console.log("\nDeployment Summary:");
  console.log(`  Provider: ${provider.displayName}`);
  console.log(`  Region: ${region?.name || config.region} (${region?.location || ""})`);
  console.log(
    `  Size: ${size?.name || config.serverSize} - ${size?.vcpu || "?"} vCPU, ${size?.ram || "?"}GB RAM`,
  );
  console.log(`  Price: ${size?.price || "N/A"}`);
  console.log(`  Server Name: ${config.serverName}`);
  console.log();

  const { confirm } = await inquirer.prompt([
    {
      type: "list",
      name: "confirm",
      message: "Proceed with deployment?",
      choices: [
        { name: "Yes, deploy!", value: "yes" },
        { name: "No, cancel", value: "no" },
        { name: "← Back (change settings)", value: BACK_SIGNAL },
      ],
    },
  ]);

  if (confirm === "yes") return true;
  if (confirm === BACK_SIGNAL) return BACK_SIGNAL;
  return false;
}

type ConfirmFn = (opts: { message: string; default: boolean }) => Promise<boolean>;

export async function confirmOrCancel(
  message: string,
  force: boolean,
  cancelMessage = "Use --force to proceed in non-interactive mode.",
  confirmFn?: ConfirmFn,
): Promise<boolean> {
  if (force) return true;

  if (process.stdin.isTTY) {
    const fn = confirmFn ?? (await import("@inquirer/prompts")).confirm;
    return fn({ message, default: false });
  }

  logger.warning(cancelMessage);
  return false;
}
