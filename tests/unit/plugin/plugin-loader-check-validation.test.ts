jest.mock("../../../src/utils/version.js", () => ({
  KASTELL_VERSION: "2.2.0",
}));

import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { clearPluginRegistry, getPluginRegistry } from "../../../src/plugin/registry.js";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("loadPlugins — check validation", () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kastell-plugin-test-"));
    originalEnv = process.env.KASTELL_DIR;
    process.env.KASTELL_DIR = tmpDir;
    clearPluginRegistry();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.KASTELL_DIR;
    else process.env.KASTELL_DIR = originalEnv;
    jest.resetModules();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("marks plugin failed when check id has shell metachar", async () => {
    // Mock the filesystem functions that loader uses
    const mockExistsSync = jest.fn();
    const mockReaddirSync = jest.fn();
    const mockReadFileSync = jest.fn();

    jest.doMock("fs", () => ({
      existsSync: mockExistsSync,
      readdirSync: mockReaddirSync,
      readFileSync: mockReadFileSync,
      default: {
        existsSync: mockExistsSync,
        readdirSync: mockReaddirSync,
        readFileSync: mockReadFileSync,
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
        return JSON.stringify({ name: "kastell-plugin-badid", version: "1.0.0", apiVersion: "1", kastell: "*", capabilities: ["audit"], checkPrefix: "BAD", entry: "./index.js" });
      }
      return `module.exports = { checks: ${JSON.stringify([{ id: "BAD;rm", category: "X", name: "n", severity: "info", checkCommand: "echo x" }])} };`;
    });

    const { loadPlugins } = await import("../../../src/plugin/loader.js");
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
        return JSON.stringify({ name: "kastell-plugin-noarray", version: "1.0.0", apiVersion: "1", kastell: "*", capabilities: ["audit"], checkPrefix: "NA", entry: "./index.js" });
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
});