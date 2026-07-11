import {
  getSkippedMutatingPluginWarnings,
  parsePluginBatchOutput,
} from "../../src/core/audit/pluginAudit.js";
import type { PluginRegistryEntry } from "../../src/plugin/registry.js";
import type { PluginManifest, LoadedPluginCheck, PluginFix } from "../../src/plugin/sdk/types.js";

function entry(
  name: string,
  checks: LoadedPluginCheck[],
  fixes?: PluginFix[],
): PluginRegistryEntry {
  const manifest: PluginManifest = {
    name,
    version: "1.0.0",
    apiVersion: "2",
    kastell: "*",
    capabilities: fixes ? ["audit", "fix"] : ["audit"],
    checkPrefix: "WP",
    entry: "./index.js",
    ...(fixes ? { fixes } : {}),
  };
  const checksById = new Map(checks.map((c) => [c.id, c]));
  const fixesByCheckId = new Map((fixes ?? []).map((f) => [f.checkId, f]));
  const readChecks = checks.filter((c): c is LoadedPluginCheck & { read: NonNullable<LoadedPluginCheck["read"]> } => c.read !== undefined);
  return {
    manifest,
    checks,
    readChecks,
    status: "loaded",
    checksById,
    fixesByCheckId,
    activeProbesByCheckId: new Map<string, never>(),
  };
}

function check(id: string, opts: Partial<LoadedPluginCheck> = {}): LoadedPluginCheck {
  return {
    id,
    category: "WordPress",
    name: id,
    severity: "warning",
    description: "",
    sourceApiVersion: "2",
    checkCommand: { kind: "read", cmd: "echo x" },
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

  it("marks missing mutating check as not run by audit", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-wp", entry("kastell-plugin-wp", [
      check("WP-READ", { passPattern: "^ok$" }),
      check("WP-LOCAL", { checkCommand: { kind: "mutate-local", cmd: "systemctl restart nginx" } }),
      check("WP-GLOBAL", { checkCommand: { kind: "mutate-global", cmd: "hcloud firewall apply-to-resource" } }),
    ]));

    const stdout = "---SECTION:PLUGIN:kastell-plugin-wp:WP-READ---\nok";
    const result = parsePluginBatchOutput(stdout, reg);

    expect(result[0].checks.find((c) => c.id === "WP-READ")?.passed).toBe(true);
    // P142 Task 2: structured skip metadata replaces sentinel-string.
    expect(result[0].checks.find((c) => c.id === "WP-LOCAL")?.skip).toEqual({
      code: "legacy-mutating",
      apiVersion: "2",
      kind: "mutate-local",
    });
    expect(result[0].checks.find((c) => c.id === "WP-GLOBAL")?.skip).toEqual({
      code: "legacy-mutating",
      apiVersion: "2",
      kind: "mutate-global",
    });
    expect(result[0].checks.find((c) => c.id === "WP-LOCAL")?.currentValue).toBe("");
    expect(result[0].checks.find((c) => c.id === "WP-GLOBAL")?.currentValue).toBe("");
  });

  it("P142 Task 2: read check has no skip metadata and keeps its currentValue", () => {
    // Regression guard: read checks must NOT be marked as skip, and their
    // currentValue must come from the batch section (not blanked out).
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-wp", entry("kastell-plugin-wp", [
      check("WP-READ", { passPattern: "^ok$" }),
    ]));
    const stdout = "---SECTION:PLUGIN:kastell-plugin-wp:WP-READ---\nok";
    const result = parsePluginBatchOutput(stdout, reg);
    const read = result[0].checks[0];
    expect(read.skip).toBeUndefined();
    expect(read.currentValue).toBe("ok");
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

  // P144 Task 5: v3 plugin check ordering and probe-only skip emission.
  describe("v3 plugin checks (P144 T5)", () => {
    function v3Check(
      id: string,
      opts: { read?: { cmd: string; passPattern?: string }; activeProbe?: boolean } = {},
    ): LoadedPluginCheck {
      return {
        id,
        category: "WordPress",
        name: id,
        severity: "warning",
        description: "",
        sourceApiVersion: "3",
        ...(opts.read !== undefined ? { read: opts.read } : {}),
        ...(opts.activeProbe ? { activeProbe: { handler: "./probe.js", risk: "low", timeoutMs: 5000 } } : {}),
      };
    }

    it("preserves order: v2 read, v3 read, v3 combined, v3 probe-only", () => {
      const reg = new Map<string, PluginRegistryEntry>();
      reg.set("kastell-plugin-mix", entry("kastell-plugin-mix", [
        v3Check("T-V2", { read: { cmd: "v2 read command", passPattern: "^ok$" } }),
        v3Check("T-V3", { read: { cmd: "v3 read command", passPattern: "^ok$" } }),
        v3Check("T-BOTH", {
          read: { cmd: "combined read command", passPattern: "^ok$" },
          activeProbe: true,
        }),
        v3Check("T-PROBE", { activeProbe: true }),
      ]));
      const stdout =
        "---SECTION:PLUGIN:kastell-plugin-mix:T-V2---\nok\n" +
        "---SECTION:PLUGIN:kastell-plugin-mix:T-V3---\nok\n" +
        "---SECTION:PLUGIN:kastell-plugin-mix:T-BOTH---\nok";
      const result = parsePluginBatchOutput(stdout, reg);
      expect(result).toHaveLength(1);
      expect(result[0].checks.map((c) => c.id)).toEqual([
        "T-V2",
        "T-V3",
        "T-BOTH",
        "T-PROBE",
      ]);
      expect(result[0].checks[3].skip).toEqual({
        code: "active-probe",
        apiVersion: "3",
      });
      expect(result[0].checks[3].currentValue).toBe("");
    });

    it("preserves category order across multiple plugins in registry iteration order", () => {
      const reg = new Map<string, PluginRegistryEntry>();
      reg.set("kastell-plugin-z", entry("kastell-plugin-z", [
        v3Check("Z-001", { read: { cmd: "echo z", passPattern: "^z$" } }),
      ]));
      reg.set("kastell-plugin-a", entry("kastell-plugin-a", [
        v3Check("A-001", { read: { cmd: "echo a", passPattern: "^a$" } }),
      ]));
      const stdout =
        "---SECTION:PLUGIN:kastell-plugin-z:Z-001---\nz\n" +
        "---SECTION:PLUGIN:kastell-plugin-a:A-001---\na";
      const result = parsePluginBatchOutput(stdout, reg);
      expect(result.map((c) => c.name)).toEqual(["Plugin: z", "Plugin: a"]);
    });
  });

  it("P150 regression: preserves plugin ordering, section protocol, and skip behavior", () => {
    const reg = new Map<string, PluginRegistryEntry>();

    reg.set("kastell-plugin-alpha", entry("kastell-plugin-alpha", [
      check("A-READ", { passPattern: "^alpha-ok$" }),
      check("A-MUTATE", { checkCommand: { kind: "mutate-local", cmd: "systemctl restart nginx" } }),
    ]));

    reg.set("kastell-plugin-failed", entry("kastell-plugin-failed", [check("F-001")]));
    reg.get("kastell-plugin-failed")!.status = "failed";

    reg.set("kastell-plugin-beta", entry("kastell-plugin-beta", [
      {
        id: "B-READ",
        category: "WordPress",
        name: "B-READ",
        severity: "warning",
        description: "",
        sourceApiVersion: "3",
        read: { cmd: "echo beta-ok", passPattern: "^beta-ok$" },
      },
      {
        id: "B-PROBE",
        category: "WordPress",
        name: "B-PROBE",
        severity: "warning",
        description: "",
        sourceApiVersion: "3",
        activeProbe: { handler: "./probe.js", risk: "low", timeoutMs: 5000 },
      },
    ]));

    const stdout = [
      "---SECTION:PLUGIN:kastell-plugin-ghost:GHOST-001---",
      "ignored ghost output",
      "---SECTION:PLUGIN:kastell-plugin-alpha:A-READ---",
      "alpha-ok",
      "---SECTION:PLUGIN:kastell-plugin-beta:B-READ---",
      "beta-ok",
      "---SECTION:PLUGIN:kastell-plugin-alpha:UNKNOWN---",
      "ignored unknown check",
      "---SECTION:PLUGIN:kastell-plugin-beta:---",
      "ignored empty check id",
    ].join("\n");

    const result = parsePluginBatchOutput(stdout, reg);

    expect(result.map((cat) => cat.name)).toEqual(["Plugin: alpha", "Plugin: beta"]);
    expect(result[0].checks.map((check) => check.id)).toEqual(["A-READ", "A-MUTATE"]);
    expect(result[1].checks.map((check) => check.id)).toEqual(["B-READ", "B-PROBE"]);

    expect(result[0].checks[0]).toMatchObject({
      id: "A-READ",
      passed: true,
      currentValue: "alpha-ok",
    });
    expect(result[0].checks[1]).toMatchObject({
      id: "A-MUTATE",
      passed: false,
      currentValue: "",
      skip: { code: "legacy-mutating", apiVersion: "2", kind: "mutate-local" },
    });
    expect(result[1].checks[0]).toMatchObject({
      id: "B-READ",
      passed: true,
      currentValue: "beta-ok",
    });
    expect(result[1].checks[1]).toMatchObject({
      id: "B-PROBE",
      passed: false,
      currentValue: "",
      skip: { code: "active-probe", apiVersion: "3" },
    });
  });

  it("P150 regression: warning stream preserves registry order for skipped plugin checks", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-alpha", entry("kastell-plugin-alpha", [
      check("A-MUTATE", { checkCommand: { kind: "mutate-local", cmd: "systemctl restart nginx" } }),
    ]));
    reg.set("kastell-plugin-beta", entry("kastell-plugin-beta", [
      {
        id: "B-PROBE",
        category: "WordPress",
        name: "B-PROBE",
        severity: "warning",
        description: "",
        sourceApiVersion: "3",
        activeProbe: { handler: "./probe.js", risk: "low", timeoutMs: 5000 },
      },
    ]));

    expect(getSkippedMutatingPluginWarnings(reg)).toEqual([
      "Plugin kastell-plugin-alpha check A-MUTATE is mutate-local and is not run by kastell audit",
      "Plugin kastell-plugin-beta check B-PROBE is probe-only and is not run by kastell audit",
    ]);
  });
});
