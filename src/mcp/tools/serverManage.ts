import { z } from "zod";
import { getServers } from "../../utils/config.js";
import {
  isSafeMode,
  addServerRecord,
  removeServerRecord,
  destroyCloudServer,
} from "../../core/manage.js";
import { logSafeModeBlock } from "../../utils/safeMode.js";
import { mcpSuccess, mcpError, elicitMissingParams } from "../utils.js";
import { getErrorMessage, sanitizeStderr } from "../../utils/errorMapper.js";
import { SUPPORTED_PROVIDERS } from "../../constants.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupportedProvider } from "../../constants.js";

export const serverManageSchema = {
  action: z
    .enum(["add", "remove", "destroy"])
    .describe(
      "Action: 'add' register an existing server, 'remove' unregister from local config (server stays running), 'destroy' permanently delete from cloud provider AND local config",
    ),
  server: z
    .string()
    .optional()
    .describe("Server name or IP (required for 'remove' and 'destroy' actions)"),
  provider: z
    .enum(SUPPORTED_PROVIDERS)
    .optional()
    .describe(
      "Cloud provider: 'hetzner', 'digitalocean', 'vultr', 'linode' (required for 'add' action). If omitted and client supports elicitation, a form will be shown.",
    ),
  ip: z.string().optional().describe(
    "Server public IP address (required for 'add' action). If omitted and client supports elicitation, a form will be shown.",
  ),
  name: z
    .string()
    .optional()
    .describe(
      "Server name, 3-63 chars, lowercase alphanumeric and hyphens (required for 'add' action). If omitted and client supports elicitation, a form will be shown.",
    ),
  skipVerify: z
    .boolean()
    .default(false)
    .describe("Skip Coolify SSH verification when adding a server (only for 'add' action)"),
  mode: z
    .enum(["coolify", "dokploy", "bare"])
    .default("coolify")
    .describe("Server mode for 'add' action: 'coolify', 'dokploy', or 'bare'. Default: coolify"),
};

// ─── Output Schema ────────────────────────────────────────────────────────────

const serverManageAddOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  server: z.object({
    name: z.string(),
    ip: z.string(),
    provider: z.string(),
    id: z.string(),
    mode: z.string(),
  }),
  platformStatus: z.string().nullable(),
  suggested_actions: z.array(z.object({ command: z.string(), reason: z.string() })),
});

const serverManageRemoveOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  note: z.string(),
  server: z.object({
    name: z.string(),
    ip: z.string(),
    provider: z.string(),
  }),
  suggested_actions: z.array(z.object({ command: z.string(), reason: z.string() })),
});

const serverManageDestroyOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  cloudDeleted: z.boolean(),
  localRemoved: z.boolean(),
  note: z.string().optional(),
  server: z.object({
    name: z.string(),
    ip: z.string(),
    provider: z.string(),
  }),
  suggested_actions: z.array(z.object({ command: z.string(), reason: z.string() })),
});

export const serverManageOutputSchema = z.object({
  result: z.discriminatedUnion("action", [
    z.object({ action: z.literal("add") }).merge(serverManageAddOutputSchema),
    z.object({ action: z.literal("remove") }).merge(serverManageRemoveOutputSchema),
    z.object({ action: z.literal("destroy") }).merge(serverManageDestroyOutputSchema),
  ]),
});

export type ServerManageOutput = z.infer<typeof serverManageOutputSchema>;

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function handleServerManage(params: {
  action: "add" | "remove" | "destroy";
  server?: string;
  provider?: string;
  ip?: string;
  name?: string;
  skipVerify?: boolean;
  mode?: "coolify" | "dokploy" | "bare";
}, mcpServer?: McpServer): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  // Elicit missing params for 'add' action only
  if (params.action === "add") {
    const missing = {
      name: !params.name,
      ip: !params.ip,
      provider: !params.provider,
    };
    const hasMissing = Object.values(missing).some(Boolean);

    if (hasMissing) {
      const elicit = await elicitMissingParams(mcpServer, "Provide server registration details:", {
        type: "object",
        properties: {
          ...(missing.name ? {
            name: { type: "string", title: "Server Name", description: "3-63 chars, lowercase", minLength: 3, maxLength: 63 },
          } : {}),
          ...(missing.ip ? {
            ip: { type: "string", title: "IP Address", description: "Server public IPv4 address" },
          } : {}),
          ...(missing.provider ? {
            provider: {
              type: "string", title: "Cloud Provider",
              oneOf: [
                { const: "hetzner", title: "Hetzner" },
                { const: "digitalocean", title: "DigitalOcean" },
                { const: "vultr", title: "Vultr" },
                { const: "linode", title: "Linode" },
              ],
            },
          } : {}),
          mode: {
            type: "string", title: "Server Mode",
            oneOf: [
              { const: "coolify", title: "Coolify" },
              { const: "dokploy", title: "Dokploy" },
              { const: "bare", title: "Bare VPS" },
            ],
          },
        },
        required: [
          ...(missing.name ? ["name"] : []),
          ...(missing.ip ? ["ip"] : []),
          ...(missing.provider ? ["provider"] : []),
        ],
      });

      if (elicit.status === "cancelled") return mcpSuccess({ status: "cancelled", message: "Server registration cancelled by user." });
      if (elicit.status === "unsupported") {
        const missingFields = Object.entries(missing).filter(([, v]) => v).map(([k]) => k);
        return mcpError(
          `Required parameter(s) missing: ${missingFields.join(", ")}`,
          "Provide all required parameters for 'add' action.",
        );
      }

      params = {
        ...params,
        name: (elicit.content.name as string) ?? params.name,
        ip: (elicit.content.ip as string) ?? params.ip,
        provider: (elicit.content.provider as SupportedProvider) ?? params.provider,
        mode: (elicit.content.mode as "coolify" | "dokploy" | "bare") ?? params.mode,
      };
    }
  }

  try {
    switch (params.action) {
      case "add": {
        if (!params.provider) {
          return mcpError(
            "Missing required parameter: provider",
            "Specify provider: 'hetzner', 'digitalocean', 'vultr', or 'linode'",
          );
        }
        if (!params.ip) {
          return mcpError(
            "Missing required parameter: ip",
            "Specify the server's public IP address",
          );
        }
        if (!params.name) {
          return mcpError(
            "Missing required parameter: name",
            "Specify a server name (3-63 chars, lowercase, alphanumeric and hyphens)",
          );
        }

        const mode = params.mode ?? "coolify";

        const result = await addServerRecord({
          provider: params.provider,
          ip: params.ip,
          name: params.name,
          skipVerify: params.skipVerify ?? false,
          mode,
        });

        if (!result.success) {
          return mcpError(result.error, undefined, [
            { command: "server_info { action: 'list' }", reason: "Check existing servers" },
          ]);
        }

        const serverName = result.server.name;
        const suggestedActions =
          mode === "bare"
            ? [
                {
                  command: `server_info { action: 'status', server: '${serverName}' }`,
                  reason: "Check server status",
                },
                {
                  command: `server_secure { action: 'secure-setup', server: '${serverName}' }`,
                  reason: "Harden SSH security + install fail2ban",
                },
                {
                  command: `server_logs { action: 'logs', server: '${serverName}' }`,
                  reason: "View server logs",
                },
              ]
            : [
                {
                  command: `server_info { action: 'status', server: '${serverName}' }`,
                  reason: "Check server status",
                },
                {
                  command: `server_info { action: 'health', server: '${serverName}' }`,
                  reason: "Check Coolify health",
                },
                {
                  command: `server_logs { action: 'logs', server: '${serverName}' }`,
                  reason: "View server logs",
                },
              ];

        return mcpSuccess({
          action: "add" as const,
          success: true,
          message: `Server "${serverName}" added successfully`,
          server: {
            name: serverName,
            ip: result.server.ip,
            provider: result.server.provider,
            id: result.server.id,
            mode,
          },
          platformStatus: result.platformStatus,
          suggested_actions: suggestedActions,
        });
      }

      case "remove": {
        if (isSafeMode()) {
          logSafeModeBlock("server-manage", { category: "destructive" });
          return mcpError(
            "Remove is disabled in SAFE_MODE",
            "Set KASTELL_SAFE_MODE=false to enable server removal from local config.",
          );
        }
        if (!params.server) {
          const servers = getServers();
          if (servers.length === 0) {
            return mcpError("No servers found", undefined, [
              { command: "kastell init", reason: "Deploy a server first" },
            ]);
          }
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "Missing required parameter: server",
                  available_servers: servers.map((s) => ({ name: s.name, ip: s.ip })),
                  hint: "Specify which server to remove by name or IP",
                }),
              },
            ],
            isError: true,
          };
        }

        const result = await removeServerRecord(params.server);

        if (!result.success) {
          const servers = getServers();
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: result.error,
                  available_servers: servers.map((s) => s.name),
                }),
              },
            ],
            isError: true,
          };
        }

        return mcpSuccess({
          action: "remove" as const,
          success: true,
          message: `Server "${result.server!.name}" removed from local config`,
          note: "The cloud server is still running. Use 'destroy' to delete it from the provider.",
          server: {
            name: result.server!.name,
            ip: result.server!.ip,
            provider: result.server!.provider,
          },
          suggested_actions: [
            { command: "server_info { action: 'list' }", reason: "View remaining servers" },
          ],
        });
      }

      case "destroy": {
        // SAFE_MODE check
        if (isSafeMode()) {
          logSafeModeBlock("server-destroy", { category: "destructive" });
          return mcpError(
            "Destroy is disabled in SAFE_MODE (enabled by default for safety)",
            "Set KASTELL_SAFE_MODE=false to enable destructive operations. WARNING: This will permanently delete the server from the cloud provider.",
            [
              {
                command: `server_manage { action: 'remove', server: '${params.server ?? ""}' }`,
                reason: "Remove from local config only (non-destructive)",
              },
            ],
          );
        }

        if (!params.server) {
          const servers = getServers();
          if (servers.length === 0) {
            return mcpError("No servers found", undefined, [
              { command: "kastell init", reason: "Deploy a server first" },
            ]);
          }
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "Missing required parameter: server",
                  available_servers: servers.map((s) => ({
                    name: s.name,
                    ip: s.ip,
                    provider: s.provider,
                  })),
                  hint: "Specify which server to destroy by name or IP",
                  warning: "This will PERMANENTLY DELETE the server from the cloud provider",
                }),
              },
            ],
            isError: true,
          };
        }

        const result = await destroyCloudServer(params.server);

        if (!result.success) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: result.error,
                  ...(result.hint ? { hint: result.hint } : {}),
                  ...(result.server
                    ? {
                        server: {
                          name: result.server.name,
                          ip: result.server.ip,
                          provider: result.server.provider,
                        },
                      }
                    : {}),
                  suggested_actions: [
                    {
                      command: `server_manage { action: 'remove', server: '${params.server}' }`,
                      reason: "Remove from local config only",
                    },
                    { command: "kastell doctor --check-tokens", reason: "Verify API tokens" },
                  ],
                }),
              },
            ],
            isError: true,
          };
        }

        return mcpSuccess({
          action: "destroy" as const,
          success: true,
          message: `Server "${result.server!.name}" destroyed`,
          cloudDeleted: result.cloudDeleted,
          localRemoved: result.localRemoved,
          ...(result.hint ? { note: result.hint } : {}),
          server: {
            name: result.server!.name,
            ip: result.server!.ip,
            provider: result.server!.provider,
          },
          suggested_actions: [
            { command: "server_info { action: 'list' }", reason: "Verify server was removed" },
          ],
        });
      }
      default: {
        return mcpError(`Unknown action: ${params.action as string}`);
      }
    }
  } catch (error: unknown) {
    return mcpError(sanitizeStderr(getErrorMessage(error)));
  }
}
