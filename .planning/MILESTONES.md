# Milestones
## v1.3 Kastell Rebrand + Dokploy Adapter (Shipped: 2026-03-06)

**Goal:** Rename quicklify to kastell across entire codebase, switch to Apache 2.0 license, and add Dokploy as a second platform adapter alongside Coolify.

**Phases completed:** 4 phases, 8 plans (7 documented + 1 quick fix)
**Tests:** 2099 -> 2191 (+92 new)
**Git range:** 46 commits over 2 days (2026-03-05 -> 2026-03-06)
**Codebase:** ~13,400 LOC TypeScript

**Key accomplishments:**
- Full rebrand from Quicklify to Kastell (CLI, types, config, env vars, package name, docs, CI)
- Auto-migration from ~/.quicklify to ~/.kastell with zero data loss
- Apache 2.0 license with NOTICE file (from MIT)
- PlatformAdapter interface + CoolifyAdapter extraction (adapter pattern for multi-platform support)
- DokployAdapter implementation (provision, health check, backup, status via CLI and MCP)
- Platform-aware health verification and mode guard (Dokploy:3000, Coolify:8000)

**Known Gaps (accepted):**
- Phase 10 GSD documentation missing (code complete, verified via integration check)
- Nyquist validation not completed for any phase

**Archive:** [v1.3-ROADMAP.md](./milestones/v1.3-ROADMAP.md) | [v1.3-REQUIREMENTS.md](./milestones/v1.3-REQUIREMENTS.md) | [v1.3-MILESTONE-AUDIT.md](./milestones/v1.3-MILESTONE-AUDIT.md)

---

## v1.2.1 — Refactor + Security Patch (Shipped: 2026-03-02)

**Goal:** Consolidate provider duplication, harden SCP security, and extract deployServer() — preparing codebase for Dokploy (v1.3.0).

**Phases completed:** 3 phases, 6 plans, 12 tasks
**Tests:** 2047 → 2099 (+52 new)
**Git range:** d701d0d..8f52a4c (29 commits)

**Key accomplishments:**
- Centralized 4-provider hardcoded lists across 14 files into single PROVIDER_REGISTRY in constants.ts
- Deduplicated stripSensitiveData() from 4 provider files into single base.ts export
- Hardened SCP with stdin=ignore, BatchMode=yes, 5-minute SIGTERM timeout (MCP stream safety)
- Hardened getProviderToken() with .trim() + whitespace-only guard
- Extracted deployServer() (~360 lines) from init.ts to core/deploy.ts (612→243 lines)
- Added OWASP-driven sanitizeResponseData() whitelist for API error responses

**Archive:** [v1.2.1-ROADMAP.md](./milestones/v1.2.1-ROADMAP.md) | [v1.2.1-REQUIREMENTS.md](./milestones/v1.2.1-REQUIREMENTS.md) | [v1.2.1-MILESTONE-AUDIT.md](./milestones/v1.2.1-MILESTONE-AUDIT.md)

---


## v1.2.0 — Generic Server Management (Shipped: 2026-02-28)

**Goal:** Break Coolify dependency, eliminate CLI/MCP code duplication, add bare server management.

**Phases completed:** 3 phases, 12 plans

**Key accomplishments:**
- All CLI commands refactored to thin wrappers around core/ modules (eliminated duplicated business logic)
- `--mode bare` support: provision and manage generic VPS servers without Coolify
- ServerRecord `mode` field with backward-compatible migration (legacy records default to "coolify")
- MCP tools aligned with core/ modules, supporting bare mode via parameter
- Shared constants centralized to src/constants.ts (10 constants, zero duplicates)
- SAFE_MODE bug fixed in restore.ts (now uses canonical isSafeMode())
- 1921 tests passing across 74 suites (95%+ coverage)

**Archive:** [v1.2.0-ROADMAP.md](./milestones/v1.2.0-ROADMAP.md) | [v1.2.0-REQUIREMENTS.md](./milestones/v1.2.0-REQUIREMENTS.md) | [v1.2.0-MILESTONE-AUDIT.md](./milestones/v1.2.0-MILESTONE-AUDIT.md)

---

## v1.1.0 — MCP Server + Security (2026-02-27)

**Goal:** Add Claude AI integration via MCP and harden security.

**Shipped:**
- MCP server with 7 tools (server_info, server_logs, server_manage, server_maintain, server_secure, server_backup, server_provision)
- 12 security fixes (path traversal, assertValidIp, sanitizeStderr, port validation, provider enum, manifest hardening)
- SSH key auto-generation during provision
- Full documentation update

**Last phase:** 0 (pre-GSD)

## v1.0.0 — Initial Release (2026-02-23)

**Goal:** Deploy and manage Coolify on cloud VPS providers via CLI.

**Shipped:**
- 23 CLI commands (init, status, destroy, secure, firewall, domain, backup, restore, snapshot, maintain, logs, etc.)
- 4 cloud providers (Hetzner, DigitalOcean, Vultr, Linode)
- YAML config support
- SAFE_MODE protection
- SSH security hardening + fail2ban
- UFW firewall management
- Domain + SSL management
- Backup/restore + cloud snapshots

**Last phase:** 0 (pre-GSD)

---
*Last updated: 2026-02-28*
