# Kastell

## What This Is

Kastell is the autonomous security and maintenance layer for modern self-hosted infrastructure. CLI tool and MCP server that secures, monitors, audits, and maintains servers on cloud VPS providers (Hetzner, DigitalOcean, Vultr, Linode). Supports Coolify-managed, Dokploy-managed, and bare (generic) servers with full platform parity. Full lifecycle: provisioning, security hardening, security auditing (46 checks, 9 categories), domain management, firewall, backups, snapshots, monitoring, and maintenance — all from a single command line or via Claude AI integration. OS keychain token security with buffer storage. Branded interactive TUI with search-based navigation.

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
- ✓ Full rebrand: quicklify -> kastell (CLI, types, config, env vars, package, docs) — v1.3
- ✓ Auto-migration ~/.quicklify -> ~/.kastell with zero data loss — v1.3
- ✓ Apache 2.0 license with NOTICE file — v1.3
- ✓ PlatformAdapter interface + CoolifyAdapter extraction (adapter pattern) — v1.3
- ✓ DokployAdapter (provision, health check, backup, status) — v1.3
- ✓ Platform-aware health verification + mode guard (Dokploy:3000, Coolify:8000) — v1.3
- ✓ Dokploy MCP integration + interactive menu support — v1.3
- ✓ Dokploy update/maintain/logs via adapter dispatch — v1.4
- ✓ SCP Windows path resolution fix — v1.4
- ✓ Locale-safe server metrics (LANG=C prefix) — v1.4
- ✓ sshd_config Include directive parsing for security audit — v1.4
- ✓ --dry-run flag on destructive commands (destroy/update/restart/remove) — v1.4
- ✓ Shell completions for bash/zsh/fish — v1.4
- ✓ Zod-based config validation + `config validate` subcommand — v1.4
- ✓ --version update notification from npm registry — v1.4
- ✓ ASCII logo (figlet) + emoji categories + tooltips in TUI — v1.4
- ✓ Search-based interactive menu with type-to-filter — v1.4
- ✓ README.md + README.tr.md documentation for v1.4 features — v1.4
- ✓ `kastell audit` — 9 categories, 46 checks, severity scoring, fix engine, trend detection — v1.5
- ✓ OS Keychain token security — keychain-first resolution, buffer storage, `kastell auth` commands — v1.5
- ✓ Dokploy restore support — adapter-based restore routing — v1.5
- ✓ Dokploy auto-detection — detectPlatform() for Coolify/Dokploy/Bare — v1.5
- ✓ YAML domain validation — isValidDomain() Zod refine — v1.5
- ✓ Provider API timeout — 15s axios timeout — v1.5
- ✓ 11 security fixes — path traversal, download-then-execute, IP quoting, etc. — v1.5
- ✓ Code quality refactoring — deployServer decomposition, maintain DRY, shared adapters, provider HOF — v1.5
- ✓ MCP server_audit tool — summary/json/score formats — v1.5
- ✓ Audit watch mode + CI integration — GitHub Actions example — v1.5

### Active

<!-- Next milestone: v1.6 Audit Expand + Evidence + Altyapı -->

- [ ] Audit snapshot/diff/compare (deferred from v1.5)
- [ ] `kastell evidence collect` — IP abuse kanıt paketi
- [ ] ServerRecord.mode required + file locking + rate limit backoff
- [ ] Adapter contract dokümantasyonu

### Planned (Kastell Roadmap)

- **v1.6** — Audit Expand + Evidence + Altyapı: audit snapshot/diff/compare, evidence collect, file locking, rate limit, adapter contract docs
- **v1.7** — Guard Core: `kastell guard`, `kastell lock`, `kastell fleet`, `kastell doctor`, bildirimler, backup --schedule, risk trend
- **v2.0** — Plugin ekosistemi (Claude Code marketplace + cross-platform SKILL.md)
- **v3.0** — Web dashboard (premium) + managed servis ($49/$99/$299+)

### Out of Scope

- AI/ML based predictions — use simple thresholds + cron instead
- Manual/no-API providers (Nodesty, OVH manual) — no cloud API = no Kastell value
- Being a container runtime, deployment platform, or OS — Kastell is security + maintenance only

## Context

- **Brand**: Kastell (kastell.dev, npm: kastell, GitHub: kastelldev)
- **Current npm**: `kastell` v1.4.0 published, `quicklify` deprecated
- 24 CLI commands + 8 MCP tools (incl. `kastell audit` + `server_audit`)
- 2467 tests across 112 suites (95%+ coverage)
- CI: GitHub Actions (3 OS x 2 Node versions = 6 matrix)
- Codebase: ~17,500 LOC TypeScript
- Architecture: Commands (thin wrappers) -> Core (business logic) -> Providers (plugin) / Adapters (platform)
- Supports three server modes: `coolify` (default), `dokploy`, and `bare` (generic VPS)
- v1.5 shipped: kastell audit (46 checks, fix engine, trend detection), OS keychain security, Dokploy parity, code refactoring
- **Target audience**: Indie hackers (Y1) -> Micro-DevOps teams (Y2) -> SaaS compliance (Y3)

### CLAUDE.md Yapisi (2026-03-05 yeniden yapilandirildi)
IF-ELSE router pattern uygulandi — context bloat onleme:
- **Global `~/.claude/CLAUDE.md`** (32 satir): Router — durustluk + compaction kurtarma + kural yonlendirici
- **`~/.claude/rules/`** (8 dosya): coding, git, security, post-task, research, subagent, contract, learning
- **`~/.claude/lessons/global.md`**: Global lessons learned
- **Kastell `CLAUDE.md`** (57 satir): Tech stack + skill routing + architecture + conventions
- **Kastell `.claude/skills/`** (5 dosya): cli-command, mcp-tool, provider, publish, testing
- Kurallar kosullu yukleniyor — her oturumda sadece gerekli dosyalar okunur

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
| Adapter pattern for platform abstraction | Clean extension point: implement interface + add factory case | ✓ Good — v1.3 |
| Apache 2.0 license (from MIT) | Patent protection for security tooling | ✓ Good — v1.3 |
| Auto-migration ~/.quicklify -> ~/.kastell | Zero data loss rebrand, .migrated flag prevents re-copy | ✓ Good — v1.3 |
| resolvePlatform() normalization | Legacy records without platform field default to coolify | ✓ Good — v1.3 |
| requireManagedMode() evolution | Platform-aware guard replaces requireCoolifyMode (deprecated alias kept) | ✓ Good — v1.3 |
| Adapter dispatch for update/maintain/logs | Zero platform conditionals in command files — v1.4 | ✓ Good — v1.4 |
| figlet for ASCII logo (zero-dep, TS-native) | Minimal dependency for branded TUI — v1.4 | ✓ Good — v1.4 |
| Search prompt (custom filter) over plugin | inquirer@12 plugin incompatibility — v1.4 | ✓ Good — v1.4 |
| Static shell completions (not runtime-derived) | Fragile runtime reflection unnecessary for 24 static commands — v1.4 | ✓ Good — v1.4 |
| Zod .strict() for config validation | Replaces manual KNOWN_KEYS, cleaner unknown key detection — v1.4 | ✓ Good — v1.4 |
| LANG=C prefix on metrics commands | Locale-safe parsing without changing system locale — v1.4 | ✓ Good — v1.4 |
| Dokploy restore via adapter dispatch | PlatformAdapter.restoreBackup() with Docker Swarm scaling | ✓ Good — v1.5 |
| detectPlatform() SSH-based auto-detect | Check Dokploy first (less false positive), fallback to bare | ✓ Good — v1.5 |
| OS Keychain via @napi-rs/keyring | Static import, constructor-level try/catch, buffer storage | ✓ Good — v1.5 |
| Composition over inheritance for adapters | Plain functions for shared utilities, not class hierarchy | ✓ Good — v1.5 |
| withProviderErrorHandling HOF | Single error handling pattern across 4 providers | ✓ Good — v1.5 |
| deployServer decomposition | 3 named phases + KastellResult return type | ✓ Good — v1.5 |
| 2 SSH batches for audit | Fast config reads vs slower active probes | ✓ Good — v1.5 |
| Severity-weighted scoring | critical=3, warning=2, info=1 for proportional scores | ✓ Good — v1.5 |
| Atomic audit history writes | temp+rename for audit-history.json integrity | ✓ Good — v1.5 |
| GitHub repo transfer deferred | Less risk, do after npm publish is stable | — Pending |

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

## Current State

**Shipped:** v1.5 Security + Dokploy + Audit (2026-03-08)

**Recent v1.5 delivery:**
- kastell audit: 9 categories, 46 checks, severity scoring, 6 formatters, fix engine, trend detection, MCP tool, watch mode, CI
- OS Keychain token security: keychain-first resolution, buffer storage, zero-on-exit cleanup, `kastell auth` commands
- Dokploy platform parity complete: restore support, auto-detection, adapter-based routing
- Code quality: deployServer decomposition, maintain DRY, shared adapter utilities, withProviderErrorHandling HOF
- 11 security fixes + dead code cleanup

**Next:** v1.6 Guard Core

---
*Last updated: 2026-03-08 after v1.5 milestone*
