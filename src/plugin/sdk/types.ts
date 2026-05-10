export type PluginCapability = "audit" | "command" | "mcp-tool" | "fix";
export type PluginSeverity = "critical" | "warning" | "info";
export type PluginFixTier = "SAFE" | "GUARDED" | "FORBIDDEN";

export interface PluginCommand {
  name: string;
  description: string;
  handler: string;
}

export interface PluginMcpTool {
  name: string;
  description: string;
  handler: string;
}

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
