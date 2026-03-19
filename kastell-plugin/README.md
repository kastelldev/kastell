# Kastell

Autonomous server security and infrastructure management for Claude Code.

## What You Get

The Kastell plugin bundles 13 MCP tools, 4 skills, 1 agent, and 5 hooks that give Claude Code
full control over your self-hosted server infrastructure. Use it to provision cloud servers,
run 413-check security audits across 27 categories, apply 19-step hardening, manage backups,
and operate entire fleets — all from natural language in Claude Code.

Supported providers: Hetzner Cloud, DigitalOcean, Vultr, Linode.
Supported platforms: Coolify, Dokploy.

## Prerequisites

- `npm install -g kastell` — the Kastell CLI must be installed globally
- At least one cloud provider API token (Hetzner, DigitalOcean, Vultr, or Linode)
- `kastell setup` — run once to configure your API tokens and default provider

## Skills

| Skill | Invocation | Purpose |
|-------|------------|---------|
| kastell-ops | Auto-loaded (background) | Architecture reference, patterns, anti-patterns, and decision trees for working in the Kastell codebase or managing Kastell-provisioned servers |
| kastell-scaffold | `/kastell:scaffold` | Generate new CLI commands, MCP tools, cloud providers, and audit checks following Kastell conventions |
| kastell-careful | `/kastell:careful` | Intercepts `kastell destroy` and `kastell restore` commands and requires explicit confirmation before proceeding |
| kastell-research | `/kastell:research` | Read-only codebase exploration with full architecture context — for understanding behavior without making changes |

**kastell-ops** loads automatically as background context whenever you work with the Kastell
codebase or ask about server provisioning, audit, hardening, or provider management. It does
not appear in the slash-command menu.

## Agents

**`/agent:kastell-auditor`** — Parallel audit analyzer that groups all 27 audit categories into
five analysis buckets (critical config, network exposure, access control, monitoring, compliance),
produces structured findings with severity ratings, and remembers previous audit context across
sessions using user-scoped memory.

Invoke it with: "Analyze my last audit report" or "Which findings should I fix first?"

Note: `kastell-fixer` is a project-scope agent, not bundled in this plugin. It requires
`isolation: worktree` which only works when installed at project scope (`.claude/agents/`).
Install kastell-fixer separately inside your Kastell project directory.

## Hooks

| Hook | Trigger | What It Does |
|------|---------|--------------|
| stop-quality-check | Stop | Checks for TypeScript compilation errors, missing CHANGELOG entries, and stale README before ending the session |
| session-log | PostToolUse (Bash) | Records Bash command outputs to `session.log` for audit trail |
| session-audit | SessionStart | Runs `kastell audit --silent` on session start and surfaces the current security score |
| pre-commit-audit-guard | PreToolUse (git commit) | Blocks the commit if the current audit score has dropped below the recorded baseline |
| destroy-block | PreToolUse (Bash) | Blocks `kastell destroy` and `kastell restore` operations through Claude Code |

## MCP Tools

All 13 tools are available in Claude Code once the plugin is installed. The MCP server starts
automatically via the bundled `.mcp.json` configuration.

| Tool | Description |
|------|-------------|
| server_info | List servers, check status, health, and available sizes |
| server_logs | Fetch logs and system metrics from servers via SSH |
| server_manage | Add, remove, or destroy servers |
| server_maintain | Update platform, restart, or run full maintenance |
| server_secure | SSH hardening, firewall management, and domain configuration |
| server_backup | Create backups and manage cloud snapshots |
| server_provision | Provision new cloud servers on Hetzner, DigitalOcean, Vultr, or Linode |
| server_audit | Run the full 413-check security audit across 27 categories |
| server_evidence | Collect forensic evidence packages from servers |
| server_guard | Manage the autonomous security monitoring daemon |
| server_doctor | Proactive health analysis with remediation recommendations |
| server_lock | Apply the 19-step production hardening sequence |
| server_fleet | Fleet-wide health and security posture overview |

## Quick Start

```bash
# Install kastell globally
npm install -g kastell

# Configure your cloud provider
kastell setup

# In Claude Code, the plugin auto-starts the MCP server.
# Try natural language commands like:
#   "Provision a new Hetzner server in Nuremberg with 2 CPUs"
#   "Run a security audit on my server at 1.2.3.4"
#   "Apply full hardening to my production server"
#   "Show me all my servers"
```

After installation, the `kastell-ops` skill loads automatically in any session where you
work with Kastell. Use `/kastell:scaffold` to generate new CLI commands or MCP tools,
and `/agent:kastell-auditor` to get prioritized remediation guidance from audit results.

## Supported Providers

| Provider | Regions | Notes |
|----------|---------|-------|
| Hetzner Cloud | EU (FSN, NBG, HEL), US (ASH, HIL) | Default recommended provider |
| DigitalOcean | Global (NYC, SFO, AMS, SGP, LON, FRA, TOR, BLR, SYD) | |
| Vultr | 25+ global locations | |
| Linode (Akamai) | 11 global locations | |

## Links

- Website: https://kastell.dev
- GitHub: https://github.com/kastelldev/kastell
- npm: https://www.npmjs.com/package/kastell
- Docs: https://kastell.dev/docs
