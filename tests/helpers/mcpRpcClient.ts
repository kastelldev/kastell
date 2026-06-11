import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Mock version.ts which uses import.meta.url (ESM-only)
jest.mock("../../src/utils/version.js", () => ({
  KASTELL_VERSION: "0.0.0-test",
}));

export async function withMcpClient<T>(
  fn: (client: Client) => Promise<T>,
  opts?: { env?: Record<string, string> },
): Promise<T> {
  const isolatedDir = opts?.env?.KASTELL_DIR
    ? null
    : mkdtempSync(join(tmpdir(), "kastell-mcp-test-"));
  const env = {
    ...(isolatedDir ? { KASTELL_DIR: isolatedDir } : {}),
    ...opts?.env,
  };
  const originalEnv: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    originalEnv[k] = process.env[k];
    process.env[k] = v;
  }

  jest.resetModules();
  let server: McpServer | null = null;
  let client: Client | null = null;
  try {
    const { createMcpServer } = await import("../../src/mcp/server.js");
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    server = await createMcpServer();
    client = new Client({ name: "kastell-test", version: "0.0.0" }, { capabilities: {} });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return await fn(client);
  } finally {
    await client?.close();
    await server?.close();
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (isolatedDir) {
      rmSync(isolatedDir, { recursive: true, force: true });
    }
  }
}
