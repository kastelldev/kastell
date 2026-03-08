import type { BackupManifest } from "../types/index.js";

export interface HealthResult {
  status: "running" | "not reachable";
}

export interface PlatformStatusResult {
  platformVersion: string;
  status: "running" | "not reachable";
}

export interface PlatformBackupResult {
  success: boolean;
  backupPath?: string;
  manifest?: BackupManifest;
  error?: string;
  hint?: string;
}

export interface UpdateResult {
  success: boolean;
  output?: string;
  error?: string;
  hint?: string;
}

export interface PlatformAdapter {
  readonly name: string;
  getCloudInit(serverName: string): string;
  healthCheck(ip: string, domain?: string): Promise<HealthResult>;
  createBackup(ip: string, serverName: string, provider: string): Promise<PlatformBackupResult>;
  getStatus(ip: string): Promise<PlatformStatusResult>;
  update(ip: string): Promise<UpdateResult>;
  getLogCommand(lines: number, follow: boolean): string;
}
