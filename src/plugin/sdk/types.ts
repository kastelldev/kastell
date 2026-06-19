import type { Severity, FixTier } from "../../types/severity.js";
import type { PluginApiVersion } from "./constants.js";

export type PluginCapability = "audit" | "command" | "mcp-tool" | "fix";

export type PluginSeverity = Severity;
export type PluginFixTier = FixTier;

export const PLUGIN_CHECK_COMMAND_KINDS = ["read", "mutate-local", "mutate-global"] as const;
export type PluginCheckCommandKind = (typeof PLUGIN_CHECK_COMMAND_KINDS)[number];

export interface PluginCommand {
  name: string;
  description: string;
  handler: string;
}

export interface PluginMcpTool {
  name: string;
  description: string;
  handler: string;
  inputSchema?: Record<string, unknown>;
}

export interface PluginContext {
  server?: string;
  ip?: string;
  ssh: (command: string, options?: { timeoutMs?: number }) => Promise<{ stdout: string; stderr: string; code: number }>;
  logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
}

export type PluginCommandHandler = (
  args: Record<string, unknown>,
  ctx: PluginContext,
) => Promise<void>;

export type PluginMcpToolHandler = (
  args: Record<string, unknown>,
  ctx: PluginContext,
) => Promise<{ content: Array<{ type: string; text: string }> }>;

export interface PluginFix {
  checkId: string;
  tier: "SAFE" | "GUARDED";
  handler: string;
  backupPaths?: string[];
}

export type PluginCheckCommand =
  | { kind: "read"; cmd: string }
  | { kind: "mutate-local"; cmd: string }
  | { kind: "mutate-global"; cmd: string };

export type PluginExplainObject = { why: string; fix: string };
export type PluginExplain = string | PluginExplainObject;

export interface PluginReadDefinition {
  cmd: string;
  passPattern?: string;
  failPattern?: string;
}

export type PluginProbeRisk = "low" | "medium" | "high";

export interface ActiveProbeDefinition {
  handler: string;
  risk: PluginProbeRisk;
  timeoutMs: number;
}

export interface PluginProbeTarget {
  serverId: string;
  provider: string;
  cloudId?: string;
  ip: string;
}

export interface PluginProbeContext {
  readonly target: PluginProbeTarget;
  readonly sessionId: string;
  readonly pluginName: string;
  readonly checkId: string;
  readonly signal: AbortSignal;
  readonly deadlineMs: number;
  ssh: (command: string, options?: { timeoutMs?: number }) => Promise<{ stdout: string; stderr: string; code: number }>;
  logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
}

export interface PluginProbeVerification {
  passed: boolean;
  summary?: string;
  data?: Record<string, unknown>;
}

export interface PluginProbeRollbackResult {
  success: boolean;
  summary?: string;
  data?: Record<string, unknown>;
}

export interface ActiveProbeModule {
  prepare: (ctx: PluginProbeContext) => Promise<unknown>;
  execute: (ctx: PluginProbeContext, prepared: unknown) => Promise<unknown>;
  verify: (
    ctx: PluginProbeContext,
    prepared: unknown,
    executed: unknown,
  ) => Promise<PluginProbeVerification>;
  rollback: (
    ctx: PluginProbeContext,
    prepared: unknown,
    executed?: unknown,
  ) => Promise<PluginProbeRollbackResult>;
}

export interface PluginComplianceRef {
  framework: string;
  ref: string;
}

interface PluginCheckBase {
  id: string;
  name: string;
  category: string;
  severity: PluginSeverity;
  description: string;
  complianceRefs?: PluginComplianceRef[];
}

export interface PluginCheckV2 extends PluginCheckBase {
  checkCommand: PluginCheckCommand;
  passPattern?: string;
  failPattern?: string;
  fixCommand?: string;
  safeToAutoFix?: PluginFixTier;
  // FIXME(p144-t5/t6): tighten to literal string and migrate listChecks/audit consumers
  // away from string default; schema already rejects object form.
  explain?: string;
}

export interface PluginCheckV3 extends PluginCheckBase {
  read?: PluginReadDefinition;
  activeProbe?: ActiveProbeDefinition;
  explain?: PluginExplain;
}

export type PluginCheck = PluginCheckV2;

export type NormalizedReadCheck = PluginReadDefinition;

export type NormalizedActiveProbe = ActiveProbeDefinition;

/**
 * Unified runtime check shape produced by `validateAndNormalizeChecks`.
 * Unified structural type: v2 fields (`checkCommand`, `passPattern`, etc.)
 * are present on v2-normalized checks and absent on v3 ones. v3 adds
 * `read` and `activeProbe`. The `sourceApiVersion` discriminator lets
 * post-validation consumers narrow where needed.
 *
 * FIXME(p144-t5/t6): tighten LoadedPluginCheck to a v2/v3 discriminated
 * union so pluginAudit.ts/buildPluginBatchSection can narrow by
 * sourceApiVersion. v2-specific fields are kept optional here so existing
 * consumer code keeps compiling.
 */
export interface LoadedPluginCheck {
  id: string;
  name: string;
  category: string;
  severity: PluginSeverity;
  description: string;
  sourceApiVersion: PluginApiVersion;
  read?: PluginReadDefinition;
  activeProbe?: ActiveProbeDefinition;
  explain?: PluginExplain;
  complianceRefs?: PluginComplianceRef[];
  checkCommand?: PluginCheckCommand;
  passPattern?: string;
  failPattern?: string;
  fixCommand?: string;
  safeToAutoFix?: PluginFixTier;
}

interface PluginManifestBase {
  name: string;
  version: string;
  kastell: string;
  capabilities: PluginCapability[];
  checkPrefix: string;
  entry: string;
  commands?: PluginCommand[];
  mcpTools?: PluginMcpTool[];
  fixes?: PluginFix[];
}

export type PluginManifest =
  | (PluginManifestBase & { apiVersion: "2" })
  | (PluginManifestBase & { apiVersion: "3" });

export interface PluginFixContext {
  ip: string;
  ssh: (command: string, options?: { timeoutMs?: number }) => Promise<{ stdout: string; stderr: string; code: number }>;
  logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
  dryRun: boolean;
  manifest: PluginManifest;
}

export interface PluginFixResult {
  success: boolean;
  error?: string;
  modifiedFiles?: string[];
}

export type PluginFixHandler = (
  checkId: string,
  ctx: PluginFixContext,
) => Promise<PluginFixResult>;

export interface PluginModuleExport {
  default?: Record<string, unknown> | ((...args: unknown[]) => unknown);
  handler?: (...args: unknown[]) => unknown;
  run?: (...args: unknown[]) => unknown;
  fix?: (...args: unknown[]) => unknown;
}
