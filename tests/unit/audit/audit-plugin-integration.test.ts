import { getPluginRegistry, registerPlugin, clearPluginRegistry } from "../../../src/plugin/registry.js";
import { executePluginChecks } from "../../../src/core/audit/pluginAudit.js";
import type { PluginManifest, PluginCheck, PluginCapability } from "../../../src/plugin/sdk/types.js";

jest.mock("../../../src/utils/ssh.js", () => ({
  sshExec: jest.fn().mockResolvedValue({ stdout: "ok", code: 0, stderr: "" }),
}));

describe("audit plugin integration", () => {
  const manifest: PluginManifest = {
    name: "kastell-plugin-wp",
    version: "1.0.0",
    apiVersion: "1",
    kastell: ">=2.0.0",
    capabilities: ["audit"] as PluginCapability[],
    checkPrefix: "WP",
    entry: "./index.js",
  };

  const checks: PluginCheck[] = [
    {
      id: "WP-UPDATES",
      name: "WordPress Updates",
      category: "WordPress",
      severity: "warning",
      description: "Check updates",
      checkCommand: "echo ok",
      passPattern: "^ok$",
    },
  ];

  beforeEach(() => clearPluginRegistry());

  it("executePluginChecks produces valid AuditCategory from registry", async () => {
    registerPlugin(manifest, checks);
    const registry = getPluginRegistry();
    const entry = registry.get("kastell-plugin-wp")!;
    const result = await executePluginChecks("1.2.3.4", "WordPress", entry.checks);
    expect(result.name).toBe("WordPress");
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0].id).toBe("WP-UPDATES");
    expect(result.checks[0].passed).toBe(true);
  });

  it("handles plugin with no checks gracefully", async () => {
    registerPlugin(manifest, []);
    const registry = getPluginRegistry();
    const entry = registry.get("kastell-plugin-wp")!;
    const result = await executePluginChecks("1.2.3.4", "Empty", entry.checks);
    expect(result.checks).toHaveLength(0);
  });
});
