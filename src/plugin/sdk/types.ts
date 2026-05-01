export type PluginSeverity = "critical" | "warning" | "info";
export type PluginFixTier = "SAFE" | "GUARDED" | "FORBIDDEN";

export interface PluginManifest {
  name: string;
  version: string;
  apiVersion: string;
  kastell: string;
  capabilities: Array<"audit">;
  checkPrefix: string;
  entry: string;
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
