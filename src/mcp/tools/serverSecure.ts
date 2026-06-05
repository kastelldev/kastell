import { z } from "zod";
import { getServers } from "../../utils/config.js";
import {
  resolveServerForMcp,
  mcpError,
  mcpSuccess,
  mcpLog,
  type McpResponse,
  elicitMissingParams,
} from "../utils.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireManagedMode } from "../../utils/modeGuard.js";
import { getErrorMessage, sanitizeStderr } from "../../utils/errorMapper.js";
import { isSafeMode } from "../../core/manage.js";
import { logSafeModeBlock } from "../../utils/safeMode.js";
import {
  handleSecureSetup,
  handleSecureAudit,
  handleFirewallSetup,
  handleFirewallAdd,
  handleFirewallRemove,
  handleFirewallStatus,
  handleDomainSet,
  handleDomainRemove,
  handleDomainCheck,
  handleDomainInfo,
} from "./serverSecure.handlers.js";
import { SECURE_ACTIONS, serverSecureActionSchema } from "./serverSecure.actions.js";

export const serverSecureSchema = {
  action: serverSecureActionSchema.describe(
    "Action: Secure: 'secure-setup' hardens SSH + installs fail2ban, 'secure-audit' runs security audit with score. Firewall: 'firewall-setup' installs UFW, 'firewall-add'/'firewall-remove' manage port rules, 'firewall-status' shows rules. Domain: 'domain-set'/'domain-remove' manage FQDN, 'domain-check' verifies DNS, 'domain-info' shows current FQDN.",
  ),
  server: z.string().optional().describe(
    "Server name or IP. Auto-selected if only one server exists.",
  ),
  port: z.number().min(1).max(65535).optional().describe(
    "Port number. Required for firewall-add/remove. Optional SSH port for secure-setup.",
  ),
  protocol: z.enum(["tcp", "udp"]).default("tcp").describe(
    "Protocol for firewall rules. Default: tcp.",
  ),
  domain: z.string().optional().describe(
    "Domain name. Required for domain-set and domain-check.",
  ),
  ssl: z.boolean().default(true).describe(
    "Enable SSL (https) for domain. Default: true.",
  ),
};

type Action = z.infer<typeof serverSecureSchema.action>;

// ─── Output Schema ────────────────────────────────────────────────────────────

const secureSetupOutputSchema = z.object({
  success: z.boolean(),
  server: z.string(),
  ip: z.string(),
  message: z.string(),
  sshHardening: z.boolean(),
  fail2ban: z.boolean(),
  sshKeyCount: z.number(),
  hint: z.string().optional(),
  suggested_actions: z.array(z.object({ command: z.string(), reason: z.string() })),
});

const secureAuditOutputSchema = z.object({
  server: z.string(),
  ip: z.string(),
  score: z.number(),
  maxScore: z.number(),
  checks: z.object({
    passwordAuth: z.boolean(),
    rootLogin: z.boolean(),
    fail2ban: z.boolean(),
    sshPort: z.boolean(),
  }),
  suggested_actions: z.array(z.object({ command: z.string(), reason: z.string() })),
});

const firewallSetupOutputSchema = z.object({
  success: z.boolean(),
  server: z.string(),
  ip: z.string(),
  message: z.string(),
  suggested_actions: z.array(z.object({ command: z.string(), reason: z.string() })),
});

const firewallAddOutputSchema = z.object({
  success: z.boolean(),
  server: z.string(),
  ip: z.string(),
  message: z.string(),
  suggested_actions: z.array(z.object({ command: z.string(), reason: z.string() })),
});

const firewallRemoveOutputSchema = z.object({
  success: z.boolean(),
  server: z.string(),
  ip: z.string(),
  message: z.string(),
  warning: z.string().optional(),
  suggested_actions: z.array(z.object({ command: z.string(), reason: z.string() })),
});

const firewallRuleSchema = z.object({
  port: z.string(),
  proto: z.string(),
  action: z.string(),
  from: z.string(),
});

const firewallStatusOutputSchema = z.object({
  server: z.string(),
  ip: z.string(),
  active: z.boolean(),
  rules: z.array(firewallRuleSchema),
  ruleCount: z.number(),
  suggested_actions: z.array(z.object({ command: z.string(), reason: z.string() })),
});

const domainSetOutputSchema = z.object({
  success: z.boolean(),
  server: z.string(),
  ip: z.string(),
  message: z.string(),
  url: z.string(),
  suggested_actions: z.array(z.object({ command: z.string(), reason: z.string() })),
});

const domainRemoveOutputSchema = z.object({
  success: z.boolean(),
  server: z.string(),
  ip: z.string(),
  message: z.string(),
  url: z.string(),
  suggested_actions: z.array(z.object({ command: z.string(), reason: z.string() })),
});

const domainCheckOutputSchema = z.object({
  server: z.string(),
  ip: z.string(),
  domain: z.string(),
  resolvedIp: z.string(),
  match: z.boolean(),
  hint: z.string().optional(),
  suggested_actions: z.array(z.object({ command: z.string(), reason: z.string() })),
});

const domainInfoOutputSchema = z.object({
  server: z.string(),
  ip: z.string(),
  fqdn: z.string().nullable(),
  message: z.string(),
  suggested_actions: z.array(z.object({ command: z.string(), reason: z.string() })),
});

export const serverSecureOutputSchema = z.object({
  result: z.discriminatedUnion("action", [
    z.object({ action: z.literal("secure-setup") }).merge(secureSetupOutputSchema),
    z.object({ action: z.literal("audit") }).merge(secureAuditOutputSchema),
    z.object({ action: z.literal("secure-audit") }).merge(secureAuditOutputSchema),
    z.object({ action: z.literal("firewall-setup") }).merge(firewallSetupOutputSchema),
    z.object({ action: z.literal("firewall-add") }).merge(firewallAddOutputSchema),
    z.object({ action: z.literal("firewall-remove") }).merge(firewallRemoveOutputSchema),
    z.object({ action: z.literal("firewall-status") }).merge(firewallStatusOutputSchema),
    z.object({ action: z.literal("domain-set") }).merge(domainSetOutputSchema),
    z.object({ action: z.literal("domain-remove") }).merge(domainRemoveOutputSchema),
    z.object({ action: z.literal("domain-check") }).merge(domainCheckOutputSchema),
    z.object({ action: z.literal("domain-info") }).merge(domainInfoOutputSchema),
  ]),
});

export type ServerSecureOutput = z.infer<typeof serverSecureOutputSchema>;

/** Actions that only read state — never blocked by SAFE_MODE */
const READ_ONLY_ACTIONS: readonly Action[] = ["audit", "secure-audit", "firewall-status", "domain-check", "domain-info"];

export async function handleServerSecure(params: {
  action: Action;
  server?: string;
  port?: number;
  protocol?: "tcp" | "udp";
  domain?: string;
  ssl?: boolean;
}, mcpServer?: McpServer): Promise<McpResponse> {
  if (["firewall-add", "firewall-remove"].includes(params.action) && !params.port) {
    const elicit = await elicitMissingParams(mcpServer, `Provide port for ${params.action}:`, {
      type: "object",
      properties: {
        port: { type: "number", title: "Port", description: "Port number (1-65535)", minimum: 1, maximum: 65535 },
        protocol: { type: "string", title: "Protocol", oneOf: [{ const: "tcp", title: "TCP" }, { const: "udp", title: "UDP" }] },
      },
      required: ["port"],
    });

    if (elicit.status === "cancelled") return mcpSuccess({ status: "cancelled", message: `${params.action} cancelled by user.` });
    if (elicit.status === "unsupported") return mcpError(`Parameter 'port' is required for ${params.action}`);
    params = { ...params, port: elicit.content.port as number, protocol: (elicit.content.protocol as "tcp" | "udp") ?? params.protocol };
  }

  if (params.action === "domain-set" && !params.domain) {
    const elicit = await elicitMissingParams(mcpServer, "Provide domain for domain-set:", {
      type: "object",
      properties: {
        domain: { type: "string", title: "Domain", description: "Domain name (e.g. example.com)" },
      },
      required: ["domain"],
    });

    if (elicit.status === "cancelled") return mcpSuccess({ status: "cancelled", message: `${params.action} cancelled by user.` });
    if (elicit.status === "unsupported") return mcpError("Parameter 'domain' is required for domain-set");
    params = { ...params, domain: elicit.content.domain as string };
  }

  try {
    const servers = getServers();
    if (servers.length === 0) {
      return mcpError("No servers found", undefined, [
        { command: "kastell init", reason: "Deploy a server first" },
      ]);
    }

    const server = resolveServerForMcp(params, servers);
    if (!server) {
      if (params.server) {
        return mcpError(
          `Server not found: ${params.server}`,
          `Available servers: ${servers.map((s) => s.name).join(", ")}`,
        );
      }
      return mcpError(
        "Multiple servers found. Specify which server to use.",
        `Available: ${servers.map((s) => s.name).join(", ")}`,
      );
    }

    // SAFE_MODE guard: block mutating actions, allow read-only
    if (!READ_ONLY_ACTIONS.includes(params.action) && isSafeMode()) {
      logSafeModeBlock("secure-modify", { category: "destructive" });
      return mcpError(
        `${params.action} is disabled in SAFE_MODE`,
        "Set KASTELL_SAFE_MODE=false to enable server modifications. Read-only actions (audit, secure-audit, firewall-status, domain-check, domain-info) remain available.",
      );
    }

    const domainActions = ["domain-set", "domain-remove", "domain-check", "domain-info"];
    if (domainActions.includes(params.action)) {
      const modeError = requireManagedMode(server, params.action);
      if (modeError) {
        return mcpError(modeError, "Domain management requires a managed platform (Coolify or Dokploy). Use SSH for bare server DNS configuration.");
      }
    }

    await mcpLog(mcpServer, `Applying ${params.action} on ${server.name}`);

    switch (params.action) {
      case "secure-setup":   return handleSecureSetup(server, params.port);
      case "secure-audit":
        console.warn("[kastell] MCP action 'secure-audit' is deprecated; use 'audit'. Removal scheduled for v2.4.");
        // fallthrough to "audit"
      case "audit":          return handleSecureAudit(server);
      case "firewall-setup": return handleFirewallSetup(server);
      case "firewall-add":   return handleFirewallAdd(server, params.port, params.protocol || "tcp");
      case "firewall-remove": return handleFirewallRemove(server, params.port, params.protocol || "tcp");
      case "firewall-status": return handleFirewallStatus(server);
      case "domain-set":    return handleDomainSet(server, params.domain, params.ssl ?? true);
      case "domain-remove": return handleDomainRemove(server);
      case "domain-check":  return handleDomainCheck(server, params.domain);
      case "domain-info":   return handleDomainInfo(server);
      default: {
        return mcpError(`Unknown action: ${params.action as string}`);
      }
    }
  } catch (error: unknown) {
    return mcpError(sanitizeStderr(getErrorMessage(error)));
  }
}
