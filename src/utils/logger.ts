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

const REDACT_PATTERNS = /token|secret|password|credential|apikey|api_key/i;

function redactArg(arg: unknown): unknown {
  if (typeof arg === "string") {
    return REDACT_PATTERNS.test(arg) ? "[REDACTED]" : arg;
  }
  if (typeof arg === "object" && arg !== null) {
    return "[object]";
  }
  return arg;
}

export const debugLog = process.env.KASTELL_DEBUG
  ? (...args: unknown[]) => console.error("[debug]", ...args.map(redactArg))
  : undefined;
