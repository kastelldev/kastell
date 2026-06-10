import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { clearPluginRegistry, getPluginRegistry } from "../../src/plugin/registry.js";

// Mock fs for directory scanning
jest.mock("fs", () => {
  const actual = jest.requireActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: jest.fn(),
    readdirSync: jest.fn(),
    readFileSync: jest.fn(),
  };
});

// Mock secureWrite
jest.mock("../../src/utils/secureWrite.js", () => ({
  secureWriteFileSync: jest.fn(),
  secureMkdirSync: jest.fn(),
}));

// Mock version for validateManifest
jest.mock("../../src/utils/version.js", () => ({
  KASTELL_VERSION: "2.2.0",
}));

import { existsSync, readdirSync, readFileSync } from "fs";
import { loadPlugins } from "../../src/plugin/loader.js";

function makeManifest(name = "kastell-plugin-test"): string {
  return JSON.stringify({
    name,
    version: "1.0.0",
    apiVersion: "2",
    kastell: ">=2.0.0",
    capabilities: ["audit"],
    checkPrefix: "TEST",
    entry: "index.js",
  });
}

function makeCheck(cmd: unknown): unknown {
  return {
    id: "TEST-001",
    name: "Test",
    category: "Test",
    severity: "info",
    description: "x",
    checkCommand: cmd,
  };
}

describe("plugin loader v2 contract", () => {
  beforeEach(() => {
    clearPluginRegistry();
    jest.resetAllMocks();
  });

  it("accepts mutating-looking command when kind declares mutation", async () => {
    (existsSync as jest.Mock).mockReturnValue(true);
    (readdirSync as jest.Mock).mockReturnValue([
      { name: "kastell-plugin-mutating", isDirectory: () => true },
    ]);
    (readFileSync as jest.Mock).mockReturnValue(makeManifest("kastell-plugin-mutating"));

    const mockImporter = jest.fn<(path: string) => Promise<unknown>>();
    mockImporter.mockResolvedValue({
      checks: [makeCheck({ kind: "mutate-local", cmd: "rm -rf /tmp/cache" })],
    });

    const result = await loadPlugins({ importer: mockImporter });
    expect(result.loaded).toContain("kastell-plugin-mutating");
    expect(result.errors).toHaveLength(0);
  });

  it("rejects legacy string checkCommand through validation", async () => {
    (existsSync as jest.Mock).mockReturnValue(true);
    (readdirSync as jest.Mock).mockReturnValue([
      { name: "kastell-plugin-legacy", isDirectory: () => true },
    ]);
    (readFileSync as jest.Mock).mockReturnValue(makeManifest("kastell-plugin-legacy"));

    const mockImporter = jest.fn<(path: string) => Promise<unknown>>();
    mockImporter.mockResolvedValue({
      checks: [makeCheck("echo legacy")],
    });

    const result = await loadPlugins({ importer: mockImporter });
    expect(result.loaded).toEqual([]);
    expect(result.errors[0]).toMatch(/check validation failed|Invalid plugin check/);
  });
});
