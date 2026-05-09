import { hardenPrompt, diagnosePrompt, setupPrompt, getServerNameCompletions } from "../../../src/mcp/prompts/workflows.js";

jest.mock("../../../src/utils/config.js", () => ({
  getServers: jest.fn().mockReturnValue([
    { name: "prod-1", ip: "1.2.3.4", provider: "hetzner", mode: "coolify" },
    { name: "prod-2", ip: "5.6.7.8", provider: "hetzner", mode: "coolify" },
    { name: "staging", ip: "9.0.1.2", provider: "digitalocean", mode: "bare" },
  ]),
}));

describe("hardenPrompt", () => {
  it("returns workflow instructions with server name", () => {
    const result = hardenPrompt({ server: "prod-1" });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
    const text = (result.messages[0].content as { type: "text"; text: string }).text;
    expect(text).toContain("prod-1");
    expect(text).toContain("server_lock");
    expect(text).toContain("server_audit");
    expect(text).toContain("server_fix");
    expect(text).toContain("70");
  });
});

describe("diagnosePrompt", () => {
  it("returns workflow instructions with server name", () => {
    const result = diagnosePrompt({ server: "staging", service: "system" });
    const text = (result.messages[0].content as { type: "text"; text: string }).text;
    expect(text).toContain("staging");
    expect(text).toContain("server_doctor");
    expect(text).toContain("server_logs");
    expect(text).toContain("system");
  });

  it("defaults service based on context in body text", () => {
    const result = diagnosePrompt({ server: "web-1" });
    const text = (result.messages[0].content as { type: "text"; text: string }).text;
    expect(text).toContain("server_doctor");
  });
});

describe("setupPrompt", () => {
  it("returns workflow instructions with server name", () => {
    const result = setupPrompt({ name: "new-server" });
    const text = (result.messages[0].content as { type: "text"; text: string }).text;
    expect(text).toContain("new-server");
    expect(text).toContain("server_provision");
    expect(text).toContain("server_lock");
    expect(text).toContain("server_audit");
  });
});

describe("getServerNameCompletions", () => {
  it("returns matching server names for partial input", () => {
    const result = getServerNameCompletions("prod");
    expect(result.values).toEqual(["prod-1", "prod-2"]);
  });

  it("returns all servers for empty input", () => {
    const result = getServerNameCompletions("");
    expect(result.values).toHaveLength(3);
  });

  it("returns empty for non-matching input", () => {
    const result = getServerNameCompletions("xyz");
    expect(result.values).toHaveLength(0);
  });
});

