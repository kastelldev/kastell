import { program } from "commander";
import chalk from "chalk";
import ora from "ora";
import { __NAME_CAMEL__Core } from "../core/__NAME__.js";

program
  .command("__NAME__")
  .description("TODO: describe what this command does")
  .option("--server <name>", "Target server name or IP")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const spinner = ora("Running __NAME__...").start();
    try {
      const result = await __NAME_CAMEL__Core(options);
      spinner.succeed("Done");
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(chalk.green(result.message));
      }
    } catch (error) {
      spinner.fail(error instanceof Error ? error.message : "Unknown error");
      process.exitCode = 1;
    }
  });
