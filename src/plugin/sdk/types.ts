import type { Severity, FixTier } from "../../types/severity.js";

export type PluginCapability = "audit" | "command" | "mcp-tool" | "fix";

export type PluginSeverity = Severity;
export type PluginFixTier = FixTier;

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

export interface PluginManifest {
  name: string;
  version: string;
  apiVersion: string;
  kastell: string;
  capabilities: PluginCapability[];
  checkPrefix: string;
  entry: string;
  /**
   * Set to true to declare this plugin's checkCommand mutates system state
   * (e.g. rm, systemctl restart, > redirection). When true, audit forces
   * cap=1 (sequential) execution to avoid races. Default false (read-only,
   * safe to parallelize).
   *
   * Preferred over the legacy `safeToParallel: false` flag — see
   * altitude A9 in CQS-low-clean design. Both fields are accepted;
   * `mutates` takes precedence when both are set.
   */
  mutates?: boolean;
  /**
   * @deprecated Use `mutates: true` instead. Inverted polarity was a
   * frequent footgun (altitude A9). Kept for back-compat with existing
   * plugin manifests.
   */
  safeToParallel?: boolean;
  commands?: PluginCommand[];
  mcpTools?: PluginMcpTool[];
  fixes?: PluginFix[];
}

export interface PluginCheck {
  id: string;
  name: string;
  category: string;
  severity: PluginSeverity;
  description: string;
  checkCommand: string;
  passPattern?: string;
  failPattern?: string;
  fixCommand?: string;
  safeToAutoFix?: PluginFixTier;
  explain?: string;
  complianceRefs?: Array<{ framework: string; ref: string }>;
}

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
