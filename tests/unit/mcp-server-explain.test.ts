import { CHECK_IDS } from "../../src/core/audit/checkIds.js";
import { serverExplainHandler, serverExplainSchema } from "../../src/mcp/tools/serverExplain.js";
import { clearCheckCatalogCache } from "../../src/core/audit/explainCheck.js";

beforeEach(() => { clearCheckCatalogCache(); });

describe("serverExplainHandler", () => {
  it("returns check details for valid ID", async () => {
    const result = await serverExplainHandler({ checkId: CHECK_IDS.SSH.SSH_PASSWORD_AUTH });
    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe(CHECK_IDS.SSH.SSH_PASSWORD_AUTH);
    expect(parsed.category).toBe("SSH");
    expect(parsed.severity).toBe("critical");
    expect(parsed.explain).toBeDefined();
    expect(parsed.complianceRefs).toBeInstanceOf(Array);
    expect(parsed._kastell_version).toBeDefined();
  });

  it("returns error for unknown ID with suggestions", async () => {
    const result = await serverExplainHandler({ checkId: "SSH-PASWORD-AUTH" });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("Unknown check ID");
    expect(parsed.error).toContain(CHECK_IDS.SSH.SSH_PASSWORD_AUTH);
    expect(parsed.hint).toBeDefined();
  });

  it("returns error for completely unknown ID", async () => {
    const result = await serverExplainHandler({ checkId: "ZZZZZ-999" });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("Unknown check ID");
    expect(parsed.hint).toBeDefined();
  });
});

describe("serverExplainSchema", () => {
  it("requires checkId string", () => {
    const result = serverExplainSchema.safeParse({ checkId: CHECK_IDS.SSH.SSH_PASSWORD_AUTH });
    expect(result.success).toBe(true);
  });

  it("rejects missing checkId", () => {
    const result = serverExplainSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
