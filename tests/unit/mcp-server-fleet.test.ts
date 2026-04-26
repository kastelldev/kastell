import * as config from "../../src/utils/config";
import * as fleetCore from "../../src/core/fleet";
import * as errorMapper from "../../src/utils/errorMapper";
import { handleServerFleet } from "../../src/mcp/tools/serverFleet";
import type { FleetRow } from "../../src/core/fleet";

jest.mock("../../src/utils/config");
jest.mock("../../src/core/fleet");
jest.mock("../../src/utils/errorMapper");

const mockedConfig = config as jest.Mocked<typeof config>;
const mockedFleet = fleetCore as jest.Mocked<typeof fleetCore>;
const mockedErrorMapper = errorMapper as jest.Mocked<typeof errorMapper>;

const sampleServer = {
  id: "abc",
  name: "web-01",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-01-01T00:00:00Z",
};

const sampleRows: FleetRow[] = [
  {
    name: "web-01",
    ip: "1.2.3.4",
    provider: "hetzner",
    status: "ONLINE",
    auditScore: 88,
    responseTime: 42,
    errorReason: null,
  },
  {
    name: "db-01",
    ip: "5.6.7.8",
    provider: "digitalocean",
    status: "DEGRADED",
    auditScore: 55,
    responseTime: 200,
    errorReason: null,
  },
];

beforeEach(() => {
  jest.resetAllMocks();
  // Re-setup errorMapper after reset (resetAllMocks clears implementations)
  mockedErrorMapper.sanitizeStderr.mockImplementation((s: string) => s);
  mockedErrorMapper.getErrorMessage.mockImplementation((err: unknown) =>
    err instanceof Error ? err.message : String(err),
  );
});

describe("MCP server_fleet tool", () => {
  describe("success cases", () => {
    it("returns mcpSuccess with rows array when servers exist", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedFleet.runFleet.mockResolvedValue(sampleRows);

      const result = await handleServerFleet({ sort: "name" });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.servers).toBe(2);
      expect(parsed.rows).toHaveLength(2);
      expect(parsed.rows[0].name).toBe("web-01");
    });

    it("passes sort option to runFleet", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedFleet.runFleet.mockResolvedValue(sampleRows);

      await handleServerFleet({ sort: "score" });

      expect(mockedFleet.runFleet).toHaveBeenCalledWith({ json: true, sort: "score" });
    });

    it("defaults sort to 'name' when no sort param given", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedFleet.runFleet.mockResolvedValue(sampleRows);

      await handleServerFleet({});

      expect(mockedFleet.runFleet).toHaveBeenCalledWith({ json: true, sort: "name" });
    });

    it("should include weakestCategory when categories param is true", async () => {
      const rowsWithCategory: FleetRow[] = [
        { ...sampleRows[0], weakestCategory: "Firewall", weakestCategoryScore: 45 },
      ];
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedFleet.runFleet.mockResolvedValue(rowsWithCategory);

      const result = await handleServerFleet({ sort: "name", categories: true });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.rows[0].weakestCategory).toBe("Firewall");
      expect(parsed.rows[0].weakestCategoryScore).toBe(45);
    });

    it("returns rows matching FleetRow shape with all fields", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedFleet.runFleet.mockResolvedValue([sampleRows[0]]);

      const result = await handleServerFleet({ sort: "name" });

      const parsed = JSON.parse(result.content[0].text);
      const row = parsed.rows[0];
      expect(row).toMatchObject({
        name: "web-01",
        ip: "1.2.3.4",
        provider: "hetzner",
        status: "ONLINE",
        auditScore: 88,
        responseTime: 42,
        errorReason: null,
      });
    });

    it("passes json:true to runFleet (suppresses table rendering)", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedFleet.runFleet.mockResolvedValue([]);

      await handleServerFleet({ sort: "provider" });

      expect(mockedFleet.runFleet).toHaveBeenCalledWith(
        expect.objectContaining({ json: true }),
      );
    });
  });

  describe("zero-server case", () => {
    it("returns mcpError with suggested action when no servers exist", async () => {
      mockedConfig.getServers.mockReturnValue([]);

      const result = await handleServerFleet({ sort: "name" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain("No servers found");
      expect(parsed.suggested_actions).toBeDefined();
      expect(parsed.suggested_actions[0].command).toBe("kastell add");
    });

    it("does not call runFleet when no servers are registered", async () => {
      mockedConfig.getServers.mockReturnValue([]);

      await handleServerFleet({});

      expect(mockedFleet.runFleet).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("catches runFleet errors and returns mcpError", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedFleet.runFleet.mockRejectedValue(new Error("SSH timeout"));

      const result = await handleServerFleet({ sort: "name" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain("SSH timeout");
    });

    it("returns mcpError for non-Error thrown values", async () => {
      mockedConfig.getServers.mockReturnValue([sampleServer] as never);
      mockedFleet.runFleet.mockRejectedValue("unexpected string error");

      const result = await handleServerFleet({ sort: "name" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBeTruthy();
    });
  });
});

describe("malformed params", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedConfig.getServers.mockReturnValue([] as never);
    mockedErrorMapper.sanitizeStderr.mockImplementation((s: string) => s);
    mockedErrorMapper.getErrorMessage.mockImplementation((err: unknown) =>
      err instanceof Error ? err.message : String(err),
    );
  });

  it("returns mcpError when no servers configured", async () => {
    const result = await handleServerFleet({});
    expect(result.isError).toBe(true);
  });
});
