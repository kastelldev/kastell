import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { serverInfoSchema, handleServerInfo } from "./tools/serverInfo.js";
import { serverLogsSchema, handleServerLogs } from "./tools/serverLogs.js";
import { serverManageSchema, handleServerManage } from "./tools/serverManage.js";
import { serverMaintainSchema, handleServerMaintain } from "./tools/serverMaintain.js";
import { serverSecureSchema, handleServerSecure } from "./tools/serverSecure.js";
import { serverBackupSchema, handleServerBackup } from "./tools/serverBackup.js";
import { serverProvisionSchema, handleServerProvision } from "./tools/serverProvision.js";
import { serverAuditSchema, handleServerAudit } from "./tools/serverAudit.js";
import { serverEvidenceSchema, handleServerEvidence } from "./tools/serverEvidence.js";
import { serverGuardSchema, handleServerGuard } from "./tools/serverGuard.js";
import { serverDoctorSchema, handleServerDoctor } from "./tools/serverDoctor.js";
import { serverLockSchema, handleServerLock } from "./tools/serverLock.js";
import { serverFleetSchema, handleServerFleet } from "./tools/serverFleet.js";
import { setMcpVersion } from "./utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkgPath = join(__dirname, "..", "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name: string; version: string };

export function createMcpServer(): McpServer {
  setMcpVersion(pkg.version);
  const server = new McpServer(
    { name: pkg.name, version: pkg.version },
    { capabilities: { logging: {} } },
  );

  server.registerTool("server_info", {
    description:
      "Get information about Kastell-managed servers. Actions: 'list' all servers, 'status' check cloud provider + Coolify/bare status, 'health' check Coolify reachability or SSH access for bare servers, 'sizes' list available server types with prices for a provider+region. Requires provider API tokens as environment variables (HETZNER_TOKEN, DIGITALOCEAN_TOKEN, VULTR_TOKEN, LINODE_TOKEN) for status/sizes checks. Avoid calling repeatedly in short intervals to prevent provider API rate limiting. For fleet-wide health and audit scores across all servers, use server_fleet instead.",
    inputSchema: serverInfoSchema,
    annotations: {
      title: "Server Information",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, async (params) => {
    return handleServerInfo(params);
  });

  server.registerTool("server_logs", {
    description:
      "Fetch logs and system metrics from Kastell-managed servers via SSH. Actions: 'logs' retrieves recent log lines from Coolify container (Coolify servers only), Docker service, or system journal. Bare servers: use service 'system' or 'docker' (coolify service not available). 'monitor' fetches CPU, RAM, and disk usage metrics (works for all server modes). Requires SSH access to target server (root@ip). Note: live streaming (--follow) is not available via MCP — use the CLI for live log tailing.",
    inputSchema: serverLogsSchema,
    annotations: {
      title: "Server Logs & Metrics",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, async (params) => {
    return handleServerLogs(params);
  });

  server.registerTool("server_manage", {
    description:
      "Manage Kastell servers. Actions: 'add' registers an existing Coolify or bare server to local config (validates API token, optionally verifies Coolify via SSH — pass mode:'bare' for servers without Coolify). 'remove' unregisters a server from local config only (cloud server keeps running). 'destroy' PERMANENTLY DELETES the server from the cloud provider and removes from local config. Requires provider API tokens as environment variables. Destroy is blocked when KASTELL_SAFE_MODE=true. Server mode for 'add' action: 'coolify', 'dokploy', or 'bare'. Default: coolify",
    inputSchema: serverManageSchema,
    annotations: {
      title: "Server Management",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, async (params) => {
    return handleServerManage(params);
  });

  server.registerTool("server_maintain", {
    description:
      "Maintain Kastell servers. Actions: 'update' runs Coolify update via SSH (Coolify servers only — bare servers are blocked), 'restart' reboots server via cloud provider API (works for both Coolify and bare servers), 'maintain' runs full 5-step maintenance (Coolify servers only — bare servers are blocked). Snapshot not included — use server_backup tool. Requires SSH access for update, provider API tokens for restart/status. Manual servers: restart not available.",
    inputSchema: serverMaintainSchema,
    annotations: {
      title: "Server Maintenance",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, async (params) => {
    return handleServerMaintain(params);
  });

  server.registerTool("server_secure", {
    description:
      "Secure Kastell servers. Secure: 'secure-setup' applies SSH hardening + fail2ban, 'secure-audit' runs security audit with score. Firewall: 'firewall-setup' installs UFW with Coolify ports, 'firewall-add'/'firewall-remove' manage port rules, 'firewall-status' shows current rules. Domain: 'domain-set'/'domain-remove' manage custom domain with optional SSL, 'domain-check' verifies DNS, 'domain-info' shows current FQDN. All require SSH access to server. For full one-shot hardening (SSH + fail2ban + UFW + sysctl + unattended-upgrades), use server_lock instead.",
    inputSchema: serverSecureSchema,
    annotations: {
      title: "Server Security",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, async (params) => {
    return handleServerSecure(params);
  });

  server.registerTool("server_backup", {
    description:
      "Backup and snapshot Kastell servers. Backup: 'backup-create' dumps Coolify DB + config via SSH (Coolify servers) or system config files (bare servers), 'backup-list' shows local backups, 'backup-restore' restores from backup — bare servers restore system config, Coolify servers restore DB+config (SAFE_MODE blocks restore). Snapshot: 'snapshot-create'/'snapshot-list'/'snapshot-delete' manage cloud provider snapshots (requires provider API token). Snapshots not available for manually added servers.",
    inputSchema: serverBackupSchema,
    annotations: {
      title: "Server Backup & Snapshots",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, async (params) => {
    return handleServerBackup(params);
  });

  server.registerTool("server_provision", {
    description:
      "Provision a new server on a cloud provider. Default: Coolify auto-install via cloud-init. Pass mode:'bare' for a generic VPS without Coolify (installs UFW and runs system updates only). Requires provider API token as environment variable (HETZNER_TOKEN, DIGITALOCEAN_TOKEN, VULTR_TOKEN, LINODE_TOKEN). WARNING: Creates a billable cloud resource. Blocked when KASTELL_SAFE_MODE=true. Server takes 3-5 minutes to fully initialize after provisioning.",
    inputSchema: serverProvisionSchema,
    annotations: {
      title: "Server Provisioning",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, async (params) => {
    return handleServerProvision(params);
  });

  server.registerTool("server_audit", {
    description:
      "Run a security audit on a Kastell-managed server. Scans 27 categories (SSH, Firewall, Updates, Auth, Docker, Network, Filesystem, Logging, Kernel, Accounts, Services, Boot, Scheduling, Time, Banners, Crypto, File Integrity, Malware, MAC, Memory, Secrets, Cloud Metadata, Supply Chain, Backup Hygiene, Resource Limits, Incident Readiness, DNS Security) with 413 checks. Returns overall score (0-100), per-category scores, and actionable quick wins. Formats: 'summary' (compact text for AI consumption), 'json' (full AuditResult), 'score' (number only). Supports compliance framework filtering: cis-level1, cis-level2, pci-dss, hipaa. Requires SSH access to target server. For predictive health trends (disk trending, swap, stale packages), use server_doctor instead.",
    inputSchema: serverAuditSchema,
    annotations: {
      title: "Server Security Audit",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, async (params) => {
    return handleServerAudit(params);
  });

  server.registerTool("server_evidence", {
    description:
      "Collect forensic evidence package from a server. Gathers firewall rules, auth.log, listening ports, system logs, and optionally Docker info. Writes to ~/.kastell/evidence/{server}/{date}/. Returns manifest with SHA256 checksums per file.",
    inputSchema: serverEvidenceSchema,
    annotations: {
      title: "Evidence Collection",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, async (params) => {
    return handleServerEvidence(params);
  });

  server.registerTool("server_guard", {
    description:
      "Manage autonomous security monitoring daemon on a server. Actions: 'start' installs guard as remote cron (checks disk/RAM/CPU/audit every 5 min), 'stop' removes guard cron entry, 'status' shows whether guard is active with last check time and any threshold breaches. Requires SSH access to target server.",
    inputSchema: serverGuardSchema,
    annotations: {
      title: "Guard Daemon",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, async (params) => {
    return handleServerGuard(params);
  });

  server.registerTool("server_doctor", {
    description:
      "Run proactive health analysis on a server. Detects disk trending full, high swap, stale packages, elevated fail2ban bans, audit regression streaks, old backups, and reclaimable Docker space. Uses cached metrics by default — pass fresh=true to fetch live data via SSH. Returns findings grouped by severity (critical/warning/info) with remediation commands. For a full scored security audit across 27 categories, use server_audit instead.",
    inputSchema: serverDoctorSchema,
    annotations: {
      title: "Server Doctor",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, async (params) => {
    return handleServerDoctor(params);
  });

  server.registerTool("server_lock", {
    description:
      "Harden a server to production standard. Applies 19 hardening steps in a single SSH session: SSH key-only auth, fail2ban, UFW firewall, SSH cipher blacklist, sysctl hardening, unattended-upgrades, login banners, account locking, cloud metadata block, DNS security, APT validation, resource limits, service disabling, backup permissions, password quality policy, Docker daemon hardening (no-new-privileges, log rotation, live-restore, icc), auditd, log retention, and AIDE integrity. Requires production=true to confirm intent (safety gate). Pass dryRun=true to preview changes without applying. Platform-aware: preserves Coolify port 8000 or Dokploy port 3000 in UFW rules. Shows audit score before and after hardening. Requires SSH access to target server. For fine-grained SSH hardening, firewall port rules, or domain management, use server_secure instead.",
    inputSchema: serverLockSchema,
    annotations: {
      title: "Server Lock",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, async (params) => {
    return handleServerLock(params);
  });

  server.registerTool("server_fleet", {
    description:
      "Get fleet-wide health and security posture for all registered servers. Returns server name, IP, provider, health status (ONLINE/DEGRADED/OFFLINE), cached audit score, and SSH response time. Use sort parameter to order results. For per-server cloud status or available server sizes, use server_info instead.",
    inputSchema: serverFleetSchema,
    annotations: {
      title: "Fleet Visibility",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, async (params) => {
    return handleServerFleet(params);
  });

  return server;
}
