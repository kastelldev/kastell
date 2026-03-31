import { severityChalk } from "../../src/core/audit/formatters/shared.js";
import chalk from "chalk";

describe("severityChalk", () => {
  it("returns chalk.red for critical", () => {
    const fn = severityChalk("critical");
    expect(fn("test")).toBe(chalk.red("test"));
  });
  it("returns chalk.yellow for warning", () => {
    const fn = severityChalk("warning");
    expect(fn("test")).toBe(chalk.yellow("test"));
  });
  it("returns chalk.blue for info", () => {
    const fn = severityChalk("info");
    expect(fn("test")).toBe(chalk.blue("test"));
  });
});
