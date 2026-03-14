# Roadmap: Kastell (formerly Quicklify)

## Milestones

- ✅ **v1.0.0 Initial Release** — Phases pre-GSD (shipped 2026-02-23)
- ✅ **v1.1.0 MCP Server + Security** — Phases pre-GSD (shipped 2026-02-27)
- ✅ **v1.2.0 Generic Server Management** — Phases 1-3 (shipped 2026-02-28)
- ✅ **v1.2.1 Refactor + Security Patch** — Phases 4-6 (shipped 2026-03-02)
- ✅ **v1.3 Kastell Rebrand + Dokploy** — Phases 7-10 (shipped 2026-03-06)
- ✅ **v1.4 TUI + Dokploy + DX** — Phases 11-15 (shipped 2026-03-07)
- ✅ **v1.5 Security + Dokploy + Audit** — Phases 16-22 (shipped 2026-03-08)
- ✅ **v1.6 Audit Expand + Evidence + Altyapi** — Phases 23-27 (shipped 2026-03-11)
- ✅ **v1.7 Guard Core** — Phases 28-33 (shipped 2026-03-14)
- 🚧 **v1.8 Fleet + Notifications** — Phases 34-40 (in progress)
- ⬜ **v1.9 Audit Genisleme + Cleanup** — 45→400+ check, 9→20+ kategori, Lynis'i gecmek, compliance mapping (PCI DSS/HIPAA/ISO27001), MCP SDK lazy-load (dynamic import — 179 transitive dep CLI startup'tan düşer), Socket.dev alert cleanup (evidence.ts opts.name path traversal guard, execSync alternatifleri), v2.0 öncesi temiz geçiş
- ⬜ **v2.0 Plugin Ekosistemi** — Claude Code marketplace, SKILL.md (cross-platform: Cursor/Gemini CLI/Kiro), slash commands, chained workflows, audit --explain, validate_plugins.py CI
- ⬜ **v3.0 Dashboard + Managed Servis** — premium web dashboard, managed servis ($49/$99/$299+), ilk musteri LA ROMA

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

<details>
<summary>✅ v1.3 Kastell Rebrand + Dokploy Adapter — SHIPPED 2026-03-06</summary>

- [x] Phase 7: Kastell Rebrand (3/3 plans) — completed 2026-03-05
- [x] Phase 8: Platform Adapter Foundation (2/2 plans) — completed 2026-03-06
- [x] Phase 9: Dokploy Adapter (2/2 plans) — completed 2026-03-06
- [x] Phase 10: Fix addServerRecord Platform Routing (1/1 plan) — completed 2026-03-06

4 phases, 8 plans, 24 requirements. Full details: [v1.3-ROADMAP.md](./milestones/v1.3-ROADMAP.md)

</details>

<details>
<summary>✅ v1.4 TUI + Dokploy + DX — SHIPPED 2026-03-07</summary>

- [x] Phase 11: Dokploy Lifecycle Completion (2/2 plans) — completed 2026-03-07
- [x] Phase 12: Bug Fixes (1/1 plan) — completed 2026-03-07
- [x] Phase 13: Developer Experience (3/3 plans) — completed 2026-03-07
- [x] Phase 14: TUI Enhancements (2/2 plans) — completed 2026-03-07
- [x] Phase 15: Documentation (1/1 plan) — completed 2026-03-07

5 phases, 9 plans, 15 requirements. Full details: [v1.4-ROADMAP.md](./milestones/v1.4-ROADMAP.md)

</details>

<details>
<summary>✅ v1.5 Security + Dokploy + Audit — SHIPPED 2026-03-08</summary>

- [x] Phase 16: Guvenlik Fixleri (11 items, pre-GSD) — completed 2026-03-08
- [x] Phase 17: Dokploy Tamamlama (3/3 plans) — completed 2026-03-08
- [x] Phase 18: Token Guvenligi (2/2 plans) — completed 2026-03-08
- [x] Phase 19: Code Quality Refactoring (4/4 plans) — completed 2026-03-08
- [x] Phase 20: kastell audit (5/5 plans) — completed 2026-03-08
- [x] Phase 21: Wire tokenBuffer — Gap Closure (absorbed into P18) — completed 2026-03-08
- [x] Phase 22: Platform Auto-Detect — Gap Closure (absorbed into P17) — completed 2026-03-08

7 phases, 14 plans, 37 requirements. Full details: [v1.5-ROADMAP.md](./milestones/v1.5-ROADMAP.md)

</details>

<details>
<summary>✅ v1.6 Audit Expand + Evidence + Altyapi — SHIPPED 2026-03-11</summary>

- [x] Phase 23: Infrastructure Foundation (3/3 plans) — completed 2026-03-09
- [x] Phase 24: Audit Snapshots (2/2 plans) — completed 2026-03-11
- [x] Phase 25: Audit Diff and Compare (2/2 plans) — completed 2026-03-11
- [x] Phase 26: Evidence Collection (2/2 plans) — completed 2026-03-11
- [x] Phase 27: Adapter Contract Documentation (1/1 plan) — completed 2026-03-11

5 phases, 10 plans, 19 requirements. Full details: [v1.6-ROADMAP.md](./milestones/v1.6-ROADMAP.md)

</details>

<details>
<summary>✅ v1.7 Guard Core — SHIPPED 2026-03-14</summary>

- [x] Phase 28: Lock (2/2 plans) — completed 2026-03-14
- [x] Phase 29: Backup Schedule (2/2 plans) — completed 2026-03-14
- [x] Phase 30: Guard Daemon (2/2 plans) — completed 2026-03-14
- [x] Phase 31: Risk Trend (2/2 plans) — completed 2026-03-14
- [x] Phase 32: Doctor (2/2 plans) — completed 2026-03-14
- [x] Phase 33: MCP + Completions (2/2 plans) — completed 2026-03-14

6 phases, 12 plans, 35 requirements. Full details: [v1.7-ROADMAP.md](./milestones/v1.7-ROADMAP.md)

</details>

### 🚧 v1.8 Fleet + Notifications (In Progress)

**Milestone Goal:** Multi-server fleet visibility, multi-channel alert notifications for guard/doctor, doctor auto-remediation with per-finding interactive confirmation, and structural tech debt cleanup — making Kastell operationally complete for multi-server environments.

## Phase Details

### Phase 34: Layer Violation Fix
**Goal**: The core layer is clean — no upward imports from commands/
**Depends on**: Nothing (first phase of v1.8)
**Requirements**: DEBT-02
**Success Criteria** (what must be TRUE):
  1. `core/deploy.ts` imports only from `core/` and `utils/` — no imports from `commands/`
  2. `kastell provision` and all dependent commands behave identically before and after the fix
  3. Full test suite passes with zero new failures
**Plans**: 1 plan
Plans:
- [ ] 34-01-PLAN.md — Move firewallSetup/secureSetup to core/ and update test mocks

### Phase 35: Adapter Deduplication
**Goal**: Adapter backup/restore duplication eliminated via shared utilities
**Depends on**: Phase 34
**Requirements**: DEBT-01
**Success Criteria** (what must be TRUE):
  1. `adapters/shared.ts` contains the common backup/restore template helpers used by both adapters
  2. `adapters/coolify.ts` and `adapters/dokploy.ts` call shared helpers — no ~80% duplicate code blocks remain
  3. All adapter conformance tests pass with no behavior change
**Plans**: 1 plan
Plans:
- [ ] 35-01-PLAN.md — Extract shared backup/restore helpers and refactor both adapters

### Phase 36: Notification Module
**Goal**: Users can configure and test multi-channel notifications before guard wires them in
**Depends on**: Phase 35
**Requirements**: NOTF-01, NOTF-02, NOTF-03, NOTF-04, NOTF-05, NOTF-06
**Success Criteria** (what must be TRUE):
  1. User can add Telegram, Discord, and Slack channel configs to `~/.kastell/notify.json` via documented YAML fields and the file is written at mode 0o600
  2. `kastell notify test telegram` (and discord, slack) sends a real message to the configured channel and reports success or failure
  3. A single `dispatchNotification()` call fans out to all configured channels simultaneously; one channel failure does not block others
  4. Sending the same alert twice within 30 minutes for the same server and finding type produces only one outbound notification
**Plans**: 2 plans
Plans:
- [ ] 36-01-PLAN.md — Core notification module (config, dispatchers, fan-out, cooldown)
- [ ] 36-02-PLAN.md — CLI notify test command and index.ts registration

### Phase 37: Doctor Fix
**Goal**: Users can remediate doctor findings interactively with full control over what executes
**Depends on**: Phase 35 (clean core, no dependency on Phase 36)
**Requirements**: DFIX-01, DFIX-02, DFIX-03
**Success Criteria** (what must be TRUE):
  1. `kastell doctor --fix` prompts the user once per finding before executing any SSH command on the server
  2. `kastell doctor --fix --force` skips all confirmation prompts and executes all fix commands without interaction
  3. `kastell doctor --fix --dry-run` prints each fix command next to its finding without executing any SSH command
  4. Skipping a finding in interactive mode leaves that finding unfixed and continues to the next one without aborting
**Plans**: 1 plan
Plans:
- [ ] 37-01-PLAN.md — Core doctor-fix module, fixCommand field, CLI wiring and tests

### Phase 38: Fleet Visibility
**Goal**: Users can see all registered servers' health and security posture in one table
**Depends on**: Phase 34 (clean core layer)
**Requirements**: FLEET-01, FLEET-02, FLEET-03, FLEET-04, FLEET-05
**Success Criteria** (what must be TRUE):
  1. `kastell fleet` displays a table with health status and cached audit score for every registered server in under 10 seconds regardless of server count
  2. An unreachable server renders an OFFLINE row with an error reason — it does not crash the command or hide the server from the table
  3. `kastell fleet --json` outputs machine-readable JSON with the same data as the table
  4. `kastell fleet --sort score` (and name, provider) reorders the table rows accordingly
  5. Claude can retrieve fleet data via the `server_fleet` MCP tool
**Plans**: 2 plans
Plans:
- [ ] 38-01-PLAN.md — Core fleet module (health extraction, p-limit concurrency, table/JSON output, sort)
- [ ] 38-02-PLAN.md — MCP server_fleet tool

### Phase 39: Guard Notification Integration
**Goal**: Guard breach detections trigger real notifications through all configured channels
**Depends on**: Phase 36 (notification module must exist first)
**Requirements**: NOTF-07
**Success Criteria** (what must be TRUE):
  1. When guard detects a breach (disk/RAM/CPU threshold exceeded or audit score regression), a notification is dispatched to all configured channels from the user's machine
  2. Guard credentials are never written into the VPS guard script — dispatch happens client-side after `kastell guard status` reads the remote breach log
  3. Repeated breaches of the same type on the same server within the cooldown window produce only one notification, not one per guard cron run
**Plans**: 1 plan
Plans:
- [ ] 39-01-PLAN.md — Wire dispatchGuardBreaches into guard status flow with tests

### Phase 40: Shell Completions + Polish
**Goal**: All v1.8 commands and flags are discoverable via tab completion and codebase is structurally clean
**Depends on**: Phases 36, 37, 38, 39 (all command signatures must be finalized first)
**Requirements**: DEBT-03, DEBT-04
**Success Criteria** (what must be TRUE):
  1. Tab completion for bash, zsh, and fish includes `fleet`, `notify`, and the `--fix`, `--force`, `--sort` flags added in v1.8
  2. `audit` and `evidence` commands and their flags (`--schedule`, `--trend`, `--days`) are present in completion scripts
  3. `postSetup` is decomposed into separate bare and platform functions with no behavioral change to provisioning
**Plans**: TBD

## Paralel Track: kastell.dev Website

- [x] Logo kesinlesti
- [x] kastell.dev website kuruldu
- [x] GitHub + npm homepage'e kastell.dev konuldu
- [x] quicklify.omrfc.dev -> kastell.dev redirect yapildi

## Backlog (Hook'lar)

> Milestone'a bagli degil, ihtiyac oldukca ekle. Gelistirici DX'i, kullaniciya deger katmiyor.

- [ ] SessionStart -> CHANGELOG + current focus yukle
- [ ] Stop -> TS hata/CHANGELOG/README kontrolu (prompt hook)
- [ ] PreCompact -> CHANGELOG snapshot
- [ ] SessionEnd -> uncommitted changes uyarisi
- [ ] SessionStart -> kastell audit --silent
- [ ] Deploy sonrasi Telegram bildirimi (HTTP hook + n8n)
- [ ] Kastell MCP auto-allow
- [ ] PostToolUse/Bash -> session.log
- [ ] UserPromptSubmit -> platform/versiyon enjeksiyonu

## Periyodik Bakim

- [ ] MEMORY.md stale bilgi kontrolu (her 2-3 major gorev)
- [ ] LESSONS.md yeni ders ekleme (hata cikinca)
- [ ] Oturum sonu: CHANGELOG, README, README.tr, SECURITY.md, llms.txt

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-27. Prior milestones | v1.2.0-v1.6 | All | Complete | 2026-03-11 |
| 28-33. Guard Core | v1.7 | 12/12 | Complete | 2026-03-14 |
| 34. Layer Violation Fix | 1/1 | Complete   | 2026-03-14 | - |
| 35. Adapter Deduplication | 1/1 | Complete    | 2026-03-14 | - |
| 36. Notification Module | 2/2 | Complete    | 2026-03-14 | - |
| 37. Doctor Fix | 1/1 | Complete    | 2026-03-14 | - |
| 38. Fleet Visibility | 2/2 | Complete    | 2026-03-14 | - |
| 39. Guard Notification Integration | 1/1 | Complete   | 2026-03-14 | - |
| 40. Shell Completions + Polish | v1.8 | 0/TBD | Not started | - |

---
*Roadmap created: 2026-02-27*
*Last updated: 2026-03-14 — Phase 39 Guard Notification Integration planned (1 plan)*
