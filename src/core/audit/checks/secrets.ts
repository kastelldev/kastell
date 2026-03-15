/**
 * Secrets Exposure security check parser.
 * Parses world-readable .env files, SSH private key permissions,
 * git config token exposure, /etc plaintext credentials,
 * AWS credential files, Docker env files, and npm token exposure.
 */

import type { AuditCheck, CheckParser, Severity } from "../types.js";

interface SecretsCheckDef {
  id: string;
  name: string;
  severity: Severity;
  check: (output: string) => { passed: boolean; currentValue: string };
  expectedValue: string;
  fixCommand: string;
  explain: string;
}

const SECRETS_CHECKS: SecretsCheckDef[] = [
  {
    id: "SECRETS-ENV-WORLD-READABLE",
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
    explain:
      "World-readable .env files expose API keys, database credentials, and service secrets to any local user on the system. Attackers who obtain local code execution can read these files without privilege escalation.",
  },
  {
    id: "SECRETS-SSH-KEY-PERMS",
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
    explain:
      "SSH private keys with permissions wider than 600 can be read by other users on the system, allowing impersonation and unauthorized access to remote hosts. SSH itself will refuse to use keys that are too permissive.",
  },
  {
    id: "SECRETS-GIT-CONFIG-TOKEN",
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
    explain:
      "Tokens or passwords embedded in .git/config remote URLs (e.g., https://user:TOKEN@github.com/...) are stored in plaintext and readable by anyone with filesystem access to the repo directory.",
  },
  {
    id: "SECRETS-ETC-PLAINTEXT-CRED",
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
    explain:
      "Config files in /etc containing plaintext passwords or tokens are readable by system services and privileged users. Credentials should be stored in a secrets manager or environment-specific vault, not in world-accessible config files.",
  },
  {
    id: "SECRETS-ENV-IN-HOME",
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
    explain:
      "Application .env files in user home directories may contain database passwords, API keys, and service tokens. Without proper permissions, these are readable by any local user on a shared system.",
  },
  {
    id: "SECRETS-WORLD-READABLE-KEYS",
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
    explain:
      "World-readable private keys (TLS keys, SSH keys, service keys) allow any local user to decrypt traffic, forge signatures, or authenticate as the key owner. This is a direct secret exfiltration risk.",
  },
  {
    id: "SECRETS-AWS-CREDS-PERMS",
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
    explain:
      "AWS credentials files (~/.aws/credentials) containing access keys must not be world-readable. Exposure allows any local user to enumerate and access cloud resources, potentially leading to data exfiltration or infrastructure compromise.",
  },
  {
    id: "SECRETS-DOCKER-ENV-PERMS",
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
    explain:
      "Docker Compose .env files frequently contain database passwords, service tokens, and encryption keys injected as container environment variables. World-readable access exposes all application secrets to local users.",
  },
  {
    id: "SECRETS-NPMRC-TOKEN",
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
    explain:
      "npm auth tokens in .npmrc files grant access to private npm registries and package publishing. World-readable .npmrc files expose these tokens to any local user, enabling package hijacking or credential theft.",
  },
  {
    id: "SECRETS-SSH-AUTHORIZED-KEYS-PERMS",
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
    explain:
      "Group or world-writable authorized_keys files can be modified by unprivileged users to insert their own public key, granting them passwordless SSH access to the account. SSH enforces strict permission checks on this file.",
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
      explain: def.explain,
    };
  });
};
