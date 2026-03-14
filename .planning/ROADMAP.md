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
- 🚧 **v1.7 Guard Core** — Phases 28-33 (in progress)
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

### 🚧 v1.7 Guard Core (In Progress)

**Milestone Goal:** Autonomous security monitoring daemon, one-command server hardening, scheduled backups, risk trend with cause analysis, and proactive operations intelligence — establishing guard as the core Kastell value driver.

- [x] **Phase 28: Lock** - One-command server hardening with idempotency, platform awareness, and audit score delta (completed 2026-03-14)
- [x] **Phase 29: Backup Schedule** - Scheduled backup via remote cron with overlap protection and idempotent install (completed 2026-03-14)
- [ ] **Phase 30: Guard Daemon** - Autonomous security monitoring daemon running as remote cron on VPS with metric collection
- [ ] **Phase 31: Risk Trend** - Audit score trend with per-check cause attribution and time-bounded queries
- [ ] **Phase 32: Doctor** - Proactive operations analysis from cached snapshots and metric history
- [ ] **Phase 33: MCP + Completions** - MCP tools for guard/doctor/lock and shell completion updates

## Phase Details

### Phase 28: Lock
**Goal**: Users can harden any registered server to production standard with a single command, safely and repeatably
**Depends on**: Nothing (first phase of v1.7)
**Requirements**: LOCK-01, LOCK-02, LOCK-03, LOCK-04, LOCK-05, LOCK-06
**Success Criteria** (what must be TRUE):
  1. User runs `kastell lock <server> --production` and all 5 hardening measures (SSH key-only auth, fail2ban, UFW, sysctl hardening, unattended-upgrades) are applied in a single SSH session
  2. Running `kastell lock <server> --production` a second time completes without error, skipping already-applied steps
  3. User runs `kastell lock <server> --production --dry-run` and sees a preview of all changes without any modification to the server
  4. Lock correctly preserves Coolify port 8000 or Dokploy port 3000 in UFW rules based on the server's registered platform
  5. The output shows the audit score before and after hardening so the user can verify improvement
**Plans:** 2/2 plans complete

Plans:
- [ ] 28-01-PLAN.md — Core lock module (types, command builders, applyLock orchestrator)
- [ ] 28-02-PLAN.md — CLI command wrapper + registration

### Phase 29: Backup Schedule
**Goal**: Users can configure automated backup schedules that run reliably on the VPS without requiring the user's machine to be online
**Depends on**: Nothing (independent of Phase 28)
**Requirements**: BKUP-01, BKUP-02, BKUP-03, BKUP-04, BKUP-05
**Success Criteria** (what must be TRUE):
  1. User runs `kastell backup <server> --schedule "0 3 * * *"` and a cron entry is installed on the VPS that runs backups at the specified time
  2. User runs `kastell backup <server> --schedule list` and sees the currently configured cron expression
  3. User runs `kastell backup <server> --schedule remove` and the cron entry is removed from the VPS
  4. Running `kastell backup <server> --schedule "0 3 * * *"` a second time replaces the existing entry — there is exactly one kastell backup cron line after any number of installs
  5. If two backup runs overlap, the second exits immediately without corrupting the backup, because a lock file on the VPS prevents concurrent execution
**Plans:** 2/2 plans complete

Plans:
- [ ] 29-01-PLAN.md — Core backupSchedule module (types, command builders, orchestrators, schedules.json)
- [ ] 29-02-PLAN.md — CLI --schedule option + Commander registration

### Phase 30: Guard Daemon
**Goal**: Users can install an autonomous security monitoring daemon on any VPS that continuously tracks disk, RAM, CPU, and audit score regressions — logging all findings to a persistent log file
**Depends on**: Phase 28 (lock establishes SSH hardening patterns; guard reuses single-heredoc SSH approach and idempotent cron install)
**Requirements**: GUARD-01, GUARD-02, GUARD-03, GUARD-04, GUARD-05, GUARD-06, GUARD-07, GUARD-08, GUARD-09, GUARD-10
**Success Criteria** (what must be TRUE):
  1. User runs `kastell guard start <server>` and a cron entry is installed on the VPS; the guard script runs every 5 minutes checking disk, RAM, and CPU thresholds
  2. User runs `kastell guard status <server>` and sees whether the guard is running, the last check timestamp, and any active threshold breaches from the log
  3. User runs `kastell guard stop <server>` and the cron entry is removed; subsequent guard status shows guard as inactive
  4. Running `kastell guard start <server>` twice results in exactly one cron entry — no duplicate guard entries accumulate
  5. Guard writes all check outcomes and threshold breaches to `/var/log/kastell-guard.log` on the VPS; the log is readable via SSH
  6. Guard writes a MetricSnapshot (disk, RAM, CPU, timestamp) on each run to a file on the VPS that doctor can read later
**Plans**: 2 plans

Plans:
- [ ] 30-01-PLAN.md — Core guard module (types, command builders, orchestrators, shell script, state management)
- [ ] 30-02-PLAN.md — CLI command wrapper + Commander subcommand registration

### Phase 31: Risk Trend
**Goal**: Users can see how their server's audit score has changed over time with a cause list explaining which checks drove each score change
**Depends on**: Nothing (reads existing audit-history.json from v1.6; independent of guard runtime)
**Requirements**: TREND-01, TREND-02, TREND-03, TREND-04, TREND-05
**Success Criteria** (what must be TRUE):
  1. User runs `kastell audit <server> --trend` and sees a chronological list of audit scores with deltas (e.g., "62 → 68 +6")
  2. Each trend entry shows which specific checks changed between snapshots — the cause list explains why the score moved, not just by how much
  3. User runs `kastell audit <server> --trend --days 7` and sees only data points from the last 7 days
  4. User runs `kastell audit <server> --trend --json` and receives machine-readable output suitable for scripting or CI
  5. If only one snapshot exists, the command shows the score without a delta or cause list rather than crashing
**Plans**: TBD

### Phase 32: Doctor
**Goal**: Users can run a proactive health analysis that predicts problems before they become incidents, with each finding linked to a concrete remediation command
**Depends on**: Phase 30 (doctor's "disk trending full" and "backup age" checks require at least two MetricSnapshot entries written by guard)
**Requirements**: DOC-01, DOC-02, DOC-03, DOC-04, DOC-05, DOC-06
**Success Criteria** (what must be TRUE):
  1. User runs `kastell doctor <server>` and receives a list of findings grouped by severity (critical / warning / info)
  2. If disk usage has been increasing across two or more MetricSnapshots, doctor reports a "disk trending full" finding with a projected time-to-full estimate
  3. Doctor detects and reports high swap usage, stale packages, elevated fail2ban ban rate, audit score regression streaks, old backups, and reclaimable Docker disk space when present
  4. Each finding includes a description of the problem and a specific `kastell` or shell command the user can run to address it
  5. Doctor completes using cached snapshots without making a live SSH connection unless `--fresh` is passed
**Plans**: TBD

### Phase 33: MCP + Completions
**Goal**: All new v1.7 commands are accessible via Claude AI through MCP tools, and shell completions are updated to include guard, doctor, and lock subcommands
**Depends on**: Phase 30, Phase 32 (guard and doctor must exist before MCP tools can wrap them)
**Requirements**: MCP-01, MCP-02, MCP-03
**Success Criteria** (what must be TRUE):
  1. Claude can start, stop, and check the status of guard on any server via MCP without the user typing CLI commands
  2. Claude can run doctor analysis and lock hardening on a server via MCP and return structured results
  3. Shell completions (bash/zsh/fish) suggest `guard start`, `guard stop`, `guard status`, `doctor`, and `lock --production` when the user presses Tab
**Plans**: TBD

## Paralel Track: kastell.dev Website

> v1.5 (audit) ile paralel — audit publish oldugunda website hazir olmali.

- [ ] Logo kesinlesmeli (website oncesi)
- [ ] kastell.dev website (ayri repo)
- [ ] kastell.dev acilinca -> GitHub + npm homepage'e kastell.dev koy
- [ ] quicklify.omrfc.dev -> kastell.dev redirect yap, sonra kapat

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
| 1-27. Prior milestones | v1.2.0–v1.6 | All | Complete | 2026-03-11 |
| 28. Lock | 2/2 | Complete    | 2026-03-14 | - |
| 29. Backup Schedule | 2/2 | Complete    | 2026-03-14 | - |
| 30. Guard Daemon | v1.7 | 0/2 | Planned | - |
| 31. Risk Trend | v1.7 | 0/TBD | Not started | - |
| 32. Doctor | v1.7 | 0/TBD | Not started | - |
| 33. MCP + Completions | v1.7 | 0/TBD | Not started | - |

---
*Roadmap created: 2026-02-27*
*Last updated: 2026-03-14 — v1.7 Guard Core roadmap added (phases 28-33)*
