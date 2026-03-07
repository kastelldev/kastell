# Roadmap: Kastell (formerly Quicklify)

## Milestones

- ✅ **v1.0.0 Initial Release** — Phases pre-GSD (shipped 2026-02-23)
- ✅ **v1.1.0 MCP Server + Security** — Phases pre-GSD (shipped 2026-02-27)
- ✅ **v1.2.0 Generic Server Management** — Phases 1-3 (shipped 2026-02-28)
- ✅ **v1.2.1 Refactor + Security Patch** — Phases 4-6 (shipped 2026-03-02)
- ✅ **v1.3 Kastell Rebrand + Dokploy** — Phases 7-10 (shipped 2026-03-06)
- ⬜ **v1.4 TUI + Dokploy + DX** — Phases 11-15: Dokploy lifecycle completion, bug fixes, DX improvements, TUI enhancements, documentation
- ⬜ **v1.5 Audit + Website + Hooks** — kastell audit (viral büyüme), IP abuse kanıt, kastell.dev, Dokploy restore, API timeout, 4 hook
- ⬜ **v1.6 Guard Core + Hooks** — guard daemon, lock --production, fleet, doctor genişletme, bildirimler, adapter contract doku, 5 hook
- ⬜ **v1.7 Risk Trend** — risk trend scoring, kastell compare
- ⬜ **v2.0 Plugin Ekosistemi** — Claude Code marketplace, SKILL.md (cross-platform: Cursor/Gemini CLI/Kiro), slash commands, chained workflows, audit --explain, validate_plugins.py CI
- ⬜ **v3.0 Dashboard + Managed Servis** — premium web dashboard, managed servis ($49/$99/$299+), ilk müşteri LA ROMA

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

### v1.4 TUI + Dokploy + DX (In Progress)

**Milestone Goal:** Complete Dokploy platform parity, fix known bugs, improve developer experience, enhance interactive TUI, and update documentation.

- [x] **Phase 11: Dokploy Lifecycle Completion** - Platform-aware update, maintain, and logs for Dokploy servers (completed 2026-03-07)
- [x] **Phase 12: Bug Fixes** - SCP Windows, locale-dependent metrics, sshd_config Include directives (completed 2026-03-07)
- [x] **Phase 13: Developer Experience** - dry-run, shell completions, config validation, version check (completed 2026-03-07)
- [x] **Phase 14: TUI Enhancements** - ASCII logo, emoji categories, tooltips, menu search (completed 2026-03-07)
- [x] **Phase 15: Documentation** - README.md and README.tr.md update for all v1.4 features (completed 2026-03-07)

## Phase Details

### Phase 11: Dokploy Lifecycle Completion
**Goal**: Users can update, maintain, and view logs on Dokploy servers with the same commands they use for Coolify
**Depends on**: Phase 10 (Dokploy Adapter foundation from v1.3)
**Requirements**: DOKP-01, DOKP-02, DOKP-03
**Success Criteria** (what must be TRUE):
  1. User can run `kastell update` on a Dokploy server and Dokploy gets updated to latest version
  2. User can run `kastell maintain` on a Dokploy server and the full 5-step maintenance cycle completes (update + security patches + disk cleanup + Docker prune + reboot if needed)
  3. User can run `kastell logs` on a Dokploy server and see Dokploy container logs (using correct Docker Swarm service names)
  4. All three commands delegate through PlatformAdapter interface -- no platform conditionals in command files
**Plans**: 1 plan
Plans:
- [ ] 15-01-PLAN.md — Update README.md and README.tr.md for all v1.4 features

### Phase 12: Bug Fixes
**Goal**: Existing functionality works correctly on Windows, non-English locales, and Ubuntu 22.04+
**Depends on**: Nothing (independent fixes)
**Requirements**: BUGF-01, BUGF-02, BUGF-03
**Success Criteria** (what must be TRUE):
  1. User can run SCP operations (backup download/upload) on Windows without path resolution errors
  2. User can view accurate server metrics (CPU, RAM, disk) on servers with non-English locales
  3. User gets correct security audit results on Ubuntu 22.04+ servers that use sshd_config Include directives
**Plans**: 1 plan
Plans:
- [ ] 12-01-PLAN.md — Fix SCP Windows path, locale-dependent metrics, sshd_config Include directives

### Phase 13: Developer Experience
**Goal**: Users have safer, more productive workflows with preview mode, shell completions, config validation, and update awareness
**Depends on**: Phase 11 (dry-run on update command needs refactored adapter flow)
**Requirements**: DX-01, DX-02, DX-03, DX-04
**Success Criteria** (what must be TRUE):
  1. User can pass `--dry-run` to destructive commands and see what would happen without executing
  2. User can run `kastell completions bash|zsh|fish` and get a working completion script for their shell
  3. User gets clear, actionable validation errors when their servers.yaml config file has structural or type errors
  4. User sees a notification about available updates when running `kastell --version` and a newer version exists on npm
**Plans**: 3 plans
Plans:
- [ ] 13-01-PLAN.md — Add --dry-run to destroy/update/restart/remove + --version update notification
- [ ] 13-02-PLAN.md — Shell completions command (bash/zsh/fish)
- [ ] 13-03-PLAN.md — Zod config validation migration + config validate subcommand

### Phase 14: TUI Enhancements
**Goal**: Interactive menu looks polished, branded, and is easier to navigate
**Depends on**: Phase 11 (menu must reflect working Dokploy commands)
**Requirements**: TUI-01, TUI-02, TUI-03, TUI-04
**Success Criteria** (what must be TRUE):
  1. User sees the Kastell ASCII art logo when opening the interactive menu
  2. User sees emoji icons next to each menu category for visual distinction
  3. User sees tooltip descriptions when hovering over or selecting menu items
  4. User can type to search and filter menu items in the interactive menu
**Plans**: 2 plans
Plans:
- [ ] 14-01-PLAN.md — Install figlet, create logo utility, add emoji + description tooltips to menu data
- [ ] 14-02-PLAN.md — Switch to search prompt, wire logo display, update tests

### Phase 15: Documentation
**Goal**: README files accurately document the complete v1.4 feature set
**Depends on**: Phase 11, Phase 12, Phase 13, Phase 14 (documents final state)
**Requirements**: DOCS-01
**Success Criteria** (what must be TRUE):
  1. README.md and README.tr.md include Dokploy update/maintain/logs documentation with `--mode dokploy` examples
  2. README files reflect current test counts, feature list, and platform adapter architecture
**Plans**: 2 plans
Plans:
- [ ] 11-01-PLAN.md — Extend PlatformAdapter interface, implement adapter methods, add pollHealth()
- [ ] 11-02-PLAN.md — Refactor core/commands to adapter dispatch, remove Dokploy guards

<details>
<summary>⬜ v1.5 Audit + Website + Hooks</summary>

**Viral Büyüme:**
- [ ] `kastell audit` — ücretsiz güvenlik taraması, viral büyüme motoru
- [ ] IP spoofing/abuse durumlarında firewall + port snapshot → Hetzner'a kanıt

**Website:**
- [ ] kastell.dev website
- [ ] kastell.dev açılınca → GitHub + npm homepage'e kastell.dev koy
- [ ] quicklify.omrfc.dev → kastell.dev redirect yap, sonra kapat
- [ ] Logo kesinleşmeli (website öncesi)

**Dokploy:**
- [ ] Dokploy restore desteği
- [ ] Dokploy version detection (API üzerinden)
- [ ] Auto-detection (sunucuda Coolify mi Dokploy mu?)

**Güvenlik & Altyapı:**
- [ ] YAML domain validation (`isValidDomain()` uygula)
- [ ] Coolify install URL version pinning
- [ ] Provider API timeout (axios calls)

**Hook'lar (4):**
- [ ] SessionStart → CHANGELOG + current focus yükle
- [ ] Stop → TS hata/CHANGELOG/README kontrolü (prompt hook)
- [ ] PreCompact → CHANGELOG snapshot
- [ ] SessionEnd → uncommitted changes uyarısı

</details>

<details>
<summary>⬜ v1.6 Guard Core + Hooks</summary>

**Guard:**
- [ ] `kastell guard` — otonom daemon (arka planda çalışan güvenlik servisi)
- [ ] `kastell lock --production` — sunucuyu production moduna kilitle
- [ ] `kastell fleet` — çoklu sunucu yönetimi
- [ ] `kastell doctor` genişletme — mevcut doctor komutuna ek kontroller

**Bildirimler:**
- [ ] Telegram / Discord / Slack bildirimleri

**Altyapi:**
- [ ] kastell backup --schedule
- [ ] ServerRecord.mode required yapma
- [ ] servers.json file locking (concurrent yazma race condition)
- [ ] Provider API 429 rate limit backoff (exponential retry)

**Dokploy (Ileri):**
- [ ] Dokploy API integration (project/service yönetimi)
- [ ] Swarm status monitoring

**Olgunluk:**
- [ ] Adapter contract dokümantasyonu — shared interface + test fixture (breaking change koruması)

**Hook'lar (5):**
- [ ] SessionStart → kastell audit --silent
- [ ] Deploy sonrası Telegram bildirimi (HTTP hook + n8n)
- [ ] Kastell MCP auto-allow
- [ ] PostToolUse/Bash → session.log
- [ ] UserPromptSubmit → platform/versiyon enjeksiyonu

</details>

<details>
<summary>⬜ v1.7 Risk Trend</summary>

- [ ] Risk trend scoring — zaman içinde güvenlik puanı takibi
- [ ] kastell compare — sunucular arası güvenlik karşılaştırması

</details>

<details>
<summary>⬜ v2.0 Plugin Ekosistemi (AI IDE Entegrasyonu)</summary>

**Plugin Öncesi Olmazsa Olmazlar:**
- [ ] `kastell init` — plugin üzerinden gelen yeni kullanıcılar için interaktif onboarding wizard
- [ ] `kastell audit --explain` — her bulgunun yanında inline "why this matters + fix" blogu

**Plugin Mimarisi:**
- [ ] `claude plugin add --marketplace kastelldev/kastell` entegrasyonu
- [ ] marketplace.json — Claude Code'un plugin add komutunda okuduğu metadata
- [ ] Skill description kalitesi — semantic similarity için spesifik: "Hetzner/Docker/Dokploy deployment security"
- [ ] Platform baglami enjekte eden skill'ler (kastell-docker, kastell-security)
- [ ] `/kastell:audit` gibi slash command'lar (Claude Code'a ozel)
- [ ] SKILL.md universal format — Cursor, Gemini CLI, Kiro gibi araçlarda da çalışır (slash command'lar hariç)
- [ ] scan→score→notify→snapshot chained workflow
- [ ] Her komut bitince sonraki adımı öneren pattern
- [ ] references/troubleshooting.md — Hetzner+Docker hata→çözüm tablosu

**CI & Doğrulama:**
- [ ] validate_plugins.py — plugin yapısını doğrulayan script
- [ ] GitHub Actions CI entegrasyonu

</details>

<details>
<summary>⬜ v3.0 Web Dashboard + Managed Servis</summary>

**Dashboard:**
- [ ] Web dashboard (premium)

**Managed Servis:**
- [ ] Sunucu yonetimini müşteri adına üstlenme — aylık abonelik modeli
  - Starter ~$49 | Growth ~$99 | Scale $299+
- [ ] İlk müşteri: LA ROMA (concierge MVP)
- [ ] Sonra çevre genişletme → landing page

</details>

## Periyodik Bakım

- [ ] MEMORY.md stale bilgi kontrolü (her 2-3 major gorev)
- [ ] LESSONS.md yeni ders ekleme (hata çıkınca)
- [ ] Oturum sonu: CHANGELOG, README, README.tr, SECURITY.md, llms.txt

## Progress

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
| 13. Developer Experience | 3/3 | Complete    | 2026-03-07 | - |
| 14. TUI Enhancements | v1.4 | Complete    | 2026-03-07 | 2026-03-07 |
| 15. Documentation | 1/1 | Complete   | 2026-03-07 | - |

---
*Roadmap created: 2026-02-27*
*Last updated: 2026-03-07 — Phase 14 complete (2/2 plans)*
