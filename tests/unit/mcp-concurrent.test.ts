import * as config from "../../src/utils/config";
import * as fleetCore from "../../src/core/fleet";
import * as auditRunner from "../../src/core/audit/index";
import * as doctorCore from "../../src/core/doctor";
import * as guardCore from "../../src/core/guard";
import { handleServerFleet } from "../../src/mcp/tools/serverFleet";
import { handleServerAudit } from "../../src/mcp/tools/serverAudit";
import { handleServerDoctor } from "../../src/mcp/tools/serverDoctor";
import { handleServerGuard } from "../../src/mcp/tools/serverGuard";
import type { FleetRow } from "../../src/core/fleet";
import type { AuditResult } from "../../src/core/audit/types";
import type { DoctorResult } from "../../src/core/doctor";

jest.mock("../../src/utils/config");
jest.mock("../../src/core/fleet");
jest.mock("../../src/core/audit/index");
jest.mock("../../src/core/doctor");
jest.mock("../../src/core/guard");

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedFleet = fleetCore as jest.Mocked<typeof fleetCore>;
const mockedAuditRunner = auditRunner as jest.Mocked<typeof auditRunner>;
const mockedDoctor = doctorCore as jest.Mocked<typeof doctorCore>;
const mockedGuard = guardCore as jest.Mocked<typeof guardCore>;

const sampleServer = {
  id: "123",
  name: "my-server",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-02-20T00:00:00Z",
};

const sampleFleetRows: FleetRow[] = [
  {
    name: "my-server",
    ip: "1.2.3.4",
    provider: "hetzner",
    status: "ONLINE",
    auditScore: 85,
    responseTime: 40,
    errorReason: null,
  },
];

const sampleAuditResult: AuditResult = {
  serverName: "my-server",
  serverIp: "1.2.3.4",
  platform: "bare",
  timestamp: "2026-03-08T00:00:00Z",
  auditVersion: "1.0.0",
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
  ],
  overallScore: 85,
  quickWins: [],
};

const sampleDoctorResult: DoctorResult = {
  serverName: "my-server",
  serverIp: "1.2.3.4",
  findings: [],
  ranAt: "2026-03-08T00:00:00Z",
  usedFreshData: false,
};

describe("concurrent MCP tool invocations", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("two different tools called concurrently return independent results", async () => {
    // Arrange
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedConfig.findServer.mockReturnValue(sampleServer as never);
    mockedFleet.runFleet.mockResolvedValue(sampleFleetRows);
    mockedAuditRunner.runAudit.mockResolvedValue({
      success: true,
      data: sampleAuditResult,
    });

    // Act
    const [fleetResult, auditResult] = await Promise.all([
      handleServerFleet({ sort: "name" }),
      handleServerAudit({ server: "my-server", format: "score" }),
    ]);

    // Assert
    expect(fleetResult.isError).toBeUndefined();
    expect(auditResult.isError).toBeUndefined();
    const fleetParsed = JSON.parse(fleetResult.content[0].text);
    expect(fleetParsed.servers).toBeDefined();
    const auditParsed = JSON.parse(auditResult.content[0].text);
    expect(auditParsed).toBeTruthy();
  });

  it("same tool called concurrently twice returns both results", async () => {
    // Arrange
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedFleet.runFleet.mockResolvedValue(sampleFleetRows);

    // Act
    const [r1, r2] = await Promise.all([
      handleServerFleet({ sort: "name" }),
      handleServerFleet({ sort: "score" }),
    ]);

    // Assert
    expect(r1.isError).toBeUndefined();
    expect(r2.isError).toBeUndefined();
  });

  it("concurrent calls — one succeeds, one errors — return independent structured responses", async () => {
    // Arrange: fleet gets servers, audit sees no servers
    mockedConfig.getServers
      .mockReturnValueOnce([sampleServer] as never)
      .mockReturnValueOnce([] as never);
    mockedFleet.runFleet.mockResolvedValue(sampleFleetRows);

    // Act
    const [fleetResult, auditResult] = await Promise.all([
      handleServerFleet({ sort: "name" }),
      handleServerAudit({ format: "summary" }),
    ]);

    // Assert
    expect(fleetResult.isError).toBeUndefined();
    expect(auditResult.isError).toBe(true);
    const auditParsed = JSON.parse(auditResult.content[0].text);
    expect(auditParsed.error).toBeTruthy();
  });

  it("three tools called concurrently all return structured responses", async () => {
    // Arrange
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedConfig.findServer.mockReturnValue(sampleServer as never);
    mockedFleet.runFleet.mockResolvedValue(sampleFleetRows);
    mockedAuditRunner.runAudit.mockResolvedValue({
      success: true,
      data: sampleAuditResult,
    });
    mockedDoctor.runServerDoctor.mockResolvedValue({
      success: true,
      data: sampleDoctorResult,
    });

    // Act
    const results = await Promise.all([
      handleServerFleet({ sort: "name" }),
      handleServerAudit({ server: "my-server", format: "score" }),
      handleServerDoctor({ server: "my-server", format: "json" }),
    ]);

    // Assert: all three return valid McpResponse with content
    for (const result of results) {
      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toBeTruthy();
    }
  });
});

describe("timeout and partial response edge cases", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.KASTELL_SAFE_MODE = "false";
  });

  it("returns mcpError when core function rejects with timeout error", async () => {
    // Arrange
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedConfig.findServer.mockReturnValue(sampleServer as never);
    mockedGuard.startGuard.mockRejectedValue(
      new Error("SSH operation timed out after 30000ms"),
    );

    // Act
    const result = await handleServerGuard({ server: "my-server", action: "start" });

    // Assert
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("timed out");
  });

  it("concurrent calls where one times out still allows other to succeed", async () => {
    // Arrange
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedConfig.findServer.mockReturnValue(sampleServer as never);
    mockedFleet.runFleet.mockResolvedValue(sampleFleetRows);
    mockedAuditRunner.runAudit.mockRejectedValue(
      new Error("SSH operation timed out after 30000ms"),
    );

    // Act
    const [fleetResult, auditResult] = await Promise.all([
      handleServerFleet({ sort: "name" }),
      handleServerAudit({ server: "my-server", format: "summary" }),
    ]);

    // Assert
    expect(fleetResult.isError).toBeUndefined();
    expect(auditResult.isError).toBe(true);
    const auditParsed = JSON.parse(auditResult.content[0].text);
    expect(auditParsed.error).toContain("timed out");
  });

  it("handles core function returning success:false as non-error MCP response", async () => {
    // Arrange: startGuard resolves (does not throw) with success:false
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedConfig.findServer.mockReturnValue(sampleServer as never);
    mockedGuard.startGuard.mockResolvedValue({
      success: false,
      error: "Guard already running",
    });

    // Act
    const result = await handleServerGuard({ server: "my-server", action: "start" });

    // Assert: non-throwing failure → mcpError (handler checks result.success)
    // isError may be true (from mcpError) but NOT an uncaught exception
    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).toBeTruthy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toBeTruthy();
    // The error info is captured in the response, no exception leaked
    expect(typeof parsed).toBe("object");
  });
});
