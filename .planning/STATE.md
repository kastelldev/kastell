---
gsd_state_version: 1.0
milestone: v1.5
milestone_name: Security + Dokploy + Audit
current_plan: 02 of 5 (02 complete)
status: in-progress
stopped_at: Completed 20-02-PLAN.md (check parsers)
last_updated: "2026-03-08T15:13:00Z"
progress:
  total_phases: 4
  completed_phases: 3
  total_plans: 14
  completed_plans: 11
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-07)

**Brand:** Kastell (kastell.dev | npm: kastell | GitHub: kastelldev)
**Core value:** Autonomous server security and maintenance across multiple cloud providers
**Current focus:** Phase 20 kastell audit (Plan 02 complete)

## Current Position

Milestone: v1.5 Security + Dokploy + Audit (in progress)
Phase: 20-kastell-audit (IN PROGRESS)
Current Plan: 02 of 5 (02 complete)
Completed: Plan 01 (audit engine foundation), Plan 02 (check parsers)

## Accumulated Context

### Decisions

- Static import of @napi-rs/keyring with constructor-level try/catch (not dynamic require)
- isKeychainAvailable() tests by attempting Entry construction
- registerCleanupHandlers() requires explicit call to avoid test interference
- Auth commands use inquirer password prompt to mask token input
- auth list shows provider display names with checkmarks, never token values
- SECURITY.md documents Tier 2 hardening: core dump, swap encryption, subprocess safety
- Key decisions from v1.4 archived in PROJECT.md Key Decisions table
- Dokploy checked before Coolify in detectPlatform (less likely false positive)
- detectPlatform returns "bare" on SSH errors (graceful degradation)
- Made restoreBackup optional in PlatformAdapter interface (17-01 added interface without implementation)
- Kept re-exports in restore.ts for backward compatibility (17-03)
- Mocked adapters/factory with explicit resolvePlatform to avoid isBareServer false positive in tests (17-03)
- Step 0 (snapshot prompt) stays in command as UI logic, steps 1-5 delegated to core
- showReport() renders StepResult[] with label mapping instead of boolean fields
- runMaintain() replaces maintainSingleServer() for thin command pattern
- [Phase 19]: Phase functions kept module-private, only deployServer exported
- [Phase 19]: deployServer return type widened from void to KastellResult (backward compatible)
- [Phase 19]: coolifyStatus renamed to platformStatus for platform-agnostic naming
- [Phase 19]: Composition with plain functions for adapter shared utilities (not inheritance)
- [Phase 19]: withProviderErrorHandling HOF applied only to standard error-handling methods
- [Phase 20]: 2 SSH batches: fast config reads vs slower active probes
- [Phase 20]: Severity weights critical=3, warning=2, info=1 for proportional scoring
- [Phase 20]: Placeholder parser registry with noopParser — Plan 02 fills in real parsers
- [Phase 20]: Graceful partial failure: if one SSH batch fails, still process successful batches
- [Phase 20]: Each check parser is a pure function (sectionOutput, platform) => AuditCheck[]
- [Phase 20]: Docker checks return info severity on bare (skip), warning on platforms (Docker expected)
- [Phase 20]: IP forwarding auto-passes on coolify/dokploy since Docker requires it

### Pending Todos

None.

### Blockers/Concerns

None.

## Performance Metrics

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 18    | 01   | 7min     | 3     | 9     |
| 18    | 02   | 5min     | 3     | 4     |
| 17    | 02   | 5min     | 1     | 3     |
| 17    | 03   | 18min    | 1     | 2     |
| 19    | 02   | 9min     | 2     | 3     |
| 19    | 03   | 13min    | 2     | 6     |
| 19    | 01   | 15min    | 2     | 18    |
| 19    | 04   | 5min     | 2     | 8     |
| 20    | 01   | 6min     | 2     | 7     |
| 20    | 02   | 11min    | 2     | 21    |

## Session Continuity

Last session: 2026-03-08T15:13:00Z
Stopped at: Completed 20-02-PLAN.md (check parsers)
Next action: Phase 20 Plan 03 (output formatters)
