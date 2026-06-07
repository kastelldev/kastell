import { runAudit } from "../../src/core/audit/index.js";
import * as ssh from "../../src/utils/ssh.js";
import { registerPlugin, clearPluginRegistry } from "../../src/plugin/registry.js";
import type { PluginManifest, PluginCheck } from "../../src/plugin/sdk/types.js";

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
    const checks: PluginCheck[] = [
      { id: "T-001", category: "Test", name: "T1", severity: "warning", description: "", checkCommand: { kind: "read", cmd: "echo ok" }, passPattern: "^ok$" },
      { id: "T-002", category: "Test", name: "T2", severity: "info", description: "", checkCommand: { kind: "read", cmd: "echo bad" }, passPattern: "^ok$" },
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
    const checks: PluginCheck[] = [
      { id: "T-MUT", category: "Test", name: "Mutating", severity: "warning", description: "", checkCommand: { kind: "mutate-local", cmd: "systemctl restart nginx" } },
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
      expect(pluginCat!.checks[0].currentValue).toBe("Not run by kastell audit (mutating kind: mutate-local)");
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
    const checks: PluginCheck[] = [
      { id: "T-READ", category: "Test", name: "Read", severity: "warning", description: "", checkCommand: { kind: "read", cmd: "echo ok" }, passPattern: "^ok$" },
      { id: "T-MUT", category: "Test", name: "Mutating", severity: "warning", description: "", checkCommand: { kind: "mutate-local", cmd: "systemctl restart nginx" } },
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
      expect(pluginCat!.checks.find((c) => c.id === "T-MUT")?.currentValue)
        .toBe("Not run by kastell audit (mutating kind: mutate-local)");
    }
  });

  // Regression guard for the connectionError heuristic (single-pass form
  // in src/core/audit/index.ts). Mutating-skip checks are EXCLUDED from the
  // "all read undetermined" heuristic — they are "not run by kastell audit"
  // by design, not because of a batch failure. A category composed entirely
  // of mutating-skip checks must not be flagged as connectionError even if
  // the plugin batch itself failed.
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
    const checks: PluginCheck[] = [
      { id: "M-LOCAL", category: "Test", name: "Local", severity: "warning", description: "", checkCommand: { kind: "mutate-local", cmd: "systemctl restart nginx" } },
      { id: "M-GLOBAL", category: "Test", name: "Global", severity: "warning", description: "", checkCommand: { kind: "mutate-global", cmd: "iptables -F" } },
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
      // No read checks → hasReadCheck stays false in the heuristic loop
      // → connectionError must NOT be set even though batch failed.
      expect(pluginCat!.connectionError).toBeUndefined();
      // Mutating checks must still surface the skip sentinel.
      expect(pluginCat!.checks).toHaveLength(2);
      for (const c of pluginCat!.checks) {
        expect(c.currentValue).toMatch(/^Not run by kastell audit \(mutating kind: /);
      }
    }
  });

  it("mixed read+mutating plugin: connectionError IS set when batch fails (read check undetermined)", async () => {
    // Companion test: when the plugin has BOTH read and mutating checks and
    // the batch fails, the read check is "Unable to determine" and the
    // mutating check is the skip sentinel. The heuristic excludes mutating
    // from the undetermined-count and sees 1 read undetermined → connectionError=true.
    const manifest: PluginManifest = {
      name: "kastell-plugin-mix",
      version: "1.0.0",
      apiVersion: "2",
      kastell: "*",
      capabilities: ["audit"],
      checkPrefix: "X",
      entry: "./index.js",
    };
    const checks: PluginCheck[] = [
      { id: "X-READ", category: "Test", name: "Read", severity: "warning", description: "", checkCommand: { kind: "read", cmd: "echo ok" }, passPattern: "^ok$" },
      { id: "X-MUT", category: "Test", name: "Mut", severity: "warning", description: "", checkCommand: { kind: "mutate-local", cmd: "systemctl restart nginx" } },
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
});
