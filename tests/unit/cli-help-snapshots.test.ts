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
import {
  createIsolatedKastellEnv,
  type IsolatedKastellEnv,
} from "../helpers/isolatedKastellEnv";

const CLI_PATH = join(__dirname, "../../dist/index.js");

/** Invoke the CLI with the given args and return the help text output */
function getHelp(isolated: IsolatedKastellEnv, args: string[]): string {
  const result = spawnSync("node", [CLI_PATH, ...args], {
    encoding: "utf-8",
    env: isolated.env,
  });
  const raw = (result.stdout || result.stderr || "").trim();
  return stripAnsi(raw);
}

describe("CLI help text snapshots", () => {
  let isolated: IsolatedKastellEnv;

  beforeAll(() => {
    isolated = createIsolatedKastellEnv();
    const result = spawnSync("node", [CLI_PATH, "--version"], {
      encoding: "utf-8",
      env: isolated.env,
    });
    if (result.status !== 0) {
      throw new Error("dist/index.js not found. Run npm run build first.");
    }
  });

  afterAll(() => {
    isolated.cleanup();
  });

  it("kastell --help matches snapshot", () => {
    expect(getHelp(isolated, ["--help"])).toMatchSnapshot();
  });

  it("kastell audit --help matches snapshot", () => {
    expect(getHelp(isolated, ["audit", "--help"])).toMatchSnapshot();
  });

  it("kastell lock --help matches snapshot", () => {
    expect(getHelp(isolated, ["lock", "--help"])).toMatchSnapshot();
  });

  it("kastell init --help matches snapshot", () => {
    expect(getHelp(isolated, ["init", "--help"])).toMatchSnapshot();
  });

  it("kastell provision --help matches snapshot (alias for init)", () => {
    expect(getHelp(isolated, ["provision", "--help"])).toMatchSnapshot();
  });

  it("kastell secure --help matches snapshot", () => {
    expect(getHelp(isolated, ["secure", "--help"])).toMatchSnapshot();
  });

  it("kastell guard --help matches snapshot", () => {
    expect(getHelp(isolated, ["guard", "--help"])).toMatchSnapshot();
  });

  it("kastell fix --help matches snapshot", () => {
    expect(getHelp(isolated, ["fix", "--help"])).toMatchSnapshot();
  });

  it("kastell plugin --help matches snapshot", () => {
    expect(getHelp(isolated, ["plugin", "--help"])).toMatchSnapshot();
  });

  it("kastell plugin install --help matches snapshot", () => {
    expect(getHelp(isolated, ["plugin", "install", "--help"])).toMatchSnapshot();
  });
});
