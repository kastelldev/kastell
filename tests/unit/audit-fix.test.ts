import { previewFixes, runFix } from "../../src/core/audit/fix.js";
import type { AuditResult, AuditCheck, AuditCategory } from "../../src/core/audit/types.js";
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
    categories,
    overallScore,
    quickWins: [],
  };
}

describe("previewFixes", () => {
  it("should return grouped fixes by severity (critical first)", () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({ id: "SSH-PASSWORD-AUTH", category: "SSH", severity: "critical", passed: false, fixCommand: "fix-critical" }),
        makeCheck({ id: "SSH-ROOT-LOGIN", category: "SSH", severity: "info", passed: false, fixCommand: "fix-info" }),
        makeCheck({ id: "SSH-EMPTY-PASSWORDS", category: "SSH", severity: "warning", passed: false, fixCommand: "fix-warning" }),
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
        makeCheck({ id: "SSH-PASSWORD-AUTH", severity: "critical", passed: false, fixCommand: "fix-it" }),
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
        makeCheck({ id: "SSH-PASSWORD-AUTH", category: "SSH", severity: "critical", passed: false, fixCommand: "fix-1" }),
        makeCheck({ id: "SSH-ROOT-LOGIN", category: "SSH", severity: "critical", passed: false, fixCommand: "fix-2" }),
      ]),
      makeCategory("Firewall", [
        makeCheck({ id: "FW-UFW-ACTIVE", category: "Firewall", severity: "critical", passed: false, fixCommand: "fix-3" }),
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
        makeCheck({ id: "SSH-PASSWORD-AUTH", category: "SSH", severity: "critical", passed: false, fixCommand: "fix-it" }),
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
        makeCheck({ id: "SSH-PASSWORD-AUTH", category: "SSH", severity: "critical", passed: false, fixCommand: "fix-ssh" }),
      ]),
    ]);

    mockedPrompt.mockResolvedValueOnce({ confirm: true });
    mockedSshExec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    const fixResult = await runFix("1.2.3.4", result, { dryRun: false });
    expect(mockedSshExec).toHaveBeenCalledWith("1.2.3.4", expect.stringContaining("fix-ssh"));
    expect(fixResult.applied).toContain("SSH-PASSWORD-AUTH");
  });

  it("should skip checks the user declined", async () => {
    const result = makeResult([
      makeCategory("SSH", [
        makeCheck({ id: "SSH-PASSWORD-AUTH", category: "SSH", severity: "critical", passed: false, fixCommand: "fix-ssh" }),
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
        makeCheck({ id: "SSH-PASSWORD-AUTH", category: "SSH", severity: "critical", passed: false, fixCommand: "fix-ssh" }),
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
        makeCheck({ id: "SSH-PASSWORD-AUTH", category: "SSH", severity: "critical", passed: false, fixCommand: "fix-ssh" }),
      ]),
    ]);

    mockedPrompt.mockResolvedValueOnce({ confirm: true });
    mockedSshExec.mockRejectedValue(new Error("Connection refused"));

    const fixResult = await runFix("1.2.3.4", result, { dryRun: false });
    expect(fixResult.errors).toHaveLength(1);
    expect(fixResult.errors[0]).toContain("SSH-PASSWORD-AUTH");
  });
});
