import { mkdirSync, cpSync, rmSync, existsSync, writeFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawn } from "child_process";

// Mock child_process.spawn before importing modules that use it
jest.mock("child_process", () => ({
  spawn: jest.fn(),
  spawnSync: jest.fn().mockReturnValue({ status: 0 }),
}));

// Mock secureWrite
jest.mock("../../src/utils/secureWrite.js", () => ({
  secureWriteFileSync: jest.fn(),
  secureMkdirSync: jest.fn(),
}));

// Mock paths to use temp directory
const TEMP_BASE = mkdtempSync(join(tmpdir(), "kastell-plugin-test-"));
const TEMP_PLUGINS_DIR = join(TEMP_BASE, "plugins");
const TEMP_NODE_MODULES = join(TEMP_PLUGINS_DIR, "node_modules");
const TEMP_KASTELL_DIR = join(TEMP_BASE, "kastell");

jest.mock("../../src/utils/paths.js", () => ({
  PLUGINS_DIR: TEMP_PLUGINS_DIR,
  PLUGINS_NODE_MODULES: TEMP_NODE_MODULES,
  KASTELL_DIR: TEMP_KASTELL_DIR,
}));

jest.mock("../../src/utils/version.js", () => ({
  KASTELL_VERSION: "2.2.0",
}));

import { installPlugin, removePlugin, listPlugins, validatePlugins } from "../../src/core/plugin.js";
import { loadPlugins as realLoadPlugins } from "../../src/plugin/loader.js";
import { clearPluginRegistry, getPluginRegistry } from "../../src/plugin/registry.js";
import { createMockProcess } from "../helpers/mockProcess.js";
import { readFileSync } from "fs";

/**
 * Replace the default `loadPlugins` with one that uses our ESM-aware
 * importer. This routes installPlugin's internal call through
 * `importEsmModule` so v3 fixtures load in Jest's CJS environment.
 */
const loadPlugins: typeof realLoadPlugins = (options) =>
  realLoadPlugins({ ...(options ?? {}), importer: importEsmModule });

// Override the loader module so that any internal call (e.g. inside
// installPlugin -> loadPlugins) uses our ESM-aware importer.
jest.mock("../../src/plugin/loader.js", () => {
  const actual = jest.requireActual("../../src/plugin/loader.js");
  return {
    ...actual,
    loadPlugins: (opts: unknown) => {
      const options = (opts ?? {}) as { importer?: unknown };
      return (actual.loadPlugins as typeof realLoadPlugins)({
        ...(options as object),
        importer: importEsmModule,
      });
    },
  };
});

const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;

const FIXTURE_PLUGIN = join(__dirname, "../fixtures/plugins/kastell-plugin-mock");

/**
 * ESM importer that bypasses Jest's CJS runtime. The repository declares
 * `"type": "module"` and the v3 fixture uses real `export` statements.
 * Jest's CJS dynamic import throws "Unexpected token 'export'" without
 * `--experimental-vm-modules`, so we read the source and evaluate the
 * exports in-process. The fixture is documentation/example code only; we
 * do NOT execute the remote shell lifecycle.
 */
async function importEsmModule(filePath: string): Promise<Record<string, unknown>> {
  let realPath = filePath;
  if (filePath.startsWith("file:")) {
    const { fileURLToPath } = await import("url");
    realPath = fileURLToPath(filePath);
  }
  const source = readFileSync(realPath, "utf-8");
  const namespace: Record<string, unknown> = {};
  // Match `export const NAME = ...;` declarations. Constraint: the
  // declaration's terminator `;` must appear on its own line, immediately
  // followed by a newline. This is a deliberate, documented limitation of
  // the regex-based extractor:
  //   - Single-line initializers (`export const x = 1;`) match.
  //   - Multi-line initializers (`export const x = [ ... ];` where the
  //     closing `];` is followed by `;\n` on its own line) match.
  //   - Initializers whose terminator is NOT on its own line break the
  //     match (e.g. `export const x = 1;` with the next statement on the
  //     same line).
  // All Kastell v3 fixtures and example plugins follow the constrained
  // format, so the extractor is sufficient for the integration test
  // surface. If we ever need to parse arbitrary ESM, switch to
  // `@babel/parser` or `acorn`.
  const constRe = /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]*?);\n/g;
  let m: RegExpExecArray | null;
  while ((m = constRe.exec(source)) !== null) {
    const name = m[1];
    const literal = m[2];
    // eslint-disable-next-line no-new-func
    const fn = new Function(`"use strict"; return (${literal});`);
    namespace[name] = fn();
  }
  const fnRe = /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g;
  while ((m = fnRe.exec(source)) !== null) {
    const name = m[1];
    // eslint-disable-next-line no-new-func
    namespace[name] = new Function(`"use strict"; return (async () => {})();`);
  }
  return namespace;
}

function simulateNpmInstall(pluginName: string): void {
  const dest = join(TEMP_NODE_MODULES, pluginName);
  mkdirSync(dest, { recursive: true });
  cpSync(FIXTURE_PLUGIN, dest, { recursive: true });
  writeFileSync(join(dest, "package.json"), JSON.stringify({ type: "module" }));
}

function simulateNpmUninstall(pluginName: string): void {
  const dest = join(TEMP_NODE_MODULES, pluginName);
  if (existsSync(dest)) rmSync(dest, { recursive: true });
}

beforeEach(() => {
  mkdirSync(TEMP_KASTELL_DIR, { recursive: true });
  mkdirSync(TEMP_NODE_MODULES, { recursive: true });
  clearPluginRegistry();
  jest.clearAllMocks();
});

afterEach(() => {
  if (existsSync(TEMP_BASE)) rmSync(TEMP_BASE, { recursive: true });
});

describe("Plugin Lifecycle Integration", () => {
  it("install → load → list → validate → remove lifecycle", async () => {
    const pluginName = "kastell-plugin-mock";

    mockedSpawn.mockImplementation(() => {
      simulateNpmInstall(pluginName);
      return createMockProcess(0);
    });

    const installResult = await installPlugin(pluginName);
    if (!installResult.success) {
      console.error("installPlugin failed:", installResult.error);
    }
    expect(installResult.success).toBe(true);
    expect(installResult.name).toBe(pluginName);

    // installPlugin internally called loadPlugins (mocked above to route
    // through `importEsmModule` so the v3 fixture is evaluated under
    // Jest's CJS runtime). The registry is already populated; no second
    // load call is needed.
    const registry = getPluginRegistry();
    expect(registry.has(pluginName)).toBe(true);
    const entry = registry.get(pluginName)!;
    expect(entry.status).toBe("loaded");
    const loaded = entry as Extract<typeof entry, { status: "loaded" }>;
    expect(loaded.checks).toHaveLength(2);
    expect(loaded.manifest.checkPrefix).toBe("MOCK");

    const listed = listPlugins();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      name: pluginName,
      version: "0.2.0",
      prefix: "MOCK",
      checks: 2,
      status: "loaded",
    });

    const validated = validatePlugins();
    expect(validated).toHaveLength(1);
    expect(validated[0]).toMatchObject({
      name: pluginName,
      valid: true,
    });

    mockedSpawn.mockImplementation(() => {
      simulateNpmUninstall(pluginName);
      return createMockProcess(0);
    });

    const removeResult = await removePlugin(pluginName);
    expect(removeResult.success).toBe(true);

    expect(getPluginRegistry().size).toBe(0);
    expect(listPlugins()).toHaveLength(0);
    expect(validatePlugins()).toHaveLength(0);
  });

  it("install failure does not leave partial state", async () => {
    mockedSpawn.mockImplementation(() => createMockProcess(1));

    const result = await installPlugin("kastell-plugin-mock");
    expect(result.success).toBe(false);

    expect(getPluginRegistry().size).toBe(0);
    expect(listPlugins()).toHaveLength(0);
  });

  it("remove of non-existent plugin fails gracefully", async () => {
    const result = await removePlugin("kastell-plugin-nonexistent");
    expect(result.success).toBe(false);
    expect(result.error).toContain("not installed");
  });

  it("load → list → validate round-trip with real filesystem", async () => {
    simulateNpmInstall("kastell-plugin-mock");

    const loadResult = await loadPlugins({
      importer: (p: string) => importEsmModule(p),
    });
    expect(loadResult.loaded).toContain("kastell-plugin-mock");
    expect(loadResult.errors).toHaveLength(0);

    const listed = listPlugins();
    expect(listed).toHaveLength(1);
    expect(listed[0].name).toBe("kastell-plugin-mock");

    const validated = validatePlugins("kastell-plugin-mock");
    expect(validated[0].valid).toBe(true);
  });

  it("loads a v3 read-only fixture and exposes read checks without activeProbe", async () => {
    simulateNpmInstall("kastell-plugin-mock");

    const loadResult = await loadPlugins({
      importer: (p: string) => importEsmModule(p),
    });
    expect(loadResult.errors).toHaveLength(0);

    const entry = getPluginRegistry().get("kastell-plugin-mock")!;
    expect(entry.status).toBe("loaded");
    const loaded = entry as Extract<typeof entry, { status: "loaded" }>;
    expect(loaded.manifest.apiVersion).toBe("3");
    for (const check of loaded.checks) {
      expect(check.sourceApiVersion).toBe("3");
      expect(check.read).toBeDefined();
      expect(check.activeProbe).toBeUndefined();
    }
    expect(loaded.readChecks).toHaveLength(2);
    expect(loaded.activeProbesByCheckId.size).toBe(0);
  });
});
