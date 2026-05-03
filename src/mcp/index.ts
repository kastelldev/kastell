#!/usr/bin/env node
// MCP SDK isolation: This file is the entry point for kastell-mcp binary only.
// The main kastell CLI (src/index.ts) must NEVER import from this module.
// See tests/unit/dep-isolation.test.ts for the guard test.
import { fileURLToPath } from "url";
import { dirname } from "path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";
import { migrateConfigIfNeeded } from "../utils/migration.js";
import { KASTELL_VERSION } from "../utils/version.js";
import { extractReason } from "../utils/errors.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Graceful handling of unhandled rejections (security audit MEDIUM-007)
process.on("unhandledRejection", (reason) => {
  const msg = extractReason(reason);
  process.stderr.write(`MCP unhandled rejection: ${msg}\n`);
});

async function main(): Promise<void> {
  // Fail-closed: MCP server defaults to SAFE_MODE=true if env is not explicitly set.
  // This prevents destructive operations when Claude Code doesn't propagate the env correctly.
  if (process.env.KASTELL_SAFE_MODE === undefined) {
    process.env.KASTELL_SAFE_MODE = "true";
  }
  // Mark invocation source so detectCaller() returns "mcp" for all downstream calls.
  process.env.KASTELL_CALLER = "mcp";

  migrateConfigIfNeeded();
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server is now listening on stdin/stdout via JSON-RPC
  // All logging must go to stderr (stdout is reserved for MCP protocol)
  process.stderr.write(`kastell-mcp v${KASTELL_VERSION} started (SAFE_MODE=${process.env.KASTELL_SAFE_MODE ?? "unset"})\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`Fatal: ${extractReason(error)}\n`);
  process.exit(1);
});
