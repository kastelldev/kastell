jest.mock("../../../src/utils/version.js", () => ({ KASTELL_VERSION: "2.2.0" }));

import {
  CURRENT_PLUGIN_API_VERSION,
  PLUGIN_API_VERSION,
  PLUGIN_NAME_PATTERN,
  SUPPORTED_PLUGIN_API_VERSIONS,
} from "../../../src/plugin/sdk/constants.js";
import {
  PLUGIN_CHECK_COMMAND_KINDS,
  type ActiveProbeDefinition,
  type LoadedPluginCheck,
  type PluginCheck,
  type PluginCheckCommand,
  type PluginCheckV2,
  type PluginCheckV3,
  type PluginContext,
  type PluginCommandHandler,
  type PluginMcpTool,
  type PluginMcpToolHandler,
  type PluginManifest,
  type PluginProbeContext,
  type PluginProbeTarget,
  type PluginReadDefinition,
  type PluginSeverity,
  type PluginFixTier,
} from "../../../src/plugin/sdk/types.js";

describe("Plugin SDK constants", () => {
  it("PLUGIN_API_VERSION is the v2 string", () => {
    expect(PLUGIN_API_VERSION).toBe("2");
  });

  it("PLUGIN_CHECK_COMMAND_KINDS lists all 3 v2 kinds in declaration order", () => {
    expect([...PLUGIN_CHECK_COMMAND_KINDS]).toEqual([
      "read",
      "mutate-local",
      "mutate-global",
    ]);
  });

  it("PLUGIN_NAME_PATTERN requires the kastell-plugin- prefix", () => {
    expect(PLUGIN_NAME_PATTERN.test("kastell-plugin-wordpress")).toBe(true);
    expect(PLUGIN_NAME_PATTERN.test("kastell-plugin-wp")).toBe(true);
    expect(PLUGIN_NAME_PATTERN.test("wordpress")).toBe(false);
    expect(PLUGIN_NAME_PATTERN.test("Kastell-Plugin-WP")).toBe(false);
  });
});

describe("Plugin SDK Types", () => {
  it("PluginManifest accepts valid manifest with all 7 fields", () => {
    const manifest: PluginManifest = {
      name: "kastell-plugin-wordpress",
      version: "1.0.0",
      apiVersion: "2",
      kastell: ">=2.2.0 <3.0.0",
      capabilities: ["audit"],
      checkPrefix: "WP",
      entry: "dist/index.js",
    };
    expect(manifest.name).toBe("kastell-plugin-wordpress");
    expect(manifest.checkPrefix).toBe("WP");
  });

  it("PluginManifest accepts v3 apiVersion discriminator", () => {
    const manifest: PluginManifest = {
      name: "kastell-plugin-v3",
      version: "1.0.0",
      apiVersion: "3",
      kastell: ">=2.3.0",
      capabilities: ["audit"],
      checkPrefix: "V3",
      entry: "dist/index.js",
    };
    expect(manifest.apiVersion).toBe("3");
  });

  it("PluginCheck accepts valid check with required + optional fields", () => {
    const check: PluginCheck = {
      id: "WP-FILE-PERMS",
      name: "WordPress file permissions",
      category: "WordPress",
      severity: "warning",
      description: "WordPress core files should not be world-writable",
      checkCommand: { kind: "read", cmd: "find /var/www/html -type f -perm -002 | wc -l" },
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

  it("PluginCheckCommand accepts all v2 command variants", () => {
    const read: PluginCheckCommand = { kind: "read", cmd: "cat /etc/os-release" };
    const local: PluginCheckCommand = { kind: "mutate-local", cmd: "systemctl restart nginx" };
    const global: PluginCheckCommand = { kind: "mutate-global", cmd: "hcloud firewall apply-to-resource" };
    expect([read.kind, local.kind, global.kind]).toEqual(["read", "mutate-local", "mutate-global"]);
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
      checkCommand: { kind: "read", cmd: "echo ok" },
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

describe("Plugin API v3 versioning", () => {
  it("separates supported versions from the current authoring version", () => {
    expect([...SUPPORTED_PLUGIN_API_VERSIONS]).toEqual(["2", "3"]);
    expect(CURRENT_PLUGIN_API_VERSION).toBe("3");
  });

  it("keeps PLUGIN_API_VERSION legacy shim for migration", () => {
    expect(PLUGIN_API_VERSION).toBe("2");
  });
});

describe("PluginCheckV2 and PluginCheckV3 public contracts", () => {
  it("PluginCheckV2 keeps the v2 checkCommand shape with safeToAutoFix and fixCommand", () => {
    const check: PluginCheckV2 = {
      id: "WP-FILE-PERMS",
      name: "WordPress file permissions",
      category: "WordPress",
      severity: "warning",
      description: "World-writable file check",
      checkCommand: { kind: "read", cmd: "find /var/www -type f -perm -002 | wc -l" },
      passPattern: "^0$",
      fixCommand: "find /var/www -type f -exec chmod 644 {} \\;",
      safeToAutoFix: "GUARDED",
      explain: "Checks world-writable files in WordPress root",
      complianceRefs: [{ framework: "CIS", ref: "6.1.3" }],
    };
    expect(check.id).toBe("WP-FILE-PERMS");
    expect(check.checkCommand.kind).toBe("read");
  });

  it("PluginCheckV3 models read-only, probe-only, and combined checks", () => {
    const readOnly: PluginCheckV3 = {
      id: "TST-READ",
      name: "read",
      category: "Test",
      severity: "info",
      description: "read",
      read: { cmd: "echo ok" },
    };
    const probeOnly: PluginCheckV3 = {
      id: "TST-PROBE",
      name: "probe",
      category: "Test",
      severity: "info",
      description: "probe",
      activeProbe: { handler: "./probes/test.js", risk: "low", timeoutMs: 5_000 },
    };
    const combined: PluginCheckV3 = {
      ...readOnly,
      id: "TST-BOTH",
      activeProbe: { handler: "./probes/test.js", risk: "medium", timeoutMs: 30_000 },
    };
    expect([readOnly, probeOnly, combined]).toHaveLength(3);
    expect(probeOnly.read).toBeUndefined();
    expect(combined.read).toBeDefined();
    expect(combined.activeProbe).toBeDefined();
  });
});

describe("PluginReadDefinition and ActiveProbeDefinition shapes", () => {
  it("PluginReadDefinition accepts optional pass/fail patterns", () => {
    const read: PluginReadDefinition = {
      cmd: "echo ok",
      passPattern: "ok",
      failPattern: "fail",
    };
    expect(read.cmd).toBe("echo ok");
    expect(read.passPattern).toBe("ok");
  });

  it("ActiveProbeDefinition enforces risk enum and required timeoutMs", () => {
    const probe: ActiveProbeDefinition = {
      handler: "./probes/x.js",
      risk: "high",
      timeoutMs: 60_000,
    };
    expect(probe.risk).toBe("high");
    expect(probe.timeoutMs).toBe(60_000);
  });
});

describe("PluginProbeTarget and PluginProbeContext", () => {
  it("PluginProbeTarget carries server identification", () => {
    const target: PluginProbeTarget = {
      serverId: "srv-1",
      provider: "hetzner",
      cloudId: "12345",
      ip: "1.2.3.4",
    };
    expect(target.ip).toBe("1.2.3.4");
    expect(target.provider).toBe("hetzner");
  });

  it("PluginProbeContext exposes readonly target, signal, ssh, and logger", () => {
    const ac = new AbortController();
    const ctx: PluginProbeContext = {
      target: { serverId: "s", provider: "hetzner", ip: "1.2.3.4" },
      sessionId: "session-1",
      pluginName: "kastell-plugin-test",
      checkId: "TST-001",
      signal: ac.signal,
      deadlineMs: 30_000,
      ssh: async () => ({ stdout: "", stderr: "", code: 0 }),
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    };
    expect(ctx.target.ip).toBe("1.2.3.4");
    expect(ctx.deadlineMs).toBe(30_000);
  });
});

describe("LoadedPluginCheck normalized shape", () => {
  it("keeps normalized checks independent from public v2/v3 shapes", () => {
    const normalized: LoadedPluginCheck = {
      id: "TST-READ",
      name: "read",
      category: "Test",
      severity: "info",
      description: "",
      sourceApiVersion: "2",
      read: { cmd: "echo ok" },
    };
    expect(normalized.sourceApiVersion).toBe("2");
    expect(normalized.read?.cmd).toBe("echo ok");
  });

  it("PluginCheck migration shim still resolves to PluginCheckV2", () => {
    const check: PluginCheck = {
      id: "WP-1",
      name: "wp",
      category: "WP",
      severity: "info",
      description: "d",
      checkCommand: { kind: "read", cmd: "echo ok" },
    };
    expect(check.checkCommand.kind).toBe("read");
  });
});
