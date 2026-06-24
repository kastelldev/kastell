import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { ServerRecord } from "../../src/types/index.js";

export interface IsolatedKastellEnv {
  dir: string;
  env: NodeJS.ProcessEnv;
  cleanup(): void;
}

export function createIsolatedKastellEnv(
  servers: ServerRecord[] = [],
): IsolatedKastellEnv {
  const dir = mkdtempSync(join(tmpdir(), "kastell-test-"));
  writeFileSync(join(dir, "servers.json"), JSON.stringify(servers, null, 2));

  return {
    dir,
    env: {
      ...process.env,
      KASTELL_DIR: dir,
      KASTELL_TEST_MODE: "1",
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    },
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch (err) {
        // Windows EPERM: spawned CLI may still hold file handles briefly after spawnSync.
        // Test assertions have already evaluated; cleanup failure is best-effort and
        // must not fail the test. Note: Node's rmSync maxRetries is ignored on win32.
        console.warn(`isolatedKastellEnv cleanup warning: ${(err as Error).message}`);
      }
    },
  };
}

export function assertIsolatedKastellDir(actual: string, expected: string): void {
  if (resolve(actual) !== resolve(expected)) {
    throw new Error(
      `KASTELL_DIR isolation failed: expected "${expected}", received "${actual}". ` +
        "Set KASTELL_DIR before importing src/utils/paths.ts or src/utils/config.ts.",
    );
  }
}

// P119 LESSON: KASTELL_DIR MUST be set BEFORE any dynamic import of modules
// that evaluate src/utils/paths.ts or src/utils/config.ts at module load time.
// These modules cache KASTELL_DIR on first evaluation; setting the env var
// after import has no effect. The wrappers below capture and restore the
// prior env state so callers (test bodies) do not need to manage it.
export async function importWithIsolatedKastellDir<T>(
  isolated: IsolatedKastellEnv,
  importer: () => Promise<T>,
): Promise<T> {
  const previousDir = process.env.KASTELL_DIR;
  const previousTestMode = process.env.KASTELL_TEST_MODE;
  process.env.KASTELL_DIR = isolated.dir;
  process.env.KASTELL_TEST_MODE = "1";
  jest.resetModules();
  try {
    const paths = await import("../../src/utils/paths.js");
    assertIsolatedKastellDir(paths.KASTELL_DIR, isolated.dir);
    return await importer();
  } finally {
    if (previousDir === undefined) {
      delete process.env.KASTELL_DIR;
    } else {
      process.env.KASTELL_DIR = previousDir;
    }
    if (previousTestMode === undefined) {
      delete process.env.KASTELL_TEST_MODE;
    } else {
      process.env.KASTELL_TEST_MODE = previousTestMode;
    }
  }
}

export function spawnKastell(
  isolated: IsolatedKastellEnv,
  args: string[],
): SpawnSyncReturns<string> {
  return spawnSync("node", [join(process.cwd(), "dist/index.js"), ...args], {
    encoding: "utf8",
    env: isolated.env,
  });
}

export async function runWithIsolatedKastellEnv<T>(
  fn: (isolated: IsolatedKastellEnv) => T | Promise<T>,
  servers: ServerRecord[] = [],
): Promise<T> {
  const isolated = createIsolatedKastellEnv(servers);
  const previousDir = process.env.KASTELL_DIR;
  const previousTestMode = process.env.KASTELL_TEST_MODE;
  process.env.KASTELL_DIR = isolated.dir;
  process.env.KASTELL_TEST_MODE = "1";
  try {
    return await fn(isolated);
  } finally {
    if (previousDir === undefined) {
      delete process.env.KASTELL_DIR;
    } else {
      process.env.KASTELL_DIR = previousDir;
    }
    if (previousTestMode === undefined) {
      delete process.env.KASTELL_TEST_MODE;
    } else {
      process.env.KASTELL_TEST_MODE = previousTestMode;
    }
    isolated.cleanup();
  }
}
