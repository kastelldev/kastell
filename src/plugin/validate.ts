import { z } from "zod";
import semver from "semver";
import { ValidationError } from "../utils/errors.js";
import { KASTELL_VERSION } from "../utils/version.js";
import type { PluginManifest, PluginCheck } from "./sdk/types.js";
import { PLUGIN_NAME_PATTERN } from "./sdk/constants.js";

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

const PluginCheckSchema = z.object({
  id: z
    .string()
    .regex(/^[A-Z][A-Z0-9_-]{1,63}$/, "Check id must be uppercase alphanumeric/underscore/dash, 2-64 chars"),
  category: z.string().min(1),
  name: z.string().min(1),
  severity: z.enum(["critical", "warning", "info"]),
  description: z.string().optional(),
  checkCommand: z
    .string()
    .min(1)
    .refine((s) => !s.includes("---SECTION:"), "checkCommand must not contain '---SECTION:' substring")
    .refine((s) => !s.includes("KASTELL_PLUGIN_CHECK_EOF"), "checkCommand must not contain heredoc tag 'KASTELL_PLUGIN_CHECK_EOF'")
    .refine((s) => !/\r/.test(s), "checkCommand must not contain CR characters"),
  passPattern: z.string().optional(),
  failPattern: z.string().optional(),
  fixCommand: z.string().optional(),
  safeToAutoFix: z.enum(["SAFE", "GUARDED", "FORBIDDEN"]).optional(),
  explain: z
    .union([
      z.string(),
      z.object({ why: z.string(), fix: z.string() }),
    ])
    .optional(),
  complianceRefs: z
    .array(z.object({ framework: z.string(), ref: z.string() }))
    .optional(),
});

const PluginManifestSchema = z
  .object({
    name: z.string().regex(PLUGIN_NAME_PATTERN, "Name must match kastell-plugin-<lowercase>"),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, "Version must be semver (X.Y.Z)"),
    apiVersion: z.literal("1"),
    kastell: z.string().min(1, "Kastell version range required"),
    capabilities: z.array(z.enum(["audit", "command", "mcp-tool", "fix"])).min(1),
    checkPrefix: z.string().regex(/^[A-Z]{2,6}$/, "checkPrefix must be 2-6 uppercase letters"),
    entry: z.string().min(1, "Entry point required"),
    safeToParallel: z.boolean().optional(),
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

export function validateChecks(checks: unknown, checkPrefix: string): PluginCheck[] {
  if (!Array.isArray(checks)) {
    throw new ValidationError("Plugin checks must be an array");
  }
  const parsed: PluginCheck[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < checks.length; i++) {
    const result = PluginCheckSchema.safeParse(checks[i]);
    if (!result.success) {
      throw new ValidationError(`Invalid plugin check at index ${i}: ${result.error.message}`);
    }
    const check = result.data;
    if (!check.id.startsWith(checkPrefix + "-")) {
      throw new ValidationError(
        `Check id "${check.id}" must start with plugin prefix "${checkPrefix}-"`,
      );
    }
    if (seen.has(check.id)) {
      throw new ValidationError(`Duplicate check id "${check.id}" within plugin`);
    }
    seen.add(check.id);
    parsed.push(check as PluginCheck);
  }
  return parsed;
}
