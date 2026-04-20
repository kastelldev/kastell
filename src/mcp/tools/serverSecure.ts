import { z } from "zod";
import { getServers } from "../../utils/config.js";
import {
  resolveServerForMcp,
  mcpError,
  mcpLog,
  type McpResponse,
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

export const serverSecureSchema = {
  action: z.enum([
    "secure-setup", "secure-audit",
    "firewall-setup", "firewall-add", "firewall-remove", "firewall-status",
    "domain-set", "domain-remove", "domain-check", "domain-info",
  ]).describe(
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

/** Actions that only read state — never blocked by SAFE_MODE */
const READ_ONLY_ACTIONS: readonly Action[] = ["secure-audit", "firewall-status", "domain-check", "domain-info"];

export async function handleServerSecure(params: {
  action: Action;
  server?: string;
  port?: number;
  protocol?: "tcp" | "udp";
  domain?: string;
  ssl?: boolean;
}, mcpServer?: McpServer): Promise<McpResponse> {
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
        "Set KASTELL_SAFE_MODE=false to enable server modifications. Read-only actions (secure-audit, firewall-status, domain-check, domain-info) remain available.",
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
      case "secure-audit":   return handleSecureAudit(server);
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
