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
  mcpSuccess,
  mcpError,
  type McpResponse,
} from "../utils.js";
import type { ServerRecord } from "../../types/index.js";
import { COOLIFY_PORT, DOKPLOY_PORT } from "../../constants.js";

// ─── Secure handlers ─────────────────────────────────────────────────────────

export async function handleSecureSetup(
  server: ServerRecord,
  port: number | undefined,
): Promise<McpResponse> {
  const result = await applySecureSetup(server.ip, port ? { port } : undefined);

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

export async function handleSecureAudit(server: ServerRecord): Promise<McpResponse> {
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

// ─── Firewall handlers ────────────────────────────────────────────────────────

export async function handleFirewallSetup(server: ServerRecord): Promise<McpResponse> {
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

export async function handleFirewallAdd(
  server: ServerRecord,
  port: number | undefined,
  protocol: "tcp" | "udp",
): Promise<McpResponse> {
  if (port === undefined) {
    return mcpError(
      "Port is required for firewall-add action",
      "Specify a port number (1-65535)",
    );
  }

  const result = await addFirewallRule(server.ip, port, protocol);

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
    message: `Port ${port}/${protocol} opened`,
    suggested_actions: [
      { command: `server_secure { action: 'firewall-status', server: '${server.name}' }`, reason: "Verify firewall rules" },
    ],
  });
}

export async function handleFirewallRemove(
  server: ServerRecord,
  port: number | undefined,
  protocol: "tcp" | "udp",
): Promise<McpResponse> {
  if (port === undefined) {
    return mcpError(
      "Port is required for firewall-remove action",
      "Specify a port number (1-65535)",
    );
  }

  const platform = resolvePlatform(server);
  const result = await removeFirewallRule(server.ip, port, protocol, platform);

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
    message: `Port ${port}/${protocol} closed`,
    ...(result.warning ? { warning: result.warning } : {}),
    suggested_actions: [
      { command: `server_secure { action: 'firewall-status', server: '${server.name}' }`, reason: "Verify firewall rules" },
    ],
  });
}

export async function handleFirewallStatus(server: ServerRecord): Promise<McpResponse> {
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

// ─── Domain handlers ──────────────────────────────────────────────────────────

export async function handleDomainSet(
  server: ServerRecord,
  domainName: string | undefined,
  ssl: boolean,
): Promise<McpResponse> {
  if (!domainName) {
    return mcpError(
      "Domain is required for domain-set action",
      "Specify a domain name (e.g., coolify.example.com)",
    );
  }

  const result = await setDomain(server.ip, domainName, ssl, resolvePlatform(server));

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

  const protocol = ssl ? "https" : "http";
  return mcpSuccess({
    success: true,
    server: server.name,
    ip: server.ip,
    message: `Domain set to ${domainName}`,
    url: `${protocol}://${domainName}`,
    suggested_actions: [
      { command: `server_secure { action: 'domain-check', server: '${server.name}', domain: '${domainName}' }`, reason: "Verify DNS points to this server" },
      { command: `server_info { action: 'health', server: '${server.name}' }`, reason: "Verify Coolify is accessible" },
    ],
  });
}

export async function handleDomainRemove(server: ServerRecord): Promise<McpResponse> {
  const platform = resolvePlatform(server);
  const result = await removeDomain(server.ip, platform);

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
    url: `http://${server.ip}:${platform === "dokploy" ? DOKPLOY_PORT : COOLIFY_PORT}`,
    suggested_actions: [
      { command: `server_info { action: 'health', server: '${server.name}' }`, reason: "Verify Coolify is accessible" },
    ],
  });
}

export async function handleDomainCheck(
  server: ServerRecord,
  domainName: string | undefined,
): Promise<McpResponse> {
  if (!domainName) {
    return mcpError(
      "Domain is required for domain-check action",
      "Specify a domain name to check DNS for",
    );
  }

  const result = await checkDns(server.ip, domainName);

  if (result.error) {
    return {
      content: [{ type: "text", text: JSON.stringify({
        server: server.name,
        ip: server.ip,
        domain: domainName,
        error: result.error,
        ...(result.hint ? { hint: result.hint } : {}),
      }) }],
      isError: true,
    };
  }

  return mcpSuccess({
    server: server.name,
    ip: server.ip,
    domain: domainName,
    resolvedIp: result.resolvedIp,
    match: result.match,
    ...(result.hint ? { hint: result.hint } : {}),
    suggested_actions: result.match
      ? [{ command: `server_secure { action: 'domain-set', server: '${server.name}', domain: '${domainName}' }`, reason: "Set this domain as Coolify FQDN" }]
      : [{ command: `server_secure { action: 'domain-info', server: '${server.name}' }`, reason: "Check current domain setting" }],
  });
}

export async function handleDomainInfo(server: ServerRecord): Promise<McpResponse> {
  const platform = resolvePlatform(server);
  const result = await getDomain(server.ip, platform);

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
    message: result.fqdn
      ? `Current domain: ${result.fqdn}`
      : `No custom domain set. Default: http://${server.ip}:${platform === "dokploy" ? DOKPLOY_PORT : COOLIFY_PORT}`,
    suggested_actions: domainSuggestedActions,
  });
}
