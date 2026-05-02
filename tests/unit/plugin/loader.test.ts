import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { clearPluginRegistry, getPluginRegistry } from "../../../src/plugin/registry.js";

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
jest.mock("../../../src/utils/secureWrite.js", () => ({
  secureWriteFileSync: jest.fn(),
  secureMkdirSync: jest.fn(),
}));

// Mock version for validateManifest
jest.mock("../../../src/utils/version.js", () => ({
  KASTELL_VERSION: "2.2.0",
}));

import { existsSync, readdirSync, readFileSync } from "fs";
import { loadPlugins } from "../../../src/plugin/loader.js";
import type { PluginCheck } from "../../../src/plugin/sdk/types.js";

const mockManifestJson = JSON.stringify({
  name: "kastell-plugin-test",
  version: "1.0.0",
  apiVersion: "1",
  kastell: ">=2.0.0",
  capabilities: ["audit"],
  checkPrefix: "TST",
  entry: "index.js",
});

const mockChecks: PluginCheck[] = [
  {
    id: "TST-EXAMPLE",
    name: "Test Example",
    category: "Test",
    severity: "info",
    description: "Test check",
    checkCommand: "echo test",
  },
];

describe("plugin/loader", () => {
  beforeEach(() => {
    clearPluginRegistry();
    jest.clearAllMocks();
  });

  it("returns empty result when plugins directory does not exist", async () => {
    (existsSync as jest.Mock).mockReturnValue(false);
    const result = await loadPlugins();
    expect(result.loaded).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("returns empty result when no kastell-plugin-* dirs found", async () => {
    (existsSync as jest.Mock).mockReturnValue(true);
    (readdirSync as jest.Mock).mockReturnValue([]);
    const result = await loadPlugins();
    expect(result.loaded).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("loads plugin with mock importer", async () => {
    (existsSync as jest.Mock).mockImplementation((p: unknown) => {
      if (String(p).includes("node_modules")) return true;
      if (String(p).includes("kastell-plugin.json")) return true;
      return false;
    });
    (readdirSync as jest.Mock).mockReturnValue([
      { name: "kastell-plugin-test", isDirectory: () => true },
    ]);
    (readFileSync as jest.Mock).mockReturnValue(mockManifestJson);

    const mockImporter = jest.fn<(path: string) => Promise<unknown>>();
    mockImporter.mockResolvedValue({ checks: mockChecks });

    const result = await loadPlugins({ importer: mockImporter });
    expect(result.loaded).toEqual(["kastell-plugin-test"]);
    expect(result.errors).toEqual([]);
    expect(getPluginRegistry().size).toBe(1);
    expect(mockImporter).toHaveBeenCalledWith(
      expect.stringContaining("index.js"),
    );
  });

  it("skips plugin with invalid manifest and continues", async () => {
    (existsSync as jest.Mock).mockReturnValue(true);
    (readdirSync as jest.Mock).mockReturnValue([
      { name: "kastell-plugin-bad", isDirectory: () => true },
      { name: "kastell-plugin-good", isDirectory: () => true },
    ]);
    (readFileSync as jest.Mock).mockImplementation((p: unknown) => {
      if (String(p).includes("bad")) return "{ invalid json }}}";
      return mockManifestJson.replace("kastell-plugin-test", "kastell-plugin-good");
    });

    const mockImporter = jest.fn<(path: string) => Promise<unknown>>();
    mockImporter.mockResolvedValue({ checks: mockChecks });

    const result = await loadPlugins({ importer: mockImporter });
    expect(result.loaded).toContain("kastell-plugin-good");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("kastell-plugin-bad");
  });

  it("handles import failure gracefully", async () => {
    (existsSync as jest.Mock).mockReturnValue(true);
    (readdirSync as jest.Mock).mockReturnValue([
      { name: "kastell-plugin-broken", isDirectory: () => true },
    ]);
    (readFileSync as jest.Mock).mockReturnValue(
      mockManifestJson.replace("kastell-plugin-test", "kastell-plugin-broken"),
    );

    const mockImporter = jest.fn<(path: string) => Promise<unknown>>();
    mockImporter.mockRejectedValue(new Error("Module not found"));

    const result = await loadPlugins({ importer: mockImporter });
    expect(result.loaded).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Module not found");
    const entry = getPluginRegistry().get("kastell-plugin-broken");
    expect(entry?.status).toBe("failed");
  });

  it("rejects plugin with checkPrefix mismatch", async () => {
    (existsSync as jest.Mock).mockReturnValue(true);
    (readdirSync as jest.Mock).mockReturnValue([
      { name: "kastell-plugin-bad-prefix", isDirectory: () => true },
    ]);
    (readFileSync as jest.Mock).mockReturnValue(
      mockManifestJson.replace("kastell-plugin-test", "kastell-plugin-bad-prefix"),
    );

    const badChecks: PluginCheck[] = [
      { ...mockChecks[0], id: "WRONG-PREFIX-CHECK" },
    ];
    const mockImporter = jest.fn<(path: string) => Promise<unknown>>();
    mockImporter.mockResolvedValue({ checks: badChecks });

    const result = await loadPlugins({ importer: mockImporter });
    expect(result.loaded).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("must start with");
  });

  it("registers plugin as failed when manifest JSON is invalid", async () => {
    (existsSync as jest.Mock).mockReturnValue(true);
    (readdirSync as jest.Mock).mockReturnValue([
      { name: "kastell-plugin-badjson", isDirectory: () => true },
    ]);
    (readFileSync as jest.Mock).mockReturnValue("{ invalid json");

    const mockImporter = jest.fn<(path: string) => Promise<unknown>>();
    const result = await loadPlugins({ importer: mockImporter });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("invalid JSON");

    const entry = getPluginRegistry().get("kastell-plugin-badjson");
    expect(entry).toBeDefined();
    expect(entry!.status).toBe("failed");
    expect(entry!.reason).toContain("invalid JSON");
  });

  it("registers plugin as failed when manifest file is missing", async () => {
    (existsSync as jest.Mock).mockReturnValue(true);
    (readdirSync as jest.Mock).mockReturnValue([
      { name: "kastell-plugin-nomanifest", isDirectory: () => true },
    ]);
    (readFileSync as jest.Mock).mockImplementation(() => {
      throw new Error("ENOENT: no such file");
    });

    const mockImporter = jest.fn<(path: string) => Promise<unknown>>();
    const result = await loadPlugins({ importer: mockImporter });
    expect(result.errors).toHaveLength(1);

    const entry = getPluginRegistry().get("kastell-plugin-nomanifest");
    expect(entry).toBeDefined();
    expect(entry!.status).toBe("failed");
    expect(entry!.reason).toContain("cannot read");
  });

  it("converts path to file URL for ESM import", async () => {
    (existsSync as jest.Mock).mockReturnValue(true);
    (readdirSync as jest.Mock).mockReturnValue([
      { name: "kastell-plugin-test", isDirectory: () => true },
    ]);
    (readFileSync as jest.Mock).mockReturnValue(mockManifestJson);

    const mockImporter = jest.fn<(path: string) => Promise<unknown>>();
    mockImporter.mockResolvedValue({ checks: mockChecks });

    await loadPlugins({ importer: mockImporter });
    const calledPath = mockImporter.mock.calls[0]?.[0] ?? "";
    expect(calledPath).toMatch(/^file:\/\//);
  });
});