jest.mock("../../../src/utils/version.js", () => ({
  KASTELL_VERSION: "2.2.0",
}));

import { validateManifest, validateChecks } from "../../../src/plugin/validate.js";
import { validateAndNormalizeChecks } from "../../../src/plugin/normalize.js";
import { ValidationError } from "../../../src/utils/errors.js";

const VALID_MANIFEST = {
  name: "kastell-plugin-wordpress",
  version: "1.0.0",
  apiVersion: "2",
  kastell: ">=2.2.0 <3.0.0",
  capabilities: ["audit"],
  checkPrefix: "WP",
  entry: "dist/index.js",
};

describe("validateManifest", () => {
  describe("valid manifests", () => {
    it("accepts a fully valid manifest", () => {
      const result = validateManifest(VALID_MANIFEST);
      expect(result.name).toBe("kastell-plugin-wordpress");
      expect(result.checkPrefix).toBe("WP");
    });

    it("accepts checkPrefix with 2 chars", () => {
      const result = validateManifest({ ...VALID_MANIFEST, checkPrefix: "WP" });
      expect(result.checkPrefix).toBe("WP");
    });

    it("accepts checkPrefix with 6 chars", () => {
      const result = validateManifest({ ...VALID_MANIFEST, checkPrefix: "WORDPR" });
      expect(result.checkPrefix).toBe("WORDPR");
    });
  });

  describe("name validation", () => {
    it("rejects missing name", () => {
      const { name: _, ...noName } = VALID_MANIFEST;
      expect(() => validateManifest(noName)).toThrow(ValidationError);
    });

    it("rejects name without kastell-plugin- prefix", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, name: "my-plugin" }))
        .toThrow(ValidationError);
    });

    it("rejects name with uppercase", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, name: "kastell-plugin-WordPress" }))
        .toThrow(ValidationError);
    });
  });

  describe("apiVersion validation", () => {
    it("accepts apiVersion 2 (the only valid value under v2 contract)", () => {
      const result = validateManifest({ ...VALID_MANIFEST, apiVersion: "2" });
      expect(result.apiVersion).toBe("2");
    });

    it("rejects apiVersion 1 (legacy v1 contract)", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, apiVersion: "1" }))
        .toThrow(ValidationError);
    });

    it("rejects numeric apiVersion", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, apiVersion: 1 as unknown as string }))
        .toThrow(ValidationError);
    });
  });

  describe("capabilities validation", () => {
    it("rejects unknown capability", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, capabilities: ["unknown"] })).toThrow(ValidationError);
    });

    it("rejects empty capabilities", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, capabilities: [] })).toThrow(ValidationError);
    });
  });

  describe("checkPrefix validation", () => {
    it("rejects lowercase prefix", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, checkPrefix: "wp" }))
        .toThrow(ValidationError);
    });

    it("rejects prefix with 1 char", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, checkPrefix: "W" }))
        .toThrow(ValidationError);
    });

    it("rejects prefix with 7 chars", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, checkPrefix: "TOOLONG" }))
        .toThrow(ValidationError);
    });

    it("rejects prefix with numbers", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, checkPrefix: "WP1" }))
        .toThrow(ValidationError);
    });
  });

  describe("strict mode", () => {
    it("rejects extra fields", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, extraField: "hack" }))
        .toThrow(ValidationError);
    });
  });

  describe("capability expansion", () => {
    it("accepts audit-only capability (backward compat)", () => {
      const result = validateManifest({ ...VALID_MANIFEST, capabilities: ["audit"] });
      expect(result.capabilities).toEqual(["audit"]);
    });

    it("accepts multiple capabilities", () => {
      const result = validateManifest({
        ...VALID_MANIFEST,
        capabilities: ["audit", "command", "fix"],
      });
      expect(result.capabilities).toEqual(["audit", "command", "fix"]);
    });

    it("accepts all four capability types", () => {
      const result = validateManifest({
        ...VALID_MANIFEST,
        capabilities: ["audit", "command", "mcp-tool", "fix"],
      });
      expect(result.capabilities).toHaveLength(4);
    });

    it("rejects empty capabilities array", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, capabilities: [] })).toThrow(ValidationError);
    });

    it("rejects unknown capability", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, capabilities: ["audit", "unknown"] })).toThrow(ValidationError);
    });

    it("accepts manifest with optional commands field", () => {
      const result = validateManifest({
        ...VALID_MANIFEST,
        capabilities: ["audit", "command"],
        commands: [{ name: "scan", description: "Run scan", handler: "./cmd/scan.js" }],
      });
      expect(result.commands).toHaveLength(1);
    });

    it("accepts manifest with optional mcpTools field", () => {
      const result = validateManifest({
        ...VALID_MANIFEST,
        capabilities: ["audit", "mcp-tool"],
        mcpTools: [{ name: "analyze", description: "Analyze server", handler: "./mcp/analyze.js" }],
      });
      expect(result.mcpTools).toHaveLength(1);
    });

    it("accepts manifest with optional fixes field", () => {
      const result = validateManifest({
        ...VALID_MANIFEST,
        capabilities: ["audit", "fix"],
        fixes: [{ checkId: "WP-001", tier: "SAFE", handler: "./fixes/fix001.js" }],
      });
      expect(result.fixes).toHaveLength(1);
    });

    it("accepts fix with absolute backupPaths", () => {
      const result = validateManifest({
        ...VALID_MANIFEST,
        capabilities: ["audit", "fix"],
        fixes: [{ checkId: "WP-001", tier: "SAFE", handler: "./fixes/fix001.js", backupPaths: ["/etc/ssh/sshd_config", "/etc/fail2ban/jail.local"] }],
      });
      expect(result.fixes).toHaveLength(1);
      expect(result.fixes?.[0].backupPaths).toHaveLength(2);
    });

    it("rejects fix with relative backupPaths", () => {
      expect(() =>
        validateManifest({
          ...VALID_MANIFEST,
          capabilities: ["audit", "fix"],
          fixes: [{ checkId: "WP-001", tier: "SAFE", handler: "./fixes/fix001.js", backupPaths: ["./relative/path"] }],
        }),
      ).toThrow(ValidationError);
    });

    it("rejects fix with checkId not matching checkPrefix", () => {
      expect(() =>
        validateManifest({
          ...VALID_MANIFEST,
          capabilities: ["audit", "fix"],
          fixes: [{ checkId: "OTHER-001", tier: "SAFE", handler: "./fixes/fix.js" }],
        }),
      ).toThrow(ValidationError);
    });

    it("rejects fix with FORBIDDEN tier", () => {
      expect(() =>
        validateManifest({
          ...VALID_MANIFEST,
          capabilities: ["audit", "fix"],
          fixes: [{ checkId: "WP-001", tier: "FORBIDDEN", handler: "./fixes/fix.js" }],
        }),
      ).toThrow(ValidationError);
    });

    it("rejects command handler with path traversal (no ./)", () => {
      expect(() =>
        validateManifest({
          ...VALID_MANIFEST,
          capabilities: ["command"],
          commands: [{ name: "evil", description: "Bad", handler: "../../etc/passwd" }],
        }),
      ).toThrow(ValidationError);
    });

    it("rejects command handler with embedded path traversal", () => {
      expect(() =>
        validateManifest({
          ...VALID_MANIFEST,
          capabilities: ["command"],
          commands: [{ name: "evil", description: "Bad", handler: "./cmd/../../../etc/passwd.js" }],
        }),
      ).toThrow(ValidationError);
    });

    it("accepts manifest without optional fields (backward compat)", () => {
      const result = validateManifest({ ...VALID_MANIFEST, capabilities: ["audit"] });
      expect(result.commands).toBeUndefined();
      expect(result.mcpTools).toBeUndefined();
      expect(result.fixes).toBeUndefined();
    });
  });

  describe("kastell version compatibility", () => {
    it("accepts compatible version range", () => {
      const result = validateManifest({ ...VALID_MANIFEST, kastell: ">=2.2.0" });
      expect(result.kastell).toBe(">=2.2.0");
    });

    it("accepts exact version match", () => {
      const result = validateManifest({ ...VALID_MANIFEST, kastell: "2.2.0" });
      expect(result.kastell).toBe("2.2.0");
    });

    it("rejects incompatible version range (too high)", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, kastell: ">=2.3.0" }))
        .toThrow(ValidationError);
    });

    it("rejects incompatible version range (too low)", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, kastell: "<2.0.0" }))
        .toThrow(ValidationError);
    });

    it("error message includes current and required version", () => {
      let err: unknown;
      try { validateManifest({ ...VALID_MANIFEST, kastell: ">=3.0.0" }); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as Error).message).toMatch(/2\.2\.0/);
      expect((err as Error).message).toMatch(/3\.0\.0/);
    });

    it("rejects invalid semver range syntax", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, kastell: "not-a-range" }))
        .toThrow(ValidationError);
    });
  });

  describe("command schema (separate from handler)", () => {
    it("accepts valid command with all fields", () => {
      const result = validateManifest({
        ...VALID_MANIFEST,
        capabilities: ["command"],
        commands: [{ name: "scan", description: "Run scan", handler: "./cmd/scan.js" }],
      });
      expect(result.commands).toHaveLength(1);
    });

    it("rejects command with missing required field", () => {
      expect(() =>
        validateManifest({
          ...VALID_MANIFEST,
          capabilities: ["command"],
          commands: [{ name: "scan", handler: "./cmd/scan.js" } as Record<string, unknown>],
        }),
      ).toThrow(ValidationError);
    });

    it("rejects command with empty name", () => {
      expect(() =>
        validateManifest({
          ...VALID_MANIFEST,
          capabilities: ["command"],
          commands: [{ name: "", description: "Bad", handler: "./cmd/scan.js" }],
        }),
      ).toThrow(ValidationError);
    });
  });

  describe("mcpTool schema (separate from handler)", () => {
    it("accepts valid mcpTool with all fields", () => {
      const result = validateManifest({
        ...VALID_MANIFEST,
        capabilities: ["mcp-tool"],
        mcpTools: [{ name: "analyze", description: "Analyze server", handler: "./mcp/analyze.js" }],
      });
      expect(result.mcpTools).toHaveLength(1);
    });

    it("rejects mcpTool with missing required field", () => {
      expect(() =>
        validateManifest({
          ...VALID_MANIFEST,
          capabilities: ["mcp-tool"],
          mcpTools: [{ name: "analyze", handler: "./mcp/analyze.js" } as Record<string, unknown>],
        }),
      ).toThrow(ValidationError);
    });

    it("rejects mcpTool with empty description", () => {
      expect(() =>
        validateManifest({
          ...VALID_MANIFEST,
          capabilities: ["mcp-tool"],
          mcpTools: [{ name: "analyze", description: "", handler: "./mcp/analyze.js" }],
        }),
      ).toThrow(ValidationError);
    });
  });

  describe("duplicate name validation", () => {
    it("rejects duplicate command names", () => {
      expect(() =>
        validateManifest({
          ...VALID_MANIFEST,
          capabilities: ["command"],
          commands: [
            { name: "scan", description: "Run scan", handler: "./cmd/scan.js" },
            { name: "scan", description: "Run scan again", handler: "./cmd/scan2.js" },
          ],
        }),
      ).toThrow(ValidationError);
    });

    it("rejects duplicate mcpTool names", () => {
      expect(() =>
        validateManifest({
          ...VALID_MANIFEST,
          capabilities: ["mcp-tool"],
          mcpTools: [
            { name: "analyze", description: "Analyze", handler: "./mcp/analyze.js" },
            { name: "analyze", description: "Analyze again", handler: "./mcp/analyze2.js" },
          ],
        }),
      ).toThrow(ValidationError);
    });

    it("rejects duplicate fix checkIds", () => {
      expect(() =>
        validateManifest({
          ...VALID_MANIFEST,
          capabilities: ["fix"],
          fixes: [
            { checkId: "WP-001", tier: "SAFE", handler: "./fixes/fix001.js" },
            { checkId: "WP-001", tier: "GUARDED", handler: "./fixes/fix001b.js" },
          ],
        }),
      ).toThrow(ValidationError);
    });

    it("accepts same name in command and mcpTool (different capabilities)", () => {
      const result = validateManifest({
        ...VALID_MANIFEST,
        capabilities: ["command", "mcp-tool"],
        commands: [{ name: "scan", description: "Run scan", handler: "./cmd/scan.js" }],
        mcpTools: [{ name: "scan", description: "Scan via MCP", handler: "./mcp/scan.js" }],
      });
      expect(result.commands).toHaveLength(1);
      expect(result.mcpTools).toHaveLength(1);
    });
  });

  describe("capability-field consistency", () => {
    it("rejects commands field without command capability", () => {
      expect(() =>
        validateManifest({
          ...VALID_MANIFEST,
          capabilities: ["audit"],
          commands: [{ name: "scan", description: "Run scan", handler: "./cmd/scan.js" }],
        }),
      ).toThrow(ValidationError);
    });

    it("rejects mcpTools field without mcp-tool capability", () => {
      expect(() =>
        validateManifest({
          ...VALID_MANIFEST,
          capabilities: ["audit"],
          mcpTools: [{ name: "analyze", description: "Analyze", handler: "./mcp/analyze.js" }],
        }),
      ).toThrow(ValidationError);
    });

    it("rejects fixes field without fix capability", () => {
      expect(() =>
        validateManifest({
          ...VALID_MANIFEST,
          capabilities: ["audit"],
          fixes: [{ checkId: "WP-001", tier: "SAFE", handler: "./fixes/fix001.js" }],
        }),
      ).toThrow(ValidationError);
    });

    it("accepts commands field with command capability", () => {
      const result = validateManifest({
        ...VALID_MANIFEST,
        capabilities: ["command"],
        commands: [{ name: "scan", description: "Run scan", handler: "./cmd/scan.js" }],
      });
      expect(result.commands).toHaveLength(1);
    });

    it("accepts mcpTools field with mcp-tool capability", () => {
      const result = validateManifest({
        ...VALID_MANIFEST,
        capabilities: ["mcp-tool"],
        mcpTools: [{ name: "analyze", description: "Analyze", handler: "./mcp/analyze.js" }],
      });
      expect(result.mcpTools).toHaveLength(1);
    });

    it("accepts fixes field with fix capability", () => {
      const result = validateManifest({
        ...VALID_MANIFEST,
        capabilities: ["fix"],
        fixes: [{ checkId: "WP-001", tier: "SAFE", handler: "./fixes/fix001.js" }],
      });
      expect(result.fixes).toHaveLength(1);
    });
  });
});

describe("validateChecks — v2/v3 version dispatch", () => {
  describe("v2 acceptance", () => {
    it("accepts v2 read-only checks and normalizes missing description", () => {
      const checks = validateChecks(
        [{
          id: "WP-READ", name: "read", category: "WP", severity: "info",
          checkCommand: { kind: "read", cmd: "echo ok" },
        }],
        "WP", "2", "kastell-plugin-wordpress",
      );
      expect(validateAndNormalizeChecks(checks, "2")[0]).toMatchObject({
        description: "", sourceApiVersion: "2", read: { cmd: "echo ok" },
      });
    });
  });

  describe("v2 rejection", () => {
    it.each(["mutate-local", "mutate-global"] as const)(
      "rejects v2 %s with check id and migration path",
      (kind) => {
        expect(() => validateChecks([{
          id: "WP-MUT", name: "mutating", category: "WP", severity: "warning",
          checkCommand: { kind, cmd: "systemctl restart nginx" },
        }], "WP", "2", "kastell-plugin-wordpress"))
          .toThrow(/WP-MUT.*mutate-.*docs\/plugin-sdk-migration-v3\.md/);
      },
    );

    it("rejects v2 raw fixCommand", () => {
      expect(() => validateChecks([{
        id: "WP-FIX", name: "raw fix", category: "WP", severity: "warning",
        checkCommand: { kind: "read", cmd: "echo bad" },
        fixCommand: "systemctl restart nginx",
      }], "WP", "2", "kastell-plugin-wordpress"))
        .toThrow(/WP-FIX.*fixCommand.*migration/i);
    });
  });

  describe("v3 acceptance", () => {
    it("accepts v3 read-only, probe-only, and combined checks", () => {
      const raw = [
        { id: "WP-READ", name: "read", category: "WP", severity: "info",
          description: "read", read: { cmd: "echo read" } },
        { id: "WP-PROBE", name: "probe", category: "WP", severity: "warning",
          description: "probe",
          activeProbe: { handler: "./probes/check.js", risk: "low", timeoutMs: 5_000 } },
        { id: "WP-BOTH", name: "both", category: "WP", severity: "critical",
          description: "both", read: { cmd: "echo both" },
          activeProbe: { handler: "./probes/check.js", risk: "high", timeoutMs: 300_000 } },
      ];
      const checks = validateChecks(raw, "WP", "3", "kastell-plugin-wordpress");
      expect(validateAndNormalizeChecks(checks, "3").map((c) => c.id))
        .toEqual(["WP-READ", "WP-PROBE", "WP-BOTH"]);
    });

    it("accepts v3 inclusive timeout boundaries (5000 and 300000)", () => {
      const raw = [
        { id: "WP-MIN", name: "min", category: "WP", severity: "info",
          description: "min", activeProbe: { handler: "./p.js", risk: "low", timeoutMs: 5_000 } },
        { id: "WP-MAX", name: "max", category: "WP", severity: "info",
          description: "max", activeProbe: { handler: "./p.js", risk: "low", timeoutMs: 300_000 } },
      ];
      expect(() => validateChecks(raw, "WP", "3", "kastell-plugin-wordpress")).not.toThrow();
    });
  });

  describe("v3 rejection", () => {
    it("rejects v3 with neither read nor activeProbe", () => {
      expect(() => validateChecks([{
        id: "WP-EMPTY", name: "empty", category: "WP", severity: "info", description: "empty",
      }], "WP", "3", "kastell-plugin-wordpress"))
        .toThrow(/requires read and\/or activeProbe/);
    });

    it.each([4_999, 300_001])("rejects v3 timeout %d outside 5000..300000", (timeoutMs) => {
      expect(() => validateChecks([{
        id: "WP-PROBE", name: "probe", category: "WP", severity: "warning", description: "probe",
        activeProbe: { handler: "./probes/check.js", risk: "low", timeoutMs },
      }], "WP", "3", "kastell-plugin-wordpress"))
        .toThrow(/timeoutMs/);
    });

    it("rejects non-integer timeoutMs", () => {
      expect(() => validateChecks([{
        id: "WP-PROBE", name: "probe", category: "WP", severity: "warning", description: "probe",
        activeProbe: { handler: "./probes/check.js", risk: "low", timeoutMs: 5_500.5 },
      }], "WP", "3", "kastell-plugin-wordpress"))
        .toThrow(/timeoutMs/);
    });

    it.each(["echo ---SECTION:foo", "echo KASTELL_PLUGIN_CHECK_EOF", "echo bad\rchar"])(
      "rejects v3 read.cmd containing dangerous token",
      (cmd) => {
        expect(() => validateChecks([{
          id: "WP-READ", name: "read", category: "WP", severity: "info",
          description: "read", read: { cmd },
        }], "WP", "3", "kastell-plugin-wordpress"))
          .toThrow();
      },
    );

    it("rejects empty read.cmd", () => {
      expect(() => validateChecks([{
        id: "WP-READ", name: "read", category: "WP", severity: "info",
        description: "read", read: { cmd: "" },
      }], "WP", "3", "kastell-plugin-wordpress"))
        .toThrow();
    });

    it.each([
      "noSlash.js",
      "./has/dotdot/../traversal.js",
      "back\\slash.js",
      "./noext",
      "./wrong.ext",
    ])("rejects handler path %s", (handler) => {
      expect(() => validateChecks([{
        id: "WP-PROBE", name: "probe", category: "WP", severity: "warning",
        description: "probe",
        activeProbe: { handler, risk: "low", timeoutMs: 5_000 },
      }], "WP", "3", "kastell-plugin-wordpress"))
        .toThrow(/handler/);
    });

    it("rejects unknown fields in read object", () => {
      expect(() => validateChecks([{
        id: "WP-READ", name: "read", category: "WP", severity: "info",
        description: "read",
        read: { cmd: "echo ok", shell: "/bin/sh" },
      }], "WP", "3", "kastell-plugin-wordpress"))
        .toThrow();
    });

    it("rejects unknown fields in activeProbe object", () => {
      expect(() => validateChecks([{
        id: "WP-PROBE", name: "probe", category: "WP", severity: "warning",
        description: "probe",
        activeProbe: { handler: "./p.js", risk: "low", timeoutMs: 5_000, sandbox: true },
      }], "WP", "3", "kastell-plugin-wordpress"))
        .toThrow();
    });

    it("rejects unknown top-level field in v3 check", () => {
      expect(() => validateChecks([{
        id: "WP-READ", name: "read", category: "WP", severity: "info",
        description: "read", read: { cmd: "echo ok" },
        safeToAutoFix: "SAFE",
      }], "WP", "3", "kastell-plugin-wordpress"))
        .toThrow();
    });

    it("rejects unknown risk enum", () => {
      expect(() => validateChecks([{
        id: "WP-PROBE", name: "probe", category: "WP", severity: "warning",
        description: "probe",
        activeProbe: { handler: "./p.js", risk: "extreme" as unknown as "low", timeoutMs: 5_000 },
      }], "WP", "3", "kastell-plugin-wordpress"))
        .toThrow();
    });
  });

  describe("shared id/duplicate checks", () => {
    it("rejects check id not matching prefix", () => {
      expect(() => validateChecks([{
        id: "OTHER-X", name: "x", category: "WP", severity: "info",
        checkCommand: { kind: "read", cmd: "echo" },
      }], "WP", "2", "kastell-plugin-wordpress"))
        .toThrow(ValidationError);
    });

    it("rejects duplicate check ids within plugin (v2)", () => {
      const arr = [{
        id: "WP-X", name: "x", category: "WP", severity: "info",
        checkCommand: { kind: "read", cmd: "echo a" },
      }, {
        id: "WP-X", name: "x", category: "WP", severity: "info",
        checkCommand: { kind: "read", cmd: "echo b" },
      }];
      expect(() => validateChecks(arr, "WP", "2", "kastell-plugin-wordpress"))
        .toThrow(/Duplicate check id/);
    });

    it("rejects duplicate check ids within plugin (v3)", () => {
      const arr = [{
        id: "WP-X", name: "x", category: "WP", severity: "info",
        description: "x", read: { cmd: "echo a" },
      }, {
        id: "WP-X", name: "x", category: "WP", severity: "info",
        description: "x", read: { cmd: "echo b" },
      }];
      expect(() => validateChecks(arr, "WP", "3", "kastell-plugin-wordpress"))
        .toThrow(/Duplicate check id/);
    });

    it("rejects non-array checks", () => {
      expect(() => validateChecks("not-array", "WP", "2", "kastell-plugin-wordpress"))
        .toThrow(/must be an array/);
    });
  });
});
