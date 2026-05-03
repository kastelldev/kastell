export interface LockOptions {
  production?: boolean;
  dryRun?: boolean;
  force?: boolean;
}

export interface LockStepResult {
  // Group 1: SSH & Auth
  sshHardening: boolean;
  fail2ban: boolean;
  banners: boolean;
  accountLock: boolean;
  sshCipher: boolean;
  // Group 2: Firewall & Network
  ufw: boolean;
  cloudMeta: boolean;
  dns: boolean;
  // Group 3: System
  sysctl: boolean;
  unattendedUpgrades: boolean;
  aptValidation: boolean;
  resourceLimits: boolean;
  serviceDisable: boolean;
  backupPermissions: boolean;
  pwquality: boolean;
  dockerHardening: boolean;
  // Group 4: Monitoring
  auditd: boolean;
  logRetention: boolean;
  aide: boolean;
  cronAccess: boolean;
  // Group 5: Score Boost (P87)
  sshFineTuning: boolean;
  loginDefs: boolean;
  faillock: boolean;
  sudoHardening: boolean;
}

export interface LockResult {
  success: boolean;
  steps: LockStepResult;
  stepErrors?: Partial<Record<keyof LockStepResult, string>>;
  scoreBefore?: number;
  scoreAfter?: number;
  error?: string;
  hint?: string;
}
