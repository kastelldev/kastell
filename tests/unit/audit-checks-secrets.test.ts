import { CHECK_IDS } from "../../src/core/audit/checkIds.js";
import { parseSecretsChecks } from "../../src/core/audit/checks/secrets.js";

describe("parseSecretsChecks", () => {
  const validOutput = [
    "NO_WORLD_READABLE_ENV",
    "NONE",
    "600 /home/alice/.ssh/id_rsa",
    "NONE",
    "NONE",
    "NO_ENV_IN_HOME",
    "NO_WORLD_READABLE_KEYS",
    "NO_PLAINTEXT_ETC_CRED",
    "NO_AWS_CREDS",
    "NO_DOCKER_ENV",
    "NO_NPMRC_TOKEN",
    "NONE",
    "allowagentforwarding no",
    // AWS creds dir check (SECRETS-NO-AWS-CREDS-PLAINTEXT) — no dir found
    "NO_AWS_DIR",
    // Kubeconfig check (SECRETS-NO-KUBECONFIG-EXPOSED) — no .kube dir found
    "NO_KUBE_DIR",
    // Shell RC secrets (SECRETS-NO-SHELL-RC-SECRETS) — none found
    "NONE",
  ].join("\n");

  const badOutput = [
    "WORLD_READABLE_ENV\n/home/alice/app/.env",
    "664 /home/alice/.ssh/id_rsa\n644 /home/bob/.ssh/id_ed25519",
    "/home/alice/.git/config\n/opt/app/.git/config",
    "/etc/mysql/my.cnf\n/etc/redis/redis.conf",
    "ENV_IN_HOME\n/home/alice/.env",
    "WORLD_READABLE_KEY\n/home/alice/.ssh/id_rsa",
    "PLAINTEXT_ETC_CRED\n/etc/mysql/my.cnf",
    "AWS_CREDS_FOUND\n/home/alice/.aws/credentials",
    "DOCKER_ENV_FOUND\n/home/alice/docker.env",
    "NPMRC_TOKEN_FOUND\n/home/alice/.npmrc",
  ].join("\n");

  describe("N/A handling", () => {
    it("returns checks with passed=false and currentValue='Unable to determine' for N/A input", () => {
      const checks = parseSecretsChecks("N/A", "bare");
      checks.forEach((c) => {
        expect(c.passed).toBe(false);
        expect(c.currentValue).toBe("Unable to determine");
      });
    });

    it("returns checks with passed=false for empty string input", () => {
      const checks = parseSecretsChecks("", "bare");
      checks.forEach((c) => {
        expect(c.passed).toBe(false);
      });
    });
  });

  describe("check count and shape", () => {
    it("returns at least 15 checks", () => {
      const checks = parseSecretsChecks(validOutput, "bare");
      expect(checks.length).toBeGreaterThanOrEqual(15);
    });

    it("all check IDs start with SECRETS-", () => {
      const checks = parseSecretsChecks("", "bare");
      checks.forEach((c) => expect(c.id).toMatch(/^SECRETS-/));
    });

    it("all checks have explain.length > 20", () => {
      const checks = parseSecretsChecks("", "bare");
      checks.forEach((c) => expect((c.explain ?? "").length).toBeGreaterThan(20));
    });

    it("all checks have fixCommand defined", () => {
      const checks = parseSecretsChecks("", "bare");
      checks.forEach((c) => expect(c.fixCommand).toBeDefined());
    });

    it("category is 'Secrets' on all checks", () => {
      const checks = parseSecretsChecks(validOutput, "bare");
      checks.forEach((c) => expect(c.category).toBe("Secrets"));
    });
  });

  describe("severity budget", () => {
    it("critical checks <= 40% of total", () => {
      const checks = parseSecretsChecks("", "bare");
      const criticalCount = checks.filter((c) => c.severity === "critical").length;
      expect(criticalCount / checks.length).toBeLessThanOrEqual(0.4);
    });
  });

  describe("SECRETS-ENV-WORLD-READABLE", () => {
    it("passes when WORLD_READABLE_ENV sentinel absent", () => {
      const checks = parseSecretsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "SECRETS-ENV-WORLD-READABLE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when WORLD_READABLE_ENV sentinel present", () => {
      const checks = parseSecretsChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "SECRETS-ENV-WORLD-READABLE");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("SECRETS-SSH-KEY-PERMS", () => {
    it("passes when SSH keys have 600 permissions", () => {
      const checks = parseSecretsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "SECRETS-SSH-KEY-PERMS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when SSH keys have overly permissive permissions (644)", () => {
      const checks = parseSecretsChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "SECRETS-SSH-KEY-PERMS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("SECRETS-GIT-CONFIG-TOKEN", () => {
    it("passes when no .git/config token paths found", () => {
      const checks = parseSecretsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "SECRETS-GIT-CONFIG-TOKEN");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when .git/config token paths found", () => {
      const checks = parseSecretsChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "SECRETS-GIT-CONFIG-TOKEN");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("SECRETS-ETC-PLAINTEXT-CRED", () => {
    it("passes when no plaintext credentials in /etc", () => {
      const checks = parseSecretsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "SECRETS-ETC-PLAINTEXT-CRED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when plaintext credentials found in /etc", () => {
      const checks = parseSecretsChecks(badOutput, "bare");
      const check = checks.find((c) => c.id === "SECRETS-ETC-PLAINTEXT-CRED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("SECRETS-NO-READABLE-HISTORY", () => {
    it("passes when no world-readable .bash_history files found", () => {
      const checks = parseSecretsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "SECRETS-NO-READABLE-HISTORY");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when world-readable .bash_history files found", () => {
      const output = validOutput + "\n/home/alice/.bash_history";
      const checks = parseSecretsChecks(output, "bare");
      const check = checks.find((c) => c.id === "SECRETS-NO-READABLE-HISTORY");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("SECRETS-NO-SSH-AGENT-FORWARDING", () => {
    it("passes when allowagentforwarding no", () => {
      const checks = parseSecretsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "SECRETS-NO-SSH-AGENT-FORWARDING");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when allowagentforwarding yes", () => {
      const output = validOutput.replace("allowagentforwarding no", "allowagentforwarding yes");
      const checks = parseSecretsChecks(output, "bare");
      const check = checks.find((c) => c.id === "SECRETS-NO-SSH-AGENT-FORWARDING");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
    });
  });

  describe("SECRETS-NO-AWS-CREDS-PLAINTEXT", () => {
    it("passes when NO_AWS_DIR (no .aws directory found)", () => {
      const checks = parseSecretsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "SECRETS-NO-AWS-CREDS-PLAINTEXT");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when .aws dir found with world-readable permissions", () => {
      // Format: path on one line, perms as standalone line
      const output = validOutput.replace("NO_AWS_DIR", "/root/.aws/credentials\n644");
      const checks = parseSecretsChecks(output, "bare");
      const check = checks.find((c) => c.id === "SECRETS-NO-AWS-CREDS-PLAINTEXT");
      expect(check!.passed).toBe(false);
    });
  });

  describe("SECRETS-NO-KUBECONFIG-EXPOSED", () => {
    it("passes when NO_KUBE_DIR (no .kube directory found)", () => {
      const checks = parseSecretsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "SECRETS-NO-KUBECONFIG-EXPOSED");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when .kube/config found", () => {
      const output = validOutput.replace("NO_KUBE_DIR", "/root/.kube/config\n/home/user/.kube/config");
      const checks = parseSecretsChecks(output, "bare");
      const check = checks.find((c) => c.id === "SECRETS-NO-KUBECONFIG-EXPOSED");
      expect(check!.passed).toBe(false);
    });
  });

  describe("SECRETS-NO-SHELL-RC-SECRETS", () => {
    it("passes when no secret exports found in RC files (NONE)", () => {
      const checks = parseSecretsChecks(validOutput, "bare");
      const check = checks.find((c) => c.id === "SECRETS-NO-SHELL-RC-SECRETS");
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it("fails when export API_KEY found in RC files", () => {
      const output = validOutput.replace(/NONE\s*$/, "export API_KEY=secret123");
      const checks = parseSecretsChecks(output, "bare");
      const check = checks.find((c) => c.id === "SECRETS-NO-SHELL-RC-SECRETS");
      expect(check!.passed).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// [MUTATION-KILLER] String literal assertions — kills StringLiteral mutants
// Every check's id, name, severity, safeToAutoFix, category, expectedValue,
// fixCommand, and explain are asserted to prevent "" replacement surviving.
// ═══════════════════════════════════════════════════════════════════════════════

describe("[MUTATION-KILLER] Secrets check metadata — string literal assertions", () => {
  const validOutput = [
    "NO_WORLD_READABLE_ENV",
    "NONE",
    "600 /home/alice/.ssh/id_rsa",
    "NONE",
    "NONE",
    "NO_ENV_IN_HOME",
    "NO_WORLD_READABLE_KEYS",
    "NO_PLAINTEXT_ETC_CRED",
    "NO_AWS_CREDS",
    "NO_DOCKER_ENV",
    "NO_NPMRC_TOKEN",
    "NONE",
    "allowagentforwarding no",
    "NO_AWS_DIR",
    "NO_KUBE_DIR",
    "NONE",
  ].join("\n");

  const checks = parseSecretsChecks(validOutput, "bare");
  const findSec = (id: string) => {
    const c = checks.find((ch) => ch.id === id);
    if (!c) throw new Error(`Check ${id} not found`);
    return c;
  };

  // ── All 16 checks: id, name, severity, safeToAutoFix, category ──

  it.each([
    ["SECRETS-ENV-WORLD-READABLE", "No World-Readable .env Files", "critical", "SAFE"],
    ["SECRETS-SSH-KEY-PERMS", "SSH Private Keys Not Overly Permissive", "critical", "SAFE"],
    ["SECRETS-GIT-CONFIG-TOKEN", "No Tokens in Git Config", "critical", "SAFE"],
    ["SECRETS-ETC-PLAINTEXT-CRED", "No Plaintext Credentials in /etc Configs", "warning", "GUARDED"],
    ["SECRETS-ENV-IN-HOME", "No Unprotected .env Files in Home Directories", "warning", "SAFE"],
    ["SECRETS-WORLD-READABLE-KEYS", "No World-Readable Private Key Files", "critical", "SAFE"],
    ["SECRETS-AWS-CREDS-PERMS", "AWS Credentials File Not Overly Permissive", "warning", "SAFE"],
    ["SECRETS-DOCKER-ENV-PERMS", "Docker Compose .env Files Not World-Readable", "warning", "SAFE"],
    ["SECRETS-NPMRC-TOKEN", "No npm Auth Tokens in .npmrc", "warning", "SAFE"],
    ["SECRETS-SSH-AUTHORIZED-KEYS-PERMS", "SSH authorized_keys Files Properly Restricted", "info", "SAFE"],
    ["SECRETS-NO-READABLE-HISTORY", "No World-Readable Bash History Files", "warning", "SAFE"],
    ["SECRETS-NO-SSH-AGENT-FORWARDING", "SSH Agent Forwarding Not Globally Enabled", "info", "GUARDED"],
    ["SECRETS-NO-AWS-CREDS-PLAINTEXT", "AWS Credential Files Not Exposed", "warning", "SAFE"],
    ["SECRETS-NO-KUBECONFIG-EXPOSED", "Kubeconfig Not Exposed", "warning", "SAFE"],
    ["SECRETS-NO-SHELL-RC-SECRETS", "No Secrets Exported in Shell RC Files", "warning", "GUARDED"],
  ])("[MUTATION-KILLER] %s has name=%s, severity=%s, safeToAutoFix=%s", (id, name, severity, safe) => {
    const c = findSec(id);
    expect(c.name).toBe(name);
    expect(c.severity).toBe(severity);
    expect(c.safeToAutoFix).toBe(safe);
    expect(c.category).toBe("Secrets");
  });

  // ── expectedValue assertions per check ──
  it.each([
    ["SECRETS-ENV-WORLD-READABLE", ".env files not world-readable (mode 600 or 640)"],
    ["SECRETS-SSH-KEY-PERMS", "SSH private keys have permissions 400 or 600"],
    ["SECRETS-GIT-CONFIG-TOKEN", "No credentials embedded in .git/config URL fields"],
    ["SECRETS-ETC-PLAINTEXT-CRED", "No plaintext password= or token= entries in /etc/*.conf"],
    ["SECRETS-ENV-IN-HOME", ".env files in home directories are not world-readable"],
    ["SECRETS-WORLD-READABLE-KEYS", "Private key files (.pem, id_*, etc.) not world-readable"],
    ["SECRETS-AWS-CREDS-PERMS", "~/.aws/credentials has mode 600 and is not world-readable"],
    ["SECRETS-DOCKER-ENV-PERMS", "Docker Compose .env files have mode 600 or 640"],
    ["SECRETS-NPMRC-TOKEN", ".npmrc files with auth tokens have mode 600"],
    ["SECRETS-SSH-AUTHORIZED-KEYS-PERMS", "authorized_keys files have mode 600 or 644 (not group/world-writable)"],
    ["SECRETS-NO-READABLE-HISTORY", ".bash_history files are not world-readable"],
    ["SECRETS-NO-SSH-AGENT-FORWARDING", "AllowAgentForwarding is 'no' in sshd configuration"],
    ["SECRETS-NO-AWS-CREDS-PLAINTEXT", "AWS credential files have mode 600 or stricter"],
    ["SECRETS-NO-KUBECONFIG-EXPOSED", "No exposed .kube directories or kubeconfig has mode 600"],
    ["SECRETS-NO-SHELL-RC-SECRETS", "No API_KEY/SECRET_KEY/TOKEN/PASSWORD exports in .bashrc or .profile"],
  ])("[MUTATION-KILLER] %s expectedValue = %s", (id, expected) => {
    expect(findSec(id).expectedValue).toBe(expected);
  });

  // ── fixCommand contains key substring ──
  it.each([
    ["SECRETS-ENV-WORLD-READABLE", "chmod 600"],
    ["SECRETS-SSH-KEY-PERMS", "chmod 600"],
    ["SECRETS-GIT-CONFIG-TOKEN", "credential"],
    ["SECRETS-ETC-PLAINTEXT-CRED", "chmod 640"],
    ["SECRETS-ENV-IN-HOME", "chmod 600"],
    ["SECRETS-WORLD-READABLE-KEYS", "chmod 600"],
    ["SECRETS-AWS-CREDS-PERMS", ".aws/credentials"],
    ["SECRETS-DOCKER-ENV-PERMS", "chmod 640"],
    ["SECRETS-NPMRC-TOKEN", ".npmrc"],
    ["SECRETS-SSH-AUTHORIZED-KEYS-PERMS", "authorized_keys"],
    ["SECRETS-NO-READABLE-HISTORY", ".bash_history"],
    ["SECRETS-NO-SSH-AGENT-FORWARDING", "AllowAgentForwarding"],
    ["SECRETS-NO-AWS-CREDS-PLAINTEXT", "chmod 600"],
    ["SECRETS-NO-KUBECONFIG-EXPOSED", "chmod 600"],
    ["SECRETS-NO-SHELL-RC-SECRETS", "secrets manager"],
  ])("[MUTATION-KILLER] %s fixCommand contains '%s'", (id, substring) => {
    const fc = findSec(id).fixCommand;
    expect(fc).toBeDefined();
    expect(fc!).toContain(substring);
  });

  // ── explain is non-empty and contains domain keyword ──
  it.each([
    ["SECRETS-ENV-WORLD-READABLE", "API keys"],
    ["SECRETS-SSH-KEY-PERMS", "impersonation"],
    ["SECRETS-GIT-CONFIG-TOKEN", "plaintext"],
    ["SECRETS-ETC-PLAINTEXT-CRED", "vault"],
    ["SECRETS-ENV-IN-HOME", "API keys"],
    ["SECRETS-WORLD-READABLE-KEYS", "exfiltration"],
    ["SECRETS-AWS-CREDS-PERMS", "cloud resources"],
    ["SECRETS-DOCKER-ENV-PERMS", "container environment"],
    ["SECRETS-NPMRC-TOKEN", "package hijacking"],
    ["SECRETS-SSH-AUTHORIZED-KEYS-PERMS", "passwordless SSH"],
    ["SECRETS-NO-READABLE-HISTORY", "passwords"],
    ["SECRETS-NO-SSH-AGENT-FORWARDING", "key hijacking"],
    ["SECRETS-NO-AWS-CREDS-PLAINTEXT", "lateral movement"],
    ["SECRETS-NO-KUBECONFIG-EXPOSED", "cluster"],
    ["SECRETS-NO-SHELL-RC-SECRETS", "shell history"],
  ])("[MUTATION-KILLER] %s explain contains '%s'", (id, keyword) => {
    const e = findSec(id).explain;
    expect(e).toBeDefined();
    expect(e!.length).toBeGreaterThan(20);
    expect(e!).toContain(keyword);
  });

  // ── N/A output: every check has consistent metadata ──
  describe("[MUTATION-KILLER] N/A output metadata consistency", () => {
    const naChecks = parseSecretsChecks("N/A", "bare");

    it("[MUTATION-KILLER] N/A output all checks have category=Secrets", () => {
      naChecks.forEach((c) => expect(c.category).toBe("Secrets"));
    });

    it("[MUTATION-KILLER] N/A output all checks have currentValue=Unable to determine", () => {
      naChecks.forEach((c) => expect(c.currentValue).toBe("Unable to determine"));
    });

    it("[MUTATION-KILLER] N/A output preserves same expectedValue as normal output", () => {
      naChecks.forEach((naC) => {
        const normalC = findSec(naC.id);
        expect(naC.expectedValue).toBe(normalC.expectedValue);
      });
    });

    it("[MUTATION-KILLER] N/A output preserves same explain as normal output", () => {
      naChecks.forEach((naC) => {
        const normalC = findSec(naC.id);
        expect(naC.explain).toBe(normalC.explain);
      });
    });

    it("[MUTATION-KILLER] N/A output preserves same fixCommand as normal output", () => {
      naChecks.forEach((naC) => {
        const normalC = findSec(naC.id);
        expect(naC.fixCommand).toBe(normalC.fixCommand);
      });
    });

    it("[MUTATION-KILLER] N/A output preserves same name as normal output", () => {
      naChecks.forEach((naC) => {
        const normalC = findSec(naC.id);
        expect(naC.name).toBe(normalC.name);
      });
    });

    it("[MUTATION-KILLER] N/A output preserves same severity as normal output", () => {
      naChecks.forEach((naC) => {
        const normalC = findSec(naC.id);
        expect(naC.severity).toBe(normalC.severity);
      });
    });
  });

  // ── Passing currentValue exact strings ──
  describe("[MUTATION-KILLER] passing currentValue strings", () => {
    it.each([
      ["SECRETS-ENV-WORLD-READABLE", "No world-readable .env files found"],
      ["SECRETS-SSH-KEY-PERMS", "All SSH private keys have correct permissions (400 or 600)"],
      ["SECRETS-GIT-CONFIG-TOKEN", "No credential-embedded URLs found in .git/config files"],
      ["SECRETS-ETC-PLAINTEXT-CRED", "No plaintext credentials detected in /etc config files"],
      ["SECRETS-ENV-IN-HOME", "No unprotected .env files found in home directories"],
      ["SECRETS-WORLD-READABLE-KEYS", "No world-readable private key files found"],
      ["SECRETS-AWS-CREDS-PERMS", "No overly permissive AWS credential files found"],
      ["SECRETS-DOCKER-ENV-PERMS", "No world-readable Docker Compose .env files found"],
      ["SECRETS-NPMRC-TOKEN", "No auth tokens found in world-readable .npmrc files"],
      ["SECRETS-SSH-AUTHORIZED-KEYS-PERMS", "SSH authorized_keys files appear properly restricted"],
      ["SECRETS-NO-READABLE-HISTORY", "No world-readable .bash_history files detected"],
      ["SECRETS-NO-SSH-AGENT-FORWARDING", "SSH agent forwarding is disabled (AllowAgentForwarding no)"],
      ["SECRETS-NO-AWS-CREDS-PLAINTEXT", "No AWS credential directories found"],
      ["SECRETS-NO-KUBECONFIG-EXPOSED", "No kubeconfig directories found"],
      ["SECRETS-NO-SHELL-RC-SECRETS", "No credential exports found in shell RC files"],
    ])("[MUTATION-KILLER] %s passing currentValue = %s", (id, expected) => {
      expect(findSec(id).currentValue).toBe(expected);
    });
  });

  // ── Failing currentValue exact strings ──
  describe("[MUTATION-KILLER] failing currentValue strings", () => {
    const badOutput = [
      "WORLD_READABLE_ENV",
      "664 /home/alice/.ssh/id_rsa",
      "/home/alice/.git/config",
      "PLAINTEXT_ETC_CRED",
      "ENV_IN_HOME",
      "WORLD_READABLE_KEY",
      "AWS_CREDS_FOUND",
      "DOCKER_ENV_FOUND",
      "NPMRC_TOKEN_FOUND",
      "646 /root/.ssh/authorized_keys",
      "/home/alice/.bash_history",
      "allowagentforwarding yes",
      "/root/.aws/credentials\n644",
      "/root/.kube\nKUBECONFIG_PERM:777",
      "export API_KEY=abc123",
    ].join("\n");
    const badChecks = parseSecretsChecks(badOutput, "bare");
    const findBad = (id: string) => badChecks.find((c) => c.id === id)!;

    it.each([
      ["SECRETS-ENV-WORLD-READABLE", "World-readable .env files found"],
      ["SECRETS-SSH-KEY-PERMS", "Overly permissive SSH private keys"],
      ["SECRETS-GIT-CONFIG-TOKEN", "Git config files with embedded credentials found"],
      ["SECRETS-ETC-PLAINTEXT-CRED", "Plaintext password/token patterns found in /etc config files"],
      ["SECRETS-ENV-IN-HOME", ".env files found in home directories with permissive access"],
      ["SECRETS-WORLD-READABLE-KEYS", "World-readable private key files detected"],
      ["SECRETS-AWS-CREDS-PERMS", "AWS credentials file found with permissive access mode"],
      ["SECRETS-DOCKER-ENV-PERMS", "World-readable Docker Compose .env files detected"],
      ["SECRETS-NPMRC-TOKEN", "Auth tokens found in .npmrc files with permissive access"],
      ["SECRETS-NO-READABLE-HISTORY", "World-readable .bash_history files found"],
      ["SECRETS-NO-SSH-AGENT-FORWARDING", "SSH agent forwarding is enabled (AllowAgentForwarding yes)"],
      ["SECRETS-NO-KUBECONFIG-EXPOSED", "kubeconfig has mode 777 (too permissive)"],
      ["SECRETS-NO-SHELL-RC-SECRETS", "Credential exports found in shell RC files"],
    ])("[MUTATION-KILLER] %s failing currentValue contains '%s'", (id, substring) => {
      expect(findBad(id).currentValue).toContain(substring);
    });
  });
});
