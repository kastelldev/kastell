/**
 * Unit tests for server_evidence MCP tool.
 * Verifies server resolution, evidence collection, and response formatting.
 */

import * as evidenceModule from "../../src/core/evidence";
import * as configModule from "../../src/utils/config";
import * as mcpUtils from "../../src/mcp/utils";

jest.mock("../../src/core/evidence");
jest.mock("../../src/utils/config");
jest.mock("../../src/mcp/utils", () => ({
  resolveServerForMcp: jest.fn(),
  mcpSuccess: jest.fn((data: Record<string, unknown>) => ({
    content: [{ type: "text", text: JSON.stringify(data) }],
  })),
  mcpError: jest.fn((error: string, hint?: string) => ({
    content: [{ type: "text", text: JSON.stringify({ error, ...(hint ? { hint } : {}) }) }],
    isError: true,
  })),
}));

import { handleServerEvidence, serverEvidenceSchema } from "../../src/mcp/tools/serverEvidence";

const mockedEvidence = evidenceModule as jest.Mocked<typeof evidenceModule>;
const mockedConfig = configModule as jest.Mocked<typeof configModule>;
const mockedMcpUtils = mcpUtils as jest.Mocked<typeof mcpUtils>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeServer(overrides: Record<string, unknown> = {}) {
  return {
    name: "prod-server",
    ip: "1.2.3.4",
    mode: "coolify" as const,
    platform: "coolify",
    ...overrides,
  };
}

function makeResult(overrides: Partial<{
  evidenceDir: string;
  serverName: string;
  serverIp: string;
  platform: string;
  collectedAt: string;
  totalFiles: number;
  skippedFiles: number;
  manifestPath: string;
}> = {}) {
  return {
    success: true as const,
    data: {
      evidenceDir: "/home/user/.kastell/evidence/prod-server/2026-03-11",
      serverName: "prod-server",
      serverIp: "1.2.3.4",
      platform: "coolify",
      collectedAt: "2026-03-11T08:00:00.000Z",
      totalFiles: 5,
      skippedFiles: 0,
      manifestPath: "/home/user/.kastell/evidence/prod-server/2026-03-11/MANIFEST.json",
      ...overrides,
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("handleServerEvidence", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockedMcpUtils.mcpSuccess as jest.Mock).mockImplementation((data: Record<string, unknown>) => ({
      content: [{ type: "text", text: JSON.stringify(data) }],
    }));
    (mockedMcpUtils.mcpError as jest.Mock).mockImplementation((error: string, hint?: string) => ({
      content: [{ type: "text", text: JSON.stringify({ error, ...(hint ? { hint } : {}) }) }],
      isError: true,
    }));
  });

  it("returns mcpError when no servers are registered", async () => {
    mockedConfig.getServers.mockReturnValue([]);

    const response = await handleServerEvidence({});

    expect(response.isError).toBe(true);
  });

  it("returns mcpError when server not found by name", async () => {
    const server = makeServer();
    mockedConfig.getServers.mockReturnValue([server] as never);
    mockedMcpUtils.resolveServerForMcp.mockReturnValue(undefined);

    const response = await handleServerEvidence({ server: "nonexistent" });

    expect(response.isError).toBe(true);
  });

  it("calls collectEvidence with resolved server and default options", async () => {
    const server = makeServer();
    mockedConfig.getServers.mockReturnValue([server] as never);
    mockedMcpUtils.resolveServerForMcp.mockReturnValue(server as never);
    mockedEvidence.collectEvidence.mockResolvedValue(makeResult() as never);

    await handleServerEvidence({});

    expect(mockedEvidence.collectEvidence).toHaveBeenCalledWith(
      "prod-server",
      "1.2.3.4",
      "coolify",
      expect.objectContaining({
        lines: 500,
        noDocker: false,
        noSysinfo: false,
        force: false,
        quiet: true,
      }),
    );
  });

  it("passes lines parameter to collectEvidence", async () => {
    const server = makeServer();
    mockedConfig.getServers.mockReturnValue([server] as never);
    mockedMcpUtils.resolveServerForMcp.mockReturnValue(server as never);
    mockedEvidence.collectEvidence.mockResolvedValue(makeResult() as never);

    await handleServerEvidence({ lines: 1000 });

    expect(mockedEvidence.collectEvidence).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ lines: 1000 }),
    );
  });

  it("passes no_docker=true when specified", async () => {
    const server = makeServer();
    mockedConfig.getServers.mockReturnValue([server] as never);
    mockedMcpUtils.resolveServerForMcp.mockReturnValue(server as never);
    mockedEvidence.collectEvidence.mockResolvedValue(makeResult() as never);

    await handleServerEvidence({ no_docker: true });

    expect(mockedEvidence.collectEvidence).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ noDocker: true }),
    );
  });

  it("passes no_sysinfo=true when specified", async () => {
    const server = makeServer();
    mockedConfig.getServers.mockReturnValue([server] as never);
    mockedMcpUtils.resolveServerForMcp.mockReturnValue(server as never);
    mockedEvidence.collectEvidence.mockResolvedValue(makeResult() as never);

    await handleServerEvidence({ no_sysinfo: true });

    expect(mockedEvidence.collectEvidence).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ noSysinfo: true }),
    );
  });

  it("returns mcpSuccess with manifest content on success", async () => {
    const server = makeServer();
    mockedConfig.getServers.mockReturnValue([server] as never);
    mockedMcpUtils.resolveServerForMcp.mockReturnValue(server as never);
    mockedEvidence.collectEvidence.mockResolvedValue(makeResult() as never);

    const response = await handleServerEvidence({});

    expect(response.isError).toBeUndefined();
    expect(mockedMcpUtils.mcpSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        evidenceDir: expect.any(String),
        totalFiles: expect.any(Number),
        manifestPath: expect.any(String),
      }),
    );
  });

  it("returns mcpError when collectEvidence fails", async () => {
    const server = makeServer();
    mockedConfig.getServers.mockReturnValue([server] as never);
    mockedMcpUtils.resolveServerForMcp.mockReturnValue(server as never);
    mockedEvidence.collectEvidence.mockResolvedValue({
      success: false as const,
      error: "SSH connection refused",
    } as never);

    const response = await handleServerEvidence({});

    expect(response.isError).toBe(true);
  });

  it("passes name parameter to collectEvidence", async () => {
    const server = makeServer();
    mockedConfig.getServers.mockReturnValue([server] as never);
    mockedMcpUtils.resolveServerForMcp.mockReturnValue(server as never);
    mockedEvidence.collectEvidence.mockResolvedValue(makeResult() as never);

    await handleServerEvidence({ name: "pre-incident" });

    expect(mockedEvidence.collectEvidence).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ name: "pre-incident" }),
    );
  });
});

describe("serverEvidenceSchema", () => {
  it("has expected parameter definitions", () => {
    expect(serverEvidenceSchema).toHaveProperty("server");
    expect(serverEvidenceSchema).toHaveProperty("name");
    expect(serverEvidenceSchema).toHaveProperty("lines");
    expect(serverEvidenceSchema).toHaveProperty("no_docker");
    expect(serverEvidenceSchema).toHaveProperty("no_sysinfo");
  });
});

describe("malformed params", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedConfig.getServers.mockReturnValue([makeServer()] as never);
    mockedMcpUtils.resolveServerForMcp.mockReturnValue(undefined);
    (mockedMcpUtils.mcpError as jest.Mock).mockImplementation((error: string, hint?: string) => ({
      content: [{ type: "text", text: JSON.stringify({ error, ...(hint ? { hint } : {}) }) }],
      isError: true,
    }));
  });

  it("returns mcpError when server param is empty string", async () => {
    const result = await handleServerEvidence({ server: "" });
    expect(result.isError).toBe(true);
  });

  it("returns mcpError when server param is null", async () => {
    const result = await handleServerEvidence({ server: null as unknown as string });
    expect(result.isError).toBe(true);
  });

  it("returns mcpError for unmatched server string", async () => {
    const result = await handleServerEvidence({ server: "999.999.999.999" });
    expect(result.isError).toBe(true);
  });

  it("returns mcpError when core throws SSH error", async () => {
    const server = makeServer();
    mockedMcpUtils.resolveServerForMcp.mockReturnValue(server as never);
    mockedEvidence.collectEvidence.mockRejectedValue(new Error("SSH connection refused"));
    const result = await handleServerEvidence({ server: "prod-server" });
    expect(result.isError).toBe(true);
  });
});
