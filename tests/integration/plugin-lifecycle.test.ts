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
import { loadPlugins } from "../../src/plugin/loader.js";
import { clearPluginRegistry, getPluginRegistry } from "../../src/plugin/registry.js";
import { createMockProcess } from "../helpers/mockProcess.js";

const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;

const FIXTURE_PLUGIN = join(__dirname, "../fixtures/plugins/kastell-plugin-mock");

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

    const registry = getPluginRegistry();
    expect(registry.has(pluginName)).toBe(true);
    const entry = registry.get(pluginName)!;
    expect(entry.status).toBe("loaded");
    expect(entry.checks).toHaveLength(2);
    expect(entry.manifest.checkPrefix).toBe("MOCK");

    const listed = listPlugins();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      name: pluginName,
      version: "0.1.0",
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
      importer: (p: string) => import(p),
    });
    expect(loadResult.loaded).toContain("kastell-plugin-mock");
    expect(loadResult.errors).toHaveLength(0);

    const listed = listPlugins();
    expect(listed).toHaveLength(1);
    expect(listed[0].name).toBe("kastell-plugin-mock");

    const validated = validatePlugins("kastell-plugin-mock");
    expect(validated[0].valid).toBe(true);
  });
});