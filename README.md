<p align="center">
  <img src="assets/logo.png" alt="Kastell" width="120" />
</p>

<h1 align="center">Kastell</h1>
<p align="center">Your infrastructure, fortified.</p>

> English | [Türkçe](README.tr.md)

![Tests](https://github.com/kastelldev/kastell/actions/workflows/ci.yml/badge.svg)
[![Coverage](https://codecov.io/gh/kastelldev/kastell/branch/main/graph/badge.svg)](https://codecov.io/gh/kastelldev/kastell)
![npm](https://img.shields.io/npm/v/kastell)
![Downloads](https://img.shields.io/npm/dt/kastell)
![License](https://img.shields.io/badge/license-Apache%202.0-blue)
![GitHub stars](https://img.shields.io/github/stars/kastelldev/kastell?style=flat-square)
[![Socket Badge](https://socket.dev/api/badge/npm/package/kastell)](https://socket.dev/npm/package/kastell)
[![Website](https://img.shields.io/badge/website-kastell.dev-blue?style=flat-square)](https://kastell.dev)

## Why Kastell Exists

Most self-hosted servers break because:

- No backup discipline
- No update strategy
- No security hardening
- No monitoring
- No snapshot routine

Stop babysitting your servers. Kastell was built to fix that.

## Quick Start

```bash
# Interactive mode -- no commands to memorize
npx kastell
```

Running `kastell` without any arguments launches an **interactive search menu** with a gradient ASCII banner and quick-start examples. Browse actions by emoji-categorized groups, type to filter results instantly, and configure options step by step -- no need to remember any command names or flags.

```
 ██╗  ██╗  ██████╗  ███████╗████████╗███████╗██╗     ██╗
 ██║ ██╔╝  ██╔══██╗ ██╔════╝╚══██╔══╝██╔════╝██║     ██║
 █████╔╝   ███████║ ███████╗   ██║   █████╗  ██║     ██║
 ██╔═██╗   ██╔══██║ ╚════██║   ██║   ██╔══╝  ██║     ██║
 ██║  ██╗  ██║  ██║ ███████║   ██║   ███████╗███████╗███████╗
 ╚═╝  ╚═╝  ╚═╝  ╚═╝ ╚══════╝   ╚═╝   ╚══════╝╚══════╝╚══════╝

  KASTELL  v1.8.0  ·  Your infrastructure, fortified.

  $ kastell init --template production  → deploy a new server
  $ kastell status --all                → check all servers
  $ kastell secure setup                → harden SSH + fail2ban
  $ kastell maintain --all              → full maintenance cycle

? What would you like to do?
   Server Management
❯    Deploy a new server
     Add an existing server
     List all servers
     ...
   Security
     Harden SSH & fail2ban
     Manage firewall (UFW)
     ...
```

Each action includes sub-options (server mode, template, log source, port number, etc.) and a **<- Back** option to return to the main menu at any point.

If you already know the commands, you can still use them directly:

```bash
kastell init                    # Deploy a new server
kastell status my-server        # Check server status
kastell backup --all            # Backup all servers
```

Kastell handles server provisioning, SSH key setup, firewall configuration, and platform installation automatically.

## What Makes Kastell Different?

| Problem | Solution |
|---------|----------|
| Broke your server with an update? | Pre-update snapshot protection via `maintain` |
| No idea if your server is healthy? | Built-in monitoring, health checks, and `doctor` diagnostics |
| Security is an afterthought? | Firewall, SSH hardening, SSL, and security audits built-in |
| Backups? Maybe someday... | One-command backup & restore with manifest tracking |
| Managing multiple servers? | `--all` flag across backup, maintain, status, and health |
| Existing server not tracked? | `kastell add` brings any server under management |
| Don't want to memorize commands? | Just run `kastell` -- interactive menu guides you |

## What Can You Do?

### Deploy
```bash
kastell                               # Interactive menu (recommended)
kastell init                          # Interactive setup (direct)
kastell init --provider hetzner       # Non-interactive
kastell init --config kastell.yml     # From YAML config
kastell init --template production    # Use a template
kastell init --mode bare              # Generic VPS (no platform)
kastell init --mode dokploy           # Dokploy (Docker Swarm PaaS)
```

### Manage
```bash
kastell list                  # List all servers
kastell status my-server      # Check server status
kastell status --all          # Check all servers
kastell ssh my-server         # SSH into server
kastell restart my-server     # Restart server
kastell destroy my-server     # Destroy cloud server entirely
kastell add                   # Add existing server
kastell remove my-server      # Remove from local config
kastell config set key value  # Manage default configuration
kastell config validate       # Validate servers.yaml structure and types
kastell export                # Export server list to JSON
kastell import servers.json   # Import servers from JSON
```

### Update & Maintain
```bash
kastell update my-server              # Update platform (Coolify or Dokploy, auto-detected)
kastell update my-server --dry-run    # Preview update without executing
kastell maintain my-server            # Full maintenance (snapshot + update + health + reboot)
kastell maintain my-server --dry-run  # Preview maintenance steps
kastell maintain --all                # Maintain all servers
```

### Back Up & Restore
```bash
kastell backup my-server      # Backup DB + config
kastell backup --all          # Backup all servers
kastell restore my-server     # Restore from backup
```

### Snapshots
```bash
kastell snapshot create my-server   # Create VPS snapshot (with cost estimate)
kastell snapshot list my-server     # List snapshots
kastell snapshot list --all         # List all snapshots across servers
kastell snapshot delete my-server   # Delete a snapshot
```

### Security
```bash
kastell firewall status my-server   # Check firewall
kastell firewall setup my-server    # Configure UFW
kastell secure audit my-server      # Security audit
kastell secure setup my-server      # SSH hardening + fail2ban
kastell domain add my-server --domain example.com  # Set domain + SSL
```

### Security Audit
```bash
kastell audit my-server                # Full security audit (9 categories, 46+ checks)
kastell audit my-server --json         # JSON output for automation
kastell audit my-server --threshold 70 # Exit code 1 if score below threshold
kastell audit my-server --fix          # Interactive fix mode (prompts per severity)
kastell audit my-server --fix --dry-run # Preview fixes without executing
kastell audit my-server --watch        # Re-audit every 5 min, show only changes
kastell audit my-server --watch 60     # Custom interval (60 seconds)
kastell audit --host root@1.2.3.4     # Audit unregistered server
kastell audit my-server --badge        # SVG badge output
kastell audit my-server --report html  # Full HTML report
kastell audit my-server --score-only   # Just the score (CI-friendly)
kastell audit my-server --summary      # Compact dashboard view
```

### Monitor & Debug
```bash
kastell monitor my-server             # CPU, RAM, disk usage
kastell logs my-server                 # View platform logs (Coolify or Dokploy)
kastell logs my-server -f              # Follow logs
kastell health                         # Health check all servers
kastell doctor                         # Check local environment
```

## Supported Providers

| Provider | Status | Regions | Starting Price |
|----------|--------|---------|---------------|
| [Hetzner Cloud](https://hetzner.cloud) | Stable | EU, US | ~€4/mo |
| [DigitalOcean](https://digitalocean.com) | Stable | Global | ~$18/mo |
| [Vultr](https://vultr.com) | Stable | Global | ~$12/mo |
| [Linode (Akamai)](https://linode.com) | Beta | Global | ~$12/mo |

> Prices reflect the cheapest plan with at least 2 GB RAM (required by Coolify and Dokploy). Bare mode has no minimum requirements -- plans start from ~$2.50/mo depending on provider. You can choose a different size during setup. Linode support is in beta -- community testing welcome.

## Supported Platforms

| Platform | Mode Flag | Min RAM | Min CPU | Description |
|----------|-----------|---------|---------|-------------|
| Coolify | `--mode coolify` (default) | 2 GB | 2 vCPU | Docker-based PaaS (port 8000) |
| Dokploy | `--mode dokploy` | 2 GB | 2 vCPU | Docker Swarm-based PaaS (port 3000) |
| Bare | `--mode bare` | — | — | Generic VPS, no platform overhead |

Kastell uses a **PlatformAdapter** architecture -- the same commands (`update`, `maintain`, `logs`, `health`) work across all platforms. The platform is stored in your server record and auto-detected on each command.

## Developer Experience

| Feature | Command / Flag | Description |
|---------|---------------|-------------|
| Dry Run | `--dry-run` | Preview destructive commands without executing. Available on: destroy, update, restart, remove, maintain, restore, firewall, domain, backup, snapshot, secure. |
| Shell Completions | `kastell completions bash\|zsh\|fish` | Generate shell completion scripts for tab-completion of commands and options. |
| Config Validation | `kastell config validate` | Check `servers.yaml` for structural and type errors using Zod strict schemas. |
| Version Check | `kastell --version` | Shows current version and notifies if a newer version is available on npm. |

## YAML Config

Deploy with a single config file:

```yaml
# kastell.yml
provider: hetzner
region: nbg1
size: cax11
name: my-coolify
fullSetup: true
domain: coolify.example.com
```

```bash
kastell init --config kastell.yml
```

## Templates

| Template | Best For | Includes |
|----------|----------|----------|
| `starter` | Testing, side projects | 1-2 vCPU, 2-4 GB RAM |
| `production` | Live applications | 2-4 vCPU, 4-8 GB RAM, full hardening |
| `dev` | Development & CI/CD | Same as starter, no hardening |

```bash
kastell init --template production --provider hetzner
```

## Security

Kastell is built with security as a priority -- **2,266 tests** across 86 suites, including dedicated security test suites.

- API tokens are never stored on disk -- prompted at runtime or via environment variables
- SSH keys are auto-generated if needed (Ed25519)
- All SSH connections use `StrictHostKeyChecking=accept-new` with IP validation (octet range) and environment filtering
- Shell injection protection on all user-facing inputs (`spawn`/`spawnSync`, no `execSync`)
- Provider error messages are sanitized to prevent token leakage
- stderr sanitization redacts IPs, home paths, tokens, and secrets from error output
- Config file token detection (22+ key patterns, case-insensitive, nested)
- Import/export operations strip sensitive fields and enforce strict file permissions (`0o600`)
- `--full-setup` enables UFW firewall and SSH hardening automatically
- MCP: SAFE_MODE (default: on) blocks all destructive operations, Zod schema validation on all inputs, path traversal protection on backup restore

## Installation

```bash
# Run directly (recommended)
npx kastell <command>

# Or install globally
npm install -g kastell
kastell <command>
```

Requires Node.js 20 or later.

## Troubleshooting

**Server creation fails?**
Run `kastell doctor --check-tokens` to verify your API token and local environment.

**Server not responding?**
Use `kastell status my-server --autostart` to check platform status and auto-restart if needed, or `kastell health` to check all servers at once.

**Need to start fresh?**
`kastell destroy my-server` removes the cloud server entirely.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, testing, and contribution guidelines.

## MCP Server (AI Integration)

Kastell includes a built-in [Model Context Protocol](https://modelcontextprotocol.io/) server for AI-powered server management. Works with Claude Code, Cursor, Windsurf, and other MCP-compatible clients.

```json
{
  "mcpServers": {
    "kastell": {
      "command": "npx",
      "args": ["-y", "-p", "kastell", "kastell-mcp"],
      "env": {
        "HETZNER_TOKEN": "your-token",
        "DIGITALOCEAN_TOKEN": "your-token",
        "VULTR_TOKEN": "your-token",
        "LINODE_TOKEN": "your-token"
      }
    }
  }
}
```

Available tools:

| Tool | Actions | Description |
|------|---------|-------------|
| `server_info` | list, status, health | Query server information, check cloud provider and platform status |
| `server_logs` | logs, monitor | Fetch platform/Docker logs and system metrics via SSH |
| `server_manage` | add, remove, destroy | Register, unregister, or destroy cloud servers |
| `server_maintain` | update, restart, maintain | Update platform, restart servers, run full maintenance |
| `server_secure` | secure, firewall, domain | SSH hardening, firewall rules, domain/SSL management (10 subcommands) |
| `server_backup` | backup, snapshot | Backup/restore databases and create/manage VPS snapshots |
| `server_provision` | create | Provision new servers on cloud providers |
| `server_audit` | audit | Run security audit with summary/json/score output formats |

> All destructive operations (destroy, restore, snapshot-delete, provision, restart, maintain, snapshot-create) require `SAFE_MODE=false` to execute.

## CI/CD Integration

Use `kastell audit` in your CI pipeline to enforce security baselines:

```yaml
# .github/workflows/security-audit.yml
name: Security Audit
on:
  schedule:
    - cron: '0 6 * * 1'  # Weekly Monday 6 AM
  workflow_dispatch:
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install -g kastell
      - run: kastell audit --host root@${{ secrets.SERVER_IP }} --threshold 70 --json > audit-result.json
      - uses: actions/upload-artifact@v4
        with:
          name: audit-report
          path: audit-result.json
```

The `--threshold` flag causes a non-zero exit code when the score falls below the target, failing the CI job automatically.

## What's Next

- kastell.dev website
- Guard daemon and fleet management
- Plugin ecosystem for AI IDEs

## Philosophy

> Infrastructure should be boring, predictable, and safe.

Kastell is not a script. It's your DevOps safety layer for self-hosted infrastructure.

## License

Apache 2.0 -- see [LICENSE](LICENSE)

## Support

- [GitHub Issues](https://github.com/kastelldev/kastell/issues) -- Bug reports and feature requests
- [Changelog](CHANGELOG.md) -- Version history

---

Built by [@omrfc](https://github.com/omrfc)
