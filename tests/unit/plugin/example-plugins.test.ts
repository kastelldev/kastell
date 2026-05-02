import { readFileSync } from "fs";
import { join } from "path";
import { validateManifest } from "../../../src/plugin/validate.js";

jest.mock("../../../src/utils/version.js", () => ({
  KASTELL_VERSION: "2.2.0",
}));

const EXAMPLES_DIR = join(__dirname, "../../../examples/plugins");

describe("example plugin: kastell-plugin-wordpress", () => {
  const pluginDir = join(EXAMPLES_DIR, "kastell-plugin-wordpress");

  it("has a valid manifest", () => {
    const raw = readFileSync(join(pluginDir, "kastell-plugin.json"), "utf-8");
    const manifest = validateManifest(JSON.parse(raw));
    expect(manifest.name).toBe("kastell-plugin-wordpress");
    expect(manifest.checkPrefix).toBe("WP");
    expect(manifest.capabilities).toEqual(["audit"]);
  });

  it("exports checks array with correct IDs and prefix", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(join(pluginDir, "index.js"));
    expect(Array.isArray(mod.checks)).toBe(true);
    expect(mod.checks).toHaveLength(3);

    for (const check of mod.checks) {
      expect(check.id).toMatch(/^WP-/);
      expect(check.name).toBeTruthy();
      expect(check.category).toBe("WordPress");
      expect(["critical", "warning", "info"]).toContain(check.severity);
      expect(check.checkCommand).toBeTruthy();
    }
  });

  it("has expected check IDs", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(join(pluginDir, "index.js"));
    const ids = (mod.checks as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain("WP-FILE-PERMS");
    expect(ids).toContain("WP-CONFIG-SECURE");
    expect(ids).toContain("WP-DEBUG-OFF");
  });
});

describe("example plugin: kastell-plugin-auditor", () => {
  const pluginDir = join(EXAMPLES_DIR, "kastell-plugin-auditor");

  it("has a valid manifest", () => {
    const raw = readFileSync(join(pluginDir, "kastell-plugin.json"), "utf-8");
    const manifest = validateManifest(JSON.parse(raw));
    expect(manifest.name).toBe("kastell-plugin-auditor");
    expect(manifest.checkPrefix).toBe("AUD");
    expect(manifest.capabilities).toEqual(["audit"]);
  });

  it("exports checks array with correct IDs and prefix", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(join(pluginDir, "index.js"));
    expect(Array.isArray(mod.checks)).toBe(true);
    expect(mod.checks).toHaveLength(2);

    for (const check of mod.checks) {
      expect(check.id).toMatch(/^AUD-/);
      expect(check.name).toBeTruthy();
      expect(["critical", "warning", "info"]).toContain(check.severity);
      expect(check.checkCommand).toBeTruthy();
    }
  });

  it("has expected check IDs", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(join(pluginDir, "index.js"));
    const ids = (mod.checks as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain("AUD-SSH-CUSTOM-PORT");
    expect(ids).toContain("AUD-FAIL2BAN-ACTIVE");
  });
});