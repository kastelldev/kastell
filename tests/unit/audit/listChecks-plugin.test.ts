import { listAllChecks } from "../../../src/core/audit/listChecks.js";
import { registerPlugin, clearPluginRegistry } from "../../../src/plugin/registry.js";
import type { PluginManifest, PluginCheck, PluginCapability } from "../../../src/plugin/sdk/types.js";
import type { CheckCatalogEntry } from "../../../src/core/audit/listChecks.js";

describe("listAllChecks with plugins", () => {
  const manifest: PluginManifest = {
    name: "kastell-plugin-wp",
    version: "1.0.0",
    apiVersion: "1",
    kastell: ">=2.0.0",
    capabilities: ["audit"] as PluginCapability[],
    checkPrefix: "WP",
    entry: "./index.js",
  };

  const pluginChecks: PluginCheck[] = [
    {
      id: "WP-UPDATES",
      name: "WordPress Updates",
      category: "WordPress",
      severity: "warning",
      description: "Check WP core updates",
      checkCommand: "wp core check-update",
      passPattern: "^$",
      explain: "WordPress core should be up to date",
    },
  ];

  beforeEach(() => clearPluginRegistry());

  it("includes plugin checks in catalog", () => {
    registerPlugin(manifest, pluginChecks);
    const all = listAllChecks();
    const wpCheck = all.find((c: CheckCatalogEntry) => c.id === "WP-UPDATES");
    expect(wpCheck).toBeDefined();
    expect(wpCheck?.category).toBe("WordPress");
    expect(wpCheck?.severity).toBe("warning");
  });

  it("filters plugin checks by category", () => {
    registerPlugin(manifest, pluginChecks);
    const filtered = listAllChecks({ category: "WordPress" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("WP-UPDATES");
  });

  it("filters plugin checks by severity", () => {
    registerPlugin(manifest, pluginChecks);
    const filtered = listAllChecks({ severity: "critical" });
    const wpCheck = filtered.find((c: CheckCatalogEntry) => c.id === "WP-UPDATES");
    expect(wpCheck).toBeUndefined();
  });

  it("returns only core checks when no plugins loaded", () => {
    const all = listAllChecks();
    const wpCheck = all.find((c: CheckCatalogEntry) => c.id === "WP-UPDATES");
    expect(wpCheck).toBeUndefined();
  });
});
