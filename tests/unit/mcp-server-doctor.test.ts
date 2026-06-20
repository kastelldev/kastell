import * as config from "../../src/utils/config";
import * as doctorCore from "../../src/core/doctor";
import * as doctorFix from "../../src/core/doctor-fix";
import * as manage from "../../src/core/manage";
import { handleServerDoctor } from "../../src/mcp/tools/serverDoctor";
import type { DoctorResult } from "../../src/core/doctor";

jest.mock("../../src/utils/config");
jest.mock("../../src/core/doctor");
jest.mock("../../src/core/doctor-fix");
jest.mock("../../src/core/manage");

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedDoctor = doctorCore as jest.Mocked<typeof doctorCore>;
const mockedDoctorFix = doctorFix as jest.Mocked<typeof doctorFix>;
const mockedManage = manage as jest.Mocked<typeof manage>;

const sampleServer = {
  id: "123",
  name: "my-server",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-02-20T00:00:00Z",
};

const sampleDoctorResult: DoctorResult = {
  serverName: "my-server",
  serverIp: "1.2.3.4",
  findings: [
    {
      id: "DISK_TREND",
      severity: "critical",
      description: "Disk projected to reach 95% full in ~2 days",
      command: "df -h / && kastell audit my-server",
      weight: 10,
    },
    {
      id: "HIGH_SWAP",
      severity: "warning",
      description: "Swap usage is at 75%",
      command: "free -h",
      weight: 5,
    },
    {
      id: "STALE_PACKAGES",
      severity: "info",
      description: "15 packages available for upgrade",
      command: "sudo apt update && sudo apt upgrade",
      weight: 1,
    },
  ],
  ranAt: "2026-03-14T11:00:00Z",
  usedFreshData: false,
  score: 77,
};

const sampleDoctorResultWithFixable: DoctorResult = {
  serverName: "my-server",
  serverIp: "1.2.3.4",
  findings: [
    {
      id: "STALE_PACKAGES",
      severity: "info",
      description: "15 packages available for upgrade",
      command: "sudo apt update && sudo apt upgrade",
      fixCommand: "DEBIAN_FRONTEND=noninteractive sudo apt update && sudo apt upgrade -y",
      weight: 1,
    },
    {
      id: "DISK_TREND",
      severity: "critical",
      description: "Disk projected to reach 95% full in ~2 days",
      command: "df -h / && kastell audit my-server",
      weight: 10,
    },
  ],
  ranAt: "2026-03-14T11:00:00Z",
  usedFreshData: true,
  score: 86,
};

beforeEach(() => {
  jest.resetAllMocks();
});

describe("MCP server_doctor tool", () => {
  describe("summary format (default)", () => {
    it("calls runServerDoctor with fresh=false by default, returns mcpSuccess with findings", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedConfig.findServer.mockReturnValue(sampleServer as never);
      mockedDoctor.runServerDoctor.mockResolvedValue({
        success: true,
        data: sampleDoctorResult,
      });

      const result = await handleServerDoctor({ server: "my-server" });

      expect(mockedDoctor.runServerDoctor).toHaveBeenCalledWith("1.2.3.4", "my-server", {
        fresh: false,
      }, sampleServer);
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.critical).toBe(1);
      expect(parsed.warning).toBe(1);
      expect(parsed.info).toBe(1);
    });

    it("calls runServerDoctor with fresh=true when fresh param is true", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedConfig.findServer.mockReturnValue(sampleServer as never);
      mockedDoctor.runServerDoctor.mockResolvedValue({
        success: true,
        data: { ...sampleDoctorResult, usedFreshData: true },
      });

      const result = await handleServerDoctor({ server: "my-server", fresh: true });

      expect(mockedDoctor.runServerDoctor).toHaveBeenCalledWith("1.2.3.4", "my-server", {
        fresh: true,
      }, sampleServer);
      expect(result.isError).toBeUndefined();
    });

    it("returns mcpSuccess with findings grouped by severity in summary", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedConfig.findServer.mockReturnValue(sampleServer as never);
      mockedDoctor.runServerDoctor.mockResolvedValue({
        success: true,
        data: sampleDoctorResult,
      });

      const result = await handleServerDoctor({ server: "my-server", format: "summary" });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.critical).toBe(1);
      expect(parsed.warning).toBe(1);
      expect(parsed.info).toBe(1);
      expect(parsed.total).toBe(3);
    });
  });

  describe("json format", () => {
    it("returns raw JSON DoctorResult when format=json", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedConfig.findServer.mockReturnValue(sampleServer as never);
      mockedDoctor.runServerDoctor.mockResolvedValue({
        success: true,
        data: sampleDoctorResult,
      });

      const result = await handleServerDoctor({ server: "my-server", format: "json" });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.serverName).toBe("my-server");
      expect(parsed.findings).toHaveLength(3);
      expect(parsed.ranAt).toBe("2026-03-14T11:00:00Z");
    });
  });

  describe("error cases", () => {
    it("returns mcpError when runServerDoctor returns success=false", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedConfig.findServer.mockReturnValue(sampleServer as never);
      mockedDoctor.runServerDoctor.mockResolvedValue({
        success: false,
        error: "Invalid IP address",
      });

      const result = await handleServerDoctor({ server: "my-server" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain("Invalid IP address");
    });

    it("returns mcpError when core function throws", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedConfig.findServer.mockReturnValue(sampleServer as never);
      mockedDoctor.runServerDoctor.mockRejectedValue(new Error("Unexpected error"));

      const result = await handleServerDoctor({ server: "my-server" });

      expect(result.isError).toBe(true);
    });
  });

  describe("server resolution", () => {
    it("returns mcpError when no servers found", async () => {
      mockedConfig.getServers.mockReturnValue([] as never);

      const result = await handleServerDoctor({ action: "status" } as never);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain("No servers found");
    });

    it("returns mcpError when multiple servers and no server param", async () => {
      mockedConfig.getServers.mockReturnValue([
        sampleServer,
        { ...sampleServer, id: "456", name: "other-server" },
      ] as never);

      const result = await handleServerDoctor({});

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain("Multiple servers");
    });

    it("returns mcpError when server not found by name", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedConfig.findServer.mockReturnValue(undefined as never);

      const result = await handleServerDoctor({ server: "nonexistent" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain("nonexistent");
    });

    it("auto-resolves single server when no server param given", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedDoctor.runServerDoctor.mockResolvedValue({
        success: true,
        data: { ...sampleDoctorResult, findings: [] },
      });

      const result = await handleServerDoctor({});

      expect(result.isError).toBeUndefined();
      expect(mockedDoctor.runServerDoctor).toHaveBeenCalledWith("1.2.3.4", "my-server", {
        fresh: false,
      }, sampleServer);
    });
  });
});

// ─── P144 T12 — Active Probe findings in MCP server_doctor ──────────────────

describe("MCP server_doctor — Active Probe findings (T12)", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedConfig.findServer.mockReturnValue(sampleServer as never);
  });

  const probeFindings = [
    {
      id: "PROBE_UNRESOLVED_11111111",
      severity: "critical" as const,
      description: "Probe session terminated as unresolved — manual cleanup required",
      command: "kastell probe inspect 11111111-1111-4111-8111-111111111111",
      weight: 10,
    },
    {
      id: "PROBE_INTERRUPTED_22222222",
      severity: "critical" as const,
      description: "Probe session interrupted mid-execution",
      command: "kastell probe inspect 22222222-2222-4222-8222-222222222222",
      weight: 10,
    },
  ];

  const doctorResultWithProbe: DoctorResult = {
    serverName: "my-server",
    serverIp: "1.2.3.4",
    findings: [
      ...probeFindings,
      {
        id: "STALE_PACKAGES",
        severity: "warning",
        description: "15 packages available for upgrade",
        command: "sudo apt update && sudo apt upgrade",
        weight: 5,
      },
    ],
    ranAt: "2026-03-14T11:00:00Z",
    usedFreshData: false,
    score: 64, // (15/70 * 100 = 21 penalty) → 79; +2 critical probe (20/70) → 71? Actually critical weight 10 each: 3 critical (30) + 1 warning (5) = 35, 35/70*100 = 50, 100-50 = 50. Score computed live.
  };

  it("preserves MCP serverDoctor structuredContent shape when probe findings are merged", async () => {
    mockedDoctor.runServerDoctor.mockResolvedValue({
      success: true,
      data: doctorResultWithProbe,
    });

    const result = await handleServerDoctor({ server: "my-server" });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.critical).toBe(2);
    expect(parsed.warning).toBe(1);
    expect(parsed.total).toBe(3);
    // Probe findings serialize as [CRITICAL] lines carrying the diagnostic
    // description and the inspection command. Verify shape, not the literal
    // PROBE_<KIND> tag (that's an internal id, not in the rendered string).
    expect(parsed.findings.length).toBe(3);
    const criticalLines = parsed.findings.filter((f: string) => f.startsWith("  [CRITICAL]"));
    expect(criticalLines.length).toBe(2);
    expect(criticalLines[0]).toContain("kastell probe inspect");
  });

  it("never invokes probe lifecycle handlers — only read-only diagnostic adapter", async () => {
    // Static guard: the MCP tool source must not import or invoke lifecycle.
    const fs = require("fs");
    const path = require("path");
    const toolSource = fs.readFileSync(
      path.join(__dirname, "..", "..", "src", "mcp", "tools", "serverDoctor.ts"),
      "utf8",
    );
    expect(toolSource).not.toMatch(/reserveProbeTarget/);
    expect(toolSource).not.toMatch(/transitionProbeSession/);
    expect(toolSource).not.toMatch(/runProbeLifecycle/);
    expect(toolSource).not.toMatch(/createProbeSessionFacade/);
    expect(toolSource).not.toMatch(/executeProbeHandler/);
  });

  it("autoFix=true with probe-only findings: returns early with no-fixable message (probe findings have no fixCommand)", async () => {
    mockedManage.isSafeMode.mockReturnValue(false);
    mockedDoctor.runServerDoctor.mockResolvedValue({
      success: true,
      data: doctorResultWithProbe,
    });

    const result = await handleServerDoctor({
      server: "my-server",
      autoFix: true,
    });

    expect(result.isError).toBeUndefined();
    // When ALL findings are unfixable (probe findings have no fixCommand),
    // the handler short-circuits with the "No auto-fixable findings" message
    // and never invokes runDoctorFix.
    expect(mockedDoctorFix.runDoctorFix).not.toHaveBeenCalled();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.message).toContain("No auto-fixable findings");
    expect(parsed.total).toBe(3);
  });

  it("autoFix=true with mixed findings: fixable filter excludes probe findings (only STALE_PACKAGES is fixable)", async () => {
    mockedManage.isSafeMode.mockReturnValue(false);
    mockedDoctor.runServerDoctor.mockResolvedValue({
      success: true,
      data: {
        ...doctorResultWithProbe,
        findings: [
          {
            id: "STALE_PACKAGES",
            severity: "warning",
            description: "15 packages to upgrade",
            command: "sudo apt update",
            fixCommand: "DEBIAN_FRONTEND=noninteractive sudo apt update && sudo apt upgrade -y",
            weight: 5,
          },
          {
            id: "PROBE_UNRESOLVED_11111111",
            severity: "critical",
            description: "Probe session unresolved",
            command: "kastell probe inspect 11111111-1111-4111-8111-111111111111",
            weight: 10,
          },
        ],
      },
    });
    mockedDoctorFix.runDoctorFix.mockResolvedValue({
      applied: ["STALE_PACKAGES"],
      skipped: [],
      failed: [],
    });

    const result = await handleServerDoctor({
      server: "my-server",
      autoFix: true,
      force: true,
    });

    expect(result.isError).toBeUndefined();
    expect(mockedDoctorFix.runDoctorFix).toHaveBeenCalledTimes(1);
    const passedFindings = mockedDoctorFix.runDoctorFix.mock.calls[0][1] as Array<{ id: string; fixCommand?: string }>;
    const fixableCount = passedFindings.filter((f) => f.fixCommand).length;
    // Only STALE_PACKAGES has fixCommand; probe finding has none.
    expect(fixableCount).toBe(1);
    const fixableIds = passedFindings.filter((f) => f.fixCommand).map((f) => f.id);
    expect(fixableIds).toEqual(["STALE_PACKAGES"]);
  });
});

describe("autoFix mode", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedConfig.findServer.mockReturnValue(sampleServer as never);
    mockedManage.isSafeMode.mockReturnValue(false);
  });

  it("autoFix=false (default) preserves existing read-only behavior", async () => {
    mockedDoctor.runServerDoctor.mockResolvedValue({
      success: true,
      data: sampleDoctorResult,
    });

    const result = await handleServerDoctor({ server: "my-server", autoFix: false });

    expect(result.isError).toBeUndefined();
    expect(mockedDoctorFix.runDoctorFix).not.toHaveBeenCalled();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.total).toBe(3);
  });

  it("autoFix=true calls runDoctorFix and returns applied/skipped/failed counts", async () => {
    mockedDoctor.runServerDoctor.mockResolvedValue({
      success: true,
      data: sampleDoctorResultWithFixable,
    });
    mockedDoctorFix.runDoctorFix.mockResolvedValue({
      applied: ["STALE_PACKAGES"],
      skipped: [],
      failed: [],
    });

    const result = await handleServerDoctor({ server: "my-server", autoFix: true, force: true });

    expect(mockedDoctorFix.runDoctorFix).toHaveBeenCalledWith(
      "1.2.3.4",
      sampleDoctorResultWithFixable.findings,
      { dryRun: false, force: true },
      sampleDoctorResultWithFixable.serverName,
    );
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.applied).toBe(1);
    expect(parsed.skipped).toBe(0);
    expect(parsed.failed).toBe(0);
    expect(parsed.mode).toBe("applied");
  });

  it("autoFix=true with isSafeMode=true forces dryRun", async () => {
    mockedManage.isSafeMode.mockReturnValue(true);
    mockedDoctor.runServerDoctor.mockResolvedValue({
      success: true,
      data: sampleDoctorResultWithFixable,
    });
    mockedDoctorFix.runDoctorFix.mockResolvedValue({
      applied: [],
      skipped: ["STALE_PACKAGES", "DISK_TREND"],
      failed: [],
    });

    const result = await handleServerDoctor({ server: "my-server", autoFix: true });

    expect(mockedDoctorFix.runDoctorFix).toHaveBeenCalledWith(
      "1.2.3.4",
      sampleDoctorResultWithFixable.findings,
      { dryRun: true, force: false },
      sampleDoctorResultWithFixable.serverName,
    );
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.mode).toBe("dry-run");
    expect(parsed.safeModeForcedDryRun).toBe(true);
  });

  it("autoFix=true returns message when no auto-fixable findings", async () => {
    mockedDoctor.runServerDoctor.mockResolvedValue({
      success: true,
      data: sampleDoctorResult,
    });

    const result = await handleServerDoctor({ server: "my-server", autoFix: true });

    expect(mockedDoctorFix.runDoctorFix).not.toHaveBeenCalled();
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.message).toContain("No auto-fixable findings");
  });
});

describe("malformed params", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedConfig.findServer.mockReturnValue(undefined as never);
  });

  it("returns mcpError when server param is empty string", async () => {
    const result = await handleServerDoctor({ server: "" });
    expect(result.isError).toBe(true);
  });

  it("returns mcpError when server param is null", async () => {
    const result = await handleServerDoctor({ server: null as unknown as string });
    expect(result.isError).toBe(true);
  });

  it("returns mcpError for unmatched server string", async () => {
    const result = await handleServerDoctor({ server: "999.999.999.999" });
    expect(result.isError).toBe(true);
  });

  it("returns mcpError when core throws SSH error", async () => {
    mockedConfig.findServer.mockReturnValue(sampleServer as never);
    mockedDoctor.runServerDoctor.mockRejectedValue(new Error("SSH connection refused"));
    const result = await handleServerDoctor({ server: "my-server" });
    expect(result.isError).toBe(true);
  });
});
