# Roadmap: Kastell (formerly Quicklify)

## Milestones

- ✅ **v1.0.0 Initial Release** — Phases pre-GSD (shipped 2026-02-23)
- ✅ **v1.1.0 MCP Server + Security** — Phases pre-GSD (shipped 2026-02-27)
- ✅ **v1.2.0 Generic Server Management** — Phases 1-3 (shipped 2026-02-28)
- ✅ **v1.2.1 Refactor + Security Patch** — Phases 4-6 (shipped 2026-03-02)
- ✅ **v1.3 Kastell Rebrand + Dokploy** — Phases 7-10 (shipped 2026-03-06)
- ✅ **v1.4 TUI + Dokploy + DX** — Phases 11-15 (shipped 2026-03-07)
- ✅ **v1.5 Security + Dokploy + Audit** — Phases 16-22 (shipped 2026-03-08)
- 🚧 **v1.6 Audit Expand + Evidence + Altyapi** — Phases 23-27 (in progress)
- ⬜ **v1.7 Guard Core** — guard daemon, lock --production, fleet, doctor, bildirimler, backup --schedule, risk trend
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

### v1.6 Audit Expand + Evidence + Altyapi (In Progress)

**Milestone Goal:** Extend audit with snapshot persistence and structured diffing, add forensic evidence collection, and harden infrastructure with file locking and rate limit backoff.

- [x] **Phase 23: Infrastructure Foundation** - File locking, rate limit backoff, ServerRecord.mode migration (completed 2026-03-09)
- [x] **Phase 24: Audit Snapshots** - Snapshot save/load/list with schema versioning (completed 2026-03-11)
- [x] **Phase 25: Audit Diff and Compare** - Check-by-check diff, cross-server compare, CI integration (completed 2026-03-11)
- [ ] **Phase 26: Evidence Collection** - Forensic evidence package with SHA256 manifest
- [ ] **Phase 27: Adapter Contract Documentation** - PlatformAdapter interface docs and test fixtures

## Phase Details

### Phase 23: Infrastructure Foundation
**Goal**: Infrastructure is hardened against concurrent writes and API rate limits
**Depends on**: Phase 22 (v1.5 complete)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04
**Success Criteria** (what must be TRUE):
  1. Two simultaneous CLI/MCP writes to servers.json do not corrupt data (file locking prevents race)
  2. Provider API calls that receive 429 responses are retried with exponential backoff and succeed on retry
  3. Rate limit retry respects Retry-After header when the provider includes it
  4. All existing ServerRecord entries without explicit mode field are auto-migrated to have mode set
**Plans:** 3/3 plans complete
Plans:
- [ ] 23-01-PLAN.md — Create withFileLock and withRetry utility modules with TDD
- [ ] 23-02-PLAN.md — Integrate withFileLock into config/history writes + mode migration
- [ ] 23-03-PLAN.md — Integrate withRetry into provider GET methods

### Phase 24: Audit Snapshots
**Goal**: Users can persist and manage audit results as versioned snapshots
**Depends on**: Phase 23 (file locking required for snapshot writes)
**Requirements**: SNAP-01, SNAP-02, SNAP-03, SNAP-04
**Success Criteria** (what must be TRUE):
  1. User can run `kastell audit --snapshot` and a dated JSON file is saved under `~/.kastell/snapshots/{server}/`
  2. User can run `kastell audit --snapshots` and see a list of saved snapshots with dates, scores, and names
  3. User can name a snapshot (e.g., `--snapshot pre-upgrade`) for easy reference later
  4. Every snapshot includes a `schemaVersion` field so future audit changes do not break old snapshots
**Plans:** 2/2 plans complete
Plans:
- [ ] 24-01-PLAN.md — Snapshot core module with TDD (save, load, list, types)
- [ ] 24-02-PLAN.md — Wire snapshot into audit CLI command

### Phase 25: Audit Diff and Compare
**Goal**: Users can track security posture changes over time and across servers
**Depends on**: Phase 24 (snapshot format must exist for diff)
**Requirements**: DIFF-01, DIFF-02, DIFF-03, DIFF-04, DIFF-05
**Success Criteria** (what must be TRUE):
  1. User can diff two snapshots and see which checks improved, regressed, or stayed the same
  2. User can compare two different servers' audit results side-by-side
  3. Diff output in terminal is color-coded: green for improvements, red for regressions
  4. Diff supports `--json` output for CI pipeline consumption
  5. `kastell audit --diff` exits with code 1 when any check regressed (CI can gate on this)
**Plans:** 2/2 plans complete
Plans:
- [ ] 25-01-PLAN.md — Diff engine core with TDD (diffAudits, resolveSnapshotRef, formatters)
- [ ] 25-02-PLAN.md — Wire --diff and --compare into audit CLI command

### Phase 26: Evidence Collection
**Goal**: Users can collect forensic evidence packages for IP abuse complaints with a single command
**Depends on**: Phase 23 (file locking for evidence writes)
**Requirements**: EVID-01, EVID-02, EVID-03, EVID-04
**Success Criteria** (what must be TRUE):
  1. User can run `kastell evidence collect <server>` and get a directory of evidence files
  2. Evidence directory contains firewall rules, auth.log excerpts, listening ports, and system logs
  3. A manifest.json file lists every collected file with its SHA256 checksum for chain-of-custody integrity
  4. Evidence collection completes over a single SSH connection (batch pattern, no repeated connects)
**Plans**: TBD

### Phase 27: Adapter Contract Documentation
**Goal**: PlatformAdapter interface is documented with test fixtures that catch breaking changes
**Depends on**: Nothing (independent, sequenced last for lowest user impact)
**Requirements**: DOCS-01, DOCS-02
**Success Criteria** (what must be TRUE):
  1. A developer can read the adapter contract docs and understand every method's purpose, parameters, and expected behavior
  2. Test fixtures validate that CoolifyAdapter and DokployAdapter conform to the PlatformAdapter contract (CI catches deviations)
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

**Execution Order:** Phases execute in numeric order: 23 -> 24 -> 25 -> 26 -> 27

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. CLI/Core Refactor | v1.2.0 | 5/5 | Complete | 2026-02-28 |
| 2. Bare Mode | v1.2.0 | 4/4 | Complete | 2026-02-28 |
| 3. MCP Refactor | v1.2.0 | 3/3 | Complete | 2026-02-28 |
| 4. Provider & Utility Consolidation | v1.2.1 | 2/2 | Complete | 2026-03-02 |
| 5. SCP Security Hardening | v1.2.1 | 2/2 | Complete | 2026-03-02 |
| 6. init.ts Extract | v1.2.1 | 2/2 | Complete | 2026-03-02 |
| 7. Kastell Rebrand | v1.3 | 3/3 | Complete | 2026-03-05 |
| 8. Platform Adapter Foundation | v1.3 | 2/2 | Complete | 2026-03-06 |
| 9. Dokploy Adapter | v1.3 | 2/2 | Complete | 2026-03-06 |
| 10. Fix addServerRecord Platform Routing | v1.3 | 1/1 | Complete | 2026-03-06 |
| 11. Dokploy Lifecycle Completion | v1.4 | 2/2 | Complete | 2026-03-07 |
| 12. Bug Fixes | v1.4 | 1/1 | Complete | 2026-03-07 |
| 13. Developer Experience | v1.4 | 3/3 | Complete | 2026-03-07 |
| 14. TUI Enhancements | v1.4 | 2/2 | Complete | 2026-03-07 |
| 15. Documentation | v1.4 | 1/1 | Complete | 2026-03-07 |
| 16. Guvenlik Fixleri | v1.5 | 11/11 | Complete | 2026-03-08 |
| 17. Dokploy Tamamlama | v1.5 | 3/3 | Complete | 2026-03-08 |
| 18. Token Guvenligi | v1.5 | 2/2 | Complete | 2026-03-08 |
| 19. Code Quality Refactoring | v1.5 | 4/4 | Complete | 2026-03-08 |
| 20. kastell audit | v1.5 | 5/5 | Complete | 2026-03-08 |
| 21. Wire tokenBuffer (Gap Closure) | v1.5 | — | Complete (absorbed into P18) | 2026-03-08 |
| 22. Platform Auto-Detect (Gap Closure) | v1.5 | — | Complete (absorbed into P17) | 2026-03-08 |
| 23. Infrastructure Foundation | v1.6 | 3/3 | Complete | 2026-03-09 |
| 24. Audit Snapshots | v1.6 | 2/2 | Complete | 2026-03-11 |
| 25. Audit Diff and Compare | 2/2 | Complete   | 2026-03-11 | - |
| 26. Evidence Collection | v1.6 | 0/TBD | Not started | - |
| 27. Adapter Contract Documentation | v1.6 | 0/TBD | Not started | - |

---
*Roadmap created: 2026-02-27*
*Last updated: 2026-03-11 — Phase 25 planned (2 plans, 2 waves)*
