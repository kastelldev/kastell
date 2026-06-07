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

export type PluginCheckCommand =
  | { kind: "read"; cmd: string }
  | { kind: "mutate-local"; cmd: string }
  | { kind: "mutate-global"; cmd: string };

export interface PluginManifest {
  name: string;
  version: string;
  apiVersion: "2";
  kastell: string;
  capabilities: PluginCapability[];
  checkPrefix: string;
  entry: string;
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
  checkCommand: PluginCheckCommand;
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
