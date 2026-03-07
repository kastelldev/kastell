import figlet from "figlet";
import chalk from "chalk";

export function renderLogo(): string {
  const text = figlet.textSync("KASTELL", {
    font: "Standard",
    horizontalLayout: "default",
  });
  return chalk.cyan.bold(text);
}
