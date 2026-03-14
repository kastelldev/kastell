---
gsd_state_version: 1.0
milestone: v1.7
milestone_name: Guard Core
status: ready_to_plan
stopped_at: Completed 28-lock-02-PLAN.md
last_updated: "2026-03-14T07:07:20.158Z"
last_activity: 2026-03-14 — Roadmap created, phases 28-33 defined
progress:
  total_phases: 6
  completed_phases: 1
  total_plans: 2
  completed_plans: 2
  percent: 100
---

---
gsd_state_version: 1.0
milestone: v1.7
milestone_name: Guard Core
status: ready_to_plan
last_updated: "2026-03-14"
last_activity: 2026-03-14 — Roadmap created, 6 phases (28-33), 35 requirements mapped
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
**Current focus:** v1.7 Guard Core — Phase 28: Lock

## Current Position

Phase: 28 of 33 (Lock)
Plan: — (not yet planned)
Status: Ready to plan
Last activity: 2026-03-14 — Roadmap created, phases 28-33 defined

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
| Phase 28-lock P01 | 164s | 1 tasks | 2 files |
| Phase 28-lock P02 | 210 | 2 tasks | 3 files |

## Accumulated Context

### Decisions

- Notifications deferred to v1.8 — guard has notification hook point only (GUARD-10)
- Fleet deferred to v1.8 — reduces scope to 6 focused phases
- Guard runs as remote cron on VPS, not local daemon — architecturally correct for CLI tool
- Build order: Lock → Backup Schedule → Guard → Risk Trend → Doctor → MCP
- Phase 30 depends on Phase 28 for SSH heredoc + idempotent cron patterns
- Phase 32 depends on Phase 30 for MetricSnapshot data needed by doctor
- croner chosen over node-cron (CJS-only) for guard daemon internal scheduling
- [Phase 28-lock]: SSH hardening is the only critical step — its failure determines overall success=false, all other 4 steps non-fatal
- [Phase 28-lock]: applyLock uses runAudit for before/after scoring — failures are non-fatal, scoreBefore/scoreAfter remain undefined
- [Phase 28-lock]: Pass server.platform (not server.mode) to applyLock — Platform is coolify|dokploy, ServerMode is coolify|bare

### Pending Todos

None.

### Blockers/Concerns

- Phase 30 (Guard): research flag raised — remote cron script versioning strategy and guard-env.sh token injection need specification before implementation. Consider `/gsd:research-phase` before planning Phase 30.
- Phase 30 open question: backup schedule storage — separate schedule.json (recommended) vs ServerRecord field. Resolve during Phase 29 planning.

## Session Continuity

Last session: 2026-03-14T07:04:06.020Z
Stopped at: Completed 28-lock-02-PLAN.md
Next action: `/gsd:plan-phase 28`
