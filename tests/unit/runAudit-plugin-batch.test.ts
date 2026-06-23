import { runAudit } from "../../src/core/audit/index.js";
import * as ssh from "../../src/utils/ssh.js";
import { registerPlugin, clearPluginRegistry } from "../../src/plugin/registry.js";
import type { PluginManifest, LoadedPluginCheck } from "../../src/plugin/sdk/types.js";

describe("runAudit — plugin batch integration", () => {
  beforeEach(() => {
    clearPluginRegistry();
    jest.resetAllMocks();
  });

  afterEach(() => {
    clearPluginRegistry();
  });

  function registerTestPlugin(): void {
    const manifest: PluginManifest = {
      name: "kastell-plugin-test",
      version: "1.0.0",
      apiVersion: "2",
      kastell: "*",
      capabilities: ["audit"],
      checkPrefix: "T",
      entry: "./index.js",
    };
    const checks: LoadedPluginCheck[] = [
      // P144 T5: post-normalization shape carries `read.cmd` so the
      // registry builds entry.readChecks. Legacy checkCommand is kept
      // for the structured-skip code path on mutating variants.
      { id: "T-001", category: "Test", name: "T1", severity: "warning", description: "", sourceApiVersion: "2", checkCommand: { kind: "read", cmd: "echo ok" }, read: { cmd: "echo ok", passPattern: "^ok$" }, passPattern: "^ok$" },
      { id: "T-002", category: "Test", name: "T2", severity: "info", description: "", sourceApiVersion: "2", checkCommand: { kind: "read", cmd: "echo bad" }, read: { cmd: "echo bad", passPattern: "^ok$" }, passPattern: "^ok$" },
    ];
    registerPlugin(manifest, checks);
  }

  it("calls sshExec 4 times when a loaded plugin has checks", async () => {
    registerTestPlugin();
    const spy = jest.spyOn(ssh, "sshExec").mockImplementation(async () => ({ stdout: "", stderr: "", code: 0 }));
    // Stub the 4th batch with plugin output
    spy.mockImplementationOnce(async () => ({ stdout: "", stderr: "", code: 0 })); // fast
    spy.mockImplementationOnce(async () => ({ stdout: "", stderr: "", code: 0 })); // medium
    spy.mockImplementationOnce(async () => ({ stdout: "", stderr: "", code: 0 })); // slow
    spy.mockImplementationOnce(async () => ({
      stdout:
        "---SECTION:PLUGIN:kastell-plugin-test:T-001---\nok\n" +
        "---SECTION:PLUGIN:kastell-plugin-test:T-002---\nbad",
      stderr: "",
      code: 0,
    }));

    const result = await runAudit("1.2.3.4", "test-server", "coolify");

    expect(spy).toHaveBeenCalledTimes(4);
    expect(result.success).toBe(true);
    if (result.success && result.data) {
      const pluginCat = result.data.categories.find((c) => c.name === "Plugin: test");
      expect(pluginCat).toBeDefined();
      expect(pluginCat!.checks).toHaveLength(2);
      expect(pluginCat!.checks[0].passed).toBe(true);
      expect(pluginCat!.checks[1].passed).toBe(false);
    }
  });

  it("calls sshExec 3 times when no plugin is loaded", async () => {
    const spy = jest.spyOn(ssh, "sshExec").mockImplementation(async () => ({ stdout: "", stderr: "", code: 0 }));
    await runAudit("1.2.3.4", "test-server", "coolify");
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("marks plugin category connectionError when plugin batch fails", async () => {
    registerTestPlugin();
    const spy = jest.spyOn(ssh, "sshExec").mockImplementation(async () => ({ stdout: "", stderr: "", code: 0 }));
    spy.mockImplementationOnce(async () => ({ stdout: "", stderr: "", code: 0 })); // fast
    spy.mockImplementationOnce(async () => ({ stdout: "", stderr: "", code: 0 })); // medium
    spy.mockImplementationOnce(async () => ({ stdout: "", stderr: "", code: 0 })); // slow
    spy.mockImplementationOnce(async () => { throw new Error("ssh timeout"); }); // plugin batch fails

    const result = await runAudit("1.2.3.4", "test-server", "coolify");
    expect(result.success).toBe(true);
    if (result.success && result.data) {
      // Plugin batch fails → parser produces "Unable to determine" check for every loaded plugin check
      // → runAudit's allUndetermined heuristic sets connectionError: true on plugin category.
      const pluginCat = result.data.categories.find((c) => c.name === "Plugin: test");
      expect(pluginCat).toBeDefined();
      expect(pluginCat!.connectionError).toBe(true);
      expect(pluginCat!.checks).toHaveLength(2);
      expect(pluginCat!.checks.every((c) => c.currentValue === "Unable to determine")).toBe(true);
      // Warning still surfaces the failure reason
      expect(result.data.warnings && result.data.warnings.some((w: string) => w.includes("plugin batch"))).toBe(true);
    }
  });

  it("surfaces mutating plugin checks as not run without executing plugin batch", async () => {
    const manifest: PluginManifest = {
      name: "kastell-plugin-test",
      version: "1.0.0",
      apiVersion: "2",
      kastell: "*",
      capabilities: ["audit"],
      checkPrefix: "T",
      entry: "./index.js",
    };
    const checks: LoadedPluginCheck[] = [
      { id: "T-MUT", category: "Test", name: "Mutating", severity: "warning", description: "", sourceApiVersion: "2", checkCommand: { kind: "mutate-local", cmd: "systemctl restart nginx" } },
    ];
    registerPlugin(manifest, checks);
    const spy = jest.spyOn(ssh, "sshExec").mockImplementation(async () => ({ stdout: "", stderr: "", code: 0 }));

    const result = await runAudit("1.2.3.4", "test-server", "coolify");

    expect(spy).toHaveBeenCalledTimes(3);
    expect(result.success).toBe(true);
    if (result.success && result.data) {
      const pluginCat = result.data.categories.find((c) => c.name === "Plugin: test");
      expect(pluginCat).toBeDefined();
      expect(pluginCat!.connectionError).toBeUndefined();
      // P142 Task 2: structured skip metadata on the check, empty currentValue.
      expect(pluginCat!.checks[0].skip).toEqual({
        code: "legacy-mutating",
        apiVersion: "2",
        kind: "mutate-local",
      });
      expect(pluginCat!.checks[0].currentValue).toBe("");
      expect(result.data.warnings).toContain("Plugin kastell-plugin-test check T-MUT is mutate-local and is not run by kastell audit");
    }
  });

  it("plugin batch failure marks read checks connectionError while ignoring mutating not-run checks", async () => {
    const manifest: PluginManifest = {
      name: "kastell-plugin-test",
      version: "1.0.0",
      apiVersion: "2",
      kastell: "*",
      capabilities: ["audit"],
      checkPrefix: "T",
      entry: "./index.js",
    };
    const checks: LoadedPluginCheck[] = [
      { id: "T-READ", category: "Test", name: "Read", severity: "warning", description: "", sourceApiVersion: "2", checkCommand: { kind: "read", cmd: "echo ok" }, read: { cmd: "echo ok", passPattern: "^ok$" }, passPattern: "^ok$" },
      { id: "T-MUT", category: "Test", name: "Mutating", severity: "warning", description: "", sourceApiVersion: "2", checkCommand: { kind: "mutate-local", cmd: "systemctl restart nginx" } },
    ];
    registerPlugin(manifest, checks);
    const spy = jest.spyOn(ssh, "sshExec").mockImplementation(async () => ({ stdout: "", stderr: "", code: 0 }));
    spy.mockImplementationOnce(async () => ({ stdout: "", stderr: "", code: 0 }));
    spy.mockImplementationOnce(async () => ({ stdout: "", stderr: "", code: 0 }));
    spy.mockImplementationOnce(async () => ({ stdout: "", stderr: "", code: 0 }));
    spy.mockImplementationOnce(async () => { throw new Error("ssh timeout"); });

    const result = await runAudit("1.2.3.4", "test-server", "coolify");

    expect(result.success).toBe(true);
    if (result.success && result.data) {
      const pluginCat = result.data.categories.find((c) => c.name === "Plugin: test");
      expect(pluginCat).toBeDefined();
      expect(pluginCat!.connectionError).toBe(true);
      // P142 Task 2: mutating check now carries structured skip metadata,
      // not a sentinel currentValue string.
      const mut = pluginCat!.checks.find((c) => c.id === "T-MUT");
      expect(mut?.skip).toEqual({
        code: "legacy-mutating",
        apiVersion: "2",
        kind: "mutate-local",
      });
      expect(mut?.currentValue).toBe("");
    }
  });

  // Regression: all-mutating category must not be flagged as connectionError
  // even when the batch fails — mutating-skip checks are excluded from the
  // "all read undetermined" heuristic.
  it("all-mutating plugin: connectionError NOT set when batch fails", async () => {
    const manifest: PluginManifest = {
      name: "kastell-plugin-mut",
      version: "1.0.0",
      apiVersion: "2",
      kastell: "*",
      capabilities: ["audit"],
      checkPrefix: "M",
      entry: "./index.js",
    };
    const checks: LoadedPluginCheck[] = [
      { id: "M-LOCAL", category: "Test", name: "Local", severity: "warning", description: "", sourceApiVersion: "2", checkCommand: { kind: "mutate-local", cmd: "systemctl restart nginx" } },
      { id: "M-GLOBAL", category: "Test", name: "Global", severity: "warning", description: "", sourceApiVersion: "2", checkCommand: { kind: "mutate-global", cmd: "iptables -F" } },
    ];
    registerPlugin(manifest, checks);
    const spy = jest.spyOn(ssh, "sshExec").mockImplementation(async () => ({ stdout: "", stderr: "", code: 0 }));
    spy.mockImplementationOnce(async () => ({ stdout: "", stderr: "", code: 0 })); // fast
    spy.mockImplementationOnce(async () => ({ stdout: "", stderr: "", code: 0 })); // medium
    spy.mockImplementationOnce(async () => ({ stdout: "", stderr: "", code: 0 })); // slow
    spy.mockImplementationOnce(async () => { throw new Error("ssh timeout"); }); // plugin batch fails

    const result = await runAudit("1.2.3.4", "test-server", "coolify");
    expect(result.success).toBe(true);
    if (result.success && result.data) {
      const pluginCat = result.data.categories.find((c) => c.name === "Plugin: mut");
      expect(pluginCat).toBeDefined();
      expect(pluginCat!.connectionError).toBeUndefined();
      expect(pluginCat!.checks).toHaveLength(2);
      // P142 Task 2: skipped checks carry structured skip metadata, not
      // a sentinel currentValue string.
      for (const c of pluginCat!.checks) {
        expect(c.skip).toBeDefined();
        expect(c.currentValue).toBe("");
      }
    }
  });

  it("mixed read+mutating plugin: connectionError IS set when batch fails (read check undetermined)", async () => {
    // Companion: mixed batch failure → read check is "Unable to determine",
    // mutating check is the skip sentinel. The heuristic sees 1 read
    // undetermined and flags connectionError=true.
    const manifest: PluginManifest = {
      name: "kastell-plugin-mix",
      version: "1.0.0",
      apiVersion: "2",
      kastell: "*",
      capabilities: ["audit"],
      checkPrefix: "X",
      entry: "./index.js",
    };
    const checks: LoadedPluginCheck[] = [
      { id: "X-READ", category: "Test", name: "Read", severity: "warning", description: "", sourceApiVersion: "2", checkCommand: { kind: "read", cmd: "echo ok" }, read: { cmd: "echo ok", passPattern: "^ok$" }, passPattern: "^ok$" },
      { id: "X-MUT", category: "Test", name: "Mut", severity: "warning", description: "", sourceApiVersion: "2", checkCommand: { kind: "mutate-local", cmd: "systemctl restart nginx" } },
    ];
    registerPlugin(manifest, checks);
    const spy = jest.spyOn(ssh, "sshExec").mockImplementation(async () => ({ stdout: "", stderr: "", code: 0 }));
    spy.mockImplementationOnce(async () => ({ stdout: "", stderr: "", code: 0 }));
    spy.mockImplementationOnce(async () => ({ stdout: "", stderr: "", code: 0 }));
    spy.mockImplementationOnce(async () => ({ stdout: "", stderr: "", code: 0 }));
    spy.mockImplementationOnce(async () => { throw new Error("ssh timeout"); });

    const result = await runAudit("1.2.3.4", "test-server", "coolify");
    expect(result.success).toBe(true);
    if (result.success && result.data) {
      const pluginCat = result.data.categories.find((c) => c.name === "Plugin: mix");
      expect(pluginCat).toBeDefined();
      expect(pluginCat!.connectionError).toBe(true);
    }
  });

  it("P142 Task 2: missing read section still uses connection-error path (skip NOT applied)", async () => {
    // Regression: a read check whose section is missing (batch failure) is
    // NOT marked with skip metadata. The existing connection-error path
    // applies. Skip metadata is reserved for v2 mutating plugin checks.
    const manifest: PluginManifest = {
      name: "kastell-plugin-readonly",
      version: "1.0.0",
      apiVersion: "2",
      kastell: "*",
      capabilities: ["audit"],
      checkPrefix: "R",
      entry: "./index.js",
    };
    const checks: LoadedPluginCheck[] = [
      { id: "R-001", category: "Test", name: "Read", severity: "warning", description: "", sourceApiVersion: "2", checkCommand: { kind: "read", cmd: "echo ok" }, read: { cmd: "echo ok", passPattern: "^ok$" }, passPattern: "^ok$" },
    ];
    registerPlugin(manifest, checks);
    const spy = jest.spyOn(ssh, "sshExec").mockImplementation(async () => ({ stdout: "", stderr: "", code: 0 }));
    spy.mockImplementationOnce(async () => ({ stdout: "", stderr: "", code: 0 }));
    spy.mockImplementationOnce(async () => ({ stdout: "", stderr: "", code: 0 }));
    spy.mockImplementationOnce(async () => ({ stdout: "", stderr: "", code: 0 }));
    spy.mockImplementationOnce(async () => { throw new Error("ssh timeout"); });

    const result = await runAudit("1.2.3.4", "test-server", "coolify");
    expect(result.success).toBe(true);
    if (result.success && result.data) {
      const pluginCat = result.data.categories.find((c) => c.name === "Plugin: readonly");
      expect(pluginCat).toBeDefined();
      expect(pluginCat!.connectionError).toBe(true);
      // Read check must NOT carry skip metadata
      expect(pluginCat!.checks[0].skip).toBeUndefined();
      expect(pluginCat!.checks[0].currentValue).toBe("Unable to determine");
    }
  });
});

// P144 Task 5: runAudit end-to-end v3 normalized-read execution with
// ordered traversal across v2 + v3 read + v3 combined + v3 probe-only.
describe("runAudit — v3 normalized plugin batch (P144 T5)", () => {
  function v3Check(
    id: string,
    opts: { read?: { cmd: string; passPattern?: string }; activeProbe?: boolean } = {},
  ): LoadedPluginCheck {
    return {
      id,
      category: "Test",
      name: id,
      severity: "warning",
      description: "",
      sourceApiVersion: "3",
      ...(opts.read !== undefined ? { read: opts.read } : {}),
      ...(opts.activeProbe ? { activeProbe: { handler: "./probe.js", risk: "low", timeoutMs: 5000 } } : {}),
    };
  }

  function stubActiveProbeModule() {
    return {
      prepare: async () => ({}),
      execute: async () => ({}),
      verify: async () => ({ passed: true }),
      rollback: async () => ({ success: true }),
      absolutePath: "/tmp/fake.js",
      sha256: "0000000000000000000000000000000000000000000000000000000000000000",
    };
  }

  it("preserves check order (v2 read, v3 read, v3 combined, v3 probe-only)", async () => {
    const manifest: PluginManifest = {
      name: "kastell-plugin-mixv3",
      version: "1.0.0",
      apiVersion: "3",
      kastell: "*",
      capabilities: ["audit"],
      checkPrefix: "M",
      entry: "./index.js",
    };
    const checks: LoadedPluginCheck[] = [
      v3Check("M-V2", { read: { cmd: "v2 read command", passPattern: "^ok$" } }),
      v3Check("M-V3", { read: { cmd: "v3 read command", passPattern: "^ok$" } }),
      v3Check("M-BOTH", {
        read: { cmd: "combined read command", passPattern: "^ok$" },
        activeProbe: true,
      }),
      v3Check("M-PROBE", { activeProbe: true }),
    ];
    const probeModules = new Map([
      ["M-BOTH", stubActiveProbeModule()],
      ["M-PROBE", stubActiveProbeModule()],
    ]);
    registerPlugin(manifest, checks, probeModules);
    const spy = jest.spyOn(ssh, "sshExec").mockImplementation(async () => ({ stdout: "", stderr: "", code: 0 }));
    spy.mockImplementationOnce(async () => ({ stdout: "", stderr: "", code: 0 })); // fast
    spy.mockImplementationOnce(async () => ({ stdout: "", stderr: "", code: 0 })); // medium
    spy.mockImplementationOnce(async () => ({ stdout: "", stderr: "", code: 0 })); // slow
    spy.mockImplementationOnce(async () => ({
      stdout:
        "---SECTION:PLUGIN:kastell-plugin-mixv3:M-V2---\nok\n" +
        "---SECTION:PLUGIN:kastell-plugin-mixv3:M-V3---\nok\n" +
        "---SECTION:PLUGIN:kastell-plugin-mixv3:M-BOTH---\nok",
      stderr: "",
      code: 0,
    }));

    const result = await runAudit("1.2.3.4", "test-server", "coolify");
    expect(result.success).toBe(true);
    if (result.success && result.data) {
      const cat = result.data.categories.find((c) => c.name === "Plugin: mixv3");
      expect(cat).toBeDefined();
      expect(cat!.checks.map((c) => c.id)).toEqual([
        "M-V2",
        "M-V3",
        "M-BOTH",
        "M-PROBE",
      ]);
      // active-probe check gets structured skip
      expect(cat!.checks[3].skip).toEqual({
        code: "active-probe",
        apiVersion: "3",
      });
      expect(cat!.checks[3].currentValue).toBe("");
    }
  });

  it("preserves category order across multiple plugins in registry iteration order", async () => {
    const manifestZ: PluginManifest = {
      name: "kastell-plugin-zeta",
      version: "1.0.0",
      apiVersion: "3",
      kastell: "*",
      capabilities: ["audit"],
      checkPrefix: "Z",
      entry: "./index.js",
    };
    const manifestA: PluginManifest = {
      name: "kastell-plugin-alpha",
      version: "1.0.0",
      apiVersion: "3",
      kastell: "*",
      capabilities: ["audit"],
      checkPrefix: "A",
      entry: "./index.js",
    };
    registerPlugin(manifestZ, [
      v3Check("Z-001", { read: { cmd: "echo z", passPattern: "^z$" } }),
    ]);
    registerPlugin(manifestA, [
      v3Check("A-001", { read: { cmd: "echo a", passPattern: "^a$" } }),
    ]);
    const spy = jest.spyOn(ssh, "sshExec").mockImplementation(async () => ({ stdout: "", stderr: "", code: 0 }));
    spy.mockImplementationOnce(async () => ({ stdout: "", stderr: "", code: 0 }));
    spy.mockImplementationOnce(async () => ({ stdout: "", stderr: "", code: 0 }));
    spy.mockImplementationOnce(async () => ({ stdout: "", stderr: "", code: 0 }));
    spy.mockImplementationOnce(async () => ({
      stdout:
        "---SECTION:PLUGIN:kastell-plugin-zeta:Z-001---\nz\n" +
        "---SECTION:PLUGIN:kastell-plugin-alpha:A-001---\na",
      stderr: "",
      code: 0,
    }));

    const result = await runAudit("1.2.3.4", "test-server", "coolify");
    expect(result.success).toBe(true);
    if (result.success && result.data) {
      const names = result.data.categories.map((c) => c.name);
      const zetaIdx = names.indexOf("Plugin: zeta");
      const alphaIdx = names.indexOf("Plugin: alpha");
      expect(zetaIdx).toBeGreaterThanOrEqual(0);
      expect(alphaIdx).toBeGreaterThan(zetaIdx);
    }
  });
});
