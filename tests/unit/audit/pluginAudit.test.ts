import {
  getSkippedMutatingPluginWarnings,
  hasLoadedPluginChecks,
  isMutatingPluginAuditCurrentValue,
  mutatingPluginAuditCurrentValue,
  parsePluginBatchOutput,
} from "../../../src/core/audit/pluginAudit.js";
import { PLUGIN_STATUS_FAILED, PLUGIN_STATUS_LOADED } from "../../../src/plugin/registry.js";
import type { PluginRegistryEntry } from "../../../src/plugin/registry.js";
import type { PluginCheck, PluginFix, PluginManifest, PluginCheckCommandKind } from "../../../src/plugin/sdk/types.js";

function loadedEntry(name: string, checks: PluginCheck[], fixes?: PluginFix[]): PluginRegistryEntry {
  const manifest: PluginManifest = {
    name,
    version: "1.0.0",
    apiVersion: "2",
    kastell: "*",
    capabilities: fixes ? ["audit", "fix"] : ["audit"],
    checkPrefix: "VP",
    entry: "./index.js",
    ...(fixes ? { fixes } : {}),
  };
  const checksById = new Map(checks.map((c) => [c.id, c]));
  const fixesByCheckId = new Map((fixes ?? []).map((f) => [f.checkId, f]));
  return { manifest, checks, status: PLUGIN_STATUS_LOADED, checksById, fixesByCheckId };
}

function failedEntry(name: string): PluginRegistryEntry {
  return {
    status: PLUGIN_STATUS_FAILED,
    manifest: {
      name,
      version: "1.0.0",
      apiVersion: "2",
      kastell: "*",
      capabilities: ["audit"],
      checkPrefix: "VP",
      entry: "./index.js",
    },
    reason: "test failure",
    checks: [],
    checksById: new Map<string, never>(),
    fixesByCheckId: new Map<string, never>(),
  };
}

function check(id: string, kind: PluginCheckCommandKind = "read"): PluginCheck {
  return {
    id,
    category: "Test",
    name: id,
    severity: "warning",
    description: "",
    checkCommand: { kind, cmd: "echo ok" },
  };
}

describe("mutatingPluginAuditCurrentValue", () => {
  it("produces expected format for mutate-local", () => {
    expect(mutatingPluginAuditCurrentValue("mutate-local")).toBe(
      "Not run by kastell audit (mutating kind: mutate-local)",
    );
  });

  it("produces expected format for mutate-global", () => {
    expect(mutatingPluginAuditCurrentValue("mutate-global")).toBe(
      "Not run by kastell audit (mutating kind: mutate-global)",
    );
  });
});

describe("isMutatingPluginAuditCurrentValue", () => {
  it("returns false for ordinary values", () => {
    expect(isMutatingPluginAuditCurrentValue("Unable to determine")).toBe(false);
    expect(isMutatingPluginAuditCurrentValue("")).toBe(false);
    expect(isMutatingPluginAuditCurrentValue("ok")).toBe(false);
    expect(isMutatingPluginAuditCurrentValue("Not run by kastell audit (something else)")).toBe(false);
  });

  it("returns false for prefix but missing closing paren", () => {
    expect(isMutatingPluginAuditCurrentValue("Not run by kastell audit (mutating kind: mutate-local")).toBe(false);
  });

  it("returns false for suffix but missing opening prefix", () => {
    expect(isMutatingPluginAuditCurrentValue("(mutating kind: mutate-local)")).toBe(false);
  });

  it("returns true for both producer outputs (roundtrip)", () => {
    expect(isMutatingPluginAuditCurrentValue(mutatingPluginAuditCurrentValue("mutate-local"))).toBe(true);
    expect(isMutatingPluginAuditCurrentValue(mutatingPluginAuditCurrentValue("mutate-global"))).toBe(true);
  });
});

describe("hasLoadedPluginChecks", () => {
  it("returns false for empty registry", () => {
    expect(hasLoadedPluginChecks(new Map())).toBe(false);
  });

  it("returns false when only failed entries are present", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-broken", failedEntry("kastell-plugin-broken"));
    expect(hasLoadedPluginChecks(reg)).toBe(false);
  });

  it("returns false for loaded entry with empty checks", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-empty", loadedEntry("kastell-plugin-empty", []));
    expect(hasLoadedPluginChecks(reg)).toBe(false);
  });

  it("returns true for loaded entry with at least one check", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-real", loadedEntry("kastell-plugin-real", [check("VP-001")]));
    expect(hasLoadedPluginChecks(reg)).toBe(true);
  });

  it("returns true even when registry mixes failed and loaded entries", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-broken", failedEntry("kastell-plugin-broken"));
    reg.set("kastell-plugin-real", loadedEntry("kastell-plugin-real", [check("VP-001")]));
    expect(hasLoadedPluginChecks(reg)).toBe(true);
  });

  it("returns true for all-mutating loaded entry (batch not built, but checks surface)", () => {
    // runAudit gate: all-mutating plugins never produce a 4th batch, but
    // parsePluginBatchOutput must still surface their skipped checks.
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-mut", loadedEntry("kastell-plugin-mut", [check("VP-MUT", "mutate-local")]));
    expect(hasLoadedPluginChecks(reg)).toBe(true);
  });
});

describe("getSkippedMutatingPluginWarnings", () => {
  it("returns empty array for read-only registry", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-read", loadedEntry("kastell-plugin-read", [
      check("VP-READ-1"),
      check("VP-READ-2"),
    ]));
    expect(getSkippedMutatingPluginWarnings(reg)).toEqual([]);
  });

  it("returns empty array for empty registry", () => {
    expect(getSkippedMutatingPluginWarnings(new Map())).toEqual([]);
  });

  it("returns warning per mutating check across plugins", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-a", loadedEntry("kastell-plugin-a", [
      check("VP-A-1", "mutate-local"),
      check("VP-A-2", "read"),
    ]));
    reg.set("kastell-plugin-b", loadedEntry("kastell-plugin-b", [
      check("VP-B-1", "mutate-global"),
    ]));
    const warnings = getSkippedMutatingPluginWarnings(reg);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toBe("Plugin kastell-plugin-a check VP-A-1 is mutate-local and is not run by kastell audit");
    expect(warnings[1]).toBe("Plugin kastell-plugin-b check VP-B-1 is mutate-global and is not run by kastell audit");
  });

  it("ignores failed and empty-check entries", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-failed", failedEntry("kastell-plugin-failed"));
    reg.set("kastell-plugin-empty", loadedEntry("kastell-plugin-empty", []));
    reg.set("kastell-plugin-mut", loadedEntry("kastell-plugin-mut", [check("VP-M", "mutate-local")]));
    const warnings = getSkippedMutatingPluginWarnings(reg);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("kastell-plugin-mut");
  });
});

describe("parsePluginBatchOutput — structured skip metadata (P142 Task 2)", () => {
  it("v2 mutating plugin checks emit skip metadata with empty currentValue", () => {
    // P142 Task 2: replace sentinel-string with structured skip object on
    // AuditCheck. Audit consumers (scoring/quickwin/fix) gate on
    // check.skip !== undefined, not on regex match.
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-mut", loadedEntry("kastell-plugin-mut", [
      check("VP-M-LOCAL", "mutate-local"),
      check("VP-M-GLOBAL", "mutate-global"),
    ]));
    const result = parsePluginBatchOutput("", reg);
    expect(result).toHaveLength(1);
    const checks = result[0].checks;
    expect(checks).toHaveLength(2);
    const local = checks.find((c) => c.id === "VP-M-LOCAL");
    const global = checks.find((c) => c.id === "VP-M-GLOBAL");
    expect(local?.skip).toEqual({
      code: "legacy-mutating",
      apiVersion: "2",
      kind: "mutate-local",
    });
    expect(global?.skip).toEqual({
      code: "legacy-mutating",
      apiVersion: "2",
      kind: "mutate-global",
    });
    expect(local?.currentValue).toBe("");
    expect(global?.currentValue).toBe("");
  });

  it("read checks with no skip metadata remain available (no false positive)", () => {
    // Companion: read check is NOT skipped — its skip field is undefined.
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-mix", loadedEntry("kastell-plugin-mix", [
      check("VP-READ", "read"),
    ]));
    const stdout = "---SECTION:PLUGIN:kastell-plugin-mix:VP-READ---\nok";
    const result = parsePluginBatchOutput(stdout, reg);
    expect(result[0].checks[0].skip).toBeUndefined();
  });
});

describe("parsePluginBatchOutput — mutating-skip behavior", () => {
  it("surfaces all-mutating loaded plugin as not-run when stdout is empty", () => {
    // buildPluginBatchSection returns null (no read checks → no 4th batch) but
    // the audit still surfaces the skipped checks.
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-mut", loadedEntry("kastell-plugin-mut", [
      check("VP-M-LOCAL", "mutate-local"),
      check("VP-M-GLOBAL", "mutate-global"),
    ]));
    const result = parsePluginBatchOutput("", reg);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Plugin: mut");
    expect(result[0].checks).toHaveLength(2);
    for (const c of result[0].checks) {
      expect(c.passed).toBe(false);
      expect(isMutatingPluginAuditCurrentValue(c.currentValue)).toBe(true);
    }
  });

  it("emits mutating sentinel for mutating checks even when batch section is present", () => {
    // Defensive: if a section is accidentally emitted for a mutating check,
    // the parser still falls back to the sentinel.
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-mix", loadedEntry("kastell-plugin-mix", [
      check("VP-READ", "read"),
      check("VP-MUT", "mutate-local"),
    ]));
    // Only the read check has a section; mutating check has none → sentinel.
    const stdout = "---SECTION:PLUGIN:kastell-plugin-mix:VP-READ---\nok";
    const result = parsePluginBatchOutput(stdout, reg);
    expect(result).toHaveLength(1);
    const read = result[0].checks.find((c) => c.id === "VP-READ");
    const mut = result[0].checks.find((c) => c.id === "VP-MUT");
    expect(read?.passed).toBe(true);
    expect(read?.currentValue).toBe("ok");
    expect(mut?.passed).toBe(false);
    expect(mut?.currentValue).toBe(mutatingPluginAuditCurrentValue("mutate-local"));
  });

  it("drops sections for unknown plugin (debugLog + continue)", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-known", loadedEntry("kastell-plugin-known", [
      check("VP-001", "read"),
    ]));
    const stdout =
      "---SECTION:PLUGIN:kastell-plugin-unknown:XX-1---\nok\n" +
      "---SECTION:PLUGIN:kastell-plugin-known:VP-001---\nok";
    const result = parsePluginBatchOutput(stdout, reg);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Plugin: known");
    expect(result[0].checks[0].passed).toBe(true);
  });

  it("drops sections for unknown check id within known plugin", () => {
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-wp", loadedEntry("kastell-plugin-wp", [
      check("VP-001", "read"),
    ]));
    const stdout =
      "---SECTION:PLUGIN:kastell-plugin-wp:VP-UNKNOWN---\ngarbage\n" +
      "---SECTION:PLUGIN:kastell-plugin-wp:VP-001---\nok";
    const result = parsePluginBatchOutput(stdout, reg);
    expect(result).toHaveLength(1);
    expect(result[0].checks.find((c) => c.id === "VP-001")?.passed).toBe(true);
  });

  it("skips loaded entries with empty checks list (pass-2 length guard)", () => {
    // Coverage for entry.checks.length === 0 branch.
    const reg = new Map<string, PluginRegistryEntry>();
    reg.set("kastell-plugin-empty", loadedEntry("kastell-plugin-empty", []));
    reg.set("kastell-plugin-real", loadedEntry("kastell-plugin-real", [
      check("VP-001", "read"),
    ]));
    const result = parsePluginBatchOutput("", reg);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Plugin: real");
  });
});
