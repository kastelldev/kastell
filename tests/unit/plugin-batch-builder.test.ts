import { buildAuditBatchCommands, buildPluginBatchSection } from "../../src/core/audit/commands.js";
import type { PluginRegistryEntry } from "../../src/plugin/registry.js";
import type { PluginManifest, PluginCheckV2 } from "../../src/plugin/sdk/types.js";

function makeEntry(name: string, checks: PluginCheckV2[], s: "loaded" | "failed" = "loaded"): PluginRegistryEntry {
  const manifest: PluginManifest = {
    name,
    version: "1.0.0",
    apiVersion: "2",
    kastell: "*",
    capabilities: ["audit"],
    checkPrefix: name.split("-").pop()!.toUpperCase().slice(0, 6),
    entry: "./index.js",
  };
  if (s === "failed") {
    return {
      descriptor: { name: manifest.name },
      status: "failed",
      reason: "test reason",
      checks: [],
      checksById: new Map(),
      activeProbesByCheckId: new Map(),
      fixesByCheckId: new Map(),
    } as unknown as PluginRegistryEntry;
  }
  const checksById = new Map(checks.map((c) => [c.id, c]));
  return {
    manifest,
    checks,
    // P144 T5: builder iterates entry.readChecks (normalized, ordered).
    // Fixture builds the index from the legacy PluginCheckV2 list using
    // the read-kind contract and synthesizes `read.cmd` from `checkCommand.cmd`.
    readChecks: checks
      .filter((c) => c.checkCommand.kind === "read")
      .map((c) => ({
        ...c,
        read: { cmd: c.checkCommand.cmd },
      })) as unknown as PluginRegistryEntry["readChecks"] extends readonly (infer T)[] ? T[] : never,
    status: "loaded",
    checksById,
    fixesByCheckId: new Map(),
    activeProbesByCheckId: new Map(),
  } as unknown as PluginRegistryEntry;
}

function check(
  id: string,
  cmd = "echo ok",
  kind: PluginCheckV2["checkCommand"]["kind"] = "read",
): PluginCheckV2 {
  return {
    id,
    category: "X",
    name: id,
    severity: "info",
    description: "",
    checkCommand: { kind, cmd },
  };
}

describe("buildPluginBatchSection", () => {
  it("returns null for empty registry", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    expect(buildPluginBatchSection(reg)).toBeNull();
  });

  it("returns null when all plugins have zero checks", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-empty", makeEntry("kastell-plugin-empty", []));
    expect(buildPluginBatchSection(reg)).toBeNull();
  });

  it("skips plugins with status !== loaded", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-failed", makeEntry("kastell-plugin-failed", [check("FAIL-001")], "failed"));
    expect(buildPluginBatchSection(reg)).toBeNull();
  });

  it("builds heredoc-wrapped section for one plugin with three checks", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set(
      "kastell-plugin-wp",
      makeEntry("kastell-plugin-wp", [check("WP-001", "echo a"), check("WP-002", "echo b"), check("WP-003", "echo c")]),
    );
    const out = buildPluginBatchSection(reg)!;
    expect(out).toContain("---SECTION:PLUGIN:kastell-plugin-wp:WP-001---");
    expect(out).toContain("---SECTION:PLUGIN:kastell-plugin-wp:WP-002---");
    expect(out).toContain("---SECTION:PLUGIN:kastell-plugin-wp:WP-003---");
    expect(out).toContain("bash <<'KASTELL_PLUGIN_CHECK_EOF' 2>/dev/null\necho a\nKASTELL_PLUGIN_CHECK_EOF");
  });

  it("preserves registry iteration order across plugins", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-a", makeEntry("kastell-plugin-a", [check("A-001")]));
    reg.set("kastell-plugin-b", makeEntry("kastell-plugin-b", [check("B-001")]));
    const out = buildPluginBatchSection(reg)!;
    expect(out.indexOf("A-001")).toBeLessThan(out.indexOf("B-001"));
  });

  it("emits closing tag at column 0 with newline before and after", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-x", makeEntry("kastell-plugin-x", [check("X-001", "echo body")]));
    const out = buildPluginBatchSection(reg)!;
    // closing tag appears at start of line (column 0), preceded by body line ending with \n
    expect(out).toMatch(/\necho body\nKASTELL_PLUGIN_CHECK_EOF/);
    // no indented closing tag
    expect(out).not.toMatch(/[ \t]+KASTELL_PLUGIN_CHECK_EOF/);
  });

  it("excludes mutating checks from plugin batch heredoc", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set(
      "kastell-plugin-wp",
      makeEntry("kastell-plugin-wp", [
        check("WP-READ", "echo read"),
        check("WP-LOCAL", "systemctl restart nginx", "mutate-local"),
        check("WP-GLOBAL", "hcloud firewall apply-to-resource", "mutate-global"),
      ]),
    );

    const out = buildPluginBatchSection(reg)!;
    expect(out).toContain("PLUGIN:kastell-plugin-wp:WP-READ");
    expect(out).toContain("echo read");
    expect(out).not.toContain("WP-LOCAL");
    expect(out).not.toContain("WP-GLOBAL");
    expect(out).not.toContain("systemctl restart nginx");
  });

  it("returns null when loaded plugins only have mutating checks", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-wp", makeEntry("kastell-plugin-wp", [
      check("WP-LOCAL", "systemctl restart nginx", "mutate-local"),
    ]));

    expect(buildPluginBatchSection(reg)).toBeNull();
  });

  // P144 Task 5: v3 normalized-read execution preserves plugin/category
  // iteration order. The builder must iterate entry.readChecks (already
  // ordered by the registry) and only emit checks that have a `read`.
  describe("v3 plugin checks (P144 T5)", () => {
    function makeLoadedEntry(
      name: string,
      checks: Array<{
        id: string;
        read?: { cmd: string };
        activeProbe?: boolean;
        checkCommand?: { kind: PluginCheckV2["checkCommand"]["kind"]; cmd: string };
      }>,
    ): PluginRegistryEntry {
      const loaded: PluginCheckV2[] = checks.map((c) => ({
        id: c.id,
        category: "X",
        name: c.id,
        severity: "info",
        description: "",
        checkCommand: c.checkCommand ?? { kind: "read", cmd: c.read?.cmd ?? "echo" },
      }));
      return {
        manifest: {
          name,
          version: "1.0.0",
          apiVersion: "3",
          kastell: "*",
          capabilities: ["audit"],
          checkPrefix: name.split("-").pop()!.toUpperCase().slice(0, 6),
          entry: "./index.js",
        },
        checks: loaded,
        // Builder iterates entry.readChecks after T5. Fixture synthesizes
        // `read.cmd` from the legacy checkCommand so the shape matches
        // what `registerPlugin` would produce via validateAndNormalizeChecks.
        readChecks: loaded
          .filter((c) => c.checkCommand?.kind === "read")
          .map((c) => ({ ...c, read: { cmd: c.checkCommand.cmd } })) as never,
        status: "loaded",
        checksById: new Map(loaded.map((c) => [c.id, c] as [string, PluginCheckV2])),
        fixesByCheckId: new Map(),
        activeProbesByCheckId: new Map(),
      } as unknown as PluginRegistryEntry;
    }

    it("emits sections for v2 read, v3 read, v3 combined; skips v3 probe-only", () => {
      const reg = new Map<string, PluginRegistryEntry>();
      reg.set("kastell-plugin-mix", makeLoadedEntry("kastell-plugin-mix", [
        { id: "T-V2", read: { cmd: "v2 read command" } },
        { id: "T-V3", read: { cmd: "v3 read command" } },
        { id: "T-BOTH", read: { cmd: "combined read command" } },
        // Probe-only: legacy kind != read keeps it out of readChecks.
        // v3 normalize would set checkCommand undefined + activeProbe defined.
        { id: "T-PROBE", activeProbe: true, checkCommand: { kind: "mutate-local", cmd: "noop" } },
      ]));
      const out = buildPluginBatchSection(reg)!;
      expect(out).toContain("T-V2");
      expect(out).toContain("T-V3");
      expect(out).toContain("T-BOTH");
      expect(out).not.toContain("T-PROBE");
    });
  });
});

describe("buildAuditBatchCommands with registry", () => {
  it("returns 3 batches when registry is undefined", () => {
    const batches = buildAuditBatchCommands({ platform: "coolify" });
    expect(batches).toHaveLength(3);
    expect(batches.map((b) => b.tier)).toEqual(["fast", "medium", "slow"]);
  });

  it("returns 3 batches when registry is empty", () => {
    const batches = buildAuditBatchCommands({ platform: "coolify", pluginRegistry: new Map() });
    expect(batches).toHaveLength(3);
  });

  it("returns 4 batches when registry has loaded plugin with checks", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-wp", makeEntry("kastell-plugin-wp", [check("WP-001")]));
    const batches = buildAuditBatchCommands({ platform: "coolify", pluginRegistry: reg });
    expect(batches).toHaveLength(4);
    expect(batches[3].tier).toBe("plugin");
    expect(batches[3].command).toContain("PLUGIN:kastell-plugin-wp:WP-001");
  });
});
