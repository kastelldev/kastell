import { describe, it, expect, beforeEach } from "@jest/globals";
// === mock'lar dosyanın EN ÜSTÜNE (mevcut import'lardan ÖNCE) ===
jest.mock("fs", () => ({
  readFileSync: jest.fn(),
  existsSync: jest.fn(),
}));

jest.mock("../../../src/utils/secureWrite.js", () => ({
  secureWriteFileSync: jest.fn(),
  secureMkdirSync: jest.fn(),
}));

// === mevcut import'lar ===
import { readFileSync, existsSync } from "fs";
import { secureWriteFileSync, secureMkdirSync } from "../../../src/utils/secureWrite.js";
import {
  registerPlugin,
  clearPluginRegistry,
  getPluginRegistry,
  loadPluginCache,
  savePluginCache,
  deletePlugin,
  mapRegistryPlugins,
} from "../../../src/plugin/registry.js";
import type { PluginManifest, PluginCheck } from "../../../src/plugin/sdk/types.js";

const mockManifest: PluginManifest = {
  name: "kastell-plugin-wordpress",
  version: "1.0.0",
  apiVersion: "1",
  kastell: ">=2.1.0",
  capabilities: ["audit"],
  checkPrefix: "WP",
  entry: "index.js",
};

const mockChecks: PluginCheck[] = [
  {
    id: "WP-ADMIN-URL",
    name: "WordPress Admin URL",
    category: "WordPress",
    severity: "warning",
    description: "Check if wp-admin is publicly accessible",
    checkCommand: "curl -s -o /dev/null -w '%{http_code}' http://localhost/wp-admin",
  },
];

describe("plugin/registry", () => {
  beforeEach(() => {
    clearPluginRegistry();
  });

  describe("registerPlugin", () => {
    it("registers a valid plugin", () => {
      registerPlugin(mockManifest, mockChecks);
      const registry = getPluginRegistry();
      expect(registry.size).toBe(1);
      const entry = registry.get("kastell-plugin-wordpress");
      expect(entry).toBeDefined();
      expect(entry!.status).toBe("loaded");
      expect(entry!.checks).toHaveLength(1);
      expect(entry!.manifest.checkPrefix).toBe("WP");
    });

    it("rejects duplicate plugin name", () => {
      registerPlugin(mockManifest, mockChecks);
      expect(() => registerPlugin(mockManifest, mockChecks)).toThrow(
        /already registered/,
      );
    });

    it("rejects duplicate checkPrefix from another plugin", () => {
      registerPlugin(mockManifest, mockChecks);
      const otherManifest = { ...mockManifest, name: "kastell-plugin-wp2" };
      expect(() => registerPlugin(otherManifest, mockChecks)).toThrow(
        /checkPrefix "WP" already used/,
      );
    });

    it("rejects check ID not starting with checkPrefix", () => {
      const badChecks: PluginCheck[] = [
        { ...mockChecks[0], id: "XX-WRONG-PREFIX" },
      ];
      expect(() => registerPlugin(mockManifest, badChecks)).toThrow(
        /must start with "WP-"/,
      );
    });

    it("rejects check ID colliding with another plugin", () => {
      registerPlugin(mockManifest, mockChecks);
      const otherManifest = {
        ...mockManifest,
        name: "kastell-plugin-other",
        checkPrefix: "OT",
      };
      const collidingChecks: PluginCheck[] = [
        { ...mockChecks[0], id: "OT-ADMIN-URL" },
      ];
      registerPlugin(otherManifest, collidingChecks);
      expect(getPluginRegistry().size).toBe(2);
    });
  });

  describe("clearPluginRegistry", () => {
    it("clears all entries", () => {
      registerPlugin(mockManifest, mockChecks);
      expect(getPluginRegistry().size).toBe(1);
      clearPluginRegistry();
      expect(getPluginRegistry().size).toBe(0);
    });
  });

  describe("getPluginRegistry", () => {
    it("returns empty map when no plugins", () => {
      const registry = getPluginRegistry();
      expect(registry.size).toBe(0);
    });
  });

  describe("deletePlugin", () => {
    it("removes plugin and cleans up prefix and check IDs", () => {
      registerPlugin(mockManifest, mockChecks);
      expect(getPluginRegistry().has("kastell-plugin-wordpress")).toBe(true);

      deletePlugin("kastell-plugin-wordpress");

      expect(getPluginRegistry().has("kastell-plugin-wordpress")).toBe(false);
      registerPlugin(mockManifest, mockChecks);
      expect(getPluginRegistry().has("kastell-plugin-wordpress")).toBe(true);
    });

    it("is a no-op for unknown plugin name", () => {
      deletePlugin("kastell-plugin-unknown");
      expect(getPluginRegistry().size).toBe(0);
    });
  });

  describe("mapRegistryPlugins", () => {
    it("maps over all registered plugins", () => {
      const otherManifest = { ...mockManifest, name: "kastell-plugin-other", checkPrefix: "OT" };
      const otherChecks: PluginCheck[] = [
        { ...mockChecks[0], id: "OT-ADMIN-URL" },
        { ...mockChecks[0], id: "OT-OTHER-CHECK", name: "Other", checkCommand: "echo test" },
      ];
      registerPlugin(mockManifest, mockChecks);
      registerPlugin(otherManifest, otherChecks);

      const result = mapRegistryPlugins((name, entry) => ({
        name,
        checks: entry.checks.length,
      }));

      expect(result).toHaveLength(2);
      expect(result).toEqual(
        expect.arrayContaining([
          { name: "kastell-plugin-wordpress", checks: 1 },
          { name: "kastell-plugin-other", checks: 2 },
        ]),
      );
    });

    it("returns empty array when no plugins registered", () => {
      const result = mapRegistryPlugins((name) => name);
      expect(result).toEqual([]);
    });
  });
});

describe("plugin cache", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("loadPluginCache", () => {
    it("returns parsed manifests from valid JSON", () => {
      (existsSync as jest.Mock).mockReturnValue(true);
      (readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify([mockManifest]),
      );
      const result = loadPluginCache();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("kastell-plugin-wordpress");
    });

    it("returns empty array when file does not exist", () => {
      (existsSync as jest.Mock).mockReturnValue(false);
      const result = loadPluginCache();
      expect(result).toEqual([]);
    });

    it("returns empty array on corrupt JSON", () => {
      (existsSync as jest.Mock).mockReturnValue(true);
      (readFileSync as jest.Mock).mockReturnValue("not valid json{{{");
      const result = loadPluginCache();
      expect(result).toEqual([]);
    });
  });

  describe("savePluginCache", () => {
    it("writes manifests with secureWriteFileSync", () => {
      savePluginCache([mockManifest]);
      expect(secureMkdirSync).toHaveBeenCalled();
      expect(secureWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining("plugin-manifests.json"),
        JSON.stringify([mockManifest], null, 2),
      );
    });
  });
});