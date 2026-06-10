import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

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
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
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

export async function importWithIsolatedKastellDir<T>(
  isolated: IsolatedKastellEnv,
  importer: () => Promise<T>,
): Promise<T> {
  const previous = process.env.KASTELL_DIR;
  process.env.KASTELL_DIR = isolated.dir;
  jest.resetModules();
  try {
    const paths = await import("../../src/utils/paths.js");
    assertIsolatedKastellDir(paths.KASTELL_DIR, isolated.dir);
    return await importer();
  } finally {
    if (previous === undefined) {
      delete process.env.KASTELL_DIR;
    } else {
      process.env.KASTELL_DIR = previous;
    }
  }
}
