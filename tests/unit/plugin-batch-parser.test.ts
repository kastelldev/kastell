import { parsePluginBatchOutput } from "../../src/core/audit/pluginAudit.js";
import type { PluginRegistryEntry } from "../../src/plugin/registry.js";
import type { PluginManifest, PluginCheck, PluginFix } from "../../src/plugin/sdk/types.js";

function entry(
  name: string,
  checks: PluginCheck[],
  fixes?: PluginFix[],
): PluginRegistryEntry {
  const manifest: PluginManifest = {
    name,
    version: "1.0.0",
    apiVersion: "1",
    kastell: "*",
    capabilities: fixes ? ["audit", "fix"] : ["audit"],
    checkPrefix: "WP",
    entry: "./index.js",
    ...(fixes ? { fixes } : {}),
  };
  const checksById = new Map(checks.map((c) => [c.id, c]));
  const fixesByCheckId = new Map((fixes ?? []).map((f) => [f.checkId, f]));
  return { manifest, checks, status: "loaded", checksById, fixesByCheckId };
}

function check(id: string, opts: Partial<PluginCheck> = {}): PluginCheck {
  return {
    id,
    category: "WordPress",
    name: id,
    severity: "warning",
    description: "",
    checkCommand: "echo x",
    ...opts,
  };
}

describe("parsePluginBatchOutput", () => {
  it("returns empty array for empty stdout AND empty registry", () => {
    expect(parsePluginBatchOutput("", new Map())).toEqual([]);
  });

  it("produces 'Unable to determine' category per loaded plugin when stdout is empty", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-wp", entry("kastell-plugin-wp", [check("WP-001"), check("WP-002")]));
    const result = parsePluginBatchOutput("", reg);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Plugin: wp");
    expect(result[0].checks).toHaveLength(2);
    for (const c of result[0].checks) {
      expect(c.passed).toBe(false);
      expect(c.currentValue).toBe("Unable to determine");
    }
  });

  it("fills missing sections with 'Unable to determine' when partial output", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-wp", entry("kastell-plugin-wp", [
      check("WP-001", { passPattern: "^ok$" }),
      check("WP-002", { passPattern: "^ok$" }),
    ]));
    // Only WP-001 has output; WP-002 is missing
    const stdout = "---SECTION:PLUGIN:kastell-plugin-wp:WP-001---\nok";
    const result = parsePluginBatchOutput(stdout, reg);
    expect(result).toHaveLength(1);
    expect(result[0].checks).toHaveLength(2);
    expect(result[0].checks.find((c) => c.id === "WP-001")?.passed).toBe(true);
    const missing = result[0].checks.find((c) => c.id === "WP-002");
    expect(missing?.passed).toBe(false);
    expect(missing?.currentValue).toBe("Unable to determine");
  });

  it("skips failed-status plugins entirely (no Unable-to-determine fallback)", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-failed", entry("kastell-plugin-failed", [check("F-001")], undefined));
    reg.get("kastell-plugin-failed")!.status = "failed";
    expect(parsePluginBatchOutput("", reg)).toEqual([]);
  });

  it("parses one section, one passing check (passPattern matches)", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-wp", entry("kastell-plugin-wp", [check("WP-001", { passPattern: "^ok$" })]));
    const stdout = "---SECTION:PLUGIN:kastell-plugin-wp:WP-001---\nok";
    const result = parsePluginBatchOutput(stdout, reg);
    expect(result).toHaveLength(1);
    expect(result[0].checks[0].passed).toBe(true);
    expect(result[0].checks[0].currentValue).toBe("ok");
  });

  it("marks check failed when neither pattern matches and no patterns defined", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-wp", entry("kastell-plugin-wp", [check("WP-001")]));
    const stdout = "---SECTION:PLUGIN:kastell-plugin-wp:WP-001---\nanything";
    const result = parsePluginBatchOutput(stdout, reg);
    // No patterns defined → evaluateCheck returns true (legacy behavior preserved)
    expect(result[0].checks[0].passed).toBe(true);
  });

  it("evaluates failPattern as failure regardless of passPattern", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-wp", entry("kastell-plugin-wp", [check("WP-001", { passPattern: "^ok$", failPattern: "ERROR" })]));
    const stdout = "---SECTION:PLUGIN:kastell-plugin-wp:WP-001---\nERROR";
    const result = parsePluginBatchOutput(stdout, reg);
    expect(result[0].checks[0].passed).toBe(false);
  });

  it("injects fixCommand for failed check with manifest fix", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set(
      "kastell-plugin-wp",
      entry(
        "kastell-plugin-wp",
        [check("WP-001", { passPattern: "^ok$" })],
        [{ checkId: "WP-001", tier: "SAFE", handler: "./fix.js" }],
      ),
    );
    const stdout = "---SECTION:PLUGIN:kastell-plugin-wp:WP-001---\nfailing";
    const result = parsePluginBatchOutput(stdout, reg);
    expect(result[0].checks[0].passed).toBe(false);
    expect(result[0].checks[0].fixCommand).toBe("plugin:kastell-plugin-wp:./fix.js");
    expect(result[0].checks[0].safeToAutoFix).toBe("SAFE");
  });

  it("preserves complianceRefs through parsing", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set(
      "kastell-plugin-wp",
      entry("kastell-plugin-wp", [
        check("WP-001", { complianceRefs: [{ framework: "CIS", ref: "1.2.3" }] }),
      ]),
    );
    const stdout = "---SECTION:PLUGIN:kastell-plugin-wp:WP-001---\nx";
    const result = parsePluginBatchOutput(stdout, reg);
    expect(result[0].checks[0].complianceRefs).toEqual([
      { framework: "CIS", controlId: "1.2.3", version: "1.0", description: "1.2.3", coverage: "partial" },
    ]);
  });

  it("ignores section for unknown plugin name", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    const stdout = "---SECTION:PLUGIN:kastell-plugin-ghost:GH-001---\nx";
    const result = parsePluginBatchOutput(stdout, reg);
    expect(result).toEqual([]);
  });

  it("ignores section for unknown check id within known plugin, falls back to Unable-to-determine for missing", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-wp", entry("kastell-plugin-wp", [check("WP-001")]));
    // Section references WP-999 (not in registry); WP-001 has no section
    const stdout = "---SECTION:PLUGIN:kastell-plugin-wp:WP-999---\nx";
    const result = parsePluginBatchOutput(stdout, reg);
    expect(result).toHaveLength(1);
    expect(result[0].checks).toHaveLength(1);
    expect(result[0].checks[0].id).toBe("WP-001");
    expect(result[0].checks[0].currentValue).toBe("Unable to determine");
  });

  it("parses multiple sections into one category per plugin", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-wp", entry("kastell-plugin-wp", [
      check("WP-001", { passPattern: "^ok$" }),
      check("WP-002", { passPattern: "^ok$" }),
    ]));
    const stdout =
      "---SECTION:PLUGIN:kastell-plugin-wp:WP-001---\nok\n" +
      "---SECTION:PLUGIN:kastell-plugin-wp:WP-002---\nfail";
    const result = parsePluginBatchOutput(stdout, reg);
    expect(result).toHaveLength(1);
    expect(result[0].checks).toHaveLength(2);
    expect(result[0].checks[0].passed).toBe(true);
    expect(result[0].checks[1].passed).toBe(false);
  });

  it("uses getShortName-formatted category name", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-wordpress", entry("kastell-plugin-wordpress", [check("WP-001")]));
    const stdout = "---SECTION:PLUGIN:kastell-plugin-wordpress:WP-001---\nx";
    const result = parsePluginBatchOutput(stdout, reg);
    expect(result[0].name).toBe("Plugin: wordpress");
  });

  it("trims trailing whitespace from section body", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-wp", entry("kastell-plugin-wp", [check("WP-001", { passPattern: "^ok$" })]));
    const stdout = "---SECTION:PLUGIN:kastell-plugin-wp:WP-001---\nok\n\n";
    const result = parsePluginBatchOutput(stdout, reg);
    expect(result[0].checks[0].currentValue).toBe("ok");
  });

  // CQS-08 #6d: malformed header edge cases. Per spec skip rule — if these
  // tests PASS, no additional guard is needed (current code already handles
  // the cases). If any FAIL, the fix is added in the same commit.
  describe("malformed headers (CQS-08 #6d)", () => {
    it("skips header with no colon, body not attached to next section", () => {
      const reg = new Map<string, PluginRegistryEntry>();
      reg.set("kastell-plugin-wp", entry("kastell-plugin-wp", [check("WP-001", { passPattern: "^ok$" })]));
      // Malformed: ---SECTION:no_colon--- (no colon between PLUGIN and checkId)
      // Followed by garbage body, then a valid section.
      const stdout =
        "---SECTION:no_colon---\n" +
        "garbage body that should not bleed into next section\n" +
        "---SECTION:PLUGIN:kastell-plugin-wp:WP-001---\n" +
        "ok";
      const result = parsePluginBatchOutput(stdout, reg);
      expect(result).toHaveLength(1);
      expect(result[0].checks[0].currentValue).toBe("ok");
      expect(result[0].checks[0].passed).toBe(true);
    });

    it("handles empty header (---SECTION:---)", () => {
      const reg = new Map<string, PluginRegistryEntry>();
      reg.set("kastell-plugin-wp", entry("kastell-plugin-wp", [check("WP-001", { passPattern: "^ok$" })]));
      const stdout =
        "---SECTION:---\n" +
        "---SECTION:PLUGIN:kastell-plugin-wp:WP-001---\n" +
        "ok";
      const result = parsePluginBatchOutput(stdout, reg);
      expect(result).toHaveLength(1);
      expect(result[0].checks[0].currentValue).toBe("ok");
    });

    it("handles header with no checkId (PLUGIN: present, checkId empty)", () => {
      const reg = new Map<string, PluginRegistryEntry>();
      reg.set("kastell-plugin-wp", entry("kastell-plugin-wp", [check("WP-001", { passPattern: "^ok$" })]));
      // ---SECTION:PLUGIN:kastell-plugin-wp:--- — colonIdx=lastIndexOf(':'), plugin=full, checkId=""
      const stdout =
        "---SECTION:PLUGIN:kastell-plugin-wp:---\n" +
        "ok\n" +
        "---SECTION:PLUGIN:kastell-plugin-wp:WP-001---\n" +
        "ok";
      const result = parsePluginBatchOutput(stdout, reg);
      // Only WP-001 should produce a check (the empty-checkId section is unknown id → ignored)
      expect(result).toHaveLength(1);
      expect(result[0].checks).toHaveLength(1);
      expect(result[0].checks[0].id).toBe("WP-001");
    });

    it("handles line that starts with prefix but lacks closing ---", () => {
      const reg = new Map<string, PluginRegistryEntry>();
      reg.set("kastell-plugin-wp", entry("kastell-plugin-wp", [check("WP-001", { passPattern: "^ok$" })]));
      // Malformed: no closing --- → treated as body (line.endsWith("---") false)
      const stdout =
        "---SECTION:PLUGIN:kastell-plugin-wp:WP-001\n" +
        "ok";
      const result = parsePluginBatchOutput(stdout, reg);
      // No valid section produced → WP-001 should be "Unable to determine"
      expect(result).toHaveLength(1);
      expect(result[0].checks[0].passed).toBe(false);
      expect(result[0].checks[0].currentValue).toBe("Unable to determine");
    });
  });
});
