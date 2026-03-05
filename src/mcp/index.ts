#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";
import { migrateConfigIfNeeded } from "../utils/migration.js";

async function main(): Promise<void> {
  migrateConfigIfNeeded();
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server is now listening on stdin/stdout via JSON-RPC
  // All logging must go to stderr (stdout is reserved for MCP protocol)
  process.stderr.write("quicklify-mcp server started\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`Fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
