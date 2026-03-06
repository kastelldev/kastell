export interface Region {
  id: string;
  name: string;
  location: string;
}

export interface ServerSize {
  id: string;
  name: string;
  vcpu: number;
  ram: number;
  disk: number;
  price: string;
}

export interface ServerConfig {
  name: string;
  size: string;
  region: string;
  cloudInit: string;
  sshKeyIds?: string[];
}

export interface ServerResult {
  id: string;
  ip: string;
  status: string;
}

export type ServerMode = "coolify" | "bare";

export type Platform = "coolify" | "dokploy";

export interface DeploymentConfig {
  provider: string;
  apiToken: string;
  region: string;
  serverSize: string;
  serverName: string;
  /** @deprecated Use platform field. Kept for backward compat */
  mode?: ServerMode;
  /** Platform adapter. undefined = bare (no platform) */
  platform?: Platform;
}

export interface ServerRecord {
  id: string;
  name: string;
  provider: string;
  ip: string;
  region: string;
  size: string;
  createdAt: string;
  /** @deprecated Use platform field. Kept for backward compat */
  mode?: ServerMode;
  /** Platform adapter. undefined = bare (no platform) */
  platform?: Platform;
}

export interface InitOptions {
  provider?: string;
  token?: string;
  tokenStdin?: boolean;
  region?: string;
  size?: string;
  name?: string;
  fullSetup?: boolean;
  config?: string;
  template?: string;
  noOpen?: boolean;
  mode?: ServerMode;
}

// Templates
export type TemplateName = "starter" | "production" | "dev";

export interface TemplateProviderDefaults {
  region: string;
  size: string;
}

export interface TemplateDefinition {
  name: TemplateName;
  description: string;
  defaults: Record<string, TemplateProviderDefaults>;
  fullSetup: boolean;
}

// YAML Config
export interface KastellYamlConfig {
  template?: TemplateName;
  provider?: string;
  region?: string;
  size?: string;
  name?: string;
  fullSetup?: boolean;
  domain?: string;
}

export interface KastellConfig {
  provider?: string;
  region?: string;
  size?: string;
  name?: string;
}

// Firewall
export type FirewallProtocol = "tcp" | "udp";
export interface FirewallRule {
  port: number;
  protocol: FirewallProtocol;
  action: "ALLOW" | "DENY";
  from: string;
}
export interface FirewallStatus {
  active: boolean;
  rules: FirewallRule[];
}

// Secure
export interface SshdSetting {
  key: string;
  value: string;
  status: "secure" | "insecure" | "missing";
}
export interface SecureAuditResult {
  passwordAuth: SshdSetting;
  rootLogin: SshdSetting;
  fail2ban: { installed: boolean; active: boolean };
  sshPort: number;
}

// Snapshot
export interface SnapshotInfo {
  id: string;
  serverId: string;
  name: string;
  status: string;
  sizeGb: number;
  createdAt: string;
  costPerMonth: string;
}

// Backup
export interface BackupManifest {
  serverName: string;
  provider: string;
  timestamp: string;
  coolifyVersion: string;
  files: string[];
  mode?: ServerMode;
  /** Platform adapter. undefined = bare (no platform) */
  platform?: Platform;
}

// Result pattern for core/ functions (no exceptions thrown)
export interface KastellResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
  hint?: string;
}
