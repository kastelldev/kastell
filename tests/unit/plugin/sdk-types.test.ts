jest.mock("../../../src/utils/version.js", () => ({ KASTELL_VERSION: "2.2.0" }));

import type {
  PluginManifest,
  PluginCheck,
  PluginSeverity,
  PluginFixTier,
  PluginContext,
  PluginCommandHandler,
  PluginMcpToolHandler,
  PluginMcpTool,
} from "../../../src/plugin/sdk/types.js";

describe("Plugin SDK Types", () => {
  it("PluginManifest accepts valid manifest with all 7 fields", () => {
    const manifest: PluginManifest = {
      name: "kastell-plugin-wordpress",
      version: "1.0.0",
      apiVersion: "1",
      kastell: ">=2.2.0 <3.0.0",
      capabilities: ["audit"],
      checkPrefix: "WP",
      entry: "dist/index.js",
    };
    expect(manifest.name).toBe("kastell-plugin-wordpress");
    expect(manifest.checkPrefix).toBe("WP");
  });

  it("PluginCheck accepts valid check with required + optional fields", () => {
    const check: PluginCheck = {
      id: "WP-FILE-PERMS",
      name: "WordPress file permissions",
      category: "WordPress",
      severity: "warning",
      description: "WordPress core files should not be world-writable",
      checkCommand: "find /var/www/html -type f -perm -002 | wc -l",
      passPattern: "^0$",
      failPattern: undefined,
      fixCommand: "find /var/www/html -type f -exec chmod 644 {} \\;",
      safeToAutoFix: "GUARDED",
      explain: "Checks world-writable files in WordPress root",
      complianceRefs: [{ framework: "CIS", ref: "6.1.3" }],
    };
    expect(check.id).toBe("WP-FILE-PERMS");
    expect(check.severity).toBe("warning");
  });

  it("PluginSeverity only allows critical | warning | info", () => {
    const s1: PluginSeverity = "critical";
    const s2: PluginSeverity = "warning";
    const s3: PluginSeverity = "info";
    expect([s1, s2, s3]).toHaveLength(3);
  });

  it("PluginFixTier only allows SAFE | GUARDED | FORBIDDEN", () => {
    const t1: PluginFixTier = "SAFE";
    const t2: PluginFixTier = "GUARDED";
    const t3: PluginFixTier = "FORBIDDEN";
    expect([t1, t2, t3]).toHaveLength(3);
  });

  it("PluginCheck works with minimal fields (no optionals)", () => {
    const check: PluginCheck = {
      id: "AUD-001",
      name: "Minimal check",
      category: "Auditor",
      severity: "info",
      description: "A minimal check",
      checkCommand: "echo ok",
    };
    expect(check.fixCommand).toBeUndefined();
    expect(check.explain).toBeUndefined();
    expect(check.complianceRefs).toBeUndefined();
  });
});

describe("PluginContext type", () => {
  it("has ssh, logger, and optional server/ip", () => {
    const ctx: PluginContext = {
      server: "test-server",
      ip: "1.2.3.4",
      ssh: async () => ({ stdout: "", stderr: "", code: 0 }),
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    };
    expect(ctx.ssh).toBeDefined();
    expect(ctx.logger).toBeDefined();
    expect(ctx.server).toBe("test-server");
    expect(ctx.ip).toBe("1.2.3.4");
  });

  it("server and ip are optional", () => {
    const ctx: PluginContext = {
      ssh: async () => ({ stdout: "", stderr: "", code: 0 }),
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    };
    expect(ctx.server).toBeUndefined();
    expect(ctx.ip).toBeUndefined();
  });
});

describe("PluginCommandHandler type", () => {
  it("handler receives args and context with ssh", () => {
    const handler: PluginCommandHandler = async (args, ctx) => {
      ctx.logger.info(`running on ${ctx.server}`);
      await ctx.ssh("echo test");
    };
    expect(typeof handler).toBe("function");
  });
});

describe("PluginMcpToolHandler type", () => {
  it("handler returns content array with text type", () => {
    const handler: PluginMcpToolHandler = async (args, ctx) => {
      const result = await ctx.ssh("echo test");
      return { content: [{ type: "text" as const, text: result.stdout }] };
    };
    expect(typeof handler).toBe("function");
  });
});

describe("PluginMcpTool type", () => {
  it("accepts tool without inputSchema", () => {
    const tool: PluginMcpTool = {
      name: "my-tool",
      description: "A tool",
      handler: "handleMyTool",
    };
    expect(tool.inputSchema).toBeUndefined();
  });

  it("accepts tool with optional inputSchema", () => {
    const tool: PluginMcpTool = {
      name: "my-tool",
      description: "A tool",
      handler: "handleMyTool",
      inputSchema: {
        type: "object",
        properties: {
          server: { type: "string" },
          force: { type: "boolean" },
        },
        required: ["server"],
      },
    };
    expect(tool.inputSchema).toBeDefined();
    expect(tool.inputSchema!.type).toBe("object");
  });
});
