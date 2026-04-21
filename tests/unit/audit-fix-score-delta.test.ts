import * as fix from "../../src/core/audit/fix.js";
import * as ssh from "../../src/utils/ssh.js";
import * as commands from "../../src/core/audit/commands.js";
import * as checksIndex from "../../src/core/audit/checks/index.js";
import type { AuditResult, AuditCategory, AuditCheck } from "../../src/core/audit/types.js";

jest.mock("../../src/utils/ssh.js");
jest.mock("../../src/core/audit/commands.js");
jest.mock("../../src/core/audit/checks/index.js");
jest.mock("inquirer");
jest.mock("../../src/utils/sshCommand.js");

const mockedSshExec = ssh.sshExec as jest.MockedFunction<typeof ssh.sshExec>;
const mockedBuildBatches = commands.buildAuditBatchCommands as jest.MockedFunction<typeof commands.buildAuditBatchCommands>;
const mockedParseAllChecks = checksIndex.parseAllChecks as jest.MockedFunction<typeof checksIndex.parseAllChecks>;

function makeCheck(overrides: Partial<AuditCheck> = {}): AuditCheck {
  return {
    id: "SSH-01",
    category: "SSH",
    name: "Test check",
    severity: "critical",
    passed: false,
    currentValue: "bad",
    expectedValue: "good",
    ...overrides,
  };
}

function makeCategory(name: string, checks: AuditCheck[], score = 50): AuditCategory {
  return { name, checks, score, maxScore: 100 };
}

function makeResult(categories: AuditCategory[], overallScore = 53): AuditResult {
  return {
    serverName: "test-server",
    serverIp: "1.2.3.4",
    platform: "bare",
    timestamp: "2026-01-01T00:00:00.000Z",
    auditVersion: "1.0.0",
    categories,
    overallScore,
    quickWins: [],
  };
}

describe("runPostFixReAudit", () => {
  beforeEach(() => {
    jest.resetAllMocks();

    mockedBuildBatches.mockReturnValue([
      { tier: "fast", command: "echo fast" },
      { tier: "medium", command: "echo medium" },
      { tier: "slow", command: "echo slow" },
    ]);

    mockedSshExec.mockResolvedValue({ stdout: "output", stderr: "", code: 0 });
  });

  it("returns full AuditResult with merged categories instead of just score", async () => {
    const originalResult = makeResult([
      makeCategory("SSH", [makeCheck({ id: "SSH-01", severity: "critical", passed: false })], 0),
    ], 0);

    mockedParseAllChecks.mockReturnValue([
      makeCategory("SSH", [makeCheck({ id: "SSH-01", severity: "critical", passed: true })], 100),
    ]);

    const result = await fix.runPostFixReAudit("1.2.3.4", "bare", originalResult, ["SSH"]);

    expect(result).not.toBeNull();
    expect(result).toHaveProperty("serverIp", "1.2.3.4");
    expect(result).toHaveProperty("categories");
    expect(result).toHaveProperty("overallScore");
    expect(typeof result!.overallScore).toBe("number");
    expect(result!.timestamp).toBeDefined();
  });

  it("returns null when affectedCategories is empty", async () => {
    const originalResult = makeResult([
      makeCategory("SSH", [makeCheck()], 50),
    ]);

    const result = await fix.runPostFixReAudit("1.2.3.4", "bare", originalResult, []);

    expect(result).toBeNull();
    expect(mockedSshExec).not.toHaveBeenCalled();
  });

  it("returns null on SSH failure", async () => {
    const originalResult = makeResult([
      makeCategory("SSH", [makeCheck()], 50),
    ]);

    mockedSshExec.mockRejectedValue(new Error("Connection refused"));

    const result = await fix.runPostFixReAudit("1.2.3.4", "bare", originalResult, ["SSH"]);

    expect(result).toBeNull();
  });

  it("replaces only affected categories, keeps others unchanged", async () => {
    const sshCategory = makeCategory("SSH", [makeCheck({ id: "SSH-01", severity: "critical", passed: false })], 0);
    const firewallCategory = makeCategory("Firewall", [makeCheck({ id: "FW-01", category: "Firewall", severity: "critical", passed: true })], 100);

    const originalResult = makeResult([sshCategory, firewallCategory], 50);

    mockedParseAllChecks.mockReturnValue([
      makeCategory("SSH", [makeCheck({ id: "SSH-01", severity: "critical", passed: true })], 100),
      makeCategory("Firewall", [makeCheck({ id: "FW-01", category: "Firewall", severity: "critical", passed: false })], 0),
    ]);

    const result = await fix.runPostFixReAudit("1.2.3.4", "bare", originalResult, ["SSH"]);

    expect(result).not.toBeNull();
    expect(result!.overallScore).toBeGreaterThan(50);

    const sshCat = result!.categories.find(c => c.name === "SSH");
    expect(sshCat!.score).toBe(100);

    const fwCat = result!.categories.find(c => c.name === "Firewall");
    expect(fwCat!.score).toBe(100);
  });

  it("calls buildAuditBatchCommands with correct platform", async () => {
    const originalResult = makeResult([
      makeCategory("SSH", [makeCheck()], 50),
    ]);

    mockedParseAllChecks.mockReturnValue([
      makeCategory("SSH", [makeCheck({ passed: true })], 100),
    ]);

    await fix.runPostFixReAudit("1.2.3.4", "coolify", originalResult, ["SSH"]);

    expect(mockedBuildBatches).toHaveBeenCalledWith("coolify");
  });

  it("runs all 3 SSH batches for score re-check", async () => {
    const originalResult = makeResult([
      makeCategory("SSH", [makeCheck()], 50),
    ]);

    mockedParseAllChecks.mockReturnValue([
      makeCategory("SSH", [makeCheck({ passed: true })], 100),
    ]);

    await fix.runPostFixReAudit("1.2.3.4", "bare", originalResult, ["SSH"]);

    expect(mockedSshExec).toHaveBeenCalledTimes(3);
  });
});
