import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// Mock version.ts which uses import.meta.url (ESM-only)
jest.mock("../../src/utils/version.js", () => ({
  KASTELL_VERSION: "0.0.0-test",
}));

import { createMcpServer } from "../../src/mcp/server.js";

export async function withMcpClient<T>(
  fn: (client: Client) => Promise<T>,
  opts?: { env?: Record<string, string> },
): Promise<T> {
  const originalEnv: Record<string, string | undefined> = {};
  if (opts?.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      originalEnv[k] = process.env[k];
      process.env[k] = v;
    }
  }

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const server = await createMcpServer();
  const client = new Client({ name: "kastell-test", version: "0.0.0" }, { capabilities: {} });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    return await fn(client);
  } finally {
    await client.close();
    await server.close();
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}