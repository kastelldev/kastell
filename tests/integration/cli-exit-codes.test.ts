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
  runWithIsolatedKastellEnv,
  spawnKastell,
} from "../helpers/isolatedKastellEnv";

describe("CLI exit codes — process-level", () => {
  it("bare update exits 1", () => {
    return runWithIsolatedKastellEnv(
      (isolated) => {
        const result = spawnKastell(isolated, ["update", "bare-one"]);

        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/not available.*bare/i);
      },
      [createBareServer({ name: "bare-one", platform: undefined })],
    );
  });

  it("bare maintain exits 1", () => {
    return runWithIsolatedKastellEnv(
      (isolated) => {
        const result = spawnKastell(isolated, ["maintain", "bare-two"]);

        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/not available.*bare/i);
      },
      [createBareServer({ name: "bare-two", platform: undefined })],
    );
  });

  it("bare domain list exits 1", () => {
    return runWithIsolatedKastellEnv(
      (isolated) => {
        const result = spawnKastell(isolated, ["domain", "list", "bare-three"]);

        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/not available.*bare/i);
      },
      [createBareServer({ name: "bare-three", platform: undefined })],
    );
  });

  it("snapshot list --all with no servers exits 0", () => {
    return runWithIsolatedKastellEnv((isolated) => {
      const result = spawnKastell(isolated, ["snapshot", "list", "--all"]);

      expect(result.status).toBe(0);
    });
  });

  it("stdout and stderr are captured separately", () => {
    return runWithIsolatedKastellEnv(
      (isolated) => {
        const result = spawnKastell(isolated, ["update", "bare-stream"]);

        expect(result.status).toBe(1);
        // Error messages come from logger.error which uses console.error → stderr.
        expect(result.stderr).toMatch(/not available.*bare/i);
        // stdout should not contain the bare-server failure message.
        expect(result.stdout).not.toMatch(/not available.*bare/i);
      },
      [createBareServer({ name: "bare-stream", platform: undefined })],
    );
  });

  it("spawning a missing CLI binary produces a clear ENOENT error", () => {
    // This test verifies the spawn-side preflight: when the CLI binary
    // (dist/index.js) is missing, spawning node against it produces a clear
    // ENOENT error. It does NOT test the test-infrastructure preflight
    // throw in cli-help-snapshots.test.ts:33 (a separate concern).
    const missingCli = join(process.cwd(), "dist/__nonexistent_cli__.js");
    return runWithIsolatedKastellEnv((isolated) => {
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

  it("status on missing server surfaces 'Server not found' through command boundary", async () => {
    await runWithIsolatedKastellEnv(async (isolated) => {
      const result = spawnKastell(isolated, ["status", "missing-server"]);

      expect(result.status).toBe(1);
      expect(result.stderr + result.stdout).toMatch(/not found|No servers found|missing/i);
    });
  });

  it("evidence with missing server surfaces 'Server not found' through command boundary", async () => {
    await runWithIsolatedKastellEnv(async (isolated) => {
      const result = spawnKastell(isolated, ["evidence", "missing-server", "--quiet"]);

      expect(result.status).toBe(1);
      expect(result.stderr + result.stdout).toMatch(/not found|No servers found|missing/i);
    });
  });

  it("audit --ci without threshold exits 1 through command boundary", async () => {
    await runWithIsolatedKastellEnv(async (isolated) => {
      const result = spawnKastell(isolated, ["audit", "demo", "--ci"]);

      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/--ci requires --threshold/i);
    });
  });
});
