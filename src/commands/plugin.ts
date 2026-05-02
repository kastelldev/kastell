import chalk from "chalk";
import inquirer from "inquirer";
import { logger, createSpinner } from "../utils/logger.js";
import {
  installPlugin,
  removePlugin,
  listPlugins,
  validatePlugins,
} from "../core/plugin.js";

export async function pluginInstallCommand(
  name: string,
  options: { version?: string; force?: boolean },
): Promise<void> {
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

  const header = `${"Name".padEnd(40)} ${"Version".padEnd(10)} ${"Prefix".padEnd(8)} ${"Checks".padEnd(8)} Status`;
  console.log(chalk.bold(header));
  console.log("─".repeat(header.length));

  for (const p of plugins) {
    const status =
      p.status === "loaded"
        ? chalk.green(p.status)
        : chalk.red(`${p.status} (${p.reason ?? "unknown"})`);
    console.log(
      `${p.name.padEnd(40)} ${p.version.padEnd(10)} ${p.prefix.padEnd(8)} ${String(p.checks).padEnd(8)} ${status}`,
    );
  }

  const failed = plugins.filter((p) => p.status === "failed");
  if (failed.length > 0) {
    console.log(
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