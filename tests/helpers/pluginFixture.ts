/**
 * Plugin fixture helper for tests that exercise the real loadPlugins()
 * discovery path (filesystem + dynamic import). Use `installPluginFixture`
 * in `beforeEach` / `it` setup, and call the returned `cleanup` in
 * `afterEach` (or after each test body) to remove the temp tree.
 *
 * All declared auxiliary files are written to disk so the real Node ESM/CJS
 * loader sees authentic file artifacts. Lifecycle exports are NOT invoked
 * during install (a process-level test can later assert that import alone
 * does not call them).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import type { PluginManifest } from "../../src/plugin/sdk/types.js";

export type PluginFixturePackageType = "module" | "commonjs";

export interface InstallPluginFixtureOptions {
  /** Plugin name (must match `kastell-plugin-<lowercase>`). */
  name: string;
  /** Package type controls fixture package.json `type` field. */
  packageType: PluginFixturePackageType;
  /** Manifest JSON object (will be serialized to kastell-plugin.json). */
  manifest: PluginManifest;
  /** Source for the plugin's entry file. Written to manifest.entry path. */
  entrySource: string;
  /** Additional auxiliary files keyed by relative path. */
  files?: Record<string, string>;
}

export interface PluginFixtureHandle {
  /** Absolute path to the temp KASTELL_DIR root created for this test. */
  kastellDir: string;
  /** Absolute path to the plugin directory under node_modules. */
  pluginDir: string;
  /** Relative entry path used (matches `manifest.entry`). */
  entryPath: string;
  /** Cleanup function: removes the temp KASTELL_DIR and all contents. */
  cleanup: () => void;
}

const SAFE_NAME_PATTERN = /^kastell-plugin-[a-z0-9-]+$/;

function assertSafeName(name: string): void {
  if (!SAFE_NAME_PATTERN.test(name)) {
    throw new Error(
      `installPluginFixture: name "${name}" must match ${SAFE_NAME_PATTERN}`,
    );
  }
}

function assertSafePath(path: string): void {
  if (path.includes("..") || path.startsWith("/") || path.startsWith("\\")) {
    throw new Error(
      `installPluginFixture: relative path "${path}" must not contain ".." or start with separators`,
    );
  }
}

/**
 * Create a temp KASTELL_DIR, install a single plugin under
 * `<kastellDir>/plugins/node_modules/<name>`, write the manifest, entry,
 * and any declared auxiliary files. Returns a handle exposing
 * `kastellDir`, `pluginDir`, `entryPath`, and a `cleanup` function.
 *
 * The KASTELL_DIR env var is set to the temp directory so subsequent calls
 * to `loadPlugins()` discover the fixture through the real path constants.
 * Callers MUST also call `cleanup` (in `afterEach`) to remove the temp tree.
 */
export function installPluginFixture(
  options: InstallPluginFixtureOptions,
): PluginFixtureHandle {
  assertSafeName(options.name);
  assertSafePath(options.manifest.entry);

  const kastellDir = mkdtempSync(join(tmpdir(), "kastell-plugin-fixture-"));
  const nodeModulesDir = join(kastellDir, "plugins", "node_modules");
  const pluginDir = join(nodeModulesDir, options.name);
  mkdirSync(pluginDir, { recursive: true });

  const manifestPath = join(pluginDir, "kastell-plugin.json");
  writeFileSync(manifestPath, JSON.stringify(options.manifest, null, 2));

  const packageType = options.packageType === "module" ? "module" : "commonjs";
  const packageJson = {
    name: options.name,
    version: options.manifest.version,
    type: packageType,
  };
  writeFileSync(
    join(pluginDir, "package.json"),
    JSON.stringify(packageJson, null, 2),
  );

  const entryPath = options.manifest.entry.replace(/^\.\//, "");
  const entryFullPath = join(pluginDir, entryPath);
  mkdirSync(dirname(entryFullPath), { recursive: true });
  writeFileSync(entryFullPath, options.entrySource);

  const files = options.files ?? {};
  for (const [relativePath, contents] of Object.entries(files)) {
    assertSafePath(relativePath);
    const fullPath = join(pluginDir, relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, contents);
  }

  const previousKastellDir = process.env.KASTELL_DIR;
  process.env.KASTELL_DIR = kastellDir;

  const cleanup = (): void => {
    try {
      if (previousKastellDir === undefined) {
        delete process.env.KASTELL_DIR;
      } else {
        process.env.KASTELL_DIR = previousKastellDir;
      }
      rmSync(kastellDir, { recursive: true, force: true });
    } catch (err) {
      console.warn(
        `installPluginFixture cleanup warning: ${(err as Error).message}`,
      );
    }
  };

  return {
    kastellDir,
    pluginDir,
    entryPath,
    cleanup,
  };
}
