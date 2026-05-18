jest.mock("../../../src/utils/ssh.js", () => ({
  sshExec: jest.fn(),
}));

import { sshExec } from "../../../src/utils/ssh.js";
import { isPluginFixCommand, parsePluginFixCommand, executePluginFix } from "../../../src/core/audit/pluginFix.js";
import { isSafeMode } from "../../../src/utils/safeMode.js";

const mockSshExec = sshExec as jest.MockedFunction<typeof sshExec>;

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
});
