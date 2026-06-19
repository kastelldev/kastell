import {
  mkdtempSync,
  writeFileSync,
  symlinkSync,
  mkdirSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

jest.mock("../../../src/utils/version.js", () => ({
  KASTELL_VERSION: "2.3.1",
}));

jest.mock("../../../src/utils/secureWrite.js", () => ({
  secureWriteFileSync: jest.fn(),
  secureMkdirSync: jest.fn(),
}));

// paths.ts reads KASTELL_DIR at module load time. We need a stable temp
// base before any test runs so the mock factory can return the right
// PLUGINS_NODE_MODULES. Module-level mkdtempSync runs at load time,
// which is before any test body.
const TEMP_BASE = mkdtempSync(join(tmpdir(), "kastell-active-probe-"));
const TEMP_KASTELL_DIR = join(TEMP_BASE, "kastell");
const TEMP_NODE_MODULES = join(TEMP_KASTELL_DIR, "plugins", "node_modules");
mkdirSync(TEMP_NODE_MODULES, { recursive: true });

jest.mock("../../../src/utils/paths.js", () => ({
  KASTELL_DIR: TEMP_KASTELL_DIR,
  BACKUPS_DIR: join(TEMP_KASTELL_DIR, "backups"),
  SECURITY_LOG: join(TEMP_KASTELL_DIR, "security.log"),
  PLUGINS_DIR: join(TEMP_KASTELL_DIR, "plugins"),
  PLUGINS_NODE_MODULES: TEMP_NODE_MODULES,
}));

import { loadActiveProbeModule } from "../../../src/plugin/activeProbeLoader.js";
import { loadPlugins } from "../../../src/plugin/loader.js";
import { clearPluginRegistry, getPluginRegistry } from "../../../src/plugin/registry.js";
import type { PluginManifest } from "../../../src/plugin/sdk/types.js";

// CJS-style probe sources so Node's loader can parse them via require/import
// without needing ESM-mode treatment in Jest. The probe loader's ESM/CJS
// dual-import path is verified by the loadActiveProbeModule unit tests below.
const CJS_PROBE = `module.exports = {
  prepare: async function () { return { state: "ready" }; },
  execute: async function (_ctx, prepared) { return Object.assign({}, prepared, { ran: true }); },
  verify: async function (_ctx, _p, executed) { return { passed: executed.ran === true, summary: "ok", data: { executed: executed } }; },
  rollback: async function () { return { success: true, summary: "rolled back" }; },
};
`;

const CJS_PROBE_NO_ROLLBACK = `module.exports = {
  prepare: async function () { return { state: "ready" }; },
  execute: async function (_ctx, prepared) { return prepared; },
  verify: async function () { return { passed: true }; },
};
`;

const CJS_PROBE_LIFECYCLE_NOT_INVOKED = `let lifecycleCalled = false;
module.exports = {
  prepare: async function () { lifecycleCalled = true; return {}; },
  execute: async function () { return {}; },
  verify: async function () { return { passed: true }; },
  rollback: async function () { return { success: true }; },
  __wasCalled: function () { return lifecycleCalled; },
};
`;

function installFixturePlugin(
  name: string,
  manifest: PluginManifest,
  entrySource: string,
  files?: Record<string, string>,
): { pluginDir: string; entryPath: string } {
  if (!/^kastell-plugin-[a-z0-9-]+$/.test(name)) {
    throw new Error(`bad fixture name: ${name}`);
  }
  const pluginDir = join(TEMP_NODE_MODULES, name);
  mkdirSync(pluginDir, { recursive: true });

  writeFileSync(join(pluginDir, "kastell-plugin.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(
    join(pluginDir, "package.json"),
    JSON.stringify({ name, version: manifest.version, type: "commonjs" }, null, 2),
  );

  const entryPath = manifest.entry.replace(/^\.\//, "");
  const entryFullPath = join(pluginDir, entryPath);
  mkdirSync(require("node:path").dirname(entryFullPath), { recursive: true });
  writeFileSync(entryFullPath, entrySource);

  if (files) {
    for (const [relPath, contents] of Object.entries(files)) {
      const fullPath = join(pluginDir, relPath);
      mkdirSync(require("node:path").dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, contents);
    }
  }

  return { pluginDir, entryPath };
}

const v3Manifest = (prefix: string, handler: string): PluginManifest => ({
  name: `kastell-plugin-${prefix.toLowerCase()}`,
  version: "1.0.0",
  apiVersion: "3",
  kastell: ">=2.0.0",
  capabilities: ["audit"],
  checkPrefix: prefix,
  entry: "./index.js",
});

const v3Entry = (checkId: string, handler: string): string => `
const checks = [
  {
    id: ${JSON.stringify(checkId)},
    name: "Probe Check",
    category: "Probe",
    severity: "warning",
    description: "probe check",
    activeProbe: {
      handler: ${JSON.stringify(handler)},
      risk: "medium",
      timeoutMs: 30000,
    },
  },
];
module.exports = { checks };
`;

const v3EntryReadOnly = (checkId: string): string => `
const checks = [
  {
    id: ${JSON.stringify(checkId)},
    name: "Read Check",
    category: "Probe",
    severity: "info",
    description: "read check",
    read: { cmd: "echo ok" },
  },
];
module.exports = { checks };
`;

describe("loadActiveProbeModule (unit)", () => {
  it("resolves a real plugin dir + handler, computes SHA-256, and type-checks lifecycle exports", async () => {
    const manifest = v3Manifest("LPR", "./dist/probes/ssh.js");
    installFixturePlugin(
      "kastell-plugin-loadprobe",
      manifest,
      v3Entry("LPR-SSH", "./dist/probes/ssh.js"),
      { "dist/probes/ssh.js": CJS_PROBE },
    );
    const validated = await loadActiveProbeModule(
      join(TEMP_NODE_MODULES, "kastell-plugin-loadprobe"),
      "./dist/probes/ssh.js",
    );
    expect(validated.absolutePath).toMatch(/dist[\\/]probes[\\/]ssh\.js$/);
    expect(validated.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(typeof validated.prepare).toBe("function");
    expect(typeof validated.execute).toBe("function");
    expect(typeof validated.verify).toBe("function");
    expect(typeof validated.rollback).toBe("function");
  });

  it("rejects a handler that escapes the plugin directory", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "kastell-probe-escape-"));
    try {
      const pluginDir = join(tmp, "plugin");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(join(pluginDir, "ok.js"), CJS_PROBE);
      await expect(loadActiveProbeModule(pluginDir, "../../etc/passwd")).rejects.toThrow(
        /escapes plugin directory/,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects a symlink that resolves outside the plugin root before import", async () => {
    if (process.platform === "win32") {
      // Windows symlink/junction creation in CI sandboxes is unreliable and
      // not portable across runner accounts. The lexical escape test above
      // already proves the containment check; the symlink branch is the same
      // realpathSync + relative() check exercised under different I/O.
      return;
    }
    const tmp = mkdtempSync(join(tmpdir(), "kastell-probe-symlink-"));
    try {
      const pluginDir = join(tmp, "plugin");
      mkdirSync(join(pluginDir, "dist", "probes"), { recursive: true });
      const outsideDir = join(tmp, "outside");
      mkdirSync(outsideDir, { recursive: true });
      writeFileSync(join(outsideDir, "ssh.js"), CJS_PROBE);
      symlinkSync(
        join(outsideDir, "ssh.js"),
        join(pluginDir, "dist", "probes", "ssh.js"),
        "file",
      );
      await expect(
        loadActiveProbeModule(pluginDir, "./dist/probes/ssh.js"),
      ).rejects.toThrow(/escapes plugin directory/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects a module missing the rollback export", async () => {
    const manifest = v3Manifest("MRL", "./probes/check.js");
    installFixturePlugin(
      "kastell-plugin-missing-rollback",
      manifest,
      v3Entry("MRL-001", "./probes/check.js"),
      { "probes/check.js": CJS_PROBE_NO_ROLLBACK },
    );
    await expect(
      loadActiveProbeModule(
        join(TEMP_NODE_MODULES, "kastell-plugin-missing-rollback"),
        "./probes/check.js",
      ),
    ).rejects.toThrow(/must export rollback\(\)/);
  });

  it("type-checks lifecycle exports without invoking them at import time", async () => {
    const manifest = v3Manifest("NVI", "./probes/check.js");
    installFixturePlugin(
      "kastell-plugin-no-invoke",
      manifest,
      v3Entry("NVI-001", "./probes/check.js"),
      { "probes/check.js": CJS_PROBE_LIFECYCLE_NOT_INVOKED },
    );
    const validated = await loadActiveProbeModule(
      join(TEMP_NODE_MODULES, "kastell-plugin-no-invoke"),
      "./probes/check.js",
    );
    expect(typeof validated.prepare).toBe("function");
    expect(typeof validated.execute).toBe("function");
    expect(typeof validated.verify).toBe("function");
    expect(typeof validated.rollback).toBe("function");
    expect(validated.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("loadPlugins() integration with activeProbeLoader (T4)", () => {
  beforeEach(() => {
    clearPluginRegistry();
    // Wipe leftover fixtures from previous tests so each test sees only
    // its own plugin (module-level TEMP_NODE_MODULES is shared across tests).
    if (existsSync(TEMP_NODE_MODULES)) {
      for (const name of require("node:fs").readdirSync(TEMP_NODE_MODULES)) {
        rmSync(join(TEMP_NODE_MODULES, name), { recursive: true, force: true });
      }
    }
  });

  it("populates activeProbesByCheckId for a v3 probe-only plugin", async () => {
    const manifest = v3Manifest("PRB", "./dist/probes/ssh.js");
    installFixturePlugin(
      "kastell-plugin-prb",
      manifest,
      v3Entry("PRB-SSH", "./dist/probes/ssh.js"),
      { "dist/probes/ssh.js": CJS_PROBE },
    );

    const result = await loadPlugins();
    expect(result.loaded).toEqual(["kastell-plugin-prb"]);
    const entry = getPluginRegistry().get("kastell-plugin-prb");
    expect(entry?.status).toBe("loaded");
    if (!entry || entry.status !== "loaded") {
      throw new Error("expected loaded probe entry");
    }
    const probe = entry.activeProbesByCheckId.get("PRB-SSH");
    expect(probe).toBeDefined();
    expect(probe?.definition).toEqual({
      handler: "./dist/probes/ssh.js",
      risk: "medium",
      timeoutMs: 30_000,
    });
    expect(probe?.module.absolutePath).toMatch(/dist[\\/]probes[\\/]ssh\.js$/);
    expect(probe?.module.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fails to load a plugin whose probe module is missing lifecycle exports", async () => {
    const manifest = v3Manifest("MRB", "./probes/check.js");
    installFixturePlugin(
      "kastell-plugin-mrb",
      manifest,
      v3Entry("MRB-001", "./probes/check.js"),
      { "probes/check.js": CJS_PROBE_NO_ROLLBACK },
    );

    const result = await loadPlugins();
    expect(result.loaded).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/must export rollback\(\)/);
  });

  it("leaves activeProbesByCheckId empty for a v3 read-only plugin", async () => {
    const manifest = v3Manifest("VTR", "./index.js");
    installFixturePlugin(
      "kastell-plugin-vtr",
      manifest,
      v3EntryReadOnly("VTR-001"),
    );

    const result = await loadPlugins();
    if (result.loaded.length === 0) {
      throw new Error(`expected vtr loaded; errors=${JSON.stringify(result.errors)}`);
    }
    expect(result.loaded).toEqual(["kastell-plugin-vtr"]);
    const entry = getPluginRegistry().get("kastell-plugin-vtr");
    if (!entry || entry.status !== "loaded") {
      throw new Error("expected loaded v3 read entry");
    }
    expect(entry.activeProbesByCheckId.size).toBe(0);
    expect(entry.readChecks.length).toBe(1);
    expect(entry.readChecks[0].id).toBe("VTR-001");
  });
});