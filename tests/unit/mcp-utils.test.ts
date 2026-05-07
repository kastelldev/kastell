import * as configModule from "../../src/utils/config";
import * as tokensModule from "../../src/core/tokens";
import {
  resolveServerForMcp,
  mcpSuccess,
  mcpError,
  requireProviderToken,
} from "../../src/mcp/utils";
import type { ServerRecord } from "../../src/types/index";

jest.mock("../../src/utils/config");
jest.mock("../../src/core/tokens");

const mockedConfig = configModule as jest.Mocked<typeof configModule>;
const mockedTokens = tokensModule as jest.Mocked<typeof tokensModule>;

const sampleServer: ServerRecord = {
  id: "123",
  name: "coolify-test",
  provider: "hetzner",
  ip: "1.2.3.4",
  region: "nbg1",
  size: "cax11",
  createdAt: "2026-02-20T00:00:00Z",
  mode: "coolify",
};

const anotherServer: ServerRecord = {
  id: "456",
  name: "other-server",
  provider: "digitalocean",
  ip: "5.6.7.8",
  region: "fra1",
  size: "s-1vcpu-1gb",
  createdAt: "2026-02-20T00:00:00Z",
  mode: "coolify",
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── resolveServerForMcp ──────────────────────────────────────────────────────

describe("resolveServerForMcp", () => {
  it("returns the server when server param matches findServer", () => {
    mockedConfig.findServer.mockReturnValue(sampleServer);
    const result = resolveServerForMcp({ server: "coolify-test" }, [sampleServer]);
    expect(result).toBe(sampleServer);
    expect(mockedConfig.findServer).toHaveBeenCalledWith("coolify-test");
  });

  it("returns undefined when server param provided but findServer returns undefined", () => {
    mockedConfig.findServer.mockReturnValue(undefined);
    const result = resolveServerForMcp({ server: "nonexistent" }, [sampleServer]);
    expect(result).toBeUndefined();
  });

  it("returns the only server when no server param and 1 server in list", () => {
    const result = resolveServerForMcp({}, [sampleServer]);
    expect(result).toBe(sampleServer);
    expect(mockedConfig.findServer).not.toHaveBeenCalled();
  });

  it("returns undefined when no server param and multiple servers", () => {
    const result = resolveServerForMcp({}, [sampleServer, anotherServer]);
    expect(result).toBeUndefined();
    expect(mockedConfig.findServer).not.toHaveBeenCalled();
  });

  it("returns undefined when no server param and 0 servers", () => {
    const result = resolveServerForMcp({}, []);
    expect(result).toBeUndefined();
    expect(mockedConfig.findServer).not.toHaveBeenCalled();
  });
});

// ─── mcpSuccess ───────────────────────────────────────────────────────────────

describe("mcpSuccess", () => {
  it("wraps data in content array with type text and includes version", () => {
    const data = { status: "ok", count: 3 };
    const result = mcpSuccess(data);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("ok");
    expect(parsed.count).toBe(3);
    expect(parsed._kastell_version).toBeDefined();
  });

  it("does not set isError", () => {
    const result = mcpSuccess({ foo: "bar" });
    expect(result.isError).toBeUndefined();
  });

  it("JSON-serializes complex data correctly", () => {
    const data = { servers: [{ name: "test", ip: "1.2.3.4" }], total: 1 };
    const result = mcpSuccess(data);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.servers[0].name).toBe("test");
    expect(parsed.total).toBe(1);
  });
});

// ─── mcpError ─────────────────────────────────────────────────────────────────

describe("mcpError", () => {
  it("wraps error string in content with isError true", () => {
    const result = mcpError("Something went wrong");
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("Something went wrong");
  });

  it("includes hint when provided", () => {
    const result = mcpError("Token missing", "Set HETZNER_TOKEN");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.hint).toBe("Set HETZNER_TOKEN");
  });

  it("omits hint when not provided", () => {
    const result = mcpError("Some error");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.hint).toBeUndefined();
  });

  it("includes suggested_actions when provided", () => {
    const actions = [{ command: "kastell list", reason: "See available servers" }];
    const result = mcpError("No server found", undefined, actions);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.suggested_actions).toEqual(actions);
  });

  it("omits suggested_actions when not provided", () => {
    const result = mcpError("Some error");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.suggested_actions).toBeUndefined();
  });

  it("includes both hint and suggested_actions when both provided", () => {
    const actions = [{ command: "kastell list", reason: "See available servers" }];
    const result = mcpError("Error msg", "A hint", actions);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("Error msg");
    expect(parsed.hint).toBe("A hint");
    expect(parsed.suggested_actions).toEqual(actions);
  });
});

// ─── mcpSuccess structuredContent ─────────────────────────────────────────────

describe("mcpSuccess structuredContent", () => {
  it("should include structuredContent without _kastell_version", () => {
    const data = { score: 85, server: "test-box" };
    const result = mcpSuccess(data);
    expect(result.structuredContent).toBeDefined();
    expect(result.structuredContent).toEqual({ result: { score: 85, server: "test-box" } });
    expect(result.structuredContent).not.toHaveProperty("_kastell_version");
  });

  it("should keep _kastell_version in text content", () => {
    const data = { score: 85 };
    const result = mcpSuccess(data);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed._kastell_version).toBeDefined();
    expect(result.structuredContent).not.toHaveProperty("_kastell_version");
  });

  it("should include structuredContent with largeResult", () => {
    const data = { data: "big" };
    const result = mcpSuccess(data, { largeResult: true });
    expect(result.structuredContent).toEqual({ result: { data: "big" } });
    expect(result.content[0]._meta).toBeDefined();
  });

  it("should NOT include structuredContent in mcpError", () => {
    const result = mcpError("something failed", "check logs");
    expect(result.structuredContent).toBeUndefined();
  });
});

// ─── requireProviderToken ─────────────────────────────────────────────────────

describe("requireProviderToken", () => {
  it("returns token when env var is set", () => {
    mockedTokens.getProviderToken.mockReturnValue("my-secret-token");
    const result = requireProviderToken("hetzner");
    expect("token" in result).toBe(true);
    if ("token" in result) {
      expect(result.token).toBe("my-secret-token");
    }
    expect(mockedTokens.getProviderToken).toHaveBeenCalledWith("hetzner");
  });

  it("returns MCP error response when token missing", () => {
    mockedTokens.getProviderToken.mockReturnValue(undefined);
    const result = requireProviderToken("digitalocean");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.isError).toBe(true);
      const parsed = JSON.parse(result.error.content[0].text);
      expect(parsed.error).toContain("No API token found for digitalocean");
      expect(parsed.hint).toContain("DIGITALOCEAN_TOKEN");
    }
  });
});
