import { z } from "zod";
import semver from "semver";
import { ValidationError } from "../utils/errors.js";
import { KASTELL_VERSION } from "../utils/version.js";
import type {
  PluginManifest,
  PluginCheckV2,
  PluginCheckV3,
} from "./sdk/types.js";
import { PLUGIN_NAME_PATTERN, type PluginApiVersion } from "./sdk/constants.js";
import { PLUGIN_CHECK_COMMAND_KINDS } from "./sdk/types.js";

const HANDLER_PATH_PATTERN = /^\.\/(?!.*\.\.)(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.js$/;

const PluginCommandSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  handler: z.string().regex(HANDLER_PATH_PATTERN, "Handler must be relative ./path.js"),
});

const PluginMcpToolSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  handler: z.string().regex(HANDLER_PATH_PATTERN, "Handler must be relative ./path.js"),
});

const PluginFixSchema = z.object({
  checkId: z.string().min(1),
  tier: z.enum(["SAFE", "GUARDED"]),
  handler: z.string().regex(HANDLER_PATH_PATTERN, "Handler must be relative ./path.js"),
  backupPaths: z.array(z.string().regex(/^\//, "Backup path must be absolute")).optional(),
});

const checkIdSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_-]{1,63}$/, "Check id must be uppercase alphanumeric/underscore/dash, 2-64 chars");

const severitySchema = z.enum(["critical", "warning", "info"]);

const complianceRefsSchema = z
  .array(z.object({ framework: z.string(), ref: z.string() }))
  .optional();

// v2 checkCommand: keep current shell-injection guards
const PluginCheckCommandV2Schema = z
  .object({
    kind: z.enum(PLUGIN_CHECK_COMMAND_KINDS, {
      error: `checkCommand.kind must be one of: ${PLUGIN_CHECK_COMMAND_KINDS.join(", ")}`,
    }),
    cmd: z
      .string()
      .min(1)
      .refine((s) => !s.includes("---SECTION:"), "checkCommand.cmd must not contain '---SECTION:' substring")
      .refine((s) => !s.includes("KASTELL_PLUGIN_CHECK_EOF"), "checkCommand.cmd must not contain heredoc tag 'KASTELL_PLUGIN_CHECK_EOF'")
      .refine((s) => !/\r/.test(s), "checkCommand.cmd must not contain CR characters"),
  })
  .strict();

// v3 read object -- same dangerous-token guards as v2 cmd
const PluginReadV3Schema = z
  .object({
    cmd: z.string().min(1),
    passPattern: z.string().optional(),
    failPattern: z.string().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.cmd.includes("---SECTION:")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "read.cmd must not contain '---SECTION:'",
        path: ["cmd"],
      });
    }
    if (value.cmd.includes("KASTELL_PLUGIN_CHECK_EOF")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "read.cmd must not contain heredoc tag 'KASTELL_PLUGIN_CHECK_EOF'",
        path: ["cmd"],
      });
    }
    if (value.cmd.includes("\r")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "read.cmd must not contain CR characters",
        path: ["cmd"],
      });
    }
  });

const PluginActiveProbeV3Schema = z
  .object({
    handler: z.string().regex(HANDLER_PATH_PATTERN, "Active Probe handler must be relative ./path.js"),
    risk: z.enum(["low", "medium", "high"]),
    timeoutMs: z.number().int().min(5_000).max(300_000),
  })
  .strict();

const PluginCheckV2Schema = z
  .object({
    id: checkIdSchema,
    category: z.string().min(1),
    name: z.string().min(1),
    severity: severitySchema,
    description: z.string().optional(),
    checkCommand: PluginCheckCommandV2Schema,
    passPattern: z.string().optional(),
    failPattern: z.string().optional(),
    fixCommand: z.string().optional(),
    safeToAutoFix: z.enum(["SAFE", "GUARDED", "FORBIDDEN"]).optional(),
    // PluginCheckV2.explain is string-only at the type level (see FIXME in
    // sdk/types.ts). v3 retains the rich {why, fix} union. Reject the object
    // form in v2 with a migration message to avoid silent data loss between
    // plugin author contract and audit/listChecks consumers.
    explain: z
      .string({
        error:
          "PluginCheckV2.explain must be a string. Use PluginCheckV3 for structured explain (docs/plugin-sdk-migration-v3.md).",
      })
      .optional(),
    complianceRefs: complianceRefsSchema,
  })
  .strict();

const PluginCheckV3Schema = z
  .object({
    id: checkIdSchema,
    category: z.string().min(1),
    name: z.string().min(1),
    severity: severitySchema,
    description: z.string().min(1),
    read: PluginReadV3Schema.optional(),
    activeProbe: PluginActiveProbeV3Schema.optional(),
    explain: z
      .union([z.string(), z.object({ why: z.string(), fix: z.string() })])
      .optional(),
    complianceRefs: complianceRefsSchema,
  })
  .strict()
  .refine(
    (check) => check.read !== undefined || check.activeProbe !== undefined,
    { message: "Plugin API v3 check requires read and/or activeProbe" },
  );

const PluginManifestSchema = z
  .object({
    name: z.string().regex(PLUGIN_NAME_PATTERN, "Name must match kastell-plugin-<lowercase>"),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, "Version must be semver (X.Y.Z)"),
    apiVersion: z.union([z.literal("2"), z.literal("3")]),
    kastell: z.string().min(1, "Kastell version range required"),
    capabilities: z.array(z.enum(["audit", "command", "mcp-tool", "fix"])).min(1),
    checkPrefix: z.string().regex(/^[A-Z]{2,6}$/, "checkPrefix must be 2-6 uppercase letters"),
    entry: z.string().min(1, "Entry point required"),
    commands: z.array(PluginCommandSchema).optional(),
    mcpTools: z.array(PluginMcpToolSchema).optional(),
    fixes: z.array(PluginFixSchema).optional(),
  })
  .strict();

export function validateManifest(manifest: unknown): PluginManifest {
  const parsed = PluginManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    throw new ValidationError(`Invalid plugin manifest: ${parsed.error.message}`);
  }

  const range = semver.validRange(parsed.data.kastell);
  if (!range) {
    throw new ValidationError(
      `Invalid kastell version range: "${parsed.data.kastell}"`,
    );
  }

  if (!semver.satisfies(KASTELL_VERSION, parsed.data.kastell)) {
    throw new ValidationError(
      `Plugin requires Kastell ${parsed.data.kastell}, current: ${KASTELL_VERSION}`,
    );
  }

  if (parsed.data.fixes) {
    for (const fix of parsed.data.fixes) {
      if (!fix.checkId.startsWith(parsed.data.checkPrefix + "-")) {
        throw new ValidationError(
          `Fix checkId "${fix.checkId}" must start with plugin prefix "${parsed.data.checkPrefix}-"`,
        );
      }
    }
  }

  if (parsed.data.commands) {
    const names = parsed.data.commands.map((c) => c.name);
    if (names.length !== new Set(names).size) {
      throw new ValidationError("Duplicate command names are not allowed");
    }
  }

  if (parsed.data.mcpTools) {
    const names = parsed.data.mcpTools.map((m) => m.name);
    if (names.length !== new Set(names).size) {
      throw new ValidationError("Duplicate mcpTool names are not allowed");
    }
  }

  if (parsed.data.fixes) {
    const checkIds = parsed.data.fixes.map((f) => f.checkId);
    if (checkIds.length !== new Set(checkIds).size) {
      throw new ValidationError("Duplicate fix checkIds are not allowed");
    }
  }

  if (parsed.data.commands && !parsed.data.capabilities.includes("command")) {
    throw new ValidationError("commands field requires 'command' capability");
  }
  if (parsed.data.mcpTools && !parsed.data.capabilities.includes("mcp-tool")) {
    throw new ValidationError("mcpTools field requires 'mcp-tool' capability");
  }
  if (parsed.data.fixes && !parsed.data.capabilities.includes("fix")) {
    throw new ValidationError("fixes field requires 'fix' capability");
  }

  return parsed.data;
}

/**
 * Validates plugin checks.
 *
 * @param checks - Raw check array from plugin manifest
 * @param checkPrefix - Plugin check prefix (registry validation)
 * @param apiVersion - Plugin API version (defaults to "2" for backward compat)
 * @param pluginName - Plugin name (used in error messages; defaults to "<unknown>")
 *
 * New code MUST pass `apiVersion` and `pluginName` to receive v3 acceptance
 * and migration-path rejection.
 */
export function validateChecks(
  checks: unknown,
  checkPrefix: string,
  apiVersion: PluginApiVersion = "2",
  pluginName: string = "<unknown>",
): (PluginCheckV2 | PluginCheckV3)[] {
  if (!Array.isArray(checks)) {
    throw new ValidationError("Plugin checks must be an array");
  }
  const parsed: (PluginCheckV2 | PluginCheckV3)[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < checks.length; i++) {
    const result =
      apiVersion === "2"
        ? PluginCheckV2Schema.safeParse(checks[i])
        : PluginCheckV3Schema.safeParse(checks[i]);
    if (!result.success) {
      throw new ValidationError(`Invalid plugin check at index ${i}: ${result.error.message}`);
    }
    const check = result.data;

    // v2-specific guards: mutate-* and raw fixCommand are rejected with
    // migration guidance toward docs/plugin-sdk-migration-v3.md
    if (apiVersion === "2") {
      const v2Check = check as PluginCheckV2;
      if (
        v2Check.checkCommand.kind === "mutate-local" ||
        v2Check.checkCommand.kind === "mutate-global"
      ) {
        throw new ValidationError(
          `Plugin "${pluginName}" check "${v2Check.id}" uses checkCommand.kind "${v2Check.checkCommand.kind}"; mutate-* is not allowed in Plugin API v2 — migrate to v3 (see docs/plugin-sdk-migration-v3.md).`,
        );
      }
      if (v2Check.fixCommand !== undefined) {
        throw new ValidationError(
          `Plugin "${pluginName}" check "${v2Check.id}" defines raw fixCommand; v2 fixCommand is removed — migrate to v3 (see docs/plugin-sdk-migration-v3.md).`,
        );
      }
    }

    if (!check.id.startsWith(checkPrefix + "-")) {
      throw new ValidationError(
        `Check id "${check.id}" must start with plugin prefix "${checkPrefix}-"`,
      );
    }
    if (seen.has(check.id)) {
      throw new ValidationError(`Duplicate check id "${check.id}" within plugin`);
    }
    seen.add(check.id);
    parsed.push(check as PluginCheckV2 | PluginCheckV3);
  }
  return parsed;
}
