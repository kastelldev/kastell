import { validateAndNormalizeChecks } from "../../../src/plugin/normalize.js";
import { validateChecks } from "../../../src/plugin/validate.js";
import type { LoadedPluginCheck } from "../../../src/plugin/sdk/types.js";

jest.mock("../../../src/utils/version.js", () => ({
  KASTELL_VERSION: "2.2.0",
}));

const PLUGIN = "kastell-plugin-wordpress";
const PREFIX = "WP";

describe("validateAndNormalizeChecks", () => {
  describe("v2 normalization", () => {
    it("normalizes v2 read-only into read + sourceApiVersion", () => {
      const checks = validateChecks(
        [{
          id: "WP-READ", name: "read", category: "WP", severity: "info",
          description: "desc",
          checkCommand: { kind: "read", cmd: "echo ok" },
        }],
        PREFIX, "2", PLUGIN,
      );
      const normalized = validateAndNormalizeChecks(checks, "2");
      expect(normalized).toHaveLength(1);
      const c = normalized[0];
      expect(c.id).toBe("WP-READ");
      expect(c.sourceApiVersion).toBe("2");
      expect(c.read).toEqual({ cmd: "echo ok" });
      expect(c.activeProbe).toBeUndefined();
      expect(c.description).toBe("desc");
    });

    it("defaults description to empty string when v2 omits it", () => {
      const checks = validateChecks(
        [{
          id: "WP-READ", name: "read", category: "WP", severity: "info",
          checkCommand: { kind: "read", cmd: "echo ok" },
        }],
        PREFIX, "2", PLUGIN,
      );
      const normalized = validateAndNormalizeChecks(checks, "2");
      expect(normalized[0].description).toBe("");
    });

    it("drops passPattern/failPattern into read object for v2", () => {
      const checks = validateChecks(
        [{
          id: "WP-PAT", name: "p", category: "WP", severity: "info",
          checkCommand: { kind: "read", cmd: "echo ok" },
          passPattern: "OK",
          failPattern: "BAD",
        }],
        PREFIX, "2", PLUGIN,
      );
      const normalized = validateAndNormalizeChecks(checks, "2");
      expect(normalized[0].read).toEqual({ cmd: "echo ok", passPattern: "OK", failPattern: "BAD" });
    });

    it("forwards explain and complianceRefs for v2", () => {
      const checks = validateChecks(
        [{
          id: "WP-META", name: "m", category: "WP", severity: "info",
          description: "m",
          checkCommand: { kind: "read", cmd: "echo ok" },
          explain: "because",
          complianceRefs: [{ framework: "CIS", ref: "1.2.3" }],
        }],
        PREFIX, "2", PLUGIN,
      );
      const normalized = validateAndNormalizeChecks(checks, "2");
      expect(normalized[0].explain).toBe("because");
      expect(normalized[0].complianceRefs).toEqual([{ framework: "CIS", ref: "1.2.3" }]);
    });
  });

  describe("v3 normalization", () => {
    it("passes v3 read-only through and sets sourceApiVersion", () => {
      const checks = validateChecks(
        [{
          id: "WP-READ", name: "read", category: "WP", severity: "info",
          description: "d", read: { cmd: "echo x" },
        }],
        PREFIX, "3", PLUGIN,
      );
      const normalized = validateAndNormalizeChecks(checks, "3");
      expect(normalized[0]).toMatchObject({
        id: "WP-READ", sourceApiVersion: "3", description: "d",
        read: { cmd: "echo x" },
      });
      expect(normalized[0].activeProbe).toBeUndefined();
    });

    it("preserves activeProbe for v3 probe-only checks", () => {
      const checks = validateChecks(
        [{
          id: "WP-PROBE", name: "probe", category: "WP", severity: "warning",
          description: "p",
          activeProbe: { handler: "./p.js", risk: "medium", timeoutMs: 10_000 },
        }],
        PREFIX, "3", PLUGIN,
      );
      const normalized = validateAndNormalizeChecks(checks, "3");
      expect(normalized[0].activeProbe).toEqual({
        handler: "./p.js", risk: "medium", timeoutMs: 10_000,
      });
      expect(normalized[0].read).toBeUndefined();
    });

    it("preserves both read and activeProbe for v3 combined", () => {
      const checks = validateChecks(
        [{
          id: "WP-BOTH", name: "b", category: "WP", severity: "critical",
          description: "b",
          read: { cmd: "echo x" },
          activeProbe: { handler: "./p.js", risk: "high", timeoutMs: 60_000 },
        }],
        PREFIX, "3", PLUGIN,
      );
      const normalized = validateAndNormalizeChecks(checks, "3");
      expect(normalized[0].read).toEqual({ cmd: "echo x" });
      expect(normalized[0].activeProbe?.handler).toBe("./p.js");
    });
  });

  describe("loaded check shape", () => {
    it("v2 result conforms to LoadedPluginCheck base fields", () => {
      const checks = validateChecks(
        [{
          id: "WP-READ", name: "r", category: "WP", severity: "info",
          description: "d",
          checkCommand: { kind: "read", cmd: "echo x" },
        }],
        PREFIX, "2", PLUGIN,
      );
      const normalized: LoadedPluginCheck[] = validateAndNormalizeChecks(checks, "2");
      const c = normalized[0];
      expect(c).toHaveProperty("id");
      expect(c).toHaveProperty("name");
      expect(c).toHaveProperty("category");
      expect(c).toHaveProperty("severity");
      expect(c).toHaveProperty("description");
      expect(c).toHaveProperty("sourceApiVersion");
    });

    it("returns empty array for empty input array (v2)", () => {
      expect(validateAndNormalizeChecks([], "2")).toEqual([]);
    });

    it("returns empty array for empty input array (v3)", () => {
      expect(validateAndNormalizeChecks([], "3")).toEqual([]);
    });
  });
});