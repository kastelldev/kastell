import { listPlugins, validatePlugins } from "../../../src/core/plugin.js";
import { getPluginRegistry, clearPluginRegistry, registerPlugin, registerFailedPlugin } from "../../../src/plugin/registry.js";
import type { PluginManifest, PluginCheck } from "../../../src/plugin/sdk/types.js";

jest.mock("child_process", () => ({
  spawn: jest.fn(),
}));

jest.mock("../../../src/plugin/loader.js", () => ({
  loadPlugins: jest.fn().mockResolvedValue({ loaded: [], errors: [] }),
}));

jest.mock("fs", () => {
  const actual = jest.requireActual("fs") as typeof import("fs");
  return { ...actual, existsSync: jest.fn().mockReturnValue(true), mkdirSync: jest.fn() };
});

const makeManifest = (overrides?: Partial<PluginManifest>): PluginManifest => ({
  name: "kastell-plugin-test",
  version: "1.0.0",
  apiVersion: "1",
  kastell: ">=2.0.0",
  capabilities: ["audit"],
  checkPrefix: "TST",
  entry: "index.js",
  ...overrides,
});

const makeCheck = (id: string): PluginCheck => ({
  id,
  name: `Check ${id}`,
  category: "Test",
  severity: "warning",
  description: `Test check ${id}`,
  checkCommand: "echo ok",
});

beforeEach(() => {
  clearPluginRegistry();
  jest.clearAllMocks();
});

describe("listPlugins", () => {
  it("returns empty array when no plugins installed", () => {
    const result = listPlugins();
    expect(result).toEqual([]);
  });

  it("returns loaded plugins with check counts", () => {
    const manifest = makeManifest();
    registerPlugin(manifest, [makeCheck("TST-ONE"), makeCheck("TST-TWO")]);
    const result = listPlugins();
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "kastell-plugin-test",
      version: "1.0.0",
      prefix: "TST",
      checks: 2,
      status: "loaded",
    });
  });

  it("includes failed plugins with reason", () => {
    const manifest = makeManifest({ name: "kastell-plugin-broken", checkPrefix: "BRK" });
    registerFailedPlugin(manifest, "invalid manifest");
    const result = listPlugins();
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "kastell-plugin-broken",
      version: "1.0.0",
      prefix: "BRK",
      checks: 0,
      status: "failed",
      reason: "invalid manifest",
    });
  });
});

describe("validatePlugins", () => {
  it("returns valid for loaded plugin", () => {
    const manifest = makeManifest();
    registerPlugin(manifest, [makeCheck("TST-ONE")]);
    const result = validatePlugins();
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "kastell-plugin-test",
      valid: true,
    });
  });

  it("returns invalid for failed plugin with reason", () => {
    const manifest = makeManifest({ name: "kastell-plugin-broken", checkPrefix: "BRK" });
    registerFailedPlugin(manifest, "module does not export checks array");
    const result = validatePlugins();
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "kastell-plugin-broken",
      valid: false,
      reason: "module does not export checks array",
    });
  });

  it("validates single plugin by name", () => {
    const m1 = makeManifest();
    const m2 = makeManifest({ name: "kastell-plugin-other", checkPrefix: "OTH" });
    registerPlugin(m1, [makeCheck("TST-ONE")]);
    registerPlugin(m2, [makeCheck("OTH-ONE")]);
    const result = validatePlugins("kastell-plugin-test");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("kastell-plugin-test");
  });

  it("returns error for unknown plugin name", () => {
    const result = validatePlugins("kastell-plugin-nonexistent");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "kastell-plugin-nonexistent",
      valid: false,
      reason: "Plugin not found in registry",
    });
  });
});

import { spawn } from "child_process";
import { loadPlugins } from "../../../src/plugin/loader.js";
import { existsSync } from "fs";
import type { ChildProcess } from "child_process";
import { EventEmitter } from "events";

const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;
const mockedLoadPlugins = loadPlugins as jest.MockedFunction<typeof loadPlugins>;
const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;

function createMockProcess(exitCode: number, stdout = ""): ChildProcess {
  const proc = new EventEmitter() as ChildProcess;
  proc.stdout = new EventEmitter() as ChildProcess["stdout"];
  proc.stderr = new EventEmitter() as ChildProcess["stderr"];
  setTimeout(() => {
    if (stdout && proc.stdout) proc.stdout.emit("data", Buffer.from(stdout));
    proc.emit("close", exitCode);
  }, 0);
  return proc;
}

describe("installPlugin", () => {
  it("returns error for invalid plugin name", async () => {
    const { installPlugin } = await import("../../../src/core/plugin.js");
    const result = await installPlugin("bad-name");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Plugin name must match pattern");
  });

  it("rejects version with shell injection characters", async () => {
    const { installPlugin } = await import("../../../src/core/plugin.js");
    const result = await installPlugin("kastell-plugin-foo", "1.0; echo INJECTED");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid version specifier");
  });

  it("installs plugin via npm and reloads", async () => {
    mockedSpawn.mockImplementation(() => createMockProcess(0));
    mockedLoadPlugins.mockResolvedValue({ loaded: ["kastell-plugin-wordpress"], errors: [] });
    mockedExistsSync.mockReturnValue(true);

    const { installPlugin } = await import("../../../src/core/plugin.js");
    const result = await installPlugin("kastell-plugin-wordpress");
    expect(result.success).toBe(true);
    expect(result.name).toBe("kastell-plugin-wordpress");
    expect(mockedSpawn).toHaveBeenCalledWith(
      expect.stringContaining("npm install kastell-plugin-wordpress --prefix"),
      [],
      expect.any(Object),
    );
    expect(mockedLoadPlugins).toHaveBeenCalled();
  });

  it("accepts version specifier", async () => {
    mockedSpawn.mockImplementation(() => createMockProcess(0));
    mockedLoadPlugins.mockResolvedValue({ loaded: ["kastell-plugin-wordpress"], errors: [] });
    mockedExistsSync.mockReturnValue(true);

    const { installPlugin } = await import("../../../src/core/plugin.js");
    await installPlugin("kastell-plugin-wordpress", "1.2.0");
    expect(mockedSpawn).toHaveBeenCalledWith(
      expect.stringContaining("npm install kastell-plugin-wordpress@1.2.0 --prefix"),
      [],
      expect.any(Object),
    );
  });

  it("cleans up on npm install failure", async () => {
    mockedSpawn.mockImplementation(() => createMockProcess(1, "npm ERR! 404"));

    const { installPlugin } = await import("../../../src/core/plugin.js");
    const result = await installPlugin("kastell-plugin-bad");
    expect(result.success).toBe(false);
    expect(result.error).toContain("npm install failed");
  });

  it("cleans up on load failure (manifest invalid)", async () => {
    mockedSpawn.mockImplementation(() => createMockProcess(0));
    mockedLoadPlugins.mockResolvedValue({
      loaded: [],
      errors: ["kastell-plugin-bad: invalid JSON in kastell-plugin.json"],
    });
    mockedExistsSync.mockReturnValue(true);

    const { installPlugin } = await import("../../../src/core/plugin.js");
    const result = await installPlugin("kastell-plugin-bad");
    expect(result.success).toBe(false);
    expect(result.error).toContain("invalid JSON");
    expect(mockedSpawn).toHaveBeenCalledTimes(2); // install + uninstall
  });
});

describe("removePlugin", () => {
  it("rejects invalid plugin name", async () => {
    const { removePlugin } = await import("../../../src/core/plugin.js");
    const result = await removePlugin("foo; rm -rf ~/");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Plugin name must match pattern");
  });

  it("rejects non-existent plugin", async () => {
    mockedExistsSync.mockReturnValue(false);
    const { removePlugin } = await import("../../../src/core/plugin.js");
    const result = await removePlugin("kastell-plugin-nonexistent");
    expect(result.success).toBe(false);
    expect(result.error).toContain("not installed");
  });

  it("removes plugin via npm and reloads", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedSpawn.mockImplementation(() => createMockProcess(0));
    mockedLoadPlugins.mockResolvedValue({ loaded: [], errors: [] });

    const { removePlugin } = await import("../../../src/core/plugin.js");
    const result = await removePlugin("kastell-plugin-wordpress");
    expect(result.success).toBe(true);
    expect(mockedSpawn).toHaveBeenCalledWith(
      expect.stringContaining("npm uninstall kastell-plugin-wordpress --prefix"),
      [],
      expect.any(Object),
    );
    expect(mockedLoadPlugins).toHaveBeenCalled();
  });

  it("reports npm uninstall failure", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedSpawn.mockImplementation(() => createMockProcess(1, "npm ERR!"));

    const { removePlugin } = await import("../../../src/core/plugin.js");
    const result = await removePlugin("kastell-plugin-wordpress");
    expect(result.success).toBe(false);
    expect(result.error).toContain("npm uninstall failed");
  });
});