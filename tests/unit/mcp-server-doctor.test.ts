import * as config from "../../src/utils/config";
import * as doctorCore from "../../src/core/doctor";
import { handleServerDoctor } from "../../src/mcp/tools/serverDoctor";
import type { DoctorResult } from "../../src/core/doctor";

jest.mock("../../src/utils/config");
jest.mock("../../src/core/doctor");

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedDoctor = doctorCore as jest.Mocked<typeof doctorCore>;

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
    },
    {
      id: "HIGH_SWAP",
      severity: "warning",
      description: "Swap usage is at 75%",
      command: "free -h",
    },
    {
      id: "STALE_PACKAGES",
      severity: "info",
      description: "15 packages available for upgrade",
      command: "sudo apt update && sudo apt upgrade",
    },
  ],
  ranAt: "2026-03-14T11:00:00Z",
  usedFreshData: false,
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
      });
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
      });
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
      });
    });
  });
});
