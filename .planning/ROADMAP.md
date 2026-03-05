# Roadmap: Kastell (formerly Quicklify)

## Milestones

- ✅ **v1.0.0 Initial Release** — Phases pre-GSD (shipped 2026-02-23)
- ✅ **v1.1.0 MCP Server + Security** — Phases pre-GSD (shipped 2026-02-27)
- ✅ **v1.2.0 Generic Server Management** — Phases 1-3 (shipped 2026-02-28)
- ✅ **v1.2.1 Refactor + Security Patch** — Phases 4-6 (shipped 2026-03-02)
- 🚧 **v1.3 Kastell Rebrand + Dokploy** — Phases 7-9 (in progress)
- ⬜ **v1.5 Website + Audit** — TBD
- ⬜ **v2.0 Guard Core** — TBD
- ⬜ **v2.5 Risk Trend + Auto Patch** — TBD
- ⬜ **v3.0 Web Dashboard + Plugins** — TBD

## Phases

<details>
<summary>✅ v1.0.0 Initial Release — SHIPPED 2026-02-23</summary>

23 CLI commands, 4 cloud providers, YAML config, SAFE_MODE, SSH hardening, firewall, domain/SSL, backup/restore, snapshots. Pre-GSD — no phase plans tracked.

</details>

<details>
<summary>✅ v1.1.0 MCP Server + Security — SHIPPED 2026-02-27</summary>

MCP server with 7 tools, 12 security fixes, SSH key auto-generation, full docs update. Pre-GSD — no phase plans tracked.

</details>

<details>
<summary>✅ v1.2.0 Generic Server Management — SHIPPED 2026-02-28</summary>

- [x] Phase 1: CLI/Core Refactor (5/5 plans) — completed 2026-02-28
- [x] Phase 2: Bare Mode (4/4 plans) — completed 2026-02-28
- [x] Phase 3: MCP Refactor (3/3 plans) — completed 2026-02-28

3 phases, 12 plans, 18 requirements. Full details: [v1.2.0-ROADMAP.md](./milestones/v1.2.0-ROADMAP.md)

</details>

<details>
<summary>✅ v1.2.1 Refactor + Security Patch — SHIPPED 2026-03-02</summary>

- [x] Phase 4: Provider & Utility Consolidation (2/2 plans) — completed 2026-03-02
- [x] Phase 5: SCP Security Hardening (2/2 plans) — completed 2026-03-02
- [x] Phase 6: init.ts Extract (2/2 plans) — completed 2026-03-02

3 phases, 6 plans, 6 requirements. Full details: [v1.2.1-ROADMAP.md](./milestones/v1.2.1-ROADMAP.md)

</details>

### 🚧 v1.3 Kastell Rebrand + Dokploy Adapter (In Progress)

**Milestone Goal:** Rename quicklify to kastell across entire codebase, switch to Apache 2.0 license, and add Dokploy as a second platform adapter alongside Coolify.

- [ ] **Phase 7: Kastell Rebrand** - Quicklify identity fully replaced with Kastell across CLI, packages, config, docs, and CI
- [ ] **Phase 8: Platform Adapter Foundation** - Adapter abstraction layer established, existing Coolify logic extracted into adapter pattern with zero behavior change
- [ ] **Phase 9: Dokploy Adapter** - Dokploy servers can be provisioned, monitored, and backed up through CLI and MCP

## Phase Details

### Phase 7: Kastell Rebrand
**Goal**: Users interact with a CLI called `kastell`, all references to "quicklify" are replaced, config paths are migrated, and the package is published under the new name with Apache 2.0 license
**Depends on**: Phase 6 (v1.2.1 complete)
**Requirements**: BRAND-01, BRAND-02, BRAND-03, BRAND-04, BRAND-05, BRAND-06, BRAND-07, BRAND-08, BRAND-09, BRAND-10
**Success Criteria** (what must be TRUE):
  1. Running `kastell --version` prints the version and `kastell init` starts provisioning — the CLI binary is `kastell`, not `quicklify`
  2. Config is read from `~/.kastell/` and if `~/.quicklify/` exists, its contents are automatically copied to `~/.kastell/` on first run without data loss
  3. `grep -ri "quicklify" src/` returns zero hits (excluding historical CHANGELOG entries), and all test files reference "kastell"
  4. LICENSE file contains Apache 2.0 text, NOTICE file exists, and README/docs reflect the Kastell brand and license
  5. `npm info kastell version` returns `1.3.0` and `npm info quicklify deprecated` shows the deprecation message pointing to kastell
**Plans**: TBD

Plans:
- [ ] 07-01: TBD
- [ ] 07-02: TBD
- [ ] 07-03: TBD

### Phase 8: Platform Adapter Foundation
**Goal**: A `PlatformAdapter` interface exists, existing Coolify functionality is extracted into `CoolifyAdapter` with zero behavior change, and core modules route through the adapter factory
**Depends on**: Phase 7
**Requirements**: ADAPT-01, ADAPT-02, ADAPT-03, ADAPT-04, ADAPT-05, ADAPT-06, ADAPT-07
**Success Criteria** (what must be TRUE):
  1. `PlatformAdapter` interface is defined with cloudInit, healthCheck, backup, and status methods, and a `getAdapter(platform)` factory returns the correct adapter
  2. All existing Coolify operations (provision, status, backup) work identically through `CoolifyAdapter` — no user-facing behavior change
  3. `ServerRecord` accepts an optional `platform` field, legacy records without it default to `"coolify"`, and `getServers()` normalizes them
  4. Mode guard checks are platform-aware (`requireManagedMode()` works for both coolify and dokploy platforms)
  5. All 2099+ existing tests pass with zero regressions after the adapter extraction
**Plans**: TBD

Plans:
- [ ] 08-01: TBD
- [ ] 08-02: TBD
- [ ] 08-03: TBD

### Phase 9: Dokploy Adapter
**Goal**: Users can provision, health-check, and back up Dokploy servers through the same CLI commands and MCP tools used for Coolify, selecting Dokploy via `--platform dokploy` or interactive menu
**Depends on**: Phase 8
**Requirements**: DOKP-01, DOKP-02, DOKP-03, DOKP-04, DOKP-05, DOKP-06, DOKP-07
**Success Criteria** (what must be TRUE):
  1. `kastell init --platform dokploy --provider hetzner` provisions a server with Dokploy installed via cloud-init, and the server record stores `platform: "dokploy"`
  2. `kastell status` on a Dokploy server checks health via the Dokploy API (`/api/admin.getOne` with API key) and reports server status
  3. `kastell backup` on a Dokploy server copies `/etc/dokploy` via SSH+SCP to the local machine
  4. MCP tools accept a `platform` parameter and correctly route Dokploy server operations through `DokployAdapter`
  5. Running `kastell` without arguments shows the interactive menu with a platform selection option for Dokploy
**Plans**: TBD

Plans:
- [ ] 09-01: TBD
- [ ] 09-02: TBD
- [ ] 09-03: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. CLI/Core Refactor | v1.2.0 | 5/5 | Complete | 2026-02-28 |
| 2. Bare Mode | v1.2.0 | 4/4 | Complete | 2026-02-28 |
| 3. MCP Refactor | v1.2.0 | 3/3 | Complete | 2026-02-28 |
| 4. Provider & Utility Consolidation | v1.2.1 | 2/2 | Complete | 2026-03-02 |
| 5. SCP Security Hardening | v1.2.1 | 2/2 | Complete | 2026-03-02 |
| 6. init.ts Extract | v1.2.1 | 2/2 | Complete | 2026-03-02 |
| 7. Kastell Rebrand | v1.3 | 0/? | Not started | - |
| 8. Platform Adapter Foundation | v1.3 | 0/? | Not started | - |
| 9. Dokploy Adapter | v1.3 | 0/? | Not started | - |

---
*Roadmap created: 2026-02-27*
*Last updated: 2026-03-05 — v1.3 phases 7-9 added (Kastell Rebrand + Dokploy Adapter)*
