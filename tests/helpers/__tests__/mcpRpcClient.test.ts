import { withMcpClient } from "../mcpRpcClient";

describe("mcpRpcClient", () => {
  it("boots MCP server and lists tools via RPC", async () => {
    await withMcpClient(async (client) => {
      const result = await client.listTools();
      expect(result.tools.length).toBeGreaterThan(0);
      expect(result.tools.some((t) => t.name === "server_audit")).toBe(true);
    });
  });

  it("sets and restores env vars", async () => {
    const before = process.env.KASTELL_TEST_HARNESS;
    await withMcpClient(
      async () => {
        expect(process.env.KASTELL_TEST_HARNESS).toBe("yes");
      },
      { env: { KASTELL_TEST_HARNESS: "yes" } },
    );
    expect(process.env.KASTELL_TEST_HARNESS).toBe(before);
  });
});