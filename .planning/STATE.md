---
gsd_state_version: 1.0
milestone: v1.7
milestone_name: Guard Core
status: ready_to_plan
stopped_at: Completed 33-mcp-completions-01-PLAN.md
last_updated: "2026-03-14T11:22:56.486Z"
last_activity: 2026-03-14 — Roadmap created, phases 28-33 defined
progress:
  total_phases: 6
  completed_phases: 6
  total_plans: 12
  completed_plans: 12
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
| Phase 29-backup-schedule P01 | 266 | 1 tasks | 2 files |
| Phase 29-backup-schedule P02 | 262 | 2 tasks | 3 files |
| Phase 30-guard-daemon P01 | 238 | 1 tasks | 3 files |
| Phase 30-guard-daemon P02 | 173 | 1 tasks | 3 files |
| Phase 31-risk-trend P01 | 234 | 2 tasks | 4 files |
| Phase 31-risk-trend P02 | 480 | 1 tasks | 3 files |
| Phase 32-doctor P01 | 900 | 1 tasks | 2 files |
| Phase 32-doctor P02 | 353 | 1 tasks | 3 files |
| Phase 33-mcp-completions P02 | 2 | 1 tasks | 2 files |
| Phase 33-mcp-completions P01 | 483 | 2 tasks | 7 files |

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
- [Phase 29-backup-schedule]: schedules.json separate from servers.json — avoids schema mutation and migration risk
- [Phase 29-backup-schedule]: Runtime bare/Coolify detection in backup script via docker ps | grep coolify — handles server type changes after scheduling
- [Phase 29-backup-schedule]: validateCronExpr does 5-field minimal check only — VPS crontab binary is authoritative validator
- [Phase 29-backup-schedule]: handleScheduleOption() as private helper keeps backupCommand thin — schedule branch before other logic
- [Phase 30-guard-daemon]: MetricSnapshot added to shared src/types/index.ts for Phase 32 Doctor compatibility
- [Phase 30-guard-daemon]: Guard shell script uses sshd -T as audit proxy (GUARD-04) — VPS cannot call kastell binary
- [Phase 30-guard-daemon]: status subcommand skips checkSshAvailable pre-flight — guardStatus handles SSH errors directly
- [Phase 30-guard-daemon]: parent guard command has no .action() — only subcommands get actions to avoid Commander routing issue
- [Phase 31-risk-trend]: computeTrend is a pure function — no I/O, accepts history array + options
- [Phase 31-risk-trend]: formatters/trend.ts not exported through formatters/index.ts — audit command in Plan 02 imports directly
- [Phase 31-risk-trend]: --trend branch placed after server resolution so ip is available for loadAuditHistory
- [Phase 31-risk-trend]: days option parsed with parseInt in command layer keeping computeTrend signature clean
- [Phase 32-doctor]: Swap/packages/fail2ban/backup/docker checks skip gracefully (null) when SSH data unavailable — no --fresh run yet
- [Phase 32-doctor]: checkAuditRegressionStreak requires 2+ consecutive score-decrease transitions (maxStreak >= 2) per DOC-04 streak semantics
- [Phase 32-doctor]: doctorCommand signature changed from (options?, version?) to (server?, options?, version?) — backward-compatible since both params optional
- [Phase 32-doctor]: ora mocked in tests via jest.mock to prevent spinner.start TypeError in non-TTY environment
- [Phase 33-mcp-completions]: guard subcommand completions in bash use prev-based case block (consistent with firewall/config pattern)
- [Phase 33-mcp-completions]: ALL_COMMANDS updated from 24 to 26 entries to include guard and lock
- [Phase 33-mcp-completions]: serverLock safety gate at MCP layer (not in applyLock) — gate visible before SSH call
- [Phase 33-mcp-completions]: serverDoctor json format returns raw DoctorResult (not wrapped in mcpSuccess)

### Pending Todos

None.

### Blockers/Concerns

- Phase 30 (Guard): research flag raised — remote cron script versioning strategy and guard-env.sh token injection need specification before implementation. Consider `/gsd:research-phase` before planning Phase 30.
- Phase 30 open question: backup schedule storage — separate schedule.json (recommended) vs ServerRecord field. Resolve during Phase 29 planning.

## Session Continuity

Last session: 2026-03-14T11:22:56.478Z
Stopped at: Completed 33-mcp-completions-01-PLAN.md
Next action: `/gsd:plan-phase 28`
