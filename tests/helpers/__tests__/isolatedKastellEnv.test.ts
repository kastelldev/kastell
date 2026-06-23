import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

import { createMockServer } from "../server-factories";
import {
  assertIsolatedKastellDir,
  createIsolatedKastellEnv,
  importWithIsolatedKastellDir,
} from "../isolatedKastellEnv";

describe("isolatedKastellEnv", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  function track<T extends { cleanup(): void }>(env: T): T {
    cleanups.push(() => env.cleanup());
    return env;
  }

  it("creates an isolated directory and spawn environment", () => {
    const isolated = track(createIsolatedKastellEnv());

    expect(isolated.env.KASTELL_DIR).toBe(isolated.dir);
    expect(isolated.env.NO_COLOR).toBe("1");
    expect(isolated.env.FORCE_COLOR).toBe("0");
    expect(isolated.dir).toContain("kastell-test-");
  });

  it("writes deterministic servers.json fixtures", () => {
    const isolated = track(createIsolatedKastellEnv([createMockServer()]));

    const raw = readFileSync(join(isolated.dir, "servers.json"), "utf8");
    const parsed = JSON.parse(raw) as unknown[];

    expect(parsed).toHaveLength(1);
  });

  it("should import path-dependent modules only after setting KASTELL_DIR", async () => {
    const isolated = track(createIsolatedKastellEnv());

    const paths = await importWithIsolatedKastellDir(isolated, () =>
      import("../../../src/utils/paths.js"),
    );

    expect(resolve(paths.KASTELL_DIR)).toBe(resolve(isolated.dir));
  });

  it("sets KASTELL_TEST_MODE during isolated imports", async () => {
    const isolated = track(createIsolatedKastellEnv());

    const snapshot = await importWithIsolatedKastellDir(isolated, async () => ({
      kastellDir: process.env.KASTELL_DIR,
      kastellTestMode: process.env.KASTELL_TEST_MODE,
    }));

    expect(snapshot.kastellDir).toBe(isolated.dir);
    expect(snapshot.kastellTestMode).toBe("1");
  });

  it("should throw a clear error when the imported path does not match isolation", () => {
    const expected = mkdtempSync(join(tmpdir(), "kastell-test-"));
    const actual = mkdtempSync(join(tmpdir(), "kastell-test-"));
    cleanups.push(() => {
      rmSync(expected, { recursive: true, force: true });
      rmSync(actual, { recursive: true, force: true });
    });

    expect(() => assertIsolatedKastellDir(actual, expected)).toThrow(
      /KASTELL_DIR.*before importing/i,
    );
  });
});
