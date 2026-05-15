import { describe, it, expect, beforeEach } from "@jest/globals";
import { clearPluginRegistry, getPluginRegistry } from "../../../src/plugin/registry.js";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadPlugins } from "../../../src/plugin/loader.js";

describe("loadPlugins — check validation", () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kastell-plugin-test-"));
    originalEnv = process.env.KASTELL_DIR;
    process.env.KASTELL_DIR = tmpDir;
    clearPluginRegistry();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.KASTELL_DIR;
    else process.env.KASTELL_DIR = originalEnv;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writePlugin(name: string, manifest: object, checks: unknown[]): void {
    const dir = join(tmpDir, "plugins", "node_modules", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "kastell-plugin.json"), JSON.stringify(manifest));
    writeFileSync(join(dir, "index.js"), `module.exports = { checks: ${JSON.stringify(checks)} };`);
  }

  it("marks plugin failed when check id has shell metachar", async () => {
    writePlugin(
      "kastell-plugin-badid",
      { name: "kastell-plugin-badid", version: "1.0.0", apiVersion: "1", kastell: "*", capabilities: ["audit"], checkPrefix: "BAD", entry: "./index.js" },
      [{ id: "BAD;rm", category: "X", name: "n", severity: "info", checkCommand: "echo x" }],
    );
    const result = await loadPlugins();
    expect(result.errors.length).toBe(1);
    const reg = getPluginRegistry();
    expect(reg.get("kastell-plugin-badid")?.status).toBe("failed");
  });

  it("marks plugin failed when checks not array", async () => {
    writePlugin(
      "kastell-plugin-noarray",
      { name: "kastell-plugin-noarray", version: "1.0.0", apiVersion: "1", kastell: "*", capabilities: ["audit"], checkPrefix: "NA", entry: "./index.js" },
      [],
    );
    // Overwrite index.js with non-array checks
    writeFileSync(
      join(tmpDir, "plugins", "node_modules", "kastell-plugin-noarray", "index.js"),
      `module.exports = { checks: "not-an-array" };`,
    );
    const result = await loadPlugins();
    expect(result.errors.length).toBe(1);
  });
});