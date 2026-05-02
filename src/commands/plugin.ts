import chalk from "chalk";
import inquirer from "inquirer";
import { logger, createSpinner } from "../utils/logger.js";
import {
  installPlugin,
  removePlugin,
  listPlugins,
  validatePlugins,
} from "../core/plugin.js";
import { PLUGIN_NAME_PATTERN } from "../plugin/sdk/constants.js";

export async function pluginInstallCommand(
  name: string,
  options: { version?: string; force?: boolean },
): Promise<void> {
  if (!PLUGIN_NAME_PATTERN.test(name)) {
    logger.error(`Invalid plugin name: ${name}. Must match kastell-plugin-<name> pattern.`);
    return;
  }

  if (!options.force) {
    const { confirm } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirm",
        message: `This plugin will run commands with root privileges on your servers. Continue installing ${name}?`,
        default: false,
      },
    ]);
    if (!confirm) {
      logger.info("Plugin install cancelled.");
      return;
    }
  }

  const spinner = createSpinner(`Installing ${name}...`);
  spinner.start();

  const result = await installPlugin(name, options.version);
  spinner.stop();

  if (result.success) {
    logger.success(`Plugin ${name} installed successfully.`);
  } else {
    logger.error(result.error ?? "Plugin install failed.");
  }
}

export async function pluginRemoveCommand(name: string): Promise<void> {
  const spinner = createSpinner(`Removing ${name}...`);
  spinner.start();

  const result = await removePlugin(name);
  spinner.stop();

  if (result.success) {
    logger.success(`Plugin ${name} removed successfully.`);
  } else {
    logger.error(result.error ?? "Plugin remove failed.");
  }
}

export function pluginListCommand(): void {
  const plugins = listPlugins();

  if (plugins.length === 0) {
    logger.info("No plugins installed.");
    return;
  }

  const maxName = Math.max(40, ...plugins.map((p) => p.name.length)) + 2;
  const maxVer = Math.max(10, ...plugins.map((p) => p.version.length)) + 2;
  const maxPrefix = Math.max(8, ...plugins.map((p) => p.prefix.length)) + 2;
  const maxChecks = 8;

  const header = `${"Name".padEnd(maxName)} ${"Version".padEnd(maxVer)} ${"Prefix".padEnd(maxPrefix)} ${"Checks".padEnd(maxChecks)} Status`;
  logger.info(chalk.bold(header));
  logger.info("─".repeat(header.length));

  for (const p of plugins) {
    const status =
      p.status === "loaded"
        ? chalk.green(p.status)
        : chalk.red(`${p.status} (${p.reason ?? "unknown"})`);
    logger.info(
      `${p.name.padEnd(maxName)} ${p.version.padEnd(maxVer)} ${p.prefix.padEnd(maxPrefix)} ${String(p.checks).padEnd(maxChecks)} ${status}`,
    );
  }

  const failed = plugins.filter((p) => p.status === "failed");
  if (failed.length > 0) {
    logger.info(
      chalk.yellow(`\nRun ${chalk.bold("kastell plugin validate <name>")} for details.`),
    );
  }
}

export function pluginValidateCommand(name?: string): void {
  const results = validatePlugins(name);

  if (results.length === 0) {
    logger.info("No plugins to validate.");
    return;
  }

  for (const r of results) {
    if (r.valid) {
      logger.success(`${r.name}: valid`);
    } else {
      logger.error(`${r.name}: invalid — ${r.reason ?? "unknown error"}`);
    }
  }
}