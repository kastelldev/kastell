import * as config from "../../src/utils/config";
import * as guardCore from "../../src/core/guard";
import { handleServerGuard } from "../../src/mcp/tools/serverGuard";

jest.mock("../../src/utils/config");
jest.mock("../../src/core/guard");

const mockedConfig = config as jest.Mocked<typeof config>;
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

beforeEach(() => {
  jest.resetAllMocks();
});

describe("MCP server_guard tool", () => {
  describe("start action", () => {
    it("calls startGuard with server ip and name, returns mcpSuccess", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedConfig.findServer.mockReturnValue(sampleServer as never);
      mockedGuard.startGuard.mockResolvedValue({ success: true });

      const result = await handleServerGuard({ server: "my-server", action: "start" });

      expect(mockedGuard.startGuard).toHaveBeenCalledWith("1.2.3.4", "my-server");
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
    });

    it("returns mcpError when startGuard fails", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedConfig.findServer.mockReturnValue(sampleServer as never);
      mockedGuard.startGuard.mockResolvedValue({
        success: false,
        error: "Failed to deploy guard script",
        hint: "Check SSH keys",
      });

      const result = await handleServerGuard({ server: "my-server", action: "start" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain("Failed to deploy guard script");
    });
  });

  describe("stop action", () => {
    it("calls stopGuard with server ip and name, returns mcpSuccess", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedConfig.findServer.mockReturnValue(sampleServer as never);
      mockedGuard.stopGuard.mockResolvedValue({ success: true });

      const result = await handleServerGuard({ server: "my-server", action: "stop" });

      expect(mockedGuard.stopGuard).toHaveBeenCalledWith("1.2.3.4", "my-server");
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
    });

    it("returns mcpError when stopGuard fails", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedConfig.findServer.mockReturnValue(sampleServer as never);
      mockedGuard.stopGuard.mockResolvedValue({
        success: false,
        error: "Failed to remove guard cron entry",
      });

      const result = await handleServerGuard({ server: "my-server", action: "stop" });

      expect(result.isError).toBe(true);
    });
  });

  describe("status action", () => {
    it("calls guardStatus with server ip and name, returns mcpSuccess with status data", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedConfig.findServer.mockReturnValue(sampleServer as never);
      mockedGuard.guardStatus.mockResolvedValue({
        success: true,
        isActive: true,
        lastRunAt: "2026-03-14T10:00:00Z",
        breaches: ["Disk usage 85% exceeds 80% threshold"],
        logTail: "[kastell-guard] 2026-03-14T10:00:00Z BREACH: Disk usage 85%",
        installedAt: "2026-03-14T09:00:00Z",
      });

      const result = await handleServerGuard({ server: "my-server", action: "status" });

      expect(mockedGuard.guardStatus).toHaveBeenCalledWith("1.2.3.4", "my-server");
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.isActive).toBe(true);
      expect(parsed.breaches).toHaveLength(1);
      expect(parsed.logTail).toContain("[kastell-guard]");
    });

    it("returns mcpError when guardStatus fails", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedConfig.findServer.mockReturnValue(sampleServer as never);
      mockedGuard.guardStatus.mockResolvedValue({
        success: false,
        isActive: false,
        breaches: [],
        logTail: "",
        error: "Failed to check guard status",
      });

      const result = await handleServerGuard({ server: "my-server", action: "status" });

      expect(result.isError).toBe(true);
    });
  });

  describe("server resolution", () => {
    it("returns mcpError when no servers found", async () => {
      mockedConfig.getServers.mockReturnValue([] as never);

      const result = await handleServerGuard({ action: "status" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain("No servers found");
    });

    it("returns mcpError when multiple servers and no server param", async () => {
      mockedConfig.getServers.mockReturnValue([
        sampleServer,
        { ...sampleServer, id: "456", name: "other-server" },
      ] as never);

      const result = await handleServerGuard({ action: "status" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain("Multiple servers");
    });

    it("returns mcpError when server not found by name", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedConfig.findServer.mockReturnValue(undefined as never);

      const result = await handleServerGuard({ server: "nonexistent", action: "status" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain("nonexistent");
    });

    it("auto-resolves single server when no server param given", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedGuard.guardStatus.mockResolvedValue({
        success: true,
        isActive: false,
        breaches: [],
        logTail: "",
      });

      const result = await handleServerGuard({ action: "status" });

      expect(result.isError).toBeUndefined();
      expect(mockedGuard.guardStatus).toHaveBeenCalledWith("1.2.3.4", "my-server");
    });
  });

  describe("error handling", () => {
    it("returns mcpError when core function throws", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedConfig.findServer.mockReturnValue(sampleServer as never);
      mockedGuard.startGuard.mockRejectedValue(new Error("SSH connection refused"));

      const result = await handleServerGuard({ server: "my-server", action: "start" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain("SSH connection refused");
    });
  });
});

describe("malformed params", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedConfig.getServers.mockReturnValue([sampleServer] as never);
    mockedConfig.findServer.mockReturnValue(undefined as never);
  });

  it("returns mcpError when server param is empty string", async () => {
    const result = await handleServerGuard({ server: "", action: "status" });
    expect(result.isError).toBe(true);
  });

  it("returns mcpError when server param is null", async () => {
    const result = await handleServerGuard({ server: null as unknown as string, action: "status" });
    expect(result.isError).toBe(true);
  });

  it("returns mcpError for unmatched server string", async () => {
    const result = await handleServerGuard({ server: "999.999.999.999", action: "status" });
    expect(result.isError).toBe(true);
  });

  it("returns mcpError when action is null", async () => {
    mockedConfig.findServer.mockReturnValue(sampleServer as never);
    const result = await handleServerGuard({ server: "my-server", action: null as unknown as Parameters<typeof handleServerGuard>[0]["action"] });
    expect(result.isError).toBe(true);
  });
});
