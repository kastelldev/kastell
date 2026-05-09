import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { findServer } from "../utils/config.js";
import { getProviderToken } from "../core/tokens.js";
import type { ServerRecord } from "../types/index.js";

// Version injected at startup by setMcpVersion()
let _version = "unknown";

export function setMcpVersion(version: string): void {
  _version = version;
}

export function getMcpVersion(): string {
  return _version;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type McpContentBlock = {
  type: "text";
  text: string;
  _meta?: Record<string, unknown>;
};

export type McpResponse = {
  content: Array<McpContentBlock>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

// ─── mcpLog ──────────────────────────────────────────────────────────────────

/**
 * Send a structured log message via the MCP server (no-op when server is undefined).
 */
export async function mcpLog(
  server: McpServer | undefined,
  message: string,
  level: "info" | "warning" | "error" = "info",
): Promise<void> {
  await server?.sendLoggingMessage({ level, data: message });
}

// ─── resolveServerForMcp ─────────────────────────────────────────────────────

/**
 * Resolve the target server for an MCP tool call.
 *
 * - If `params.server` is provided, delegates to `findServer` (by name or IP).
 * - If there is exactly one server in the list, returns it automatically.
 * - Otherwise returns undefined (caller should return an error response).
 */
export function resolveServerForMcp(
  params: { server?: string },
  servers: ServerRecord[],
): ServerRecord | undefined {
  if (params.server !== undefined) {
    return findServer(params.server);
  }
  if (servers.length === 1) {
    return servers[0];
  }
  return undefined;
}

// ─── mcpSuccess ──────────────────────────────────────────────────────────────

/** Default max result size for large MCP tool outputs (500K chars). */
const LARGE_RESULT_SIZE = 500_000;

/**
 * Wrap a success payload in the standard MCP response shape.
 *
 * Pass `largeResult: true` to annotate the content block with
 * `_meta["anthropic/maxResultSizeChars"]` (500K), preventing Claude Code
 * from truncating large outputs like audit JSON or evidence data.
 */
export function mcpSuccess(data: Record<string, unknown>, opts?: { largeResult?: boolean }): McpResponse {
  const block: McpContentBlock = {
    type: "text",
    text: JSON.stringify({ ...data, _kastell_version: _version }),
  };
  if (opts?.largeResult) {
    block._meta = { "anthropic/maxResultSizeChars": LARGE_RESULT_SIZE };
  }
  return {
    content: [block],
    // Wrap in { result: ... } so MCP SDK's normalizeObjectSchema sees z.object
    structuredContent: { result: data },
  };
}

// ─── mcpError ────────────────────────────────────────────────────────────────

/**
 * Wrap an error message (and optional metadata) in the standard MCP error response shape.
 */
export function mcpError(
  error: string,
  hint?: string,
  suggestedActions?: Array<{ command: string; reason: string }>,
): McpResponse {
  const payload: Record<string, unknown> = {
    error,
    ...(hint !== undefined ? { hint } : {}),
    ...(suggestedActions !== undefined ? { suggested_actions: suggestedActions } : {}),
  };
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    isError: true,
  };
}

// ─── Elicitation Helpers ─────────────────────────────────────────────────────

// ─── Elicitation Helpers ─────────────────────────────────────────────────────

import type { ElicitRequestFormParams } from "@modelcontextprotocol/sdk/types.js";

export type ElicitResult =
  | { status: "accepted"; content: Record<string, unknown> }
  | { status: "cancelled" }
  | { status: "unsupported" };

export function supportsElicitation(server: McpServer | undefined): boolean {
  if (!server) return false;
  try {
    const caps = (server.server as { getClientCapabilities?: () => Record<string, unknown> })
      .getClientCapabilities?.();
    return caps?.elicitation !== undefined;
  } catch {
    return false;
  }
}

export async function elicitMissingParams(
  server: McpServer | undefined,
  message: string,
  requestedSchema: object,
): Promise<ElicitResult> {
  if (!supportsElicitation(server)) {
    return { status: "unsupported" };
  }

  // SDK type: ElicitRequestFormParams — mode is optional (defaults to "form")
  const result = await server!.server.elicitInput({
    message,
    requestedSchema: requestedSchema as ElicitRequestFormParams["requestedSchema"],
  });

  if (result.action === "accept" && result.content) {
    return { status: "accepted", content: result.content as Record<string, unknown> };
  }
  return { status: "cancelled" };
}

// ─── requireProviderToken ─────────────────────────────────────────────────────

/**
 * Look up the API token for the given provider.
 *
 * Returns `{ token }` on success, or `{ error: McpResponse }` when no token
 * is configured so callers can do a simple discriminated-union check and
 * return the error response immediately.
 */
export function requireProviderToken(
  provider: string,
): { token: string } | { error: McpResponse } {
  const token = getProviderToken(provider);
  if (token) {
    return { token };
  }
  return {
    error: mcpError(
      `No API token found for ${provider}`,
      `Set ${provider.toUpperCase()}_TOKEN environment variable`,
    ),
  };
}
