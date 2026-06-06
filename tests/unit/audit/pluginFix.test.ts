jest.mock("../../../src/utils/ssh.js", () => ({
  sshExec: jest.fn(),
}));
jest.mock("../../../src/plugin/handlerResolver.js", () => ({
  resolvePluginHandler: jest.fn(),
}));

import { sshExec } from "../../../src/utils/ssh.js";
import {
  isPluginFixCommand,
  parsePluginFixCommand,
  executePluginFix,
  getPluginFixMetadata,
  getPluginBackupPaths,
  getAppliedPluginNames,
  buildFixHistorySource,
} from "../../../src/core/audit/pluginFix.js";
import { isSafeMode } from "../../../src/utils/safeMode.js";
import {
  registerPlugin,
  clearPluginRegistry,
  PLUGIN_STATUS_LOADED,
} from "../../../src/plugin/registry.js";
import { resolvePluginHandler } from "../../../src/plugin/handlerResolver.js";
import type { PluginManifest, PluginCheck, PluginFixHandler } from "../../../src/plugin/sdk/types.js";

const mockSshExec = sshExec as jest.MockedFunction<typeof sshExec>;
const mockResolvePluginHandler = resolvePluginHandler as jest.MockedFunction<typeof resolvePluginHandler>;

function makeLoadedPlugin(
  name: string,
  fixes: PluginManifest["fixes"],
  checkIds: string[],
): { manifest: PluginManifest; checks: PluginCheck[] } {
  const manifest: PluginManifest = {
    name,
    version: "1.0.0",
    apiVersion: "1",
    kastell: "1",
    capabilities: ["audit"],
    checkPrefix: name.replace("kastell-plugin-", "").toUpperCase(),
    entry: "./index.js",
    fixes,
  };
  const checks: PluginCheck[] = checkIds.map((id) => ({
    id,
    name: `Check ${id}`,
    category: "SSH",
    severity: "info" as const,
    description: "test",
    checkCommand: `echo ${id}`,
  }));
  return { manifest, checks };
}

describe("isPluginFixCommand", () => {
  it("returns true for plugin: prefix", () => {
    expect(isPluginFixCommand("plugin:kastell-plugin:./fixes/a.js")).toBe(true);
  });

  it("returns false for core commands", () => {
    expect(isPluginFixCommand("chmod 600 ~/.ssh/authorized_keys")).toBe(false);
    expect(isPluginFixCommand("ufw allow 22/tcp")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isPluginFixCommand(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isPluginFixCommand("")).toBe(false);
  });
});

describe("parsePluginFixCommand", () => {
  it("extracts pluginName and handlerPath", () => {
    const result = parsePluginFixCommand("plugin:kastell-plugin:./fixes/a.js");
    expect(result).toEqual({ pluginName: "kastell-plugin", handlerPath: "./fixes/a.js" });
  });

  it("handles colons in handler path", () => {
    const result = parsePluginFixCommand("plugin:my-plugin:./deep/path/handler.js");
    expect(result).toEqual({ pluginName: "my-plugin", handlerPath: "./deep/path/handler.js" });
  });

  it("returns null for non-plugin command", () => {
    expect(parsePluginFixCommand("chmod 600 file")).toBe(null);
  });

  it("returns null for malformed plugin command (missing parts)", () => {
    expect(parsePluginFixCommand("plugin:")).toBe(null);
    expect(parsePluginFixCommand("plugin:name")).toBe(null);
  });

  it("returns null for empty pluginName or handlerPath", () => {
    expect(parsePluginFixCommand("plugin::handler.js")).toBe(null);
    expect(parsePluginFixCommand("plugin:name:")).toBe(null);
  });
});

describe("executePluginFix", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns error when SAFE_MODE is active", async () => {
    // isSafeMode() reads from process.env.KASTELL_SAFE_MODE
    const original = process.env.KASTELL_SAFE_MODE;
    process.env.KASTELL_SAFE_MODE = "true";
    try {
      const result = await executePluginFix({
        ip: "1.2.3.4",
        checkId: "CHECK-001",
        pluginName: "kastell-plugin",
        handlerPath: "./fixes/a.js",
        dryRun: false,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("SAFE_MODE active");
    } finally {
      if (original === undefined) {
        delete process.env.KASTELL_SAFE_MODE;
      } else {
        process.env.KASTELL_SAFE_MODE = original;
      }
    }
  });

  it("returns error when plugin is not loaded in registry", async () => {
    const result = await executePluginFix({
      ip: "1.2.3.4",
      checkId: "CHECK-001",
      pluginName: "kastell-plugin-nonexistent",
      handlerPath: "./fixes/a.js",
      dryRun: false,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found or failed to load");
  });

  it("returns success for dry-run without importing handler", async () => {
    const result = await executePluginFix({
      ip: "1.2.3.4",
      checkId: "CHECK-001",
      pluginName: "kastell-plugin",
      handlerPath: "./fixes/a.js",
      dryRun: true,
    });
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    // SSH should not be called in dry-run
    expect(mockSshExec).not.toHaveBeenCalled();
  });

it("returns error when handler import throws", async () => {
  // resolvePluginHandler rejects — executePluginFix's try/catch around the
  // dynamic import should surface this as "Failed to import fix handler".
  mockResolvePluginHandler.mockRejectedValue(
    new Error("Cannot find module './does-not-exist.js'"),
  );

  const { manifest, checks } = makeLoadedPlugin(
    "kastell-plugin",
    [{ checkId: "KASTELL-PLUGIN-001", tier: "SAFE", handler: "./does-not-exist.js" }],
    ["KASTELL-PLUGIN-001"],
  );
  clearPluginRegistry();
  registerPlugin(manifest, checks);

  const result = await executePluginFix({
    ip: "1.2.3.4",
    checkId: "KASTELL-PLUGIN-001",
    pluginName: "kastell-plugin",
    handlerPath: "./does-not-exist.js",
    dryRun: false,
  });
  expect(result.success).toBe(false);
  expect(result.error).toMatch(/Failed to import fix handler/);
});

it("returns success with executionLog when handler resolves with success result", async () => {
  const { manifest, checks } = makeLoadedPlugin(
    "kastell-plugin-success",
    [{ checkId: "SUCCESS-001", tier: "SAFE", handler: "./fix.js" }],
    ["SUCCESS-001"],
  );
  clearPluginRegistry();
  registerPlugin(manifest, checks);

  const handler: PluginFixHandler = async (_checkId, ctx) => {
    // Pin the context shape so a future refactor of PluginFixContext fails loud.
    expect(ctx.ip).toBe("1.2.3.4");
    expect(ctx.dryRun).toBe(false);
    expect(ctx.manifest.name).toBe("kastell-plugin-success");
    expect(typeof ctx.ssh).toBe("function");
    expect(typeof ctx.logger.info).toBe("function");
    return { success: true, modifiedFiles: ["/etc/foo.conf"] };
  };
  mockResolvePluginHandler.mockResolvedValue(handler as never);

  const result = await executePluginFix({
    ip: "1.2.3.4",
    checkId: "SUCCESS-001",
    pluginName: "kastell-plugin-success",
    handlerPath: "./fix.js",
    dryRun: false,
  });

  expect(result.success).toBe(true);
  expect(result.error).toBeUndefined();
  expect(result.modifiedFiles).toEqual(["/etc/foo.conf"]);
  expect(result.executionLog?.command).toBe("plugin:kastell-plugin-success:./fix.js");
  expect(result.executionLog?.success).toBe(true);
  expect(result.executionLog?.stdout).toBe("plugin fix applied");
  expect(result.executionLog?.stderr).toBe("");
  expect(typeof result.executionLog?.durationMs).toBe("number");
  // Handler did not call ctx.ssh — sshExec should not have been touched.
  expect(mockSshExec).not.toHaveBeenCalled();
});

it("returns success:false with 'handler threw' error when handlerFn throws", async () => {
  const { manifest, checks } = makeLoadedPlugin(
    "kastell-plugin-throws",
    [{ checkId: "THROWS-001", tier: "SAFE", handler: "./fix.js" }],
    ["THROWS-001"],
  );
  clearPluginRegistry();
  registerPlugin(manifest, checks);

  const handler: PluginFixHandler = async () => {
    throw new Error("boom from handler");
  };
  mockResolvePluginHandler.mockResolvedValue(handler as never);

  const result = await executePluginFix({
    ip: "1.2.3.4",
    checkId: "THROWS-001",
    pluginName: "kastell-plugin-throws",
    handlerPath: "./fix.js",
    dryRun: false,
  });

  expect(result.success).toBe(false);
  expect(result.error).toMatch(/Plugin fix handler threw: boom from handler/);
  expect(result.executionLog?.command).toBe("plugin:kastell-plugin-throws:./fix.js");
  expect(result.executionLog?.success).toBe(false);
  expect(result.executionLog?.stdout).toBe("");
  expect(result.executionLog?.stderr).toBe("boom from handler");
  expect(typeof result.executionLog?.durationMs).toBe("number");
  // Plugin returned success:false through the throw branch — handler never
  // ran to completion, so sshExec should not have been invoked from the
  // outer try/catch path either.
  expect(mockSshExec).not.toHaveBeenCalled();
});
});

// ─── CQS-08 P139 extracted helpers — direct unit coverage ────────────────────
// These were previously only covered indirectly via mocks in 4 other test
// files (plugin-fix-integration, cli-fix-checks, fix-dry-run-error,
// fix-safe-command). The helpers themselves had 0 calls in coverage, so
// edge cases (empty arrays, missing fix, no backupPaths) were untested.

describe("getPluginFixMetadata", () => {
  beforeEach(() => {
    clearPluginRegistry();
  });

  it("returns empty result when registry is empty", () => {
    expect(getPluginFixMetadata([], [])).toEqual({ backupPaths: [], pluginNames: [] });
  });

  it("collects backupPaths from failed checks and pluginNames from applied checks", () => {
    const { manifest, checks } = makeLoadedPlugin(
      "kastell-plugin-wp",
      [
        { checkId: "WP-001", tier: "SAFE", handler: "./fix.js", backupPaths: ["/etc/wp/config.php", "/var/www/.htaccess"] },
        { checkId: "WP-002", tier: "GUARDED", handler: "./fix2.js" },
      ],
      ["WP-001", "WP-002"],
    );
    registerPlugin(manifest, checks);

    const result = getPluginFixMetadata(
      ["WP-001"], // failed
      ["WP-002"], // applied
    );
    expect(result.backupPaths).toEqual(["/etc/wp/config.php", "/var/www/.htaccess"]);
    expect(result.pluginNames).toEqual(["kastell-plugin-wp"]);
  });

  it("skips plugins with no fixes and skips fixes without backupPaths", () => {
    const { manifest, checks } = makeLoadedPlugin(
      "kastell-plugin-x",
      [
        { checkId: "X-001", tier: "SAFE", handler: "./fix.js" /* no backupPaths */ },
      ],
      ["X-001"],
    );
    registerPlugin(manifest, checks);

    const result = getPluginFixMetadata(["X-001"], []);
    expect(result.backupPaths).toEqual([]);
    expect(result.pluginNames).toEqual([]);
  });

  it("deduplicates pluginNames when multiple fixes from same plugin are applied", () => {
    const { manifest, checks } = makeLoadedPlugin(
      "kastell-plugin-y",
      [
        { checkId: "Y-001", tier: "SAFE", handler: "./a.js" },
        { checkId: "Y-002", tier: "SAFE", handler: "./b.js" },
      ],
      ["Y-001", "Y-002"],
    );
    registerPlugin(manifest, checks);

    const result = getPluginFixMetadata([], ["Y-001", "Y-002"]);
    expect(result.pluginNames).toEqual(["kastell-plugin-y"]);
  });
});

describe("getPluginBackupPaths", () => {
  beforeEach(() => {
    clearPluginRegistry();
  });

  it("delegates to getPluginFixMetadata with empty appliedCheckIds", () => {
    const { manifest, checks } = makeLoadedPlugin(
      "kastell-plugin-z",
      [{ checkId: "Z-001", tier: "SAFE", handler: "./f.js", backupPaths: ["/etc/z.conf"] }],
      ["Z-001"],
    );
    registerPlugin(manifest, checks);

    expect(getPluginBackupPaths(["Z-001"])).toEqual(["/etc/z.conf"]);
    expect(getPluginBackupPaths([])).toEqual([]);
  });
});

describe("getAppliedPluginNames", () => {
  beforeEach(() => {
    clearPluginRegistry();
  });

  it("delegates to getPluginFixMetadata with empty failedCheckIds", () => {
    const { manifest, checks } = makeLoadedPlugin(
      "kastell-plugin-q",
      [{ checkId: "Q-001", tier: "SAFE", handler: "./f.js" }],
      ["Q-001"],
    );
    registerPlugin(manifest, checks);

    expect(getAppliedPluginNames(["Q-001"])).toEqual(["kastell-plugin-q"]);
    expect(getAppliedPluginNames([])).toEqual([]);
  });
});

describe("buildFixHistorySource", () => {
  it('returns {source: "fix"} when names is empty', () => {
    expect(buildFixHistorySource([])).toEqual({ source: "fix" });
  });

  it('returns {source: "plugin", pluginName} for a single name', () => {
    expect(buildFixHistorySource(["kastell-plugin-wp"])).toEqual({
      source: "plugin",
      pluginName: "kastell-plugin-wp",
    });
  });

  it("uses the first name when multiple are given (discriminant contract)", () => {
    // Multiple plugins on a single fix is a structural ambiguity in the
    // current model — we record only the first. Test pins this so future
    // refactors don't silently change the shape.
    expect(buildFixHistorySource(["a", "b", "c"])).toEqual({
      source: "plugin",
      pluginName: "a",
    });
  });
});
