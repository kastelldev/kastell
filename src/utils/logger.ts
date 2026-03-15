import chalk from "chalk";
import ora, { type Ora } from "ora";

export const logger = {
  info: (message: string) => {
    console.log(chalk.blue("ℹ"), message);
  },

  success: (message: string) => {
    console.log(chalk.green("✔"), message);
  },

  error: (message: string) => {
    console.log(chalk.red("✖"), message);
  },

  warning: (message: string) => {
    console.log(chalk.yellow("⚠"), message);
  },

  title: (message: string) => {
    console.log();
    console.log(chalk.bold.cyan(message));
    console.log();
  },

  step: (message: string) => {
    console.log(chalk.gray("→"), message);
  },
};

export function createSpinner(text: string): Ora {
  return ora({
    text,
    color: "cyan",
  });
}

export const debugLog = process.env.DEBUG
  ? (...args: unknown[]) => console.error("[debug]", ...args)
  : undefined;
