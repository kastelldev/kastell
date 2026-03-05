# Kastell

## What This Is

Kastell is the autonomous security and maintenance layer for modern self-hosted infrastructure. CLI tool and MCP server that secures, monitors, and maintains servers on cloud VPS providers (Hetzner, DigitalOcean, Vultr, Linode). Supports both Coolify-managed and bare (generic) servers. Full lifecycle: provisioning, security hardening, domain management, firewall, backups, snapshots, monitoring, and maintenance — all from a single command line or via Claude AI integration.

**Positioning:** Coolify deploys. Docker runs. Kastell protects.

## Core Value

Autonomous server security and maintenance across multiple cloud providers. Guard is the core product, Provision is complementary.

## Requirements

### Validated

<!-- Shipped and confirmed valuable -->

- ✓ CLI provisions Coolify servers on Hetzner, DigitalOcean, Vultr, Linode — v1.0.0
- ✓ Server status checks (cloud + Coolify health) — v1.0.0
- ✓ SSH security hardening + fail2ban — v1.0.0
- ✓ UFW firewall setup and port management — v1.0.0
- ✓ Custom domain + SSL management — v1.0.0
- ✓ Coolify backup/restore via SSH — v1.0.0
- ✓ Cloud provider snapshots — v1.0.0
- ✓ Server maintenance (update + reboot) — v1.0.0
- ✓ Log viewing (Coolify, Docker, system) — v1.0.0
- ✓ Server destroy with SAFE_MODE protection — v1.0.0
- ✓ YAML config for automated provisioning — v1.0.0
- ✓ MCP server with 7 tools for Claude integration — v1.1.0
- ✓ 12 security hardening measures — v1.1.0
- ✓ SSH key auto-generation during provision — v1.1.0
- ✓ CLI commands import from core/ (eliminate code duplication) — v1.2.0
- ✓ `--mode bare` support for non-Coolify servers — v1.2.0
- ✓ MCP tools aligned with core/ + bare mode support — v1.2.0
- ✓ Provider list centralization (PROVIDER_REGISTRY in constants.ts) — v1.2.1
- ✓ stripSensitiveData consolidation to providers/base.ts — v1.2.1
- ✓ SCP stdin=ignore + BatchMode=yes (MCP stream corruption prevention) — v1.2.1
- ✓ SCP timeout for download/upload operations — v1.2.1
- ✓ Token whitespace trim in getProviderToken() — v1.2.1
- ✓ init.ts refactor — deployServer() extracted to core/deploy.ts — v1.2.1

### Active

<!-- Current milestone: v1.3 Kastell Rebrand + Dokploy Adapter -->

**Part 1: Rebrand (quicklify -> kastell)**
- [ ] package.json name + bin entry: quicklify -> kastell
- [ ] All src/ "quicklify" string references -> "kastell"
- [ ] Config path: ~/.quicklify -> ~/.kastell (migrate if old path exists)
- [ ] Test files "quicklify" references -> "kastell"
- [ ] LICENSE: MIT -> Apache 2.0
- [ ] Docs: README.md, README.tr.md, CHANGELOG.md, SECURITY.md, CONTRIBUTING.md, llms.txt
- [ ] GitHub Actions workflows update
- [ ] MCP server name (settings.json + .mcp.json)
- [ ] CLAUDE.md project instructions update
- [ ] npm deprecate quicklify "Moved to kastell -- https://kastell.dev"
- [ ] npm kastell placeholder -> real content (v0.0.1 -> v1.3.0)

**Part 2: Dokploy Adapter**
- [ ] Platform adapter interface + pattern infrastructure
- [ ] Coolify adapter (refactor existing logic into adapter)
- [ ] Dokploy adapter: cloud-init provisioning
- [ ] Dokploy adapter: health check
- [ ] Dokploy adapter: backup
- [ ] Dokploy MCP tool support

### Planned (Kastell Roadmap)

- **v1.3** — Kastell rebrand (quicklify→kastell rename) + Dokploy adapter
- **v1.5** — kastell.dev website + `kastell audit` (free security scan)
- **v2.0** — Guard Core: `kastell lock`, `kastell fleet`, `kastell guard`, `kastell doctor`, notifications
- **v2.5** — Risk trend scoring + auto security patch
- **v3.0** — Web dashboard (premium) + plugin/recipe system

### Out of Scope

- AI/ML based predictions — use simple thresholds + cron instead
- Manual/no-API providers (Nodesty, OVH manual) — no cloud API = no Kastell value
- Being a container runtime, deployment platform, or OS — Kastell is security + maintenance only

## Context

- **Brand**: Kastell (kastell.dev, npm: kastell, GitHub: kastelldev)
- **Current npm**: `quicklify` v1.2.1 (transitioning to `kastell` in v1.3)
- 23 CLI commands + 7 MCP tools
- 2099 tests across 78 suites (95%+ coverage)
- CI: GitHub Actions (3 OS x 2 Node versions = 6 matrix)
- Codebase: ~11,800 LOC TypeScript
- Architecture: Commands (thin wrappers) → Core (business logic) → Providers (plugin pattern)
- Supports two server modes: `coolify` (default, Coolify-managed) and `bare` (generic VPS)
- v1.2.1 shipped: PROVIDER_REGISTRY centralization, SCP security hardening, init.ts extract
- **Target audience**: Indie hackers (Y1) → Micro-DevOps teams (Y2) → SaaS compliance (Y3)

## Constraints

- **Node.js**: 20+ required (engines field in package.json)
- **Backward compatibility**: Existing CLI commands must not break
- **npm package**: Must remain publishable, no breaking changes to bin entries
- **SSH dependency**: Server operations require SSH client on user machine
- **Provider APIs**: Rate limited, operations must be idempotent where possible

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Commander.js for CLI | Mature, well-documented, TypeScript support | ✓ Good |
| Provider plugin pattern | Easy to add new cloud providers | ✓ Good |
| MCP SDK for AI integration | Standard protocol, Claude-native | ✓ Good |
| SAFE_MODE env var | Prevent accidental destructive operations | ✓ Good |
| Core/ layer separation | Reusable logic across CLI and MCP | ✓ Good — v1.2.0 fully utilized |
| Re-export pattern for backward compat | Commands import from core/ and re-export for test mock compat | ✓ Good |
| ServerMode type (coolify/bare) | Clean mode separation, backward-compatible defaulting | ✓ Good |
| getBareCloudInit separate from Coolify | Bare servers get minimal hardening without Coolify bloat | ✓ Good |
| requireCoolifyMode guard pattern | Consistent mode checking across CLI and MCP | ✓ Good |
| PROVIDER_REGISTRY as const in constants.ts | Single source of truth for all 4 providers + derived types | ✓ Good — v1.2.1 |
| stripSensitiveData in base.ts | Shared provider utility, eliminates 4x duplication | ✓ Good — v1.2.1 |
| SCP stdin=ignore + BatchMode | MCP stream safety + non-interactive hardening | ✓ Good — v1.2.1 |
| Token sanitization at getProviderToken() boundary | DRY — single sanitization point, not at call sites | ✓ Good — v1.2.1 |
| deployServer() in core/deploy.ts | Independently testable deployment logic, init.ts stays thin | ✓ Good — v1.2.1 |
| sanitizeResponseData() whitelist approach | OWASP: only known-safe fields pass through, not blacklist | ✓ Good — v1.2.1 |

## Kastell Command Architecture (Future)

| Command | Purpose | Version |
|---------|---------|---------|
| `kastell audit` | Free security scan + actionable fix commands | v1.5 |
| `kastell lock --production` | One-command server hardening | v2.0 |
| `kastell guard` | Autonomous security daemon | v2.0 |
| `kastell fleet` | Multi-server visibility | v2.0 |
| `kastell doctor` | Proactive operations intelligence | v2.0 |
| `kastell provision` | Server provisioning (current Quicklify) | v1.3 |
| `kastell uninstall` | Clean removal (trust guarantee) | v2.0 |
| `kastell dashboard` | Web UI monitoring (premium) | v3.0 |

## Strategic Principles

- **Guard = heart, Provision = entry point.** Provision is removable, Guard is not
- **Audit = growth engine.** Guard brings revenue, Audit brings distribution
- **Litmus test**: "If Provision disappeared tomorrow, would Kastell still be valuable?" → Deepen Guard until the answer is yes
- **No FUD**: Facts + Fix + Command. No fear-based marketing
- **No AI/ML**: Simple statistics + threshold + cron. Deterministic > magical
- **No feature creep**: Minimal, reliable, predictable
- **Security = Core**: Maintenance = security sustainability, Monitoring = security visibility
- **Open source**: Non-negotiable for root-access trust
- **`--dry-run` everywhere**: Trust barrier solution
- **Dashboard**: Local-first → self-hosted optional → SaaS last (root-access trust)
- **Risk trend**: Always with "why" — trend without cause is meaningless
- **Lifestyle vs infra company**: Decide after Year 1 traction, not now

## Market Analysis (2026-03-04)

**No direct competitor exists.** No single tool covers Kastell's full position (provision + guard + audit + fleet + multi-provider + CLI + MCP).

Partial competitors:
- **Lynis** (cisofy.com/lynis): `lynis audit system` → score 0-100. Audit only, no fix, no guard. **Reference for kastell audit**
- **CrowdSec**: Real-time threat detection only. No provision/backup/maintenance
- **Netdata**: Monitoring dashboard only. Observes, doesn't act
- **Fail2Ban**: Brute force blocking only. One piece of kastell lock
- **Nixopus**: VPS management + deploy. Weak security layer
- **Ansible/Chef/Puppet**: Infra automation for DevOps teams. Too complex for indie hackers

**Kastell's differentiator**: Detect → Decide → Act → Report. **Autonomous.** Others either just report or solve only one piece.

**Market gap**: "I have a server, make it secure and maintained with one command" — nobody fills this for indie hackers.

## Guard Autonomous Architecture (v2.0)

Guard runs as a daemon on the server (cron-based, no AI):
- Health checks every 5 min
- Auto backup on schedule
- Disk/RAM alerts at threshold (e.g., disk > 80%)
- Docker cleanup (docker system prune)
- Auto security patches (unattended-upgrades)
- Multi-channel notifications (Telegram/Discord/Slack/Email)
- Risk trend with "why": `Risk: 62 → 68 ↑` + cause list

All simple statistics + cron. No AI/ML. Deterministic and predictable.

## Brand & Messaging

- **Technical slogan** (website): "Your infrastructure, fortified."
- **Social slogan** (X/indie): "Self-hosting is freedom. Kastell makes it safe."
- **Enterprise term** (future): "Infrastructure Integrity Layer" — not for Year 1
- **Positioning**: Coolify deploys. Docker runs. Kastell protects.

## v1.3 Rebrand Scope (Next Milestone)

Rename quicklify → kastell across entire codebase:
- `package.json` name + bin entry
- All src/ references ("quicklify" string occurrences)
- Config path: `~/.quicklify` → `~/.kastell`
- README.md, README.tr.md, CHANGELOG.md, SECURITY.md, CONTRIBUTING.md, llms.txt
- GitHub Actions workflows
- MCP server name
- Test files referencing "quicklify"
- **LICENSE: MIT → Apache 2.0** (patent koruması)
- `npm deprecate quicklify "Moved to kastell — https://kastell.dev"`
- GitHub repo transfer: `omrfc/quicklify` → `kastelldev/kastell`
- GitHub org description, topics, website URL güncelle
- MCP settings: ~/.claude/settings.json + .mcp.json quicklify → kastell
- CLAUDE.md project instructions: quicklify referansları güncelle
- npm `kastell` placeholder'ı gerçek içerikle değiştir (v0.0.1 → v1.3.0)
- Add Dokploy adapter: `--platform dokploy` flag + cloud-init + health check + backup

## Current Milestone: v1.3 Kastell Rebrand + Dokploy Adapter

**Goal:** Rename quicklify to kastell across entire codebase, switch to Apache 2.0 license, and add Dokploy platform adapter using adapter pattern infrastructure.

**Target features:**
- Full rebrand: package name, bin, config paths, docs, CI, MCP, npm
- Platform adapter pattern: interface + Coolify adapter + Dokploy adapter
- Dokploy lifecycle: provision (cloud-init) + health check + backup
- Dokploy MCP integration

**Decisions:**
- Adapter pattern for platform abstraction (not mode expansion)
- GitHub repo transfer deferred to post-v1.3
- Dokploy restore deferred to v1.5

---
*Last updated: 2026-03-05 — v1.3 milestone started*
