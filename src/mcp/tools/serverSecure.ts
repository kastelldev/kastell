import { z } from "zod";
import { getServers } from "../../utils/config.js";
import {
  applySecureSetup,
  runSecureAudit,
} from "../../core/secure.js";
import {
  setupFirewall,
  addFirewallRule,
  removeFirewallRule,
  getFirewallStatus,
  getPortsForPlatform,
} from "../../core/firewall.js";
import { resolvePlatform } from "../../adapters/factory.js";
import {
  setDomain,
  removeDomain,
  getDomain,
  checkDns,
} from "../../core/domain.js";
import {
  resolveServerForMcp,
  mcpSuccess,
  mcpError,
  type McpResponse,
} from "../utils.js";
import { requireManagedMode } from "../../utils/modeGuard.js";
import { getErrorMessage } from "../../utils/errorMapper.js";

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

export async function handleServerSecure(params: {
  action: Action;
  server?: string;
  port?: number;
  protocol?: "tcp" | "udp";
  domain?: string;
  ssl?: boolean;
}): Promise<McpResponse> {
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

    const domainActions = ["domain-set", "domain-remove", "domain-check", "domain-info"];
    if (domainActions.includes(params.action)) {
      const modeError = requireManagedMode(server, params.action);
      if (modeError) {
        return mcpError(modeError, "Domain management requires Coolify. Use SSH for bare server DNS configuration.");
      }
    }

    switch (params.action) {
      case "secure-setup": {
        const result = await applySecureSetup(server.ip, params.port ? { port: params.port } : undefined);

        if (!result.success) {
          return {
            content: [{ type: "text", text: JSON.stringify({
              server: server.name,
              ip: server.ip,
              error: result.error,
              ...(result.hint ? { hint: result.hint } : {}),
              suggested_actions: [
                { command: `server_info { action: 'health', server: '${server.name}' }`, reason: "Check if server is reachable" },
              ],
            }) }],
            isError: true,
          };
        }

        const message = result.fail2ban
          ? "Security setup complete: SSH hardened + fail2ban active"
          : "Security setup partially complete: SSH hardened, fail2ban failed";

        return {
          content: [{ type: "text", text: JSON.stringify({
            success: true,
            server: server.name,
            ip: server.ip,
            message,
            sshHardening: result.sshHardening,
            fail2ban: result.fail2ban,
            sshKeyCount: result.sshKeyCount,
            ...(result.hint ? { hint: result.hint } : {}),
            suggested_actions: [
              { command: `server_secure { action: 'secure-audit', server: '${server.name}' }`, reason: "Verify security configuration" },
            ],
          }) }],
          ...(!result.fail2ban ? { isError: true } : {}),
        };
      }

      case "secure-audit": {
        const result = await runSecureAudit(server.ip);

        if (result.error) {
          return {
            content: [{ type: "text", text: JSON.stringify({
              server: server.name,
              ip: server.ip,
              error: result.error,
              ...(result.hint ? { hint: result.hint } : {}),
            }) }],
            isError: true,
          };
        }

        const suggestedActions = result.score < 100
          ? [{ command: `server_secure { action: 'secure-setup', server: '${server.name}' }`, reason: "Improve security score" }]
          : [{ command: `server_secure { action: 'firewall-status', server: '${server.name}' }`, reason: "Check firewall configuration" }];

        return mcpSuccess({
          server: server.name,
          ip: server.ip,
          score: result.score,
          maxScore: 100,
          checks: {
            passwordAuth: result.audit.passwordAuth,
            rootLogin: result.audit.rootLogin,
            fail2ban: result.audit.fail2ban,
            sshPort: result.audit.sshPort,
          },
          suggested_actions: suggestedActions,
        });
      }

      case "firewall-setup": {
        const platform = resolvePlatform(server);
        const result = await setupFirewall(server.ip, platform);

        if (!result.success) {
          return {
            content: [{ type: "text", text: JSON.stringify({
              server: server.name,
              ip: server.ip,
              error: result.error,
              ...(result.hint ? { hint: result.hint } : {}),
            }) }],
            isError: true,
          };
        }

        const ports = getPortsForPlatform(platform);
        const platformLabel = platform ?? "bare";
        return mcpSuccess({
          success: true,
          server: server.name,
          ip: server.ip,
          message: `UFW enabled with ${platformLabel} ports (${ports.join(", ")}) + SSH (22)`,
          suggested_actions: [
            { command: `server_secure { action: 'firewall-status', server: '${server.name}' }`, reason: "Verify firewall rules" },
          ],
        });
      }

      case "firewall-add": {
        if (params.port === undefined) {
          return mcpError(
            "Port is required for firewall-add action",
            "Specify a port number (1-65535)",
          );
        }

        const result = await addFirewallRule(server.ip, params.port, params.protocol || "tcp");

        if (!result.success) {
          return {
            content: [{ type: "text", text: JSON.stringify({
              server: server.name,
              ip: server.ip,
              error: result.error,
              ...(result.hint ? { hint: result.hint } : {}),
            }) }],
            isError: true,
          };
        }

        return mcpSuccess({
          success: true,
          server: server.name,
          ip: server.ip,
          message: `Port ${params.port}/${params.protocol || "tcp"} opened`,
          suggested_actions: [
            { command: `server_secure { action: 'firewall-status', server: '${server.name}' }`, reason: "Verify firewall rules" },
          ],
        });
      }

      case "firewall-remove": {
        if (params.port === undefined) {
          return mcpError(
            "Port is required for firewall-remove action",
            "Specify a port number (1-65535)",
          );
        }

        const platform = resolvePlatform(server);
        const result = await removeFirewallRule(server.ip, params.port, params.protocol || "tcp", platform);

        if (!result.success) {
          return {
            content: [{ type: "text", text: JSON.stringify({
              server: server.name,
              ip: server.ip,
              error: result.error,
              ...(result.hint ? { hint: result.hint } : {}),
              ...(result.warning ? { warning: result.warning } : {}),
            }) }],
            isError: true,
          };
        }

        return mcpSuccess({
          success: true,
          server: server.name,
          ip: server.ip,
          message: `Port ${params.port}/${params.protocol || "tcp"} closed`,
          ...(result.warning ? { warning: result.warning } : {}),
          suggested_actions: [
            { command: `server_secure { action: 'firewall-status', server: '${server.name}' }`, reason: "Verify firewall rules" },
          ],
        });
      }

      case "firewall-status": {
        const result = await getFirewallStatus(server.ip);

        if (result.error) {
          return {
            content: [{ type: "text", text: JSON.stringify({
              server: server.name,
              ip: server.ip,
              error: result.error,
              ...(result.hint ? { hint: result.hint } : {}),
            }) }],
            isError: true,
          };
        }

        const suggestedActions = !result.status.active
          ? [{ command: `server_secure { action: 'firewall-setup', server: '${server.name}' }`, reason: "Enable firewall" }]
          : [{ command: `server_secure { action: 'firewall-add', server: '${server.name}', port: 3000 }`, reason: "Open additional ports if needed" }];

        return mcpSuccess({
          server: server.name,
          ip: server.ip,
          active: result.status.active,
          rules: result.status.rules,
          ruleCount: result.status.rules.length,
          suggested_actions: suggestedActions,
        });
      }

      case "domain-set": {
        if (!params.domain) {
          return mcpError(
            "Domain is required for domain-set action",
            "Specify a domain name (e.g., coolify.example.com)",
          );
        }

        const result = await setDomain(server.ip, params.domain, params.ssl ?? true);

        if (!result.success) {
          return {
            content: [{ type: "text", text: JSON.stringify({
              server: server.name,
              ip: server.ip,
              error: result.error,
              ...(result.hint ? { hint: result.hint } : {}),
            }) }],
            isError: true,
          };
        }

        const protocol = (params.ssl ?? true) ? "https" : "http";
        return mcpSuccess({
          success: true,
          server: server.name,
          ip: server.ip,
          message: `Domain set to ${params.domain}`,
          url: `${protocol}://${params.domain}`,
          suggested_actions: [
            { command: `server_secure { action: 'domain-check', server: '${server.name}', domain: '${params.domain}' }`, reason: "Verify DNS points to this server" },
            { command: `server_info { action: 'health', server: '${server.name}' }`, reason: "Verify Coolify is accessible" },
          ],
        });
      }

      case "domain-remove": {
        const result = await removeDomain(server.ip);

        if (!result.success) {
          return {
            content: [{ type: "text", text: JSON.stringify({
              server: server.name,
              ip: server.ip,
              error: result.error,
              ...(result.hint ? { hint: result.hint } : {}),
            }) }],
            isError: true,
          };
        }

        return mcpSuccess({
          success: true,
          server: server.name,
          ip: server.ip,
          message: "Domain removed. Platform reset to default.",
          url: `http://${server.ip}:${resolvePlatform(server) === "dokploy" ? 3000 : 8000}`,
          suggested_actions: [
            { command: `server_info { action: 'health', server: '${server.name}' }`, reason: "Verify Coolify is accessible" },
          ],
        });
      }

      case "domain-check": {
        if (!params.domain) {
          return mcpError(
            "Domain is required for domain-check action",
            "Specify a domain name to check DNS for",
          );
        }

        const result = await checkDns(server.ip, params.domain);

        if (result.error) {
          return {
            content: [{ type: "text", text: JSON.stringify({
              server: server.name,
              ip: server.ip,
              domain: params.domain,
              error: result.error,
              ...(result.hint ? { hint: result.hint } : {}),
            }) }],
            isError: true,
          };
        }

        return mcpSuccess({
          server: server.name,
          ip: server.ip,
          domain: params.domain,
          resolvedIp: result.resolvedIp,
          match: result.match,
          ...(result.hint ? { hint: result.hint } : {}),
          suggested_actions: result.match
            ? [{ command: `server_secure { action: 'domain-set', server: '${server.name}', domain: '${params.domain}' }`, reason: "Set this domain as Coolify FQDN" }]
            : [{ command: `server_secure { action: 'domain-info', server: '${server.name}' }`, reason: "Check current domain setting" }],
        });
      }

      case "domain-info": {
        const result = await getDomain(server.ip);

        if (result.error) {
          return {
            content: [{ type: "text", text: JSON.stringify({
              server: server.name,
              ip: server.ip,
              error: result.error,
              ...(result.hint ? { hint: result.hint } : {}),
            }) }],
            isError: true,
          };
        }

        const domainSuggestedActions = [];
        if (result.fqdn) {
          const cleanFqdn = result.fqdn.replace(/^https?:\/\//, "");
          domainSuggestedActions.push({
            command: `server_secure { action: 'domain-check', server: '${server.name}', domain: '${cleanFqdn}' }`,
            reason: "Verify DNS",
          });
        } else {
          domainSuggestedActions.push({
            command: `server_secure { action: 'domain-set', server: '${server.name}', domain: 'coolify.example.com' }`,
            reason: "Set a custom domain",
          });
        }

        return mcpSuccess({
          server: server.name,
          ip: server.ip,
          fqdn: result.fqdn,
          message: result.fqdn ? `Current domain: ${result.fqdn}` : `No custom domain set. Default: http://${server.ip}:${resolvePlatform(server) === "dokploy" ? 3000 : 8000}`,
          suggested_actions: domainSuggestedActions,
        });
      }
    }
  } catch (error: unknown) {
    return mcpError(getErrorMessage(error));
  }
}
