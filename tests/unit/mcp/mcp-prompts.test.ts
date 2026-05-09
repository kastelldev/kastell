import { hardenPrompt, diagnosePrompt, setupPrompt } from "../../../src/mcp/prompts/workflows.js";

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

