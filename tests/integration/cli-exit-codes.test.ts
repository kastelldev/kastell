/**
 * Process-level tests verifying that the built CLI exits with the expected
 * non-zero status codes when commands fail. These tests spawn `dist/index.js`
 * (so `npm run build` must run before this suite) and assert on the captured
 * stdout / stderr streams.
 *
 * Bare-server fixtures are used to exercise guarded code paths that exit 1
 * without performing any SSH or provider network calls.
 */

import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { createBareServer } from "../helpers/server-factories";
import {
  createIsolatedKastellEnv,
  spawnKastell,
  type IsolatedKastellEnv,
} from "../helpers/isolatedKastellEnv";

describe("CLI exit codes — process-level", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  function track(isolated: IsolatedKastellEnv): IsolatedKastellEnv {
    cleanups.push(() => isolated.cleanup());
    return isolated;
  }

  it("bare update exits 1", () => {
    const isolated = track(
      createIsolatedKastellEnv([
        createBareServer({ name: "bare-one", platform: undefined }),
      ]),
    );

    const result = spawnKastell(isolated, ["update", "bare-one"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/not available.*bare/i);
  });

  it("bare maintain exits 1", () => {
    const isolated = track(
      createIsolatedKastellEnv([
        createBareServer({ name: "bare-two", platform: undefined }),
      ]),
    );

    const result = spawnKastell(isolated, ["maintain", "bare-two"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/not available.*bare/i);
  });

  it("bare domain list exits 1", () => {
    const isolated = track(
      createIsolatedKastellEnv([
        createBareServer({ name: "bare-three", platform: undefined }),
      ]),
    );

    const result = spawnKastell(isolated, ["domain", "list", "bare-three"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/not available.*bare/i);
  });

  it("snapshot list --all with no servers exits 0", () => {
    const isolated = track(createIsolatedKastellEnv());

    const result = spawnKastell(isolated, ["snapshot", "list", "--all"]);

    expect(result.status).toBe(0);
  });

  it("stdout and stderr are captured separately", () => {
    const isolated = track(
      createIsolatedKastellEnv([
        createBareServer({ name: "bare-stream", platform: undefined }),
      ]),
    );

    const result = spawnKastell(isolated, ["update", "bare-stream"]);

    expect(result.status).toBe(1);
    // Error messages come from logger.error which uses console.error → stderr.
    expect(result.stderr).toMatch(/not available.*bare/i);
    // stdout should not contain the bare-server failure message.
    expect(result.stdout).not.toMatch(/not available.*bare/i);
  });

  it("spawning a missing CLI binary produces a clear ENOENT error", () => {
    // This test verifies the spawn-side preflight: when the CLI binary
    // (dist/index.js) is missing, spawning node against it produces a clear
    // ENOENT error. It does NOT test the test-infrastructure preflight
    // throw in cli-help-snapshots.test.ts:33 (a separate concern).
    const missingCli = join(process.cwd(), "dist/__nonexistent_cli__.js");
    const isolated = track(createIsolatedKastellEnv());

    const result = spawnSync("node", [missingCli, "--version"], {
      encoding: "utf8",
      env: isolated.env,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(
      /cannot find module|ENOENT|no such file/i,
    );
  });
});
