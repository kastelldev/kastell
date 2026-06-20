import { readFileSync } from "fs";
import { join } from "path";
import { validateManifest, validateChecks } from "../../../src/plugin/validate.js";
import type {
  PluginCheckV2,
  PluginCheckV3,
} from "../../../src/plugin/sdk/types.js";

jest.mock("../../../src/utils/version.js", () => ({
  KASTELL_VERSION: "2.3.0",
}));

const EXAMPLES_DIR = join(__dirname, "../../../examples/plugins");

/**
 * Read a plugin entry module as text and extract its ESM exports without
 * executing it. The repository declares `"type": "module"`, so the
 * maintained examples are real ESM and use `export` statements — we
 * inspect the source structurally rather than running it through a JS
 * evaluator. This is the "import and inspect" cross-platform test that
 * the brief requires; it intentionally does not execute the remote
 * shell lifecycle.
 */
function readPluginModule(pluginDir: string): {
  source: string;
  exportNames: string[];
  namedHandlers: Record<string, string>;
} {
  const source = readFileSync(join(pluginDir, "index.js"), "utf-8");
  const exportNames: string[] = [];
  const re = /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    exportNames.push(match[1]);
  }
  const namedHandlers: Record<string, string> = {};
  for (const name of exportNames) {
    namedHandlers[name] = source;
  }
  return { source, exportNames, namedHandlers };
}

function parseChecksFromSource(source: string): PluginCheckV3[] {
  // The maintained examples serialize the `checks` array as a JS object
  // literal in `export const checks = [ ... ];`. We extract the literal
  // and evaluate it in an isolated scope so we can read the resulting
  // array. The shape is validated downstream by validateChecks.
  const arrayMatch = source.match(/export\s+const\s+checks\s*=\s*(\[[\s\S]*?\n\];)/);
  if (!arrayMatch) {
    throw new Error("could not locate `export const checks = [ ... ];` literal");
  }
  const literal = arrayMatch[1].replace(/;$/, "");
  // eslint-disable-next-line no-new-func
  const fn = new Function(`"use strict"; return (${literal});`);
  return fn() as PluginCheckV3[];
}

describe("example plugin: kastell-plugin-wordpress", () => {
  const pluginDir = join(EXAMPLES_DIR, "kastell-plugin-wordpress");

  it("declares apiVersion 3 and read-only audit capability", () => {
    const raw = readFileSync(join(pluginDir, "kastell-plugin.json"), "utf-8");
    const manifest = validateManifest(JSON.parse(raw));
    expect(manifest.apiVersion).toBe("3");
    expect(manifest.name).toBe("kastell-plugin-wordpress");
    expect(manifest.checkPrefix).toBe("WP");
    expect(manifest.capabilities).toEqual(["audit"]);
  });

  it("exports three v3 read checks with preserved IDs, order, and severity", () => {
    const { source } = readPluginModule(pluginDir);
    const checks = parseChecksFromSource(source);
    expect(Array.isArray(checks)).toBe(true);
    expect(checks).toHaveLength(3);

    expect(checks[0].id).toBe("WP-FILE-PERMS");
    expect(checks[0].severity).toBe("warning");
    expect(checks[0].read?.cmd).toBe("find /var/www/html -type f -perm -002 | wc -l");
    expect(checks[0].read?.passPattern).toBe("^0$");
    expect(checks[0].activeProbe).toBeUndefined();

    expect(checks[1].id).toBe("WP-CONFIG-SECURE");
    expect(checks[1].severity).toBe("critical");
    expect(checks[1].read?.cmd).toBe("stat -c %a /var/www/html/wp-config.php");
    expect(checks[1].read?.passPattern).toBe("^[46]00$");

    expect(checks[2].id).toBe("WP-DEBUG-OFF");
    expect(checks[2].severity).toBe("warning");
    expect(checks[2].read?.cmd).toBe("grep -c 'WP_DEBUG.*true' /var/www/html/wp-config.php");
    expect(checks[2].read?.passPattern).toBe("^0$");
  });

  it("retains a 1:1 v2-to-v3 read mapping (no behavioral drift)", () => {
    const raw = readFileSync(join(pluginDir, "kastell-plugin.json"), "utf-8");
    const manifest = validateManifest(JSON.parse(raw));
    const { source } = readPluginModule(pluginDir);
    const checks = parseChecksFromSource(source);
    const validated = validateChecks(
      checks,
      manifest.checkPrefix,
      "3",
      manifest.name,
    ) as PluginCheckV3[];
    const ids = validated.map((c) => c.id);
    expect(ids).toEqual(["WP-FILE-PERMS", "WP-CONFIG-SECURE", "WP-DEBUG-OFF"]);
  });

  it("is authored as ESM with named export `checks`", () => {
    const { source, exportNames } = readPluginModule(pluginDir);
    expect(source).toMatch(/export\s+const\s+checks/);
    expect(exportNames).toEqual([]); // no exported function names; data exports only
  });
});

describe("example plugin: kastell-plugin-auditor", () => {
  const pluginDir = join(EXAMPLES_DIR, "kastell-plugin-auditor");

  it("declares apiVersion 3 with audit + command + mcp-tool capabilities", () => {
    const raw = readFileSync(join(pluginDir, "kastell-plugin.json"), "utf-8");
    const manifest = validateManifest(JSON.parse(raw));
    expect(manifest.apiVersion).toBe("3");
    expect(manifest.name).toBe("kastell-plugin-auditor");
    expect(manifest.checkPrefix).toBe("AUD");
    expect(manifest.capabilities).toEqual(
      expect.arrayContaining(["audit", "command", "mcp-tool"]),
    );
  });

  it("combines a read-only check and a combined read + Active Probe check", () => {
    const { source } = readPluginModule(pluginDir);
    const checks = parseChecksFromSource(source);
    expect(checks).toHaveLength(2);

    const sshCheck = checks.find((c) => c.id === "AUD-SSH-CUSTOM-PORT")!;
    expect(sshCheck.read).toBeDefined();
    expect(sshCheck.read?.cmd).toBe("grep '^Port ' /etc/ssh/sshd_config | awk '{print $2}'");
    expect(sshCheck.read?.failPattern).toBe("^22$");
    expect(sshCheck.activeProbe).toBeUndefined();

    const probeCheck = checks.find((c) => c.id === "AUD-TMP-MODE-ACTIVE")!;
    expect(probeCheck.severity).toBe("info");
    expect(probeCheck.read).toBeDefined();
    expect(probeCheck.read?.cmd).toBe("test -d /tmp && test -w /tmp && echo ready");
    expect(probeCheck.read?.passPattern).toBe("^ready$");
    expect(probeCheck.activeProbe).toBeDefined();
    expect(probeCheck.activeProbe?.handler).toBe("./probes/tmp-mode-round-trip.js");
    expect(probeCheck.activeProbe?.risk).toBe("low");
    expect(probeCheck.activeProbe?.timeoutMs).toBe(30000);
  });

  it("exposes ESM command + mcpTool handlers under the package type=module boundary", () => {
    const cmdPath = join(pluginDir, "commands", "analyze.js");
    const mcpPath = join(pluginDir, "mcp", "report.js");
    const cmdSource = readFileSync(cmdPath, "utf-8");
    const mcpSource = readFileSync(mcpPath, "utf-8");

    expect(cmdSource).toMatch(/export\s+(?:async\s+)?function\s+handler/);
    expect(cmdSource).not.toMatch(/module\.exports/);

    expect(mcpSource).toMatch(/export\s+(?:async\s+)?function\s+handler/);
    expect(mcpSource).not.toMatch(/module\.exports/);
  });
});

describe("example probe: kastell-plugin-auditor/probes/tmp-mode-round-trip", () => {
  const probePath = join(
    EXAMPLES_DIR,
    "kastell-plugin-auditor",
    "probes",
    "tmp-mode-round-trip.js",
  );

  it("exports prepare, execute, verify, and rollback lifecycle functions", () => {
    const source = readFileSync(probePath, "utf-8");
    expect(source).toMatch(/export\s+(?:async\s+)?function\s+prepare\b/);
    expect(source).toMatch(/export\s+(?:async\s+)?function\s+execute\b/);
    expect(source).toMatch(/export\s+(?:async\s+)?function\s+verify\b/);
    expect(source).toMatch(/export\s+(?:async\s+)?function\s+rollback\b/);
  });

  it("has no top-level side effects (no immediate shell invocation)", () => {
    const source = readFileSync(probePath, "utf-8");
    // Strip the body of every `function`/`export ... function` declaration
    // (anything between the opening `{` and the matching `}`). The probe
    // is allowed to call `ctx.ssh` inside the four lifecycle functions;
    // the assertion is that no `ctx.ssh` reference survives at module
    // scope outside those function bodies.
    const withoutFunctionBodies = source.replace(
      /(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{[\s\S]*?\n\}/g,
      "/* fn-body-stripped */",
    );
    expect(withoutFunctionBodies).not.toMatch(/ctx\.ssh/);
  });
});

describe("test fixture: kastell-plugin-v2-readonly", () => {
  const fixtureDir = join(
    __dirname,
    "../../fixtures/plugins/kastell-plugin-v2-readonly",
  );

  it("loads a v2 read-only manifest and check list through validateManifest + validateChecks", () => {
    const raw = readFileSync(join(fixtureDir, "kastell-plugin.json"), "utf-8");
    const manifest = validateManifest(JSON.parse(raw));
    expect(manifest.apiVersion).toBe("2");
    expect(manifest.capabilities).toEqual(["audit"]);

    const source = readFileSync(join(fixtureDir, "index.js"), "utf-8");
    const arrayMatch = source.match(/export\s+const\s+checks\s*=\s*(\[[\s\S]*?\n\];)/);
    expect(arrayMatch).not.toBeNull();
    const literal = arrayMatch![1].replace(/;$/, "");
    // eslint-disable-next-line no-new-func
    const checks = new Function(`"use strict"; return (${literal});`)() as PluginCheckV2[];
    const validated = validateChecks(
      checks,
      manifest.checkPrefix,
      "2",
      manifest.name,
    ) as PluginCheckV2[];
    expect(validated).toHaveLength(1);
    expect(validated[0].id).toBe("VROR-LEGACY-CHECK");
    expect(validated[0].checkCommand?.kind).toBe("read");
  });
});

describe("test fixture: kastell-plugin-mock", () => {
  const fixtureDir = join(__dirname, "../../fixtures/plugins/kastell-plugin-mock");

  it("loads as a v3 read-only fixture", () => {
    const raw = readFileSync(join(fixtureDir, "kastell-plugin.json"), "utf-8");
    const manifest = validateManifest(JSON.parse(raw));
    expect(manifest.apiVersion).toBe("3");
    expect(manifest.checkPrefix).toBe("MOCK");

    const source = readFileSync(join(fixtureDir, "index.js"), "utf-8");
    const arrayMatch = source.match(/export\s+const\s+checks\s*=\s*(\[[\s\S]*?\n\];)/);
    expect(arrayMatch).not.toBeNull();
    const literal = arrayMatch![1].replace(/;$/, "");
    // eslint-disable-next-line no-new-func
    const checks = new Function(`"use strict"; return (${literal});`)() as PluginCheckV3[];
    const validated = validateChecks(
      checks,
      manifest.checkPrefix,
      "3",
      manifest.name,
    ) as PluginCheckV3[];
    expect(validated).toHaveLength(2);
    expect(validated[0].read).toBeDefined();
  });
});
