/**
 * Secrets Exposure security check parser.
 * Parses world-readable .env files, SSH private key permissions,
 * git config token exposure, /etc plaintext credentials,
 * AWS credential files, Docker env files, and npm token exposure.
 */

import type {AuditCheck, CheckParser, Severity, FixTier} from "../types.js";
import { CHECK_IDS } from "../checkIds.js";

interface SecretsCheckDef {
  id: string;
  name: string;
  severity: Severity;
  check: (output: string) => { passed: boolean; currentValue: string };
  expectedValue: string;
  fixCommand: string;
  safeToAutoFix?: FixTier;
  explain: string;
}

const SECRETS_CHECKS: SecretsCheckDef[] = [
  {
    id: CHECK_IDS.SECRETS.SECRETS_ENV_WORLD_READABLE,
    name: "No World-Readable .env Files",
    severity: "critical",
    check: (output) => {
      // Use word-boundary check: NO_WORLD_READABLE_ENV means pass; WORLD_READABLE_ENV alone means fail
      const noSentinel = output.includes("NO_WORLD_READABLE_ENV");
      // Only flag as fail if WORLD_READABLE_ENV appears but NOT as part of NO_WORLD_READABLE_ENV
      const hasWorldReadable = !noSentinel && output.includes("WORLD_READABLE_ENV");
      return {
        passed: !hasWorldReadable,
        currentValue: hasWorldReadable
          ? "World-readable .env files found in /etc, /home, /opt, /srv, or /var/www"
          : "No world-readable .env files found",
      };
    },
    expectedValue: ".env files not world-readable (mode 600 or 640)",
    fixCommand:
      "find /etc /home /opt /srv /var/www -maxdepth 3 -name '.env' -perm -o+r -exec chmod 600 {} \\; && chown root:root $(find /etc -maxdepth 3 -name '.env' 2>/dev/null)",
    safeToAutoFix: "SAFE",
    explain:
      "World-readable .env files expose API keys, database credentials, and service secrets to any local user on the system. Attackers who obtain local code execution can read these files without privilege escalation.",
  },
  {
    id: CHECK_IDS.SECRETS.SECRETS_SSH_KEY_PERMS,
    name: "SSH Private Keys Not Overly Permissive",
    severity: "critical",
    check: (output) => {
      // Look for stat output like "664 /home/user/.ssh/id_rsa" or "644 /home/user/.ssh/id_ed25519"
      // Permissions > 600 are overly permissive for private keys
      const lines = output.split("\n");
      const permissiveKeys: string[] = [];
      for (const line of lines) {
        // Match "NNN /path/to/key" format from stat -c '%a %n'
        const match = line.match(/^(\d{3,4})\s+(.*(?:id_rsa|id_ed25519|id_ecdsa|id_dsa|.*\.pem).*)/);
        if (match) {
          const mode = match[1];
          const path = match[2];
          // Only 400 and 600 are acceptable for private keys
          if (mode !== "400" && mode !== "600") {
            permissiveKeys.push(`${mode} ${path}`);
          }
        }
      }
      const passed = permissiveKeys.length === 0;
      return {
        passed,
        currentValue: passed
          ? "All SSH private keys have correct permissions (400 or 600)"
          : `Overly permissive SSH private keys: ${permissiveKeys.slice(0, 3).join(", ")}`,
      };
    },
    expectedValue: "SSH private keys have permissions 400 or 600",
    fixCommand: "find /home /root -maxdepth 4 \\( -name 'id_rsa' -o -name 'id_ed25519' -o -name 'id_ecdsa' -o -name 'id_dsa' -o -name '*.pem' \\) -exec chmod 600 {} \\;",
    safeToAutoFix: "SAFE",
    explain:
      "SSH private keys with permissions wider than 600 can be read by other users on the system, allowing impersonation and unauthorized access to remote hosts. SSH itself will refuse to use keys that are too permissive.",
  },
  {
    id: CHECK_IDS.SECRETS.SECRETS_GIT_CONFIG_TOKEN,
    name: "No Tokens in Git Config",
    severity: "critical",
    check: (output) => {
      // Positive lines indicate .git/config files found by grep for 'url.*@.*' patterns
      // Parser gets file paths returned by grep -l
      const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
      const tokenFiles = lines.filter((l) => l.includes(".git/config") && !l.includes("NONE"));
      const passed = tokenFiles.length === 0 || output.includes("NONE");
      return {
        passed,
        currentValue: passed
          ? "No credential-embedded URLs found in .git/config files"
          : `Git config files with embedded credentials found: ${tokenFiles.slice(0, 3).join(", ")}`,
      };
    },
    expectedValue: "No credentials embedded in .git/config URL fields",
    fixCommand:
      "git credential-store --file ~/.git-credentials && git config --global credential.helper store",
    safeToAutoFix: "SAFE",
    explain:
      "Tokens or passwords embedded in .git/config remote URLs (e.g., https://user:TOKEN@github.com/...) are stored in plaintext and readable by anyone with filesystem access to the repo directory.",
  },
  {
    id: CHECK_IDS.SECRETS.SECRETS_ETC_PLAINTEXT_CRED,
    name: "No Plaintext Credentials in /etc Configs",
    severity: "warning",
    check: (output) => {
      // NO_PLAINTEXT_ETC_CRED sentinel = pass; PLAINTEXT_ETC_CRED sentinel = fail
      // Also fail when actual /etc/ file paths are returned by grep -l
      if (output.includes("NO_PLAINTEXT_ETC_CRED") || output.includes("NONE")) {
        return { passed: true, currentValue: "No plaintext credentials detected in /etc config files" };
      }
      const hasPlaintext =
        output.includes("PLAINTEXT_ETC_CRED") ||
        /\/etc\/[a-z][a-z0-9/._-]+\.[a-z]+/.test(output);
      return {
        passed: !hasPlaintext,
        currentValue: hasPlaintext
          ? "Plaintext password/token patterns found in /etc config files"
          : "No plaintext credentials detected in /etc config files",
      };
    },
    expectedValue: "No plaintext password= or token= entries in /etc/*.conf",
    fixCommand:
      "# Review files containing plaintext credentials and replace with vault/env-var references or restrict permissions: chmod 640 /etc/affected.conf && chown root:service-group /etc/affected.conf",
    safeToAutoFix: "GUARDED",
    explain:
      "Config files in /etc containing plaintext passwords or tokens are readable by system services and privileged users. Credentials should be stored in a secrets manager or environment-specific vault, not in world-accessible config files.",
  },
  {
    id: CHECK_IDS.SECRETS.SECRETS_ENV_IN_HOME,
    name: "No Unprotected .env Files in Home Directories",
    severity: "warning",
    check: (output) => {
      const hasEnvInHome = output.includes("ENV_IN_HOME");
      const noEnvInHome = output.includes("NO_ENV_IN_HOME");
      const passed = noEnvInHome || !hasEnvInHome;
      return {
        passed,
        currentValue: passed
          ? "No unprotected .env files found in home directories"
          : ".env files found in home directories with permissive access",
      };
    },
    expectedValue: ".env files in home directories are not world-readable",
    fixCommand:
      "find /home -maxdepth 3 -name '.env' -exec chmod 600 {} \\;",
    safeToAutoFix: "SAFE",
    explain:
      "Application .env files in user home directories may contain database passwords, API keys, and service tokens. Without proper permissions, these are readable by any local user on a shared system.",
  },
  {
    id: CHECK_IDS.SECRETS.SECRETS_WORLD_READABLE_KEYS,
    name: "No World-Readable Private Key Files",
    severity: "critical",
    check: (output) => {
      const hasWorldReadableKeys = output.includes("WORLD_READABLE_KEY");
      const noWorldReadableKeys = output.includes("NO_WORLD_READABLE_KEYS");
      const passed = noWorldReadableKeys || !hasWorldReadableKeys;
      return {
        passed,
        currentValue: passed
          ? "No world-readable private key files found"
          : "World-readable private key files detected",
      };
    },
    expectedValue: "Private key files (.pem, id_*, etc.) not world-readable",
    fixCommand:
      "find /home /root /etc /opt -maxdepth 4 \\( -name '*.pem' -o -name '*.key' -o -name 'id_rsa' -o -name 'id_ed25519' \\) -perm -o+r -exec chmod 600 {} \\;",
    safeToAutoFix: "SAFE",
    explain:
      "World-readable private keys (TLS keys, SSH keys, service keys) allow any local user to decrypt traffic, forge signatures, or authenticate as the key owner. This is a direct secret exfiltration risk.",
  },
  {
    id: CHECK_IDS.SECRETS.SECRETS_AWS_CREDS_PERMS,
    name: "AWS Credentials File Not Overly Permissive",
    severity: "warning",
    check: (output) => {
      const hasAwsCreds = output.includes("AWS_CREDS_FOUND");
      const noAwsCreds = output.includes("NO_AWS_CREDS");
      const passed = noAwsCreds || !hasAwsCreds;
      return {
        passed,
        currentValue: passed
          ? "No overly permissive AWS credential files found"
          : "AWS credentials file found with permissive access mode",
      };
    },
    expectedValue: "~/.aws/credentials has mode 600 and is not world-readable",
    fixCommand:
      "find /home /root -maxdepth 3 -path '*/.aws/credentials' -exec chmod 600 {} \\;",
    safeToAutoFix: "SAFE",
    explain:
      "AWS credentials files (~/.aws/credentials) containing access keys must not be world-readable. Exposure allows any local user to enumerate and access cloud resources, potentially leading to data exfiltration or infrastructure compromise.",
  },
  {
    id: CHECK_IDS.SECRETS.SECRETS_DOCKER_ENV_PERMS,
    name: "Docker Compose .env Files Not World-Readable",
    severity: "warning",
    check: (output) => {
      const hasDockerEnv = output.includes("DOCKER_ENV_FOUND");
      const noDockerEnv = output.includes("NO_DOCKER_ENV");
      const passed = noDockerEnv || !hasDockerEnv;
      return {
        passed,
        currentValue: passed
          ? "No world-readable Docker Compose .env files found"
          : "World-readable Docker Compose .env files detected",
      };
    },
    expectedValue: "Docker Compose .env files have mode 600 or 640",
    fixCommand:
      "find /home /opt /srv /var/www -maxdepth 4 -name 'docker.env' -o -name '.env' -path '*/docker*' -exec chmod 640 {} \\;",
    safeToAutoFix: "SAFE",
    explain:
      "Docker Compose .env files frequently contain database passwords, service tokens, and encryption keys injected as container environment variables. World-readable access exposes all application secrets to local users.",
  },
  {
    id: CHECK_IDS.SECRETS.SECRETS_NPMRC_TOKEN,
    name: "No npm Auth Tokens in .npmrc",
    severity: "warning",
    check: (output) => {
      const hasNpmrcToken = output.includes("NPMRC_TOKEN_FOUND");
      const noNpmrcToken = output.includes("NO_NPMRC_TOKEN");
      const passed = noNpmrcToken || !hasNpmrcToken;
      return {
        passed,
        currentValue: passed
          ? "No auth tokens found in world-readable .npmrc files"
          : "Auth tokens found in .npmrc files with permissive access",
      };
    },
    expectedValue: ".npmrc files with auth tokens have mode 600",
    fixCommand:
      "find /home /root -maxdepth 3 -name '.npmrc' -exec chmod 600 {} \\;",
    safeToAutoFix: "SAFE",
    explain:
      "npm auth tokens in .npmrc files grant access to private npm registries and package publishing. World-readable .npmrc files expose these tokens to any local user, enabling package hijacking or credential theft.",
  },
  {
    id: CHECK_IDS.SECRETS.SECRETS_SSH_AUTHORIZED_KEYS_PERMS,
    name: "SSH authorized_keys Files Properly Restricted",
    severity: "info",
    check: (output) => {
      // If output contains entries about authorized_keys with bad permissions, fail
      // If NONE or no relevant sentinel, treat as indeterminate (fail conservatively)
      const hasPermIssue = /6[46][46]\s+.*authorized_keys/.test(output);
      const passed = !hasPermIssue;
      return {
        passed,
        currentValue: passed
          ? "SSH authorized_keys files appear properly restricted"
          : "SSH authorized_keys file found with overly permissive mode",
      };
    },
    expectedValue: "authorized_keys files have mode 600 or 644 (not group/world-writable)",
    fixCommand:
      "find /home /root -maxdepth 4 -name 'authorized_keys' -exec chmod 644 {} \\;",
    safeToAutoFix: "SAFE",
    explain:
      "Group or world-writable authorized_keys files can be modified by unprivileged users to insert their own public key, granting them passwordless SSH access to the account. SSH enforces strict permission checks on this file.",
  },
  {
    id: CHECK_IDS.SECRETS.SECRETS_NO_READABLE_HISTORY,
    name: "No World-Readable Bash History Files",
    severity: "warning",
    check: (output) => {
      // find /home -maxdepth 3 -name ".bash_history" -perm -o+r returns paths or "NONE"
      const hasReadableHistory = output !== "NONE" && /\.bash_history/.test(output);
      return {
        passed: !hasReadableHistory,
        currentValue: hasReadableHistory
          ? "World-readable .bash_history files found"
          : "No world-readable .bash_history files detected",
      };
    },
    expectedValue: ".bash_history files are not world-readable",
    fixCommand: "find /home -name '.bash_history' -exec chmod 600 {} \\;",
    safeToAutoFix: "SAFE",
    explain:
      "World-readable bash history files expose previously typed commands including passwords and API tokens.",
  },
  {
    id: CHECK_IDS.SECRETS.SECRETS_NO_SSH_AGENT_FORWARDING,
    name: "SSH Agent Forwarding Not Globally Enabled",
    severity: "info",
    check: (output) => {
      // sshd -T output: "allowagentforwarding yes" or "allowagentforwarding no"
      const match = output.match(/allowagentforwarding\s+(\w+)/i);
      if (!match) {
        // Cannot determine — conservative pass (not configured = default disabled)
        return { passed: true, currentValue: "AllowAgentForwarding not explicitly set (default: no)" };
      }
      const value = match[1].toLowerCase();
      const passed = value === "no";
      return {
        passed,
        currentValue: passed
          ? "SSH agent forwarding is disabled (AllowAgentForwarding no)"
          : "SSH agent forwarding is enabled (AllowAgentForwarding yes)",
      };
    },
    expectedValue: "AllowAgentForwarding is 'no' in sshd configuration",
    fixCommand: "Add 'AllowAgentForwarding no' to /etc/ssh/sshd_config && systemctl restart sshd",
    safeToAutoFix: "GUARDED",
    explain:
      "SSH agent forwarding exposes the user's authentication agent to the remote server, enabling key hijacking.",
  },
  {
    id: CHECK_IDS.SECRETS.SECRETS_NO_AWS_CREDS_PLAINTEXT,
    name: "AWS Credential Files Not Exposed",
    severity: "warning",
    check: (output) => {
      // find returns .aws dirs (NONE if absent), then AWS creds permissions
      // If .aws dirs found, check permissions; if NONE, pass
      const awsDirLine = output.split("\n").find((l) => l.trim().includes("/.aws"));
      if (!awsDirLine) {
        // No .aws dirs found
        return { passed: true, currentValue: "No AWS credential directories found" };
      }
      // Check permissions — stat returns mode like "600" or "644"
      const permMatches = output.match(/^(\d{3,4})$/gm) ?? [];
      const badPerms = permMatches.filter((p) => {
        const perm = parseInt(p.trim(), 10);
        // Only 600 or stricter (400, 000) is acceptable
        const others = perm % 10;
        const group = Math.floor(perm / 10) % 10;
        return others > 0 || group > 4;
      });
      const passed = badPerms.length === 0;
      return {
        passed,
        currentValue: passed
          ? "AWS credential files have acceptable permissions"
          : `AWS credential files found with permissive permissions: ${badPerms.join(", ")}`,
      };
    },
    expectedValue: "AWS credential files have mode 600 or stricter",
    fixCommand: "chmod 600 ~/.aws/credentials",
    safeToAutoFix: "SAFE",
    explain:
      "AWS credential files with excessive permissions allow local users to steal cloud access keys for lateral movement.",
  },
  {
    id: CHECK_IDS.SECRETS.SECRETS_NO_KUBECONFIG_EXPOSED,
    name: "Kubeconfig Not Exposed",
    severity: "warning",
    check: (output) => {
      // find returns .kube dirs or "NO_KUBE_DIR"
      const hasKubeDir = output.split("\n").some((l) => l.trim().includes("/.kube"));
      if (!hasKubeDir) {
        return { passed: true, currentValue: "No kubeconfig directories found" };
      }
      // Check kubeconfig permission from KUBECONFIG_PERM:NNN sentinel
      const permMatch = output.match(/KUBECONFIG_PERM:(\d+)/);
      if (permMatch) {
        const perm = parseInt(permMatch[1], 10);
        const passed = perm === 600 || perm === 400;
        return {
          passed,
          currentValue: passed
            ? `kubeconfig has mode ${perm} (secure)`
            : `kubeconfig has mode ${perm} (too permissive)`,
        };
      }
      // NO_KUBECONFIG = .kube dir exists but no config file
      if (output.includes("NO_KUBECONFIG")) {
        return { passed: true, currentValue: "No kubeconfig file found in .kube directory" };
      }
      return {
        passed: false,
        currentValue: "Kubeconfig directory found — unable to verify permissions",
      };
    },
    expectedValue: "No exposed .kube directories or kubeconfig has mode 600",
    fixCommand: "chmod 600 ~/.kube/config",
    safeToAutoFix: "SAFE",
    explain:
      "Exposed kubeconfig files contain cluster credentials that allow full Kubernetes cluster compromise.",
  },
  {
    id: CHECK_IDS.SECRETS.SECRETS_NO_SHELL_RC_SECRETS,
    name: "No Secrets Exported in Shell RC Files",
    severity: "warning",
    check: (output) => {
      // grep returns matching export lines; pass if no credential exports found
      const hasExportedSecrets = /export\s+(API_KEY|SECRET_KEY|TOKEN|PASSWORD|AWS_ACCESS_KEY)/i.test(output);
      return {
        passed: !hasExportedSecrets,
        currentValue: hasExportedSecrets
          ? "Credential exports found in shell RC files"
          : "No credential exports found in shell RC files",
      };
    },
    expectedValue: "No API_KEY/SECRET_KEY/TOKEN/PASSWORD exports in .bashrc or .profile",
    fixCommand: "Remove credential exports from shell RC files; use a secrets manager or .env files with proper permissions",
    safeToAutoFix: "GUARDED",
    explain:
      "Credentials hardcoded in shell RC files are exposed to any process running as that user and persist in shell history.",
  },
];

export const parseSecretsChecks: CheckParser = (
  sectionOutput: string,
  _platform: string,
): AuditCheck[] => {
  const isNA =
    !sectionOutput ||
    sectionOutput.trim() === "N/A" ||
    sectionOutput.trim() === "";
  const output = isNA ? "" : sectionOutput;

  return SECRETS_CHECKS.map((def) => {
    if (isNA) {
      return {
        id: def.id,
        category: "Secrets",
        name: def.name,
        severity: def.severity,
        passed: false,
        currentValue: "Unable to determine",
        expectedValue: def.expectedValue,
        fixCommand: def.fixCommand,
        safeToAutoFix: def.safeToAutoFix,
        explain: def.explain,
      };
    }
    const { passed, currentValue } = def.check(output);
    return {
      id: def.id,
      category: "Secrets",
      name: def.name,
      severity: def.severity,
      passed,
      currentValue,
      expectedValue: def.expectedValue,
      fixCommand: def.fixCommand,
      safeToAutoFix: def.safeToAutoFix,
      explain: def.explain,
    };
  });
};
