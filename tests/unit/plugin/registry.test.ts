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
import { registerPlugin, clearPluginRegistry, getPluginRegistry, loadPluginCache, savePluginCache, deletePlugin, mapRegistryPlugins, getPluginCommands, getPluginMcpTools, registerFailedPlugin, registerDisabledPlugin, PLUGIN_STATUS_LOADED, PLUGIN_STATUS_FAILED, PLUGIN_STATUS_DISABLED, toPluginCacheEntry } from "../../../src/plugin/registry.js";
import { toFailedPluginDescriptor } from "../../../src/plugin/failedDescriptor.js";
import type { PluginManifest, LoadedPluginCheck, PluginCapability } from "../../../src/plugin/sdk/types.js";

const mockManifest: PluginManifest = {
  name: "kastell-plugin-wordpress",
  version: "1.0.0",
  apiVersion: "2",
  kastell: ">=2.1.0",
  capabilities: ["audit"] as PluginCapability[],
  checkPrefix: "WP",
  entry: "index.js",
};

const mockChecks: LoadedPluginCheck[] = [
  {
    id: "WP-ADMIN-URL",
    name: "WordPress Admin URL",
    category: "WordPress",
    severity: "warning",
    description: "Check if wp-admin is publicly accessible",
    sourceApiVersion: "2",
    read: { cmd: "curl -s -o /dev/null -w '%{http_code}' http://localhost/wp-admin" },
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
      const loaded = entry as Extract<typeof entry, { status: "loaded" }>;
      expect(loaded.checks).toHaveLength(1);
      expect(loaded.manifest.checkPrefix).toBe("WP");
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
      const badChecks: LoadedPluginCheck[] = [
        { ...mockChecks[0], id: "XX-WRONG-PREFIX" },
      ];
      expect(() => registerPlugin(mockManifest, badChecks)).toThrow(
        /must start with "WP-"/,
      );
    });

    it("rejects check ID colliding with another plugin (prefix-uniqueness guard)", () => {
      // A colliding check id can only happen when the prefix check fires
      // first — the prefix check is the actual enforcement layer.
      registerPlugin(mockManifest, mockChecks);
      const otherManifest = {
        ...mockManifest,
        name: "kastell-plugin-other",
        checkPrefix: "OT",
      };
      const collidingChecks: LoadedPluginCheck[] = [
        { ...mockChecks[0], id: "WP-ADMIN-URL" },
      ];
      expect(() => registerPlugin(otherManifest, collidingChecks)).toThrow(
        /must start with "OT-"/,
      );
      expect(getPluginRegistry().size).toBe(1);
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
      const otherChecks: LoadedPluginCheck[] = [
        { ...mockChecks[0], id: "OT-ADMIN-URL" },
        { ...mockChecks[0], id: "OT-OTHER-CHECK", name: "Other", read: { cmd: "echo test" } },
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

  describe("registry capability fields", () => {
    const manifestWithFields: PluginManifest = {
      name: "kastell-plugin-wp",
      version: "1.0.0",
      apiVersion: "2",
      kastell: ">=2.0.0",
      capabilities: ["audit", "command", "fix"] as PluginCapability[],
      checkPrefix: "WP",
      entry: "./index.js",
      commands: [{ name: "scan", description: "Scan WP", handler: "./cmd/scan.js" }],
      fixes: [{ checkId: "WP-001", tier: "SAFE", handler: "./fixes/001.js" }],
    };

    beforeEach(() => clearPluginRegistry());

    it("stores commands from manifest", () => {
      registerPlugin(manifestWithFields, []);
      const entry = getPluginRegistry().get("kastell-plugin-wp");
      if (entry && entry.status === "loaded") {
        expect(entry.commands?.length).toBeGreaterThan(0);
        expect(entry.commands![0].name).toBe("scan");
      }
    });

    it("stores fixes from manifest", () => {
      registerPlugin(manifestWithFields, []);
      const entry = getPluginRegistry().get("kastell-plugin-wp");
      if (entry && entry.status === "loaded") {
        expect(entry.manifest.fixes).toHaveLength(1);
        expect(entry.manifest.fixes![0].checkId).toBe("WP-001");
      }
    });

    it("stores mcpTools from manifest", () => {
      const m: PluginManifest = { ...manifestWithFields, capabilities: ["audit", "mcp-tool"] as PluginCapability[], mcpTools: [{ name: "analyze", description: "Analyze", handler: "./mcp/a.js" }] };
      registerPlugin(m, []);
      const entry = getPluginRegistry().get("kastell-plugin-wp");
      if (entry && entry.status === "loaded") {
        expect(entry.mcpTools).toHaveLength(1);
      }
    });

    it("omits optional fields when not in manifest", () => {
      const m: PluginManifest = { ...mockManifest, capabilities: ["audit"] as PluginCapability[], commands: undefined, fixes: undefined };
      registerPlugin(m, []);
      const entry = getPluginRegistry().get("kastell-plugin-wordpress");
      if (entry && entry.status === "loaded") {
        expect(entry.commands).toBeUndefined();
        expect(entry.manifest.fixes).toBeUndefined();
        expect(entry.mcpTools).toBeUndefined();
      }
    });
  });

  describe("LoadedPluginCheck index population (T4)", () => {
    it("populates readChecks for v2 read-only checks and leaves activeProbesByCheckId empty", () => {
      const v2Manifest: PluginManifest = {
        name: "kastell-plugin-v2read",
        version: "1.0.0",
        apiVersion: "2",
        kastell: ">=2.0.0",
        capabilities: ["audit"] as PluginCapability[],
        checkPrefix: "V2R",
        entry: "./index.js",
      };
      const v2Checks: LoadedPluginCheck[] = [
        {
          id: "V2R-ONE",
          name: "One",
          category: "Cat",
          severity: "info",
          description: "d",
          sourceApiVersion: "2",
          read: { cmd: "echo a" },
        },
        {
          id: "V2R-TWO",
          name: "Two",
          category: "Cat",
          severity: "info",
          description: "d",
          sourceApiVersion: "2",
          read: { cmd: "echo b" },
        },
      ];
      registerPlugin(v2Manifest, v2Checks);
      const entry = getPluginRegistry().get("kastell-plugin-v2read");
      if (!entry || entry.status !== "loaded") {
        throw new Error("expected loaded v2 entry");
      }
      expect(entry.checks.map((c) => c.id)).toEqual(["V2R-ONE", "V2R-TWO"]);
      expect(entry.readChecks.map((c) => c.id)).toEqual(["V2R-ONE", "V2R-TWO"]);
      expect(entry.readChecks[0].read.cmd).toBe("echo a");
      expect(entry.activeProbesByCheckId.size).toBe(0);
    });

    it("populates activeProbesByCheckId when probe modules are passed in", () => {
      const v3Manifest: PluginManifest = {
        name: "kastell-plugin-v3probe",
        version: "1.0.0",
        apiVersion: "3",
        kastell: ">=2.0.0",
        capabilities: ["audit"] as PluginCapability[],
        checkPrefix: "V3P",
        entry: "./index.js",
      };
      const v3Checks: LoadedPluginCheck[] = [
        {
          id: "V3P-SSH",
          name: "SSH probe",
          category: "Cat",
          severity: "warning",
          description: "d",
          sourceApiVersion: "3",
          activeProbe: { handler: "./dist/probes/ssh.js", risk: "medium", timeoutMs: 30_000 },
        },
      ];
      const probeModule = {
        prepare: jest.fn(),
        execute: jest.fn(),
        verify: jest.fn(),
        rollback: jest.fn(),
        absolutePath: "/tmp/dist/probes/ssh.js",
        sha256: "0".repeat(64),
      };
      const probeMap = new Map([["V3P-SSH", probeModule]]);
      registerPlugin(v3Manifest, v3Checks, probeMap);
      const entry = getPluginRegistry().get("kastell-plugin-v3probe");
      if (!entry || entry.status !== "loaded") {
        throw new Error("expected loaded v3 entry");
      }
      expect(entry.activeProbesByCheckId.get("V3P-SSH")).toMatchObject({
        definition: {
          handler: "./dist/probes/ssh.js",
          risk: "medium",
          timeoutMs: 30_000,
        },
        module: { absolutePath: "/tmp/dist/probes/ssh.js", sha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
      });
    });

    it("throws when a check has activeProbe but no validated module is passed in", () => {
      const manifest: PluginManifest = {
        name: "kastell-plugin-missing-module",
        version: "1.0.0",
        apiVersion: "3",
        kastell: ">=2.0.0",
        capabilities: ["audit"] as PluginCapability[],
        checkPrefix: "MM",
        entry: "./index.js",
      };
      const checks: LoadedPluginCheck[] = [
        {
          id: "MM-001",
          name: "n",
          category: "c",
          severity: "info",
          description: "d",
          sourceApiVersion: "3",
          activeProbe: { handler: "./p.js", risk: "low", timeoutMs: 10_000 },
        },
      ];
      expect(() => registerPlugin(manifest, checks)).toThrow(
        /Validated Active Probe module missing for MM-001/,
      );
    });

    it("combines readChecks and activeProbesByCheckId for a v3 combined check", () => {
      const manifest: PluginManifest = {
        name: "kastell-plugin-v3combo",
        version: "1.0.0",
        apiVersion: "3",
        kastell: ">=2.0.0",
        capabilities: ["audit"] as PluginCapability[],
        checkPrefix: "V3C",
        entry: "./index.js",
      };
      const checks: LoadedPluginCheck[] = [
        {
          id: "V3C-BOTH",
          name: "Combined",
          category: "Cat",
          severity: "critical",
          description: "d",
          sourceApiVersion: "3",
          read: { cmd: "echo x" },
          activeProbe: { handler: "./p.js", risk: "high", timeoutMs: 60_000 },
        },
      ];
      const probeModule = {
        prepare: jest.fn(),
        execute: jest.fn(),
        verify: jest.fn(),
        rollback: jest.fn(),
        absolutePath: "/p.js",
        sha256: "a".repeat(64),
      };
      registerPlugin(manifest, checks, new Map([["V3C-BOTH", probeModule]]));
      const entry = getPluginRegistry().get("kastell-plugin-v3combo");
      if (!entry || entry.status !== "loaded") {
        throw new Error("expected loaded combo entry");
      }
      expect(entry.checks.map((c) => c.id)).toEqual(["V3C-BOTH"]);
      expect(entry.readChecks.map((c) => c.id)).toEqual(["V3C-BOTH"]);
      expect(entry.activeProbesByCheckId.size).toBe(1);
      expect(entry.activeProbesByCheckId.has("V3C-BOTH")).toBe(true);
    });

    it("failed entries expose empty readChecks and activeProbesByCheckId", () => {
      registerFailedPlugin(
        toFailedPluginDescriptor("kastell-plugin-failed", {
          name: "kastell-plugin-failed",
          version: "1.0.0",
          apiVersion: "2",
          kastell: ">=2.0.0",
          capabilities: ["audit"],
          checkPrefix: "F",
          entry: "./index.js",
        }),
        "boom",
      );
      const entry = getPluginRegistry().get("kastell-plugin-failed");
      if (!entry || entry.status !== "failed") {
        throw new Error("expected failed entry");
      }
      expect(entry.checks).toEqual([]);
      expect(entry.readChecks).toEqual([]);
      expect(entry.activeProbesByCheckId.size).toBe(0);
    });

    it("disabled entries expose empty readChecks and activeProbesByCheckId", () => {
      registerDisabledPlugin({
        name: "kastell-plugin-off",
        version: "1.0.0",
        apiVersion: "2",
        kastell: ">=2.0.0",
        capabilities: ["audit"] as PluginCapability[],
        checkPrefix: "OFF",
        entry: "./index.js",
      });
      const entry = getPluginRegistry().get("kastell-plugin-off");
      if (!entry || entry.status !== "disabled") {
        throw new Error("expected disabled entry");
      }
      expect(entry.checks).toEqual([]);
      expect(entry.readChecks).toEqual([]);
      expect(entry.activeProbesByCheckId.size).toBe(0);
    });
  });
});

describe("getPluginCommands", () => {
  beforeEach(() => clearPluginRegistry());

  it("returns empty array when no plugins have commands", () => {
    registerPlugin(
      { ...mockManifest, capabilities: ["audit"] as PluginCapability[] },
      mockChecks,
    );
    expect(getPluginCommands()).toEqual([]);
  });

  it("returns commands with plugin short name", () => {
    const manifestWithCmd = {
      ...mockManifest,
      name: "kastell-plugin-auditor",
      capabilities: ["audit", "command"] as PluginCapability[],
      commands: [{ name: "scan", description: "Run scan", handler: "./scan.js" }],
    };
    registerPlugin(manifestWithCmd, mockChecks);
    const cmds = getPluginCommands();
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toEqual({
      pluginShortName: "auditor",
      command: { name: "scan", description: "Run scan", handler: "./scan.js" },
      pluginDir: expect.any(String),
    });
  });

  it("skips failed plugins", () => {
    registerFailedPlugin(toFailedPluginDescriptor(mockManifest.name, mockManifest), "load error");
    expect(getPluginCommands()).toEqual([]);
  });
});

describe("getPluginMcpTools", () => {
  beforeEach(() => clearPluginRegistry());

  it("returns empty array when no plugins have mcpTools", () => {
    registerPlugin(
      { ...mockManifest, capabilities: ["audit"] as PluginCapability[] },
      mockChecks,
    );
    expect(getPluginMcpTools()).toEqual([]);
  });

  it("returns mcpTools with plugin short name", () => {
    const manifestWithTool = {
      ...mockManifest,
      name: "kastell-plugin-auditor",
      capabilities: ["audit", "mcp-tool"] as PluginCapability[],
      mcpTools: [{ name: "analyze", description: "Run analysis", handler: "./mcp/analyze.js" }],
    };
    registerPlugin(manifestWithTool, mockChecks);
    const tools = getPluginMcpTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]).toEqual({
      pluginShortName: "auditor",
      toolName: "server_plugin_auditor_analyze",
      tool: { name: "analyze", description: "Run analysis", handler: "./mcp/analyze.js" },
      pluginDir: expect.any(String),
    });
  });

  it("skips failed plugins", () => {
    registerFailedPlugin(toFailedPluginDescriptor(mockManifest.name, mockManifest), "load error");
    expect(getPluginMcpTools()).toEqual([]);
  });
});

describe("registerDisabledPlugin", () => {
  it("creates a disabled entry with empty checks", () => {
    registerDisabledPlugin(mockManifest);
    const entry = getPluginRegistry().get("kastell-plugin-wordpress");
    expect(entry).toBeDefined();
    expect(entry!.status).toBe("disabled");
    expect(entry!.checks).toEqual([]);
  });
});

describe("loadPluginCache strict metadata schema", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("drops invalid cache entries and executable fields", () => {
    (existsSync as jest.Mock).mockReturnValue(true);
    (readFileSync as jest.Mock).mockReturnValue(JSON.stringify([
      {
        name: "kastell-plugin-safe",
        version: "1.0.0",
        apiVersion: "3",
        kastell: ">=2.3.1",
        capabilities: ["audit"],
        checkPrefix: "SAFE",
        entry: "./index.js",
        checks: [{ id: "SHOULD-NOT-CACHE" }],
      },
      { name: "../../escape", apiVersion: "3" },
    ]));
    expect(loadPluginCache()).toEqual([{
      name: "kastell-plugin-safe",
      version: "1.0.0",
      apiVersion: "3",
      kastell: ">=2.3.1",
      capabilities: ["audit"],
      checkPrefix: "SAFE",
      entry: "./index.js",
    }]);
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
    it("writes cache entries with secureWriteFileSync", () => {
      const entry = toPluginCacheEntry(mockManifest);
      savePluginCache([entry]);
      expect(secureMkdirSync).toHaveBeenCalled();
      expect(secureWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining("plugin-manifests.json"),
        JSON.stringify([entry], null, 2),
      );
    });
  });
});

describe("PLUGIN_STATUS_* constants (CQS-08)", () => {
  it("PLUGIN_STATUS_LOADED has literal value 'loaded'", () => {
    expect(PLUGIN_STATUS_LOADED).toBe("loaded");
  });
  it("PLUGIN_STATUS_FAILED has literal value 'failed'", () => {
    expect(PLUGIN_STATUS_FAILED).toBe("failed");
  });
  it("PLUGIN_STATUS_DISABLED has literal value 'disabled'", () => {
    expect(PLUGIN_STATUS_DISABLED).toBe("disabled");
  });
});
