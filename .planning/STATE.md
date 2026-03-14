---
gsd_state_version: 1.0
milestone: v1.8
milestone_name: Fleet + Notifications
status: ready_to_plan
stopped_at: Completed 39-01-PLAN.md (Guard Notification Integration)
last_updated: "2026-03-14T20:35:07.143Z"
last_activity: 2026-03-14 — Roadmap created, 7 phases defined (34-40)
progress:
  total_phases: 7
  completed_phases: 6
  total_plans: 8
  completed_plans: 8
  percent: 100
---

---
gsd_state_version: 1.0
milestone: v1.8
milestone_name: Fleet + Notifications
status: ready_to_plan
last_updated: "2026-03-14"
last_activity: 2026-03-14 — v1.8 roadmap created (7 phases, 34-40)
progress:
  [██████████] 100%
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-14)

**Brand:** Kastell (kastell.dev | npm: kastell | GitHub: kastelldev)
**Core value:** Autonomous server security and maintenance across multiple cloud providers
**Current focus:** v1.8 Fleet + Notifications — Phase 34: Layer Violation Fix

## Current Position

Phase: 34 of 40 (Layer Violation Fix)
Plan: — (not yet planned)
Status: Ready to plan
Last activity: 2026-03-14 — Roadmap created, 7 phases defined (34-40)

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0 (this milestone)
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

*Updated after each plan completion*
| Phase 34-layer-violation-fix P01 | 25min | 2 tasks | 9 files |
| Phase 35-adapter-deduplication P01 | 20min | 2 tasks | 3 files |
| Phase 36-notification-module P01 | 4min | 2 tasks | 2 files |
| Phase 36-notification-module P02 | 7min | 2 tasks | 4 files |
| Phase 37-doctor-fix P01 | 35min | 2 tasks | 6 files |
| Phase 38-fleet-visibility P01 | 30min | 2 tasks | 11 files |
| Phase 38-fleet-visibility P02 | 3min | 1 tasks | 3 files |
| Phase 39-guard-notification-integration P01 | 20min | 2 tasks | 4 files |

## Accumulated Context

### Decisions

- Roadmap: Tech debt first (phases 34-35) — builds on clean foundation before fleet/notifications land
- Roadmap: Notification module (phase 36) before guard integration (phase 39) — guard is the final consumer
- Roadmap: Fleet (phase 38) and Doctor --fix (phase 37) are independent — could reorder if needed
- Roadmap: Shell completions last (phase 40) — all command signatures must be finalized first
- Architecture: Guard notification dispatch is client-side only — credentials never go to VPS guard script
- Architecture: `Promise.allSettled + p-limit(5)` for fleet SSH — never sequential for...of
- Architecture: Per-finding confirmation gate in doctor --fix — even with --force, no silent destructive execution
- [Phase 34-layer-violation-fix]: Re-export bridge pattern in commands/ files preserves backward compat when moving functions to core/
- [Phase 34-layer-violation-fix]: inquirer moved to core/secure.ts — core can hold interactive UI for orchestration-level functions called from deploy
- [Phase 35-adapter-deduplication]: Config-object composition over inheritance for adapter backup/restore — simpler with two adapters, no fragile hierarchy
- [Phase 35-adapter-deduplication]: AdapterRestoreConfig.tryRestartCmd string field replaces private tryRestartDokploy() and tryRestartCoolify import — uniform pattern across adapters
- [Phase 36-notification-module]: Cooldown state is client-side at ~/.kastell/notify-cooldown.json — credentials never go to VPS guard script
- [Phase 36-notification-module]: dispatchWithCooldown uses composite key serverName:findingType — prevents cross-server cooldown collision
- [Phase 36-notification-module]: Cooldown timestamp only written on at least one channel success — all-fail allows retry
- [Phase 36-notification-module]: createSpinner from utils/logger used in notify.ts (not direct ora import) — enables clean Jest mocking
- [Phase 37-doctor-fix]: dryRun wins over force in runDoctorFix — safety rule enforced at core level
- [Phase 37-doctor-fix]: --fix auto-forces fresh=true to ensure current server state before SSH remediation
- [Phase 37-doctor-fix]: assertValidIp inline mock (not jest.requireActual) prevents Node v24 jest worker crash
- [Phase 38-fleet-visibility]: checkServerHealth moved to core/health.ts, commands/health.ts re-exports for backward compat (re-export bridge pattern)
- [Phase 38-fleet-visibility]: p-limit pure ESM requires .cjs mock in tests/__mocks__ mapped via moduleNameMapper
- [Phase 38-fleet-visibility]: FleetRow status mapping: healthy=ONLINE, unhealthy=DEGRADED, unreachable/host-key-mismatch=OFFLINE
- [Phase 38-fleet-visibility]: getErrorMessage mock re-setup in beforeEach after jest.resetAllMocks() — factory mock implementations are cleared by resetAllMocks, must restore in beforeEach
- [Phase 38-fleet-visibility]: server_fleet uses readOnlyHint:true — fleet probing reads state but never modifies servers
- [Phase 39-guard-notification-integration]: Sequential for...of in dispatchGuardBreaches (not Promise.all) — avoids concurrent cooldown JSON write races
- [Phase 39-guard-notification-integration]: categorizeBreach is private — tested indirectly via dispatchGuardBreaches by asserting findingType arg to mocked dispatchWithCooldown

### Pending Todos

None.

### Blockers/Concerns

- nodemailer ESM interop: MEDIUM confidence only — validate CJS interop with spike import test before committing to email channel in Phase 36
- Guard cooldown state location: server-side `/var/lib/kastell/` vs client-side `~/.kastell/` — resolve at Phase 36 start, affects Phase 39 guard script changes

## Session Continuity

Last session: 2026-03-14T20:35:07.134Z
Stopped at: Completed 39-01-PLAN.md (Guard Notification Integration)
Next action: `/gsd:plan-phase 34`
