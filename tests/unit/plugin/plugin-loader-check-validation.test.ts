jest.mock("../../../src/utils/version.js", () => ({
  KASTELL_VERSION: "2.2.0",
}));

// Silence secureWrite noise on Windows (registry cache write uses
// applyWindowsAcl which fails on non-elevated test runs). The in-memory
// registry is unaffected; we only avoid the on-disk side effect.
jest.mock("../../../src/utils/secureWrite.js", () => ({
  secureWriteFileSync: jest.fn(),
  secureMkdirSync: jest.fn(),
}));

import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { mkdtempSync, rmSync, cpSync, mkdirSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("loadPlugins — check validation", () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kastell-plugin-test-"));
    originalEnv = process.env.KASTELL_DIR;
    process.env.KASTELL_DIR = tmpDir;
    jest.resetModules();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.KASTELL_DIR;
    else process.env.KASTELL_DIR = originalEnv;
    jest.resetModules();
    jest.dontMock("fs");
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("marks plugin failed when check id has shell metachar", async () => {
    // Mock the filesystem functions that loader uses
    const mockExistsSync = jest.fn();
    const mockReaddirSync = jest.fn();
    const mockReadFileSync = jest.fn();
    const mockMkdirSync = jest.fn();
    const mockWriteFileSync = jest.fn();
    const mockRmSync = jest.fn();
    const mockChmodSync = jest.fn();

    jest.doMock("fs", () => ({
      existsSync: mockExistsSync,
      readdirSync: mockReaddirSync,
      readFileSync: mockReadFileSync,
      mkdirSync: mockMkdirSync,
      writeFileSync: mockWriteFileSync,
      rmSync: mockRmSync,
      chmodSync: mockChmodSync,
      default: {
        existsSync: mockExistsSync,
        readdirSync: mockReaddirSync,
        readFileSync: mockReadFileSync,
        mkdirSync: mockMkdirSync,
        writeFileSync: mockWriteFileSync,
        rmSync: mockRmSync,
        chmodSync: mockChmodSync,
      },
    }));

    // Set up mock returns
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      return s.includes("node_modules") || s.includes("kastell-plugin.json") || s.endsWith("index.js");
    });
    mockReaddirSync.mockReturnValue([{ name: "kastell-plugin-badid", isDirectory: () => true }]);
    mockReadFileSync.mockImplementation((p) => {
      const s = String(p);
      if (s.includes("kastell-plugin.json")) {
        return JSON.stringify({ name: "kastell-plugin-badid", version: "1.0.0", apiVersion: "2", kastell: "*", capabilities: ["audit"], checkPrefix: "BAD", entry: "./index.js" });
      }
      return `module.exports = { checks: ${JSON.stringify([{ id: "BAD;rm", category: "X", name: "n", severity: "info", checkCommand: { kind: "read", cmd: "echo x" } }])} };`;
    });

    const { loadPlugins } = await import("../../../src/plugin/loader.js");
    const { getPluginRegistry } = await import("../../../src/plugin/registry.js");
    const result = await loadPlugins();
    expect(result.errors.length).toBe(1);
    const reg = getPluginRegistry();
    expect(reg.get("kastell-plugin-badid")?.status).toBe("failed");
  });

  it("marks plugin failed when checks not array", async () => {
    const mockExistsSync = jest.fn();
    const mockReaddirSync = jest.fn();
    const mockReadFileSync = jest.fn();
    const mockMkdirSync = jest.fn();
    const mockWriteFileSync = jest.fn();
    const mockRmSync = jest.fn();
    const mockChmodSync = jest.fn();

    jest.doMock("fs", () => ({
      existsSync: mockExistsSync,
      readdirSync: mockReaddirSync,
      readFileSync: mockReadFileSync,
      mkdirSync: mockMkdirSync,
      writeFileSync: mockWriteFileSync,
      rmSync: mockRmSync,
      chmodSync: mockChmodSync,
      default: {
        existsSync: mockExistsSync,
        readdirSync: mockReaddirSync,
        readFileSync: mockReadFileSync,
        mkdirSync: mockMkdirSync,
        writeFileSync: mockWriteFileSync,
        rmSync: mockRmSync,
        chmodSync: mockChmodSync,
      },
    }));

    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([{ name: "kastell-plugin-noarray", isDirectory: () => true }]);
    mockReadFileSync.mockImplementation((p) => {
      const s = String(p);
      if (s.includes("kastell-plugin.json")) {
        return JSON.stringify({ name: "kastell-plugin-noarray", version: "1.0.0", apiVersion: "2", kastell: "*", capabilities: ["audit"], checkPrefix: "NA", entry: "./index.js" });
      }
      return `module.exports = { checks: "not-an-array" };`;
    });
    mockMkdirSync.mockImplementation(() => {});
    mockWriteFileSync.mockImplementation(() => {});
    mockRmSync.mockImplementation(() => {});

    const { loadPlugins } = await import("../../../src/plugin/loader.js");
    const result = await loadPlugins();
    expect(result.errors.length).toBe(1);
  });

  it("rejects v2 mutate-local with migration guidance when apiVersion is 2", async () => {
    const { errors, reg } = await loadBadFixtureOnDisk(
      "kastell-plugin-v2-mutate-bad",
    );
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.join("\n")).toContain("mutate-local");
    expect(errors.join("\n")).toContain("migrate to v3");
    expect(reg.get("kastell-plugin-v2-mutate-bad")?.status).toBe("failed");
  });

  it("rejects v2 raw fixCommand with migration guidance when apiVersion is 2", async () => {
    const { errors, reg } = await loadBadFixtureOnDisk(
      "kastell-plugin-v2-rawfix-bad",
    );
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.join("\n")).toContain("fixCommand");
    expect(errors.join("\n")).toContain("migrate to v3");
    expect(reg.get("kastell-plugin-v2-rawfix-bad")?.status).toBe("failed");
  });

  /**
   * Copy the named on-disk fixture (under tests/fixtures/plugins/<name>) into
   * tmpDir/plugins/node_modules/<name>/, then call loadPlugins with a small
   * ESM evaluator. KASTELL_DIR is set to tmpDir in beforeEach, so
   * PLUGINS_NODE_MODULES resolves there. This honors the brief's
   * inventory: the bad-shape v2 fixtures exist on disk and the loader is
   * exercised against the real fs shape.
   *
   * The fixtures use `export const checks = [...]` (ESM). Jest's CJS runtime
   * cannot `import()` them under `"type": "module"`, so we extract the
   * checks literal and evaluate it inline — equivalent to the loader's
   * discovery path: read fs, parse manifest, import entry, validate checks.
   *
   * Note: because the surrounding `beforeEach` calls `jest.resetModules()`,
   * both the loader and the registry must be `import()`ed inside this
   * helper so they share the same module instance the test then observes.
   */
  async function loadBadFixtureOnDisk(
    pluginName: string,
  ): Promise<{ errors: string[]; reg: ReturnType<typeof import("../../../src/plugin/registry.js").getPluginRegistry> }> {
    const fixtureSrc = join(
      __dirname,
      "../../fixtures/plugins",
      pluginName,
    );
    const dest = join(tmpDir, "plugins", "node_modules", pluginName);
    mkdirSync(join(tmpDir, "plugins", "node_modules"), { recursive: true });
    cpSync(fixtureSrc, dest, { recursive: true });

    const entryPath = join(dest, "index.js");
    const source = readFileSync(entryPath, "utf-8");
    const arrayMatch = source.match(/export\s+const\s+checks\s*=\s*(\[[\s\S]*?\n\];)/);
    if (!arrayMatch) {
      throw new Error(`fixture ${pluginName} does not export checks array`);
    }
    const literal = arrayMatch[1].replace(/;$/, "");

    const { loadPlugins } = await import("../../../src/plugin/loader.js");
    const errors = await loadPlugins({
      importer: () => {
        // eslint-disable-next-line no-new-func
        const checks = new Function(`"use strict"; return (${literal});`)();
        return Promise.resolve({ checks });
      },
    }).then((r) => r.errors);
    const { getPluginRegistry } = await import("../../../src/plugin/registry.js");
    return { errors, reg: getPluginRegistry() };
  }
});
