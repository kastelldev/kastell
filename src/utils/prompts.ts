import inquirer from "inquirer";
import type { CloudProvider } from "../providers/base.js";
import type { DeploymentConfig, ServerMode } from "../types/index.js";
import { SUPPORTED_PROVIDERS, PROVIDER_DISPLAY_NAMES } from "../constants.js";
import { logger } from "./logger.js";
import { markCommandFailed } from "./exitCode.js";

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

export type ConfirmationDecision =
  | { confirmed: true; source: "force" | "prompt" }
  | { confirmed: false; reason: "declined" | "non-tty"; message: string };

const DEFAULT_CANCEL_MESSAGE = "Use --force to proceed in non-interactive mode.";

export async function confirmOrCancel(
  message: string,
  force: boolean,
  cancelMessage = DEFAULT_CANCEL_MESSAGE,
  confirmFn?: ConfirmFn,
): Promise<ConfirmationDecision> {
  if (force) return { confirmed: true, source: "force" };

  if (process.stdin.isTTY) {
    const fn = confirmFn ?? (await import("@inquirer/prompts")).confirm;
    const accepted = await fn({ message, default: false });
    if (accepted) return { confirmed: true, source: "prompt" };
    return { confirmed: false, reason: "declined", message: "Operation cancelled." };
  }

  logger.warning(cancelMessage);
  return { confirmed: false, reason: "non-tty", message: cancelMessage };
}

/**
 * Thin wrapper around a `ConfirmationDecision` that:
 *   - returns `true` if the user confirmed (proceed)
 *   - logs the decision message and returns `false` if declined
 *   - logs the decision message, calls `markFailed` (exit code 1) and returns
 *     `false` if the refusal came from non-interactive mode
 *
 * Replaces the repeated 5-line if/return block in destructive commands:
 *
 *   if (!decision.confirmed) {
 *     logger.info(decision.message);
 *     if (decision.reason === "non-tty") markCommandFailed();
 *     return;
 *   }
 *
 * Use: `if (!enforceOrCancel(decision)) return;`
 *
 * `markFailed` is injectable for testability; production callers omit it.
 */
export function enforceOrCancel(
  decision: ConfirmationDecision,
  markFailed: () => void = markCommandFailed,
): boolean {
  if (decision.confirmed) return true;
  logger.info(decision.message);
  if (decision.reason === "non-tty") markFailed();
  return false;
}

/**
 * TTY-only second-factor confirmation: prompt the user to re-type an
 * expected string (e.g. the server name) and return `true` iff the
 * trimmed input matches.
 *
 * Callers MUST filter non-TTY environments before calling this helper
 * (e.g. gate on `process.stdin.isTTY` after a successful `confirmOrCancel`).
 * In non-TTY mode this helper throws — it never silently accepts.
 */
export async function confirmTypedNameInTty(args: {
  expected: string;
  promptMessage: string;
}): Promise<boolean> {
  if (!process.stdin.isTTY) {
    throw new Error(
      "confirmTypedNameInTty requires an interactive TTY. " +
        "Callers must filter non-TTY mode before invoking this helper.",
    );
  }
  const { confirmName } = await inquirer.prompt([
    {
      type: "input",
      name: "confirmName",
      message: args.promptMessage,
    },
  ]);
  return confirmName.trim() === args.expected;
}
