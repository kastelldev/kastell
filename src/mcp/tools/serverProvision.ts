import { z } from "zod";
import { isSafeMode } from "../../core/manage.js";
import { provisionServer } from "../../core/provision.js";
import { mcpSuccess, mcpError, mcpLog } from "../utils.js";
import { getErrorMessage, sanitizeStderr } from "../../utils/errorMapper.js";
import { SUPPORTED_PROVIDERS } from "../../constants.js";
import type { SupportedProvider } from "../../constants.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ─── Schema ──────────────────────────────────────────────────────────────────

export const serverProvisionSchema = {
  provider: z
    .enum(SUPPORTED_PROVIDERS)
    .describe("Cloud provider to create server on"),
  region: z
    .string()
    .optional()
    .describe(
      "Region/location ID (e.g. 'nbg1' for Hetzner, 'fra1' for DigitalOcean, 'ewr' for Vultr, 'us-east' for Linode). Uses template defaults if omitted",
    ),
  size: z
    .string()
    .optional()
    .describe(
      "Server type/plan ID (e.g. 'cax11' for Hetzner, 's-2vcpu-2gb' for DigitalOcean). Uses template defaults if omitted",
    ),
  name: z
    .string()
    .describe(
      "Server hostname, 3-63 chars, lowercase, starts with letter, only alphanumeric and hyphens, ends with letter or number",
    ),
  template: z
    .enum(["starter", "production", "dev"])
    .default("starter")
    .describe(
      "Template for default region/size. 'starter' = cheapest, 'production' = more resources, 'dev' = development. Explicit region/size override template defaults. Default: starter",
    ),
  mode: z
    .enum(["coolify", "dokploy", "bare"])
    .default("coolify")
    .describe(
      "Server mode: 'coolify' installs Coolify, 'dokploy' installs Dokploy, 'bare' provisions generic VPS. Default: coolify",
    ),
};

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function handleServerProvision(params: {
  provider: SupportedProvider;
  region?: string;
  size?: string;
  name: string;
  template?: "starter" | "production" | "dev";
  mode?: "coolify" | "dokploy" | "bare";
}, mcpServer?: McpServer): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const mode = params.mode ?? "coolify";

  // SAFE_MODE guard
  if (isSafeMode()) {
    return mcpError(
      "Provision is disabled in SAFE_MODE",
      "Set KASTELL_SAFE_MODE=false to enable server provisioning. WARNING: This creates billable cloud resources.",
    );
  }

  await mcpLog(mcpServer, `Provisioning ${params.provider} server: ${params.name}`);

  try {
    const result = await provisionServer({
      provider: params.provider,
      region: params.region,
      size: params.size,
      name: params.name,
      template: params.template,
      mode,
    });

    if (!result.success) {
      return mcpError(
        result.error ?? "Provision failed",
        result.hint,
        [
          {
            command: "server_info { action: 'list' }",
            reason: "Check existing servers",
          },
        ],
      );
    }

    if (!result.server) {
      return mcpError("Unexpected: server record missing");
    }

    const server = result.server;

    const suggestedActions =
      mode === "bare"
        ? [
            {
              command: `ssh root@${server.ip}`,
              reason: "Connect to your bare server via SSH",
            },
            {
              command: `server_secure { action: 'secure-setup', server: '${server.name}' }`,
              reason: "Harden SSH security + install fail2ban",
            },
            {
              command: `server_secure { action: 'firewall-setup', server: '${server.name}' }`,
              reason: "Setup UFW firewall",
            },
            {
              command: `server_info { action: 'status', server: '${server.name}' }`,
              reason: "Check cloud provider status",
            },
          ]
        : [
            {
              command: `server_info { action: 'health', server: '${server.name}' }`,
              reason: "Check Coolify health (wait 3-5 minutes after creation for Coolify to initialize)",
            },
            {
              command: `server_secure { action: 'secure-setup', server: '${server.name}' }`,
              reason: "Harden SSH security + install fail2ban",
            },
            {
              command: `server_secure { action: 'firewall-setup', server: '${server.name}' }`,
              reason: "Setup UFW firewall with Coolify ports",
            },
            {
              command: `server_info { action: 'status', server: '${server.name}' }`,
              reason: "Check cloud provider status",
            },
          ];

    await mcpLog(mcpServer, "Provision complete");

    return mcpSuccess({
      success: true,
      message: `Server "${server.name}" provisioned on ${server.provider}`,
      server: {
        id: server.id,
        name: server.name,
        provider: server.provider,
        ip: server.ip,
        region: server.region,
        size: server.size,
        mode,
        createdAt: server.createdAt,
      },
      ...(result.hint ? { hint: result.hint } : {}),
      suggested_actions: suggestedActions,
    });
  } catch (error: unknown) {
    return mcpError(
      sanitizeStderr(getErrorMessage(error)),
    );
  }
}
