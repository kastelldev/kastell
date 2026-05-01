import type {
  PluginManifest,
  PluginCheck,
  PluginSeverity,
  PluginFixTier,
} from "../../../src/plugin/sdk/types.js";

describe("Plugin SDK Types", () => {
  it("PluginManifest accepts valid manifest with all 7 fields", () => {
    const manifest: PluginManifest = {
      name: "kastell-plugin-wordpress",
      version: "1.0.0",
      apiVersion: "1",
      kastell: ">=2.2.0 <3.0.0",
      capabilities: ["audit"],
      checkPrefix: "WP",
      entry: "dist/index.js",
    };
    expect(manifest.name).toBe("kastell-plugin-wordpress");
    expect(manifest.checkPrefix).toBe("WP");
  });

  it("PluginCheck accepts valid check with required + optional fields", () => {
    const check: PluginCheck = {
      id: "WP-FILE-PERMS",
      name: "WordPress file permissions",
      category: "WordPress",
      severity: "warning",
      description: "WordPress core files should not be world-writable",
      checkCommand: "find /var/www/html -type f -perm -002 | wc -l",
      passPattern: "^0$",
      failPattern: undefined,
      fixCommand: "find /var/www/html -type f -exec chmod 644 {} \\;",
      safeToAutoFix: "GUARDED",
      explain: "Checks world-writable files in WordPress root",
      complianceRefs: [{ framework: "CIS", ref: "6.1.3" }],
    };
    expect(check.id).toBe("WP-FILE-PERMS");
    expect(check.severity).toBe("warning");
  });

  it("PluginSeverity only allows critical | warning | info", () => {
    const s1: PluginSeverity = "critical";
    const s2: PluginSeverity = "warning";
    const s3: PluginSeverity = "info";
    expect([s1, s2, s3]).toHaveLength(3);
  });

  it("PluginFixTier only allows SAFE | GUARDED | FORBIDDEN", () => {
    const t1: PluginFixTier = "SAFE";
    const t2: PluginFixTier = "GUARDED";
    const t3: PluginFixTier = "FORBIDDEN";
    expect([t1, t2, t3]).toHaveLength(3);
  });

  it("PluginCheck works with minimal fields (no optionals)", () => {
    const check: PluginCheck = {
      id: "AUD-001",
      name: "Minimal check",
      category: "Auditor",
      severity: "info",
      description: "A minimal check",
      checkCommand: "echo ok",
    };
    expect(check.fixCommand).toBeUndefined();
    expect(check.explain).toBeUndefined();
    expect(check.complianceRefs).toBeUndefined();
  });
});
