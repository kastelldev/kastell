/**
 * Snapshot tests for CLI help text output.
 * Protects kastell and subcommand help text from silent regressions.
 * Any change to CLI option names, descriptions, or commands will cause a test failure.
 *
 * Uses spawnSync to invoke the built dist/index.js binary.
 * NO_COLOR=1 and FORCE_COLOR=0 disable ANSI escape sequences for deterministic output.
 */

import { spawnSync } from "child_process";
import { join } from "path";
import { stripAnsi } from "../helpers/stripAnsi";

const CLI_PATH = join(__dirname, "../../dist/index.js");

/** Invoke the CLI with the given args and return the help text output */
function getHelp(args: string[]): string {
  const result = spawnSync("node", [CLI_PATH, ...args], {
    encoding: "utf-8",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  const raw = (result.stdout || result.stderr || "").trim();
  return stripAnsi(raw);
}

describe("CLI help text snapshots", () => {
  beforeAll(() => {
    const result = spawnSync("node", [CLI_PATH, "--version"], { encoding: "utf-8" });
    if (result.status !== 0) {
      throw new Error("dist/index.js not found. Run npm run build first.");
    }
  });

  it("kastell --help matches snapshot", () => {
    expect(getHelp(["--help"])).toMatchSnapshot();
  });

  it("kastell audit --help matches snapshot", () => {
    expect(getHelp(["audit", "--help"])).toMatchSnapshot();
  });

  it("kastell lock --help matches snapshot", () => {
    expect(getHelp(["lock", "--help"])).toMatchSnapshot();
  });

  it("kastell init --help matches snapshot", () => {
    expect(getHelp(["init", "--help"])).toMatchSnapshot();
  });

  it("kastell secure --help matches snapshot", () => {
    expect(getHelp(["secure", "--help"])).toMatchSnapshot();
  });

  it("kastell guard --help matches snapshot", () => {
    expect(getHelp(["guard", "--help"])).toMatchSnapshot();
  });

  it("kastell fix --help matches snapshot", () => {
    expect(getHelp(["fix", "--help"])).toMatchSnapshot();
  });

  it("kastell plugin --help matches snapshot", () => {
    expect(getHelp(["plugin", "--help"])).toMatchSnapshot();
  });

  it("kastell plugin install --help matches snapshot", () => {
    expect(getHelp(["plugin", "install", "--help"])).toMatchSnapshot();
  });
});
