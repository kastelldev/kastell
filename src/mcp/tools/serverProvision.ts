import { z } from "zod";
import { isSafeMode } from "../../core/manage.js";
import { logSafeModeBlock } from "../../utils/safeMode.js";
import { provisionServer, ProvisionPersistenceError, toProvisionPublicDto } from "../../core/provision.js";
import { mcpSuccess, mcpError, mcpLog, elicitMissingParams, ELICIT_PROVIDER_SCHEMA, ELICIT_SERVER_NAME_SCHEMA } from "../utils.js";
import { getErrorMessage, sanitizeStderr } from "../../utils/errorMapper.js";
import { SUPPORTED_PROVIDERS } from "../../constants.js";
import type { SupportedProvider } from "../../constants.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ─── Output Schema ───────────────────────────────────────────────────────────


const provisionServerRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  ip: z.string(),
  region: z.string(),
  size: z.string(),
  mode: z.string(),
  createdAt: z.string(),
});

export const serverProvisionOutputSchema = z.object({
  result: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("created-persisted"),
      success: z.boolean().optional(),
      message: z.string().optional(),
      server: provisionServerRecordSchema,
      replacedStaleServer: provisionServerRecordSchema.optional(),
      readiness: z.object({
        status: z.enum(["pending", "ready", "unknown"]),
        message: z.string().optional(),
      }).optional(),
      hint: z.string().optional(),
      suggested_actions: z.array(z.object({ command: z.string(), reason: z.string() })).optional(),
    }),
    z.object({
      kind: z.literal("created-orphan"),
      provider: z.enum(SUPPORTED_PROVIDERS),
      providerId: z.string(),
      name: z.string(),
      ip: z.string(),
      suggestedCommand: z.string(),
    }),
    z.object({
      kind: z.literal("cancelled"),
      status: z.literal("cancelled"),
      message: z.string(),
    }),
  ]),
});

export type ServerProvisionOutput = z.infer<typeof serverProvisionOutputSchema>;

// ─── Schema ──────────────────────────────────────────────────────────────────

export const serverProvisionSchema = {
  provider: z.enum(SUPPORTED_PROVIDERS).optional().describe(
    "Cloud provider to create server on. If omitted and client supports elicitation, a form will be shown.",
  ),
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
  name: z.string().optional().describe(
    "Server hostname, 3-63 chars, lowercase, starts with letter, only alphanumeric and hyphens, ends with letter or number. If omitted and client supports elicitation, a form will be shown.",
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

export async function handleServerProvision(
  params: {
    provider?: SupportedProvider;
    region?: string;
    size?: string;
    name?: string;
    template?: "starter" | "production" | "dev";
    mode?: "coolify" | "dokploy" | "bare";
  },
  mcpServer?: McpServer,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const mode = params.mode ?? "coolify";

  let provider = params.provider;
  let name = params.name;

  if (!provider || !name) {
    const elicit = await elicitMissingParams(mcpServer, "Provide server provisioning details:", {
      type: "object",
      properties: {
        ...(!provider ? { provider: ELICIT_PROVIDER_SCHEMA } : {}),
        ...(!name ? { name: ELICIT_SERVER_NAME_SCHEMA } : {}),
      },
      required: [
        ...(!provider ? ["provider"] : []),
        ...(!name ? ["name"] : []),
      ],
    });

    if (elicit.status === "cancelled") {
      return mcpSuccess({
        kind: "cancelled",
        status: "cancelled",
        message: "Provisioning cancelled by user.",
      });
    }
    if (elicit.status === "unsupported") {
      const missing = [!provider && "provider", !name && "name"].filter(Boolean);
      return mcpError(
        `Required parameter(s) missing: ${missing.join(", ")}`,
        "Provide all required parameters, or use a client that supports elicitation.",
      );
    }

    provider = (elicit.content.provider as SupportedProvider) ?? provider;
    name = (elicit.content.name as string) ?? name;
  }

  // SAFE_MODE guard — check AFTER elicitation (spec requirement)
  if (isSafeMode()) {
    logSafeModeBlock("provision", { category: "destructive" });
    return mcpError(
      "Provision is disabled in SAFE_MODE",
      "Set KASTELL_SAFE_MODE=false to enable server provisioning. WARNING: This creates billable cloud resources.",
    );
  }

  await mcpLog(mcpServer, `Provisioning ${provider} server: ${name}`);

  try {
    const result = await provisionServer(
      {
        provider: provider!,
        region: params.region,
        size: params.size,
        name: name!,
        template: params.template,
        mode,
      },
      { readinessPolicy: "defer" },
    );

    if (!result.success) {
      return mcpError(result.error ?? "Provision failed", result.hint, [
        {
          command: "server_info { action: 'list' }",
          reason: "Check existing servers",
        },
      ]);
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
              reason:
                "Check Coolify health (wait 3-5 minutes after creation for Coolify to initialize)",
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

    const data = {
      kind: "created-persisted" as const,
      success: true,
      message: `Server "${server.name}" cloud creation and local registration completed on ${server.provider}; readiness may remain pending.`,
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
      readiness: result.readiness ?? { status: "pending" },
      ...(result.hint ? { hint: result.hint } : {}),
      suggested_actions: suggestedActions,
    };
    return mcpSuccess(data);
  } catch (error: unknown) {
    if (error instanceof ProvisionPersistenceError) {
      // Task 3 wire-up: when the core layer attaches an internalResult (the
      // orphan case), project it through the public DTO. The DTO strips
      // `cause` and any token/responseBody/apiToken properties the cause may
      // carry, so nothing internal leaks to MCP clients. The success-shaped
      // response carries a `kind` discriminator the client can switch on.
      if (error.internalResult) {
        return mcpSuccess(toProvisionPublicDto(error.internalResult));
      }
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: sanitizeStderr(error.message),
            provider: error.provider,
            serverId: error.serverId,
            serverName: error.serverName,
            ip: error.ip,
            warning: error.warning,
            recovery: error.recovery,
            suggested_actions: [
              {
                command: "server_info { action: 'list' }",
                reason: "Check whether a local record exists",
              },
            ],
          }),
        }],
        isError: true,
      };
    }
    return mcpError(sanitizeStderr(getErrorMessage(error)));
  }
}
