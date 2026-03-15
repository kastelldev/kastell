import * as config from "../../src/utils/config";
import * as auditRunner from "../../src/core/audit/index";
import { handleServerAudit } from "../../src/mcp/tools/serverAudit";
import type { AuditResult } from "../../src/core/audit/types";

jest.mock("../../src/utils/config");
jest.mock("../../src/core/audit/index");

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedAuditRunner = auditRunner as jest.Mocked<typeof auditRunner>;

const sampleServer = {
  id: "123",
  name: "coolify-test",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-02-20T00:00:00Z",
};

const sampleAuditResult: AuditResult = {
  serverName: "coolify-test",
  serverIp: "1.2.3.4",
  platform: "bare",
  timestamp: "2026-03-08T00:00:00Z",
  categories: [
    {
      name: "SSH",
      checks: [
        {
          id: "SSH-PASSWORD-AUTH",
          category: "SSH",
          name: "Password Authentication",
          severity: "critical",
          passed: true,
          currentValue: "no",
          expectedValue: "no",
        },
      ],
      score: 100,
      maxScore: 100,
    },
    {
      name: "Firewall",
      checks: [
        {
          id: "FW-UFW-ACTIVE",
          category: "Firewall",
          name: "UFW Active",
          severity: "critical",
          passed: false,
          currentValue: "inactive",
          expectedValue: "active",
          fixCommand: "ufw --force enable",
        },
      ],
      score: 0,
      maxScore: 100,
    },
  ],
  overallScore: 72,
  quickWins: [
    {
      commands: ["ufw --force enable"],
      currentScore: 72,
      projectedScore: 85,
      description: "Fix UFW Active (Firewall)",
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("MCP server_audit tool", () => {
  it("should call runAudit with resolved server IP", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedConfig.findServer.mockReturnValue(sampleServer as never);
    mockedAuditRunner.runAudit.mockResolvedValue({
      success: true,
      data: sampleAuditResult,
    });

    const result = await handleServerAudit({ server: "coolify-test", format: "summary" });

    expect(mockedAuditRunner.runAudit).toHaveBeenCalledWith(
      "1.2.3.4",
      "coolify-test",
      expect.any(String),
    );
    expect(result.isError).toBeUndefined();
  });

  it("should return mcpSuccess with formatted audit summary (not full HTML)", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedConfig.findServer.mockReturnValue(sampleServer as never);
    mockedAuditRunner.runAudit.mockResolvedValue({
      success: true,
      data: sampleAuditResult,
    });

    const result = await handleServerAudit({ server: "coolify-test", format: "summary" });

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    const text = result.content[0].text;
    // Summary should contain score and category info, not HTML tags
    expect(text).not.toContain("<html");
    expect(text).toContain("72");
    expect(text).toContain("SSH");
  });

  it("should return mcpError for invalid server", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedConfig.findServer.mockReturnValue(undefined as never);

    const result = await handleServerAudit({ server: "nonexistent", format: "summary" });

    expect(result.isError).toBe(true);
  });

  it("should accept optional server and format parameters", async () => {
    // When only one server exists and no server param, auto-resolve
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedAuditRunner.runAudit.mockResolvedValue({
      success: true,
      data: sampleAuditResult,
    });

    const result = await handleServerAudit({ format: "summary" });
    expect(result.isError).toBeUndefined();
  });

  it('should return full AuditResult as JSON for format "json"', async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedConfig.findServer.mockReturnValue(sampleServer as never);
    mockedAuditRunner.runAudit.mockResolvedValue({
      success: true,
      data: sampleAuditResult,
    });

    const result = await handleServerAudit({ server: "coolify-test", format: "json" });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.overallScore).toBe(72);
    expect(parsed.categories).toHaveLength(2);
    expect(parsed.serverName).toBe("coolify-test");
  });

  it('should return just the score number for format "score"', async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedConfig.findServer.mockReturnValue(sampleServer as never);
    mockedAuditRunner.runAudit.mockResolvedValue({
      success: true,
      data: sampleAuditResult,
    });

    const result = await handleServerAudit({ server: "coolify-test", format: "score" });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.score).toBe(72);
  });

  it("should return mcpError when runAudit fails", async () => {
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedConfig.findServer.mockReturnValue(sampleServer as never);
    mockedAuditRunner.runAudit.mockResolvedValue({
      success: false,
      error: "SSH connection failed",
      hint: "Check SSH keys",
    });

    const result = await handleServerAudit({ server: "coolify-test", format: "summary" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("SSH connection failed");
  });
});
