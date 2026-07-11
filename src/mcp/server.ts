import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { KASTELL_VERSION } from "../utils/version.js";
import { loadPlugins } from "../plugin/loader.js";
import { serverInfoSchema, handleServerInfo, serverInfoOutputSchema } from "./tools/serverInfo.js";
import { serverLogsSchema, handleServerLogs, serverLogsOutputSchema } from "./tools/serverLogs.js";
import { serverManageSchema, handleServerManage, serverManageOutputSchema } from "./tools/serverManage.js";
import { serverMaintainSchema, handleServerMaintain, serverMaintainOutputSchema } from "./tools/serverMaintain.js";
import { serverSecureSchema, handleServerSecure, serverSecureOutputSchema } from "./tools/serverSecure.js";
import { serverBackupSchema, handleServerBackup, serverBackupOutputSchema } from "./tools/serverBackup.js";
import { serverProvisionSchema, handleServerProvision, serverProvisionOutputSchema } from "./tools/serverProvision.js";
import { serverAuditSchema, handleServerAudit, serverAuditOutputSchema } from "./tools/serverAudit.js";
import { serverEvidenceSchema, handleServerEvidence, serverEvidenceOutputSchema } from "./tools/serverEvidence.js";
import { serverGuardSchema, handleServerGuard, serverGuardOutputSchema } from "./tools/serverGuard.js";
import { serverDoctorSchema, handleServerDoctor, serverDoctorOutputSchema } from "./tools/serverDoctor.js";
import { serverLockSchema, handleServerLock, serverLockOutputSchema } from "./tools/serverLock.js";
import { serverFleetSchema, handleServerFleet, serverFleetOutputSchema } from "./tools/serverFleet.js";
import { serverFixSchema, handleServerFix, serverFixOutputSchema } from "./tools/serverFix.js";
import { serverExplainSchema, serverExplainHandler, serverExplainOutputSchema } from "./tools/serverExplain.js";
import { serverCompareSchema, handleServerCompare, serverCompareOutputSchema } from "./tools/serverCompare.js";
import { serverPluginSchema, handleServerPlugin, serverPluginOutputSchema } from "./tools/serverPlugin.js";
import { getPluginMcpTools } from "../plugin/registry.js";
import { registerPluginMcpTools } from "./pluginTools.js";
import { setMcpVersion } from "./utils.js";
import { runProbeSessionMaintenance } from "../core/probe/diagnostics.js";
import { readCheckCatalog, readCheckDetail } from "./resources/checks.js";
import { describeAuditCatalog } from "../core/audit/explainCheck.js";
import { readServerList, readServerAudit } from "./resources/servers.js";
import { hardenPrompt, diagnosePrompt, setupPrompt } from "./prompts/workflows.js";
import { debugLog } from "../utils/logger.js";

// ─── Tool Registry ───────────────────────────────────────────────────────────

export interface McpToolEntry {
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  outputSchema: Record<string, any>;
  handler: (params: any /* eslint-disable-line @typescript-eslint/no-explicit-any -- handler params are tool-specific typed objects; any avoids a union of 17 incompatible param types */, server?: McpServer) => Promise<Record<string, unknown>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  annotations?: Record<string, any>;
  requiresServer?: boolean;
}

/**
 * Single source of truth for all MCP tool definitions.
 * Used by round-trip test harness (Wave A) to verify schema/handler consistency.
 */
export const ALL_MCP_TOOLS: McpToolEntry[] = [
  {
    name: "server_info",
    description:
      "Get information about Kastell-managed servers. Actions: 'list' all servers, 'status' check cloud provider + Coolify/bare status, 'health' check Coolify reachability or SSH access for bare servers, 'sizes' list available server types with prices for a provider+region. Requires provider API tokens as environment variables (HETZNER_TOKEN, DIGITALOCEAN_TOKEN, VULTR_TOKEN, LINODE_TOKEN) for status/sizes checks. Avoid calling repeatedly in short intervals to prevent provider API rate limiting. For fleet-wide health and audit scores across all servers, use server_fleet instead.",
    inputSchema: serverInfoSchema,
    outputSchema: serverInfoOutputSchema,
    annotations: {
      title: "Server Information",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (params) => handleServerInfo(params),
  },
  {
    name: "server_logs",
    description:
      "Fetch logs and system metrics from Kastell-managed servers via SSH. Actions: 'logs' retrieves recent log lines from Coolify container (Coolify servers only), Docker service, or system journal. Bare servers: use service 'system' or 'docker' (coolify service not available). 'monitor' fetches CPU, RAM, and disk usage metrics (works for all server modes). Requires SSH access to target server (root@ip). Note: live streaming (--follow) is not available via MCP — use the CLI for live log tailing.",
    inputSchema: serverLogsSchema,
    outputSchema: serverLogsOutputSchema,
    annotations: {
      title: "Server Logs & Metrics",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (params) => handleServerLogs(params),
  },
  {
    name: "server_manage",
    description:
      "Manage Kastell servers. Actions: 'add' registers an existing Coolify or bare server to local config (validates API token, optionally verifies Coolify via SSH — pass mode:'bare' for servers without Coolify). 'remove' unregisters a server from local config only (cloud server keeps running). 'destroy' PERMANENTLY DELETES the server from the cloud provider and removes from local config. Requires provider API tokens as environment variables. Destroy is blocked when KASTELL_SAFE_MODE=true. Server mode for 'add' action: 'coolify', 'dokploy', or 'bare'. Default: coolify",
    inputSchema: serverManageSchema,
    outputSchema: serverManageOutputSchema,
    annotations: {
      title: "Server Management",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async (params, server?: McpServer) => handleServerManage(params, server!),
    requiresServer: true,
  },
  {
    name: "server_maintain",
    description:
      "Maintain Kastell servers. Actions: 'update' runs Coolify update via SSH (Coolify servers only — bare servers are blocked), 'restart' reboots server via cloud provider API (works for both Coolify and bare servers), 'maintain' runs full 5-step maintenance (Coolify servers only — bare servers are blocked). Snapshot not included — use server_backup tool. Requires SSH access for update, provider API tokens for restart/status. Manual servers: restart not available.",
    inputSchema: serverMaintainSchema,
    outputSchema: serverMaintainOutputSchema,
    annotations: {
      title: "Server Maintenance",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (params) => handleServerMaintain(params),
  },
  {
    name: "server_secure",
    description:
      "Secure Kastell servers. Secure: 'secure-setup' applies SSH hardening + fail2ban, 'secure-audit' runs security audit with score. Firewall: 'firewall-setup' installs UFW with Coolify ports, 'firewall-add'/'firewall-remove' manage port rules, 'firewall-status' shows current rules. Domain: 'domain-set'/'domain-remove' manage custom domain with optional SSL, 'domain-check' verifies DNS, 'domain-info' shows current FQDN. All require SSH access to server. For full one-shot hardening (SSH + fail2ban + UFW + sysctl + unattended-upgrades), use server_lock instead.",
    inputSchema: serverSecureSchema,
    outputSchema: serverSecureOutputSchema,
    annotations: {
      title: "Server Security",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (params, server?: McpServer) => handleServerSecure(params, server!),
    requiresServer: true,
  },
  {
    name: "server_backup",
    description:
      "Backup and snapshot Kastell servers. Backup: 'backup-create' dumps Coolify DB + config via SSH (Coolify servers) or system config files (bare servers), 'backup-list' shows local backups, 'backup-restore' restores from backup — bare servers restore system config, Coolify servers restore DB+config (SAFE_MODE blocks restore). Snapshot: 'snapshot-create'/'snapshot-list'/'snapshot-delete' manage cloud provider snapshots (requires provider API token). Snapshots not available for manually added servers.",
    inputSchema: serverBackupSchema,
    outputSchema: serverBackupOutputSchema,
    annotations: {
      title: "Server Backup & Snapshots",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async (params) => handleServerBackup(params),
  },
  {
    name: "server_provision",
    description:
      "Provision a new server on a cloud provider. Default: Coolify auto-install via cloud-init. Pass mode:'bare' for a generic VPS without Coolify (installs UFW and runs system updates only). Requires provider API token as environment variable (HETZNER_TOKEN, DIGITALOCEAN_TOKEN, VULTR_TOKEN, LINODE_TOKEN). WARNING: Creates a billable cloud resource. Blocked when KASTELL_SAFE_MODE=true. Server takes 3-5 minutes to fully initialize after provisioning.",
    inputSchema: serverProvisionSchema,
    outputSchema: serverProvisionOutputSchema,
    annotations: {
      title: "Server Provisioning",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async (params, server?: McpServer) => handleServerProvision(params, server!),
    requiresServer: true,
  },
  {
    name: "server_audit",
    description: (() => {
      const cat = describeAuditCatalog();
      return `Run a security audit on a server. ${cat.description}. Returns score (0-100), per-category scores, and quick wins. Formats: 'summary' (compact text), 'json' (full AuditResult), 'score' (number only). Supports compliance filtering (cis-level1, cis-level2, pci-dss, hipaa), category/severity filtering, snapshot save/compare, threshold gate, and profile filtering. Requires SSH access. For health trends use server_doctor instead.`;
    })(),
    inputSchema: serverAuditSchema,
    outputSchema: serverAuditOutputSchema,
    annotations: {
      title: "Server Security Audit",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (params, server?: McpServer) => handleServerAudit(params, server!),
    requiresServer: true,
  },
  {
    name: "server_evidence",
    description:
      "Collect forensic evidence package from a server. Gathers firewall rules, auth.log, listening ports, system logs, and optionally Docker info. Writes to ~/.kastell/evidence/{server}/{date}/. Returns manifest with SHA256 checksums per file.",
    inputSchema: serverEvidenceSchema,
    outputSchema: serverEvidenceOutputSchema,
    annotations: {
      title: "Evidence Collection",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async (params) => handleServerEvidence(params),
  },
  {
    name: "server_guard",
    description:
      "Manage autonomous security monitoring daemon on a server. Actions: 'start' installs guard as remote cron (checks disk/RAM/CPU/audit every 5 min), 'stop' removes guard cron entry, 'status' shows whether guard is active with last check time and any threshold breaches. Requires SSH access to target server.",
    inputSchema: serverGuardSchema,
    outputSchema: serverGuardOutputSchema,
    annotations: {
      title: "Guard Daemon",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (params) => handleServerGuard(params),
  },
  {
    name: "server_doctor",
    description:
      "Run proactive health analysis on a server. Detects disk trending full, high swap, stale packages, elevated fail2ban bans, audit regression streaks, old backups, and reclaimable Docker space. Uses cached metrics by default; pass fresh=true to fetch live data via SSH. Returns findings grouped by severity (critical/warning/info) with remediation commands. For a full scored security audit, use server_audit instead.",
    inputSchema: serverDoctorSchema,
    outputSchema: serverDoctorOutputSchema,
    annotations: {
      title: "Server Doctor",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (params) => handleServerDoctor(params),
  },
  {
    name: "server_lock",
    description:
      "Harden a server to production standard. Applies the production hardening sequence in a single SSH session covering SSH, fail2ban, UFW, sysctl, unattended-upgrades, Docker daemon, auditd, AIDE, and more. Requires production=true (safety gate). Pass dryRun=true to preview. Platform-aware: preserves Coolify/Dokploy ports. Shows audit score before and after. Requires SSH access. For fine-grained SSH/firewall/domain changes use server_secure instead.",
    inputSchema: serverLockSchema,
    outputSchema: serverLockOutputSchema,
    annotations: {
      title: "Server Lock",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async (params, server?: McpServer) => handleServerLock(params, server!),
    requiresServer: true,
  },
  {
    name: "server_fleet",
    description:
      "Get fleet-wide health and security posture for all registered servers. Returns server name, IP, provider, health status (ONLINE/DEGRADED/OFFLINE), cached audit score, and SSH response time. Use sort parameter to order results. For per-server cloud status or available server sizes, use server_info instead.",
    inputSchema: serverFleetSchema,
    outputSchema: serverFleetOutputSchema,
    annotations: {
      title: "Fleet Visibility",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (params) => handleServerFleet(params),
  },
  {
    name: "server_fix",
    description:
      "Apply safe auto-fixes to a server. Runs audit, filters SAFE tier fixes, creates backup, applies fixes, and re-audits for score delta. dryRun defaults to true (preview only). SAFE_MODE forces preview. SSH/Firewall/Docker fixes are FORBIDDEN and always rejected. Use checks and category params to target specific fixes.",
    inputSchema: serverFixSchema,
    outputSchema: serverFixOutputSchema,
    annotations: {
      title: "Server Safe Fix",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async (params, server?: McpServer) => handleServerFix(params, server!),
    requiresServer: true,
  },
  {
    name: "server_explain",
    description:
      "Deep-dive into a single audit check. Returns what it does, why it matters, how to fix it, fix tier (SAFE/GUARDED/FORBIDDEN), and compliance references (CIS/PCI-DSS/HIPAA). No SSH connection required. Supports case-insensitive and fuzzy matching for check IDs.",
    inputSchema: serverExplainSchema,
    outputSchema: serverExplainOutputSchema,
    annotations: {
      title: "Explain Audit Check",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => serverExplainHandler(params),
  },
  {
    name: "server_compare",
    description:
      "Compare two servers side-by-side. Returns category-level score comparison (default) or check-level diff (detail mode). Uses cached snapshots when available, falls back to live SSH audit. Requires two registered servers.",
    inputSchema: serverCompareSchema,
    outputSchema: serverCompareOutputSchema,
    annotations: {
      title: "Compare Servers",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (params) => handleServerCompare(params),
  },
  {
    name: "server_plugin",
    description:
      "Manage kastell plugins. Actions: 'list' shows installed plugins with check counts and status, 'validate' checks manifest integrity and entry point validity. Install/remove not available via MCP — use CLI for security (requires explicit user consent). No SSH connection required.",
    inputSchema: serverPluginSchema,
    outputSchema: serverPluginOutputSchema,
    annotations: {
      title: "Plugin Management",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => handleServerPlugin(params),
  },
];

export async function createMcpServer(): Promise<McpServer> {
  await loadPlugins();
  // Best-effort Active Probe maintenance — must NOT block McpServer
  // construction. Classification + retention only; no probe lifecycle.
  await runProbeSessionMaintenance({ strict: false });
  setMcpVersion(KASTELL_VERSION);
  const server = new McpServer(
    { name: "kastell", version: KASTELL_VERSION },
    {
      capabilities: { logging: {}, resources: {}, prompts: {} },
      instructions: `Kastell manages self-hosted servers across 4 cloud providers (Hetzner, DigitalOcean, Vultr, Linode) and 3 platforms (Coolify, Dokploy, bare VPS).

Workflow: provision a server -> add to config -> secure/harden -> audit -> maintain.

Tool routing:
- server_info: read-only queries (list, status, health, sizes)
- server_provision: creates new billable cloud resources (requires SAFE_MODE=false)
- server_manage: register existing servers (add), unregister (remove), permanently delete (destroy - requires SAFE_MODE=false)
- server_lock: one-shot production hardening sequence (SSH + fail2ban + UFW + sysctl + auditd + AIDE + Docker)
- server_audit: ${describeAuditCatalog().short}, CIS/PCI-DSS/HIPAA compliance filtering
- server_secure: granular security (SSH hardening, firewall rules, domain/SSL)
- server_backup: backup/restore + VPS snapshots
- server_maintain: platform updates, restarts, full maintenance cycle
- server_logs: live logs and system metrics via SSH
- server_evidence: forensic collection with SHA256 checksums
- server_guard: autonomous monitoring daemon (cron-based)
- server_doctor: proactive health analysis (disk trend, swap, stale packages)
- server_fleet: fleet-wide dashboard (all servers at once)
- server_fix: apply safe auto-fixes (SAFE tier only, dryRun default, SAFE_MODE enforced)

Safety: KASTELL_SAFE_MODE=true (default in MCP) blocks destructive operations. Set SAFE_MODE=false explicitly to provision, destroy, or restore.

Bare servers: use service 'system' or 'docker' for logs (not 'coolify'). server_maintain update/maintain blocked on bare servers.`,
    },
  );

  for (const tool of ALL_MCP_TOOLS) {
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      annotations: tool.annotations,
    }, async (params) => {
      return (tool.handler as
        (params: any, server?: McpServer) => Promise<Record<string, unknown>>)(params, tool.requiresServer ? server : undefined) as any; // eslint-disable-line @typescript-eslint/no-explicit-any -- McpServer ToolCallback type bridge
    });
  }

  // ─── Plugin Tools ────────────────────────────────────────────────────────

  const pluginMcpTools = getPluginMcpTools();
  if (pluginMcpTools.length > 0) {
    const toolCount = registerPluginMcpTools(server, pluginMcpTools);
    debugLog?.(`registered ${toolCount} plugin MCP tools`);
  }

  // ─── Resources ────────────────────────────────────────────────────────────

  server.registerResource(
    "check-catalog",
    "kastell://checks",
    { description: `Full audit check catalog (${describeAuditCatalog().resource})` },
    async () => readCheckCatalog(),
  );

  server.registerResource(
    "check-detail",
    new ResourceTemplate("kastell://checks/{id}", { list: undefined }),
    { description: "Detailed information about a specific audit check" },
    async (_uri, { id }) => readCheckDetail(id as string),
  );

  server.registerResource(
    "server-list",
    "kastell://servers",
    { description: "List of all registered Kastell servers" },
    async () => readServerList(),
  );

  server.registerResource(
    "server-audit",
    new ResourceTemplate("kastell://servers/{name}/audit", { list: undefined }),
    { description: "Latest cached audit score for a specific server" },
    async (_uri, { name }) => readServerAudit(name as string),
  );

  // ─── Prompts ─────────────────────────────────────────────────────────────

  server.registerPrompt(
    "harden",
    {
      title: "Harden Server",
      description: "Full hardening workflow: lock → audit → conditional fix chain",
      argsSchema: { server: z.string().describe("Server name to harden") },
    },
    (args) => hardenPrompt(args),
  );

  server.registerPrompt(
    "diagnose",
    {
      title: "Diagnose Server",
      description: "Diagnose server issues: doctor → logs → audit findings summary",
      argsSchema: {
        server: z.string().describe("Server name to diagnose"),
        service: z.string().optional().describe("Log source: coolify, docker, or system"),
      },
    },
    (args) => diagnosePrompt(args),
  );

  server.registerPrompt(
    "setup",
    {
      title: "Setup New Server",
      description: "New server setup: provision → lock → audit verification chain",
      argsSchema: { name: z.string().describe("Server name to create") },
    },
    (args) => setupPrompt(args),
  );

  return server;
}
