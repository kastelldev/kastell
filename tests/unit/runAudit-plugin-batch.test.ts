import { runAudit } from "../../src/core/audit/index.js";
import * as ssh from "../../src/utils/ssh.js";
import { registerPlugin, clearPluginRegistry } from "../../src/plugin/registry.js";
import type { PluginManifest, PluginCheck } from "../../src/plugin/sdk/types.js";

describe("runAudit — plugin batch integration", () => {
  beforeEach(() => {
    clearPluginRegistry();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    clearPluginRegistry();
  });

  function registerTestPlugin(): void {
    const manifest: PluginManifest = {
      name: "kastell-plugin-test",
      version: "1.0.0",
      apiVersion: "1",
      kastell: "*",
      capabilities: ["audit"],
      checkPrefix: "T",
      entry: "./index.js",
    };
    const checks: PluginCheck[] = [
      { id: "T-001", category: "Test", name: "T1", severity: "warning", description: "", checkCommand: "echo ok", passPattern: "^ok$" },
      { id: "T-002", category: "Test", name: "T2", severity: "info", description: "", checkCommand: "echo bad", passPattern: "^ok$" },
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
});
