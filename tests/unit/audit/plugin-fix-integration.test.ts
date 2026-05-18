/**
 * Integration tests for plugin fix dispatch in runFix apply loop.
 * Verifies that plugin: prefix fixCommands are routed to pluginFix handlers
 * and that plugin checks appear correctly in safePlan preview.
 */

import { previewSafeFixes } from "../../../src/core/audit/fix.js";
import type { AuditResult } from "../../../src/core/audit/types.js";

// Mock the entire pluginFix module
jest.mock("../../../src/core/audit/pluginFix.js", () => ({
  isPluginFixCommand: jest.fn((cmd: string | undefined) =>
    typeof cmd === "string" && cmd.startsWith("plugin:"),
  ),
  parsePluginFixCommand: jest.fn((cmd: string) => {
    if (!cmd.startsWith("plugin:")) return null;
    const parts = cmd.split(":");
    if (parts.length < 3) return null;
    return { pluginName: parts[1], handlerPath: parts.slice(2).join(":") };
  }),
  executePluginFix: jest.fn().mockResolvedValue({ success: true }),
  getPluginBackupPaths: jest.fn().mockReturnValue([]),
  getAppliedPluginNames: jest.fn().mockReturnValue([]),
}));

import {
  isPluginFixCommand,
  parsePluginFixCommand,
  executePluginFix,
} from "../../../src/core/audit/pluginFix.js";

function makeAuditResult(overrides: Partial<AuditResult> = {}): AuditResult {
  return {
    serverName: "test-server",
    serverIp: "1.2.3.4",
    platform: "bare",
    timestamp: new Date().toISOString(),
    auditVersion: "2.0.0",
    categories: [],
    overallScore: 0,
    quickWins: [],
    ...overrides,
  };
}

function makeCheck(overrides: Partial<{
  id: string; category: string; passed: boolean; fixCommand?: string; safeToAutoFix?: "SAFE" | "GUARDED" | "FORBIDDEN";
}> = {}) {
  return {
    id: "TEST-001",
    category: "General",
    name: "Test Check",
    severity: "warning" as const,
    passed: false,
    currentValue: "",
    expectedValue: "",
    description: "Test check",
    ...overrides,
  };
}

function makeCategory(
  name: string,
  checks: ReturnType<typeof makeCheck>[],
  score = 50,
) {
  return { name, score, maxScore: 100, checks };
}

describe("plugin fix integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("previewSafeFixes — plugin check tier behavior", () => {
    it("should include SAFE plugin fix in safePlan via injected safeToAutoFix", () => {
      const result = makeAuditResult({
        categories: [
          makeCategory(
            "General",
            [
              makeCheck({
                id: "PLUGIN-TEST-1",
                category: "General",
                fixCommand: "plugin:kastell-plugin-test:./fixes/a.js",
                safeToAutoFix: "SAFE",
              }),
            ],
          ),
        ],
      });

      const { safePlan, guardedCount, forbiddenCount } = previewSafeFixes(result);

      // Plugin fix with SAFE tier should appear in safePlan
      expect(safePlan.groups).toHaveLength(1);
      expect(safePlan.groups[0].checks).toHaveLength(1);
      expect(safePlan.groups[0].checks[0].id).toBe("PLUGIN-TEST-1");
      expect(guardedCount).toBe(0);
      expect(forbiddenCount).toBe(0);
    });

    it("should count GUARDED plugin fix in guardedCount", () => {
      const result = makeAuditResult({
        categories: [
          makeCategory(
            "General",
            [
              makeCheck({
                id: "PLUGIN-TEST-2",
                category: "General",
                fixCommand: "plugin:kastell-plugin-test:./fixes/b.js",
                safeToAutoFix: "GUARDED",
              }),
            ],
          ),
        ],
      });

      const { safePlan, guardedCount, forbiddenCount } = previewSafeFixes(result);

      // GUARDED plugin fix should NOT appear in safePlan
      expect(safePlan.groups).toHaveLength(0);
      expect(guardedCount).toBe(1);
      expect(forbiddenCount).toBe(0);
    });

    it("should NOT put 'Plugin:test' category in FORBIDDEN_CATEGORIES — plugin fix tier preserved", () => {
      // The FORBIDDEN_CATEGORIES set only contains SSH, Firewall, Docker
      // Plugin category should not be treated as FORBIDDEN just because it starts with "Plugin"
      const result = makeAuditResult({
        categories: [
          makeCategory(
            "Plugin:test",
            [
              makeCheck({
                id: "PLUGIN-CUSTOM-1",
                category: "Plugin:test",
                fixCommand: "plugin:kastell-plugin-test:./fixes/c.js",
                safeToAutoFix: "SAFE",
              }),
            ],
          ),
        ],
      });

      const { safePlan, guardedCount, forbiddenCount } = previewSafeFixes(result);

      // Plugin:test category is not in FORBIDDEN_CATEGORIES, so SAFE fix should appear in safePlan
      expect(safePlan.groups).toHaveLength(1);
      expect(safePlan.groups[0].checks).toHaveLength(1);
      expect(safePlan.groups[0].checks[0].id).toBe("PLUGIN-CUSTOM-1");
      expect(guardedCount).toBe(0);
      expect(forbiddenCount).toBe(0);
    });

    it("should recognize plugin: prefix via isPluginFixCommand", () => {
      expect(isPluginFixCommand("plugin:kastell-plugin:./fixes/a.js")).toBe(true);
      expect(isPluginFixCommand("plugin:other-plugin:./fix.js")).toBe(true);
      expect(isPluginFixCommand("ufw allow 22")).toBe(false);
      expect(isPluginFixCommand(undefined)).toBe(false);
      expect(isPluginFixCommand("")).toBe(false);
    });

    it("should parse plugin fix command via parsePluginFixCommand", () => {
      const result = parsePluginFixCommand("plugin:kastell-plugin-test:./fixes/a.js");
      expect(result).toEqual({ pluginName: "kastell-plugin-test", handlerPath: "./fixes/a.js" });

      const result2 = parsePluginFixCommand("plugin:my-plugin:handlers/fix.js");
      expect(result2).toEqual({ pluginName: "my-plugin", handlerPath: "handlers/fix.js" });

      expect(parsePluginFixCommand("ufw allow 22")).toBe(null);
      expect(parsePluginFixCommand("plugin:single")).toBe(null);
    });
  });
});
